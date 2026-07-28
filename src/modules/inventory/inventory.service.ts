import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import { isFractionalSellingUnit } from './inventory.constants';
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';

type Tx = Prisma.TransactionClient;

async function ensureRow(tx: Tx, variantId: string, warehouseId: string) {
  await tx.inventoryItem.upsert({
    where: { variantId_warehouseId: { variantId, warehouseId } },
    update: {},
    create: { variantId, warehouseId },
  });
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly warehousesService: WarehousesService,
  ) {}

  private async assertWholeNumberIfRequired(
    variantId: string,
    quantity: number,
  ) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      include: { product: { select: { sellingUnit: true } } },
    });
    if (!variant) {
      throw new NotFoundException('variant not found');
    }
    if (
      !isFractionalSellingUnit(variant.product.sellingUnit) &&
      !Number.isInteger(quantity)
    ) {
      throw new BadRequestException(
        `quantity must be a whole number for selling unit "${variant.product.sellingUnit}"`,
      );
    }
  }

  async receive(dto: ReceiveStockDto, actorId: string) {
    await this.assertWholeNumberIfRequired(dto.variantId, dto.quantity);
    const warehouseId =
      dto.warehouseId ?? (await this.warehousesService.findDefault()).id;

    const item = await this.prisma.$transaction(async (tx) => {
      await ensureRow(tx, dto.variantId, warehouseId);
      const updated = await tx.inventoryItem.update({
        where: {
          variantId_warehouseId: { variantId: dto.variantId, warehouseId },
        },
        data: { quantityOnHand: { increment: dto.quantity } },
      });
      await tx.inventoryMovement.create({
        data: {
          variantId: dto.variantId,
          warehouseId,
          type: 'RECEIPT',
          quantity: dto.quantity,
          reason: dto.reason,
          actorId,
        },
      });
      return updated;
    });

    await this.auditService.log({
      actorId,
      action: 'inventory.receive',
      entityType: 'inventory_item',
      entityId: item.id,
      after: item,
    });

    return item;
  }

  async adjust(dto: AdjustStockDto, actorId: string) {
    await this.assertWholeNumberIfRequired(
      dto.variantId,
      Math.abs(dto.quantityDelta),
    );
    const warehouseId =
      dto.warehouseId ?? (await this.warehousesService.findDefault()).id;

    const item = await this.prisma.$transaction(async (tx) => {
      await ensureRow(tx, dto.variantId, warehouseId);
      const current = await tx.inventoryItem.findUniqueOrThrow({
        where: {
          variantId_warehouseId: { variantId: dto.variantId, warehouseId },
        },
      });

      const newOnHand = Number(current.quantityOnHand) + dto.quantityDelta;
      if (newOnHand < Number(current.quantityReserved)) {
        throw new ConflictException(
          'cannot adjust stock below the quantity already reserved by open orders',
        );
      }

      const updated = await tx.inventoryItem.update({
        where: {
          variantId_warehouseId: { variantId: dto.variantId, warehouseId },
        },
        data: { quantityOnHand: { increment: dto.quantityDelta } },
      });
      await tx.inventoryMovement.create({
        data: {
          variantId: dto.variantId,
          warehouseId,
          type: 'ADJUSTMENT',
          quantity: dto.quantityDelta,
          reason: dto.reason,
          actorId,
        },
      });
      return updated;
    });

    await this.auditService.log({
      actorId,
      action: 'inventory.adjust',
      entityType: 'inventory_item',
      entityId: item.id,
      after: item,
      reason: dto.reason,
    });

    return item;
  }

  findBalances(variantId?: string) {
    return this.prisma.inventoryItem.findMany({
      where: variantId ? { variantId } : undefined,
      include: { warehouse: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  findMovements(variantId?: string) {
    return this.prisma.inventoryMovement.findMany({
      where: variantId ? { variantId } : undefined,
      include: { warehouse: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /** Atomically reserves stock for an order line. Returns false (never throws) if not enough is available. */
  async reserve(
    tx: Tx,
    variantId: string,
    warehouseId: string,
    quantity: number,
    orderId: string,
    actorId?: string,
  ): Promise<boolean> {
    await ensureRow(tx, variantId, warehouseId);
    const affected = await tx.$executeRaw`
      UPDATE inventory_items
      SET "quantityReserved" = "quantityReserved" + ${quantity}
      WHERE "variantId" = ${variantId} AND "warehouseId" = ${warehouseId}
        AND ("quantityOnHand" - "quantityReserved") >= ${quantity}
    `;
    if (affected === 0) {
      return false;
    }
    await tx.inventoryMovement.create({
      data: {
        variantId,
        warehouseId,
        type: 'RESERVE',
        quantity,
        orderId,
        actorId,
      },
    });
    return true;
  }

  async release(
    tx: Tx,
    variantId: string,
    warehouseId: string,
    quantity: number,
    orderId: string,
    actorId?: string,
  ) {
    await tx.inventoryItem.update({
      where: { variantId_warehouseId: { variantId, warehouseId } },
      data: { quantityReserved: { decrement: quantity } },
    });
    await tx.inventoryMovement.create({
      data: {
        variantId,
        warehouseId,
        type: 'RELEASE',
        quantity,
        orderId,
        actorId,
      },
    });
  }

  async deduct(
    tx: Tx,
    variantId: string,
    warehouseId: string,
    quantity: number,
    orderId: string,
    actorId?: string,
  ) {
    await tx.inventoryItem.update({
      where: { variantId_warehouseId: { variantId, warehouseId } },
      data: {
        quantityOnHand: { decrement: quantity },
        quantityReserved: { decrement: quantity },
      },
    });
    await tx.inventoryMovement.create({
      data: {
        variantId,
        warehouseId,
        type: 'DEDUCT',
        quantity,
        orderId,
        actorId,
      },
    });
  }

  async returnStock(
    tx: Tx,
    variantId: string,
    warehouseId: string,
    quantity: number,
    orderId: string,
    actorId?: string,
  ) {
    await ensureRow(tx, variantId, warehouseId);
    await tx.inventoryItem.update({
      where: { variantId_warehouseId: { variantId, warehouseId } },
      data: { quantityOnHand: { increment: quantity } },
    });
    await tx.inventoryMovement.create({
      data: {
        variantId,
        warehouseId,
        type: 'RETURN',
        quantity,
        orderId,
        actorId,
      },
    });
  }
}
