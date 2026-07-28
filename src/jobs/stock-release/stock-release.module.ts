import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OrdersModule } from '../../modules/orders/orders.module';
import { StockReleaseProcessor } from './stock-release.processor';
import { STOCK_RELEASE_QUEUE } from './stock-release.constants';

@Module({
  imports: [
    OrdersModule,
    BullModule.registerQueue({ name: STOCK_RELEASE_QUEUE }),
  ],
  providers: [StockReleaseProcessor],
})
export class StockReleaseModule {}
