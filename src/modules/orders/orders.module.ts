import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CartModule } from '../cart/cart.module';
import { InventoryModule } from '../inventory/inventory.module';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { PricingModule } from '../pricing/pricing.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { STOCK_RELEASE_QUEUE } from '../../jobs/stock-release/stock-release.constants';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    CartModule,
    InventoryModule,
    WarehousesModule,
    PricingModule,
    PromotionsModule,
    BullModule.registerQueue({ name: STOCK_RELEASE_QUEUE }),
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
