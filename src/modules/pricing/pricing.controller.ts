import { Body, Controller, Param, Post } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { PricingService } from './pricing.service';
import { SetPriceDto } from './dto/set-price.dto';
import { BulkUpdatePricesDto } from './dto/bulk-update-prices.dto';

@Controller()
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @RequirePermissions('prices.update')
  @Post('variants/:variantId/prices')
  setPrice(
    @Param('variantId') variantId: string,
    @Body() dto: SetPriceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pricingService.setPrice(variantId, dto, user.id);
  }

  @RequirePermissions('prices.update')
  @Post('prices/bulk')
  bulkUpdate(
    @Body() dto: BulkUpdatePricesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pricingService.bulkUpdate(dto, user.id);
  }
}
