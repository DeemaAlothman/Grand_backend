import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { CartService } from './cart.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  getCart(@CurrentUser() user: AuthenticatedUser) {
    return this.cartService.getCart(user.id);
  }

  @Post('items')
  addItem(@Body() dto: AddCartItemDto, @CurrentUser() user: AuthenticatedUser) {
    return this.cartService.addItem(user.id, dto);
  }

  @Patch('items/:itemId')
  updateItem(
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCartItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cartService.updateItem(user.id, itemId, dto);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('items/:itemId')
  async removeItem(
    @Param('itemId') itemId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.cartService.removeItem(user.id, itemId);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete()
  async clear(@CurrentUser() user: AuthenticatedUser) {
    await this.cartService.clear(user.id);
  }
}
