import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
