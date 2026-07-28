import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { InventoryService } from './inventory.service';
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @RequirePermissions('inventory.read')
  @Get()
  findBalances(@Query('variantId') variantId?: string) {
    return this.inventoryService.findBalances(variantId);
  }

  @RequirePermissions('inventory.read')
  @Get('movements')
  findMovements(@Query('variantId') variantId?: string) {
    return this.inventoryService.findMovements(variantId);
  }

  @RequirePermissions('inventory.adjust')
  @Post('receive')
  receive(
    @Body() dto: ReceiveStockDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventoryService.receive(dto, user.id);
  }

  @RequirePermissions('inventory.adjust')
  @Post('adjustments')
  adjust(@Body() dto: AdjustStockDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.adjust(dto, user.id);
  }
}
