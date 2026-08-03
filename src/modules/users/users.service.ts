import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import * as argon2 from '@node-rs/argon2';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';

const USER_SELECT = {
  id: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
  status: true,
  mfaEnabled: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
  role: { select: { id: true, key: true, name: true } },
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
      },
    });
  }

  findByIdWithRole(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
      },
    });
  }

  findAll() {
    return this.prisma.user.findMany({
      select: USER_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });
    if (!user) {
      throw new NotFoundException('user not found');
    }
    return user;
  }

  /** Staff account created directly by an admin — active immediately, unlike self-registered customers. */
  async createStaffUser(
    dto: {
      email: string;
      password: string;
      firstName?: string;
      lastName?: string;
      roleKey: string;
    },
    actorId: string,
  ) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('email is already registered');
    }

    const role = await this.prisma.role.findUnique({
      where: { key: dto.roleKey },
    });
    if (!role) {
      throw new NotFoundException('role not found');
    }

    const passwordHash = await argon2.hash(dto.password);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        roleId: role.id,
        status: 'ACTIVE',
      },
      select: USER_SELECT,
    });

    await this.auditService.log({
      actorId,
      action: 'user.create',
      entityType: 'user',
      entityId: user.id,
      after: user,
    });
    return user;
  }

  async updateRole(id: string, roleKey: string, actorId: string) {
    const before = await this.findOne(id);
    const role = await this.prisma.role.findUnique({ where: { key: roleKey } });
    if (!role) {
      throw new NotFoundException('role not found');
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: { roleId: role.id },
      select: USER_SELECT,
    });
    await this.auditService.log({
      actorId,
      action: 'user.update_role',
      entityType: 'user',
      entityId: id,
      before,
      after: user,
    });
    return user;
  }

  async updateStatus(id: string, status: UserStatus, actorId: string) {
    const before = await this.findOne(id);
    const user = await this.prisma.user.update({
      where: { id },
      data: { status },
      select: USER_SELECT,
    });
    await this.auditService.log({
      actorId,
      action: 'user.update_status',
      entityType: 'user',
      entityId: id,
      before,
      after: user,
    });
    return user;
  }

  async createCustomer(params: {
    email: string;
    passwordHash: string;
    firstName?: string;
    lastName?: string;
  }) {
    const existing = await this.prisma.user.findUnique({
      where: { email: params.email },
    });
    if (existing) {
      throw new ConflictException('email is already registered');
    }

    const customerRole = await this.prisma.role.findUnique({
      where: { key: 'customer' },
    });
    if (!customerRole) {
      throw new NotFoundException('customer role is not seeded');
    }

    return this.prisma.user.create({
      data: {
        email: params.email,
        passwordHash: params.passwordHash,
        firstName: params.firstName,
        lastName: params.lastName,
        roleId: customerRole.id,
        status: 'ACTIVE',
      },
    });
  }

  touchLastLogin(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  }
}
