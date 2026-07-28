import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { OrdersService } from '../../modules/orders/orders.service';
import { STOCK_RELEASE_QUEUE } from './stock-release.constants';

interface StockReleaseJobData {
  orderId: string;
}

@Processor(STOCK_RELEASE_QUEUE)
export class StockReleaseProcessor extends WorkerHost {
  private readonly logger = new Logger(StockReleaseProcessor.name);

  constructor(private readonly ordersService: OrdersService) {
    super();
  }

  async process(job: Job<StockReleaseJobData>): Promise<void> {
    const { orderId } = job.data;
    const order = await this.ordersService.findOne(orderId);

    if (order.status !== 'PENDING_PAYMENT') {
      this.logger.log(
        `Skipping order ${orderId}: status is "${order.status}", not PENDING_PAYMENT`,
      );
      return;
    }

    await this.ordersService.updateStatus(
      orderId,
      {
        status: 'CANCELLED',
        reason: 'payment timeout - stock automatically released',
      },
      null,
    );
    this.logger.log(
      `Released reserved stock and cancelled order ${orderId} after payment timeout`,
    );
  }
}
