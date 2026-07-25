import { randomUUID, createHash, timingSafeEqual } from 'crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import ms from 'ms';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type {
  AccessTokenPayload,
  RefreshTokenPayload,
} from '../../common/types/jwt-payload.type';

export interface DeviceContext {
  deviceName?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface RoleContext {
  roleKey: string;
  permissions: string[];
}

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

@Injectable()
export class TokensService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async issueTokenPair(
    userId: string,
    role: RoleContext,
    device: DeviceContext,
  ) {
    const accessSecret = this.configService.get<string>('jwt.accessSecret')!;
    const accessExpiresIn = this.configService.get<string>(
      'jwt.accessExpiresIn',
    )!;
    const refreshSecret = this.configService.get<string>('jwt.refreshSecret')!;
    const refreshExpiresIn = this.configService.get<string>(
      'jwt.refreshExpiresIn',
    )!;

    const accessPayload: AccessTokenPayload = {
      sub: userId,
      roleKey: role.roleKey,
      permissions: role.permissions,
      type: 'access',
    };
    const accessToken = this.jwtService.sign(accessPayload, {
      secret: accessSecret,
      expiresIn: accessExpiresIn as ms.StringValue,
    });

    const jti = randomUUID();
    const refreshPayload: RefreshTokenPayload = {
      sub: userId,
      jti,
      type: 'refresh',
    };
    const refreshToken = this.jwtService.sign(refreshPayload, {
      secret: refreshSecret,
      expiresIn: refreshExpiresIn as ms.StringValue,
    });

    const expiresAt = new Date(
      Date.now() + ms(refreshExpiresIn as ms.StringValue),
    );
    await this.prisma.refreshToken.create({
      data: {
        id: jti,
        userId,
        tokenHash: hashToken(refreshToken),
        deviceName: device.deviceName,
        ipAddress: device.ipAddress,
        userAgent: device.userAgent,
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }

  async rotateRefreshToken(
    refreshToken: string,
    role: RoleContext,
    device: DeviceContext,
  ) {
    const payload = this.verifyRefreshToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { id: payload.jti },
    });

    if (!stored) {
      throw new UnauthorizedException('Refresh token not recognized');
    }

    if (stored.revokedAt) {
      // Reuse of an already-rotated/revoked token: possible theft. Nuke every session for this user.
      await this.revokeAllForUser(stored.userId);
      await this.auditService.log({
        actorId: stored.userId,
        action: 'auth.refresh_token_reuse_detected',
        entityType: 'user',
        entityId: stored.userId,
        ipAddress: device.ipAddress,
      });
      throw new UnauthorizedException('Refresh token has already been used');
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    if (!safeEqual(hashToken(refreshToken), stored.tokenHash)) {
      throw new UnauthorizedException('Refresh token mismatch');
    }

    const next = await this.issueTokenPair(stored.userId, role, device);
    const nextPayload = this.jwtService.decode<RefreshTokenPayload>(
      next.refreshToken,
    );

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), replacedByTokenId: nextPayload.jti },
    });

    return { ...next, userId: stored.userId };
  }

  async revoke(refreshToken: string) {
    const payload = this.verifyRefreshToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { id: payload.jti, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return payload.sub;
  }

  revokeAllForUser(userId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Decodes the subject claim without verifying the signature yet. Never trust the result beyond a DB lookup key. */
  peekSubject(refreshToken: string): string | undefined {
    return this.jwtService.decode<RefreshTokenPayload>(refreshToken)?.sub;
  }

  private verifyRefreshToken(refreshToken: string): RefreshTokenPayload {
    try {
      const payload = this.jwtService.verify<RefreshTokenPayload>(
        refreshToken,
        {
          secret: this.configService.get<string>('jwt.refreshSecret'),
        },
      );
      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Invalid token type');
      }
      return payload;
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }
}
