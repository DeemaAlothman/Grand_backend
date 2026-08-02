import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';

@Injectable()
export class CouponsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(dto: CreateCouponDto, actorId: string) {
    if (dto.type === 'PERCENTAGE' && dto.value > 100) {
      throw new BadRequestException(
        'a percentage coupon value cannot exceed 100',
      );
    }

    try {
      const coupon = await this.prisma.coupon.create({
        data: {
          code: dto.code.toUpperCase(),
          type: dto.type,
          value: dto.value,
          maxUses: dto.maxUses,
          minOrderTotal: dto.minOrderTotal,
          startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
          isActive: dto.isActive ?? true,
        },
      });
      await this.auditService.log({
        actorId,
        action: 'coupon.create',
        entityType: 'coupon',
        entityId: coupon.id,
        after: coupon,
      });
      return coupon;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('a coupon with this code already exists');
      }
      throw error;
    }
  }

  findAll() {
    return this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) {
      throw new NotFoundException('coupon not found');
    }
    return coupon;
  }

  async update(id: string, dto: UpdateCouponDto, actorId: string) {
    const before = await this.findOne(id);
    const updated = await this.prisma.coupon.update({
      where: { id },
      data: {
        maxUses: dto.maxUses,
        minOrderTotal: dto.minOrderTotal,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        isActive: dto.isActive,
      },
    });
    await this.auditService.log({
      actorId,
      action: 'coupon.update',
      entityType: 'coupon',
      entityId: id,
      before,
      after: updated,
    });
    return updated;
  }

  /** Validates a coupon against a cart subtotal and computes the discount, without redeeming it yet. */
  async validate(code: string, subtotal: number) {
    const coupon = await this.prisma.coupon.findUnique({
      where: { code: code.toUpperCase() },
    });
    if (!coupon || !coupon.isActive) {
      throw new BadRequestException('coupon not found or inactive');
    }
    const now = new Date();
    if (coupon.startsAt && now < coupon.startsAt) {
      throw new BadRequestException('coupon is not active yet');
    }
    if (coupon.expiresAt && now > coupon.expiresAt) {
      throw new BadRequestException('coupon has expired');
    }
    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
      throw new BadRequestException('coupon has reached its usage limit');
    }
    if (coupon.minOrderTotal && subtotal < Number(coupon.minOrderTotal)) {
      throw new BadRequestException(
        `order subtotal must be at least ${Number(coupon.minOrderTotal)} to use this coupon`,
      );
    }

    const discount =
      coupon.type === 'PERCENTAGE'
        ? (subtotal * Number(coupon.value)) / 100
        : Math.min(Number(coupon.value), subtotal);

    return { coupon, discountAmount: Math.round(discount * 100) / 100 };
  }

  /** Atomically increments usage; returns false (never throws) if the usage limit was hit concurrently. */
  async redeem(
    tx: Prisma.TransactionClient,
    couponId: string,
  ): Promise<boolean> {
    const affected = await tx.$executeRaw`
      UPDATE coupons
      SET "usedCount" = "usedCount" + 1
      WHERE id = ${couponId} AND ("maxUses" IS NULL OR "usedCount" < "maxUses")
    `;
    return affected > 0;
  }
}
