import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { CouponsService } from './coupons.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { ValidateCouponDto } from './dto/validate-coupon.dto';

@Controller('coupons')
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @RequirePermissions('promotions.manage')
  @Get()
  findAll() {
    return this.couponsService.findAll();
  }

  @RequirePermissions('promotions.manage')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.couponsService.findOne(id);
  }

  @RequirePermissions('promotions.manage')
  @Post()
  create(@Body() dto: CreateCouponDto, @CurrentUser() user: AuthenticatedUser) {
    return this.couponsService.create(dto, user.id);
  }

  @RequirePermissions('promotions.manage')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCouponDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.couponsService.update(id, dto, user.id);
  }

  /** Lets a logged-in customer check a coupon against their current cart total before checkout, without redeeming it. */
  @Post('validate')
  validate(@Body() dto: ValidateCouponDto) {
    return this.couponsService.validate(dto.code, dto.subtotal);
  }
}
