import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from '@node-rs/argon2';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { MailService } from '../../infrastructure/mail/mail.service';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import { TokensService, type DeviceContext } from './tokens.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000; // 30 minutes

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'hex');
  const bufferB = Buffer.from(b, 'hex');
  if (bufferA.length !== bufferB.length) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

type UserWithRole = NonNullable<
  Awaited<ReturnType<UsersService['findByEmail']>>
>;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly tokensService: TokensService,
    private readonly auditService: AuditService,
    private readonly mailService: MailService,
  ) {}

  private toRoleContext(user: UserWithRole) {
    return {
      roleKey: user.role.key,
      permissions: user.role.permissions.map(
        (rolePermission) => rolePermission.permission.key,
      ),
    };
  }

  async register(dto: RegisterDto, device: DeviceContext) {
    const passwordHash = await argon2.hash(dto.password);
    const user = await this.usersService.createCustomer({
      email: dto.email,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
    });

    await this.auditService.log({
      actorId: user.id,
      action: 'auth.register',
      entityType: 'user',
      entityId: user.id,
      ipAddress: device.ipAddress,
    });

    const fullUser = await this.usersService.findByIdWithRole(user.id);
    return this.tokensService.issueTokenPair(
      user.id,
      this.toRoleContext(fullUser!),
      device,
    );
  }

  async login(dto: LoginDto, device: DeviceContext) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordValid = await argon2.verify(user.passwordHash, dto.password);
    if (!passwordValid) {
      await this.auditService.log({
        actorId: user.id,
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: user.id,
        ipAddress: device.ipAddress,
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException(
        `Account is ${user.status.toLowerCase()}`,
      );
    }

    await this.usersService.touchLastLogin(user.id);
    await this.auditService.log({
      actorId: user.id,
      action: 'auth.login',
      entityType: 'user',
      entityId: user.id,
      ipAddress: device.ipAddress,
    });

    return this.tokensService.issueTokenPair(
      user.id,
      this.toRoleContext(user),
      device,
    );
  }

  async refresh(refreshToken: string, device: DeviceContext) {
    // We need the user's current role/permissions to embed a fresh access token,
    // so peek at the subject first; tokensService still verifies signature/expiry/hash below.
    const subject = this.tokensService.peekSubject(refreshToken);
    if (!subject) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.usersService.findByIdWithRole(subject);
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }

    const result = await this.tokensService.rotateRefreshToken(
      refreshToken,
      this.toRoleContext(user),
      device,
    );
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
  }

  async logout(refreshToken: string) {
    await this.tokensService.revoke(refreshToken);
  }

  async logoutAll(userId: string) {
    await this.tokensService.revokeAllForUser(userId);
    await this.auditService.log({
      actorId: userId,
      action: 'auth.logout_all',
      entityType: 'user',
      entityId: userId,
    });
  }

  async forgotPassword(email: string, device: DeviceContext) {
    const user = await this.usersService.findByEmail(email);
    // Always behave the same way whether or not the account exists, to avoid user enumeration.
    if (!user) {
      return;
    }

    const rawToken = randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
      },
    });

    await this.auditService.log({
      actorId: user.id,
      action: 'auth.forgot_password_requested',
      entityType: 'user',
      entityId: user.id,
      ipAddress: device.ipAddress,
    });

    await this.mailService.sendPasswordResetEmail(user.email, rawToken);
  }

  async resetPassword(
    token: string,
    newPassword: string,
    device: DeviceContext,
  ) {
    const tokenHash = hashToken(token);
    const candidates = await this.prisma.passwordResetToken.findMany({
      where: { usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const match = candidates.find((candidate) =>
      safeEqual(candidate.tokenHash, tokenHash),
    );
    if (!match) {
      throw new BadRequestException('Reset token is invalid or expired');
    }

    const passwordHash = await argon2.hash(newPassword);

    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({
        where: { id: match.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: match.userId },
        data: { passwordHash },
      }),
    ]);

    await this.tokensService.revokeAllForUser(match.userId);
    await this.auditService.log({
      actorId: match.userId,
      action: 'auth.password_reset',
      entityType: 'user',
      entityId: match.userId,
      ipAddress: device.ipAddress,
    });
  }
}
