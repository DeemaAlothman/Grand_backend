import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/** Statuses that represent a real, paid-or-further sale (excludes draft/unpaid/failed/cancelled). */
const SOLD_STATUSES: OrderStatus[] = [
  'PAID',
  'CONFIRMED',
  'PROCESSING',
  'READY_TO_SHIP',
  'SHIPPED',
  'DELIVERED',
  'RETURN_REQUESTED',
  'RETURNED',
  'REFUNDED',
];

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async salesReport(from?: Date, to?: Date) {
    const where = {
      status: { in: SOLD_STATUSES },
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };

    const [totals, byDay] = await Promise.all([
      this.prisma.order.aggregate({
        where,
        _sum: { total: true },
        _count: { id: true },
      }),
      this.prisma.$queryRaw<
        { day: Date; revenue: string; orderCount: bigint }[]
      >`
        SELECT date_trunc('day', "createdAt") AS day, SUM(total) AS revenue, COUNT(*) AS "orderCount"
        FROM orders
        WHERE status = ANY(${SOLD_STATUSES}::"OrderStatus"[])
          AND (${from ?? null}::timestamptz IS NULL OR "createdAt" >= ${from ?? null})
          AND (${to ?? null}::timestamptz IS NULL OR "createdAt" <= ${to ?? null})
        GROUP BY day
        ORDER BY day ASC
      `,
    ]);

    return {
      totalRevenue: Number(totals._sum.total ?? 0),
      orderCount: totals._count.id,
      byDay: byDay.map((row) => ({
        date: row.day,
        revenue: Number(row.revenue),
        orderCount: Number(row.orderCount),
      })),
    };
  }

  async lowStock(threshold: number) {
    const items = await this.prisma.inventoryItem.findMany({
      include: {
        warehouse: true,
        variant: { include: { product: true } },
      },
    });

    return items
      .map((item) => ({
        ...item,
        available: Number(item.quantityOnHand) - Number(item.quantityReserved),
      }))
      .filter((item) => item.available <= threshold)
      .sort((a, b) => a.available - b.available);
  }

  stagnantProducts(sinceDays: number) {
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    return this.prisma.product.findMany({
      where: {
        status: 'PUBLISHED',
        variants: {
          every: {
            orderItems: {
              none: { order: { createdAt: { gte: since } } },
            },
          },
        },
      },
      include: { category: true, brand: true, variants: true },
      orderBy: { createdAt: 'asc' },
    });
  }
}
