import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrdersService } from '../orders/orders.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';

@Injectable()
export class ShipmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly ordersService: OrdersService,
  ) {}

  async ship(orderId: string, dto: CreateShipmentDto, actorId: string) {
    const order = await this.ordersService.findOne(orderId);
    if (order.status !== 'READY_TO_SHIP') {
      throw new ConflictException(
        `order must be "READY_TO_SHIP" to create a shipment (currently "${order.status}")`,
      );
    }

    const shipment = await this.prisma.shipment.create({
      data: {
        orderId,
        carrier: dto.carrier,
        trackingNumber: dto.trackingNumber,
        status: 'SHIPPED',
        shippedAt: new Date(),
      },
    });

    await this.ordersService.updateStatus(
      orderId,
      { status: 'SHIPPED' },
      actorId,
    );

    await this.auditService.log({
      actorId,
      action: 'shipment.create',
      entityType: 'shipment',
      entityId: shipment.id,
      after: shipment,
    });

    return shipment;
  }

  async markDelivered(shipmentId: string, actorId: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
    });
    if (!shipment) {
      throw new NotFoundException('shipment not found');
    }
    if (shipment.status !== 'SHIPPED') {
      throw new ConflictException(
        `shipment is "${shipment.status}", not "SHIPPED"`,
      );
    }

    const updated = await this.prisma.shipment.update({
      where: { id: shipmentId },
      data: { status: 'DELIVERED', deliveredAt: new Date() },
    });

    await this.ordersService.updateStatus(
      shipment.orderId,
      { status: 'DELIVERED' },
      actorId,
    );

    await this.auditService.log({
      actorId,
      action: 'shipment.delivered',
      entityType: 'shipment',
      entityId: shipmentId,
      after: updated,
    });

    return updated;
  }

  findByOrder(orderId: string) {
    return this.prisma.shipment.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
