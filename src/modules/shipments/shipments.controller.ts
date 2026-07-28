import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { ShipmentsService } from './shipments.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';

@Controller()
export class ShipmentsController {
  constructor(private readonly shipmentsService: ShipmentsService) {}

  @RequirePermissions('orders.updateStatus')
  @Get('orders/:orderId/shipments')
  findByOrder(@Param('orderId') orderId: string) {
    return this.shipmentsService.findByOrder(orderId);
  }

  @RequirePermissions('orders.updateStatus')
  @Post('orders/:orderId/shipments')
  ship(
    @Param('orderId') orderId: string,
    @Body() dto: CreateShipmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shipmentsService.ship(orderId, dto, user.id);
  }

  @RequirePermissions('orders.updateStatus')
  @Post('shipments/:shipmentId/deliver')
  markDelivered(
    @Param('shipmentId') shipmentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shipmentsService.markDelivered(shipmentId, user.id);
  }
}
