import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { isFractionalSellingUnit } from '../inventory/inventory.constants';
import { PricingService } from '../pricing/pricing.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

const CART_INCLUDE = {
  items: {
    include: {
      variant: {
        include: {
          product: true,
          attributeValues: { include: { attribute: true } },
          prices: { include: { priceList: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
};

function withTotal<
  T extends {
    items: {
      quantity: unknown;
      variant: { prices: { priceListId: string; amount: unknown }[] };
    }[];
  },
>(cart: T, priceListId: string) {
  let total = 0;
  let hasUnpricedItem = false;

  for (const item of cart.items) {
    const price = item.variant.prices.find(
      (p) => p.priceListId === priceListId,
    );
    if (!price) {
      hasUnpricedItem = true;
      continue;
    }
    total += Number(price.amount) * Number(item.quantity);
  }

  return {
    ...cart,
    total: hasUnpricedItem ? null : Math.round(total * 100) / 100,
  };
}

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingService: PricingService,
  ) {}

  private async validateQuantity(variantId: string, quantity: number) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      include: { product: true },
    });
    if (!variant) {
      throw new NotFoundException('variant not found');
    }
    if (variant.status !== 'ACTIVE' || variant.product.status !== 'PUBLISHED') {
      throw new BadRequestException('this product is not currently available');
    }
    if (
      !isFractionalSellingUnit(variant.product.sellingUnit) &&
      !Number.isInteger(quantity)
    ) {
      throw new BadRequestException(
        `quantity must be a whole number for selling unit "${variant.product.sellingUnit}"`,
      );
    }
    if (quantity < Number(variant.product.minOrderQuantity)) {
      throw new BadRequestException(
        `minimum order quantity for this product is ${Number(variant.product.minOrderQuantity)}`,
      );
    }
    return variant;
  }

  private async getOrCreateCartId(userId: string): Promise<string> {
    const cart = await this.prisma.cart.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
    return cart.id;
  }

  async getCart(userId: string) {
    const cartId = await this.getOrCreateCartId(userId);
    const cart = await this.prisma.cart.findUniqueOrThrow({
      where: { id: cartId },
      include: CART_INCLUDE,
    });
    const priceList = await this.pricingService.resolvePriceListForUser(userId);
    return withTotal(cart, priceList.id);
  }

  async addItem(userId: string, dto: AddCartItemDto) {
    await this.validateQuantity(dto.variantId, dto.quantity);
    const cartId = await this.getOrCreateCartId(userId);

    const existing = await this.prisma.cartItem.findUnique({
      where: { cartId_variantId: { cartId, variantId: dto.variantId } },
    });
    const newQuantity =
      (existing ? Number(existing.quantity) : 0) + dto.quantity;
    await this.validateQuantity(dto.variantId, newQuantity);

    await this.prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId, variantId: dto.variantId } },
      update: { quantity: newQuantity },
      create: { cartId, variantId: dto.variantId, quantity: dto.quantity },
    });

    return this.getCart(userId);
  }

  async updateItem(userId: string, itemId: string, dto: UpdateCartItemDto) {
    const cartId = await this.getOrCreateCartId(userId);
    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cartId },
    });
    if (!item) {
      throw new NotFoundException('cart item not found');
    }

    if (dto.quantity === 0) {
      await this.prisma.cartItem.delete({ where: { id: itemId } });
      return this.getCart(userId);
    }

    await this.validateQuantity(item.variantId, dto.quantity);
    await this.prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity: dto.quantity },
    });
    return this.getCart(userId);
  }

  async removeItem(userId: string, itemId: string) {
    const cartId = await this.getOrCreateCartId(userId);
    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cartId },
    });
    if (!item) {
      throw new NotFoundException('cart item not found');
    }
    await this.prisma.cartItem.delete({ where: { id: itemId } });
  }

  async clear(userId: string) {
    const cartId = await this.getOrCreateCartId(userId);
    await this.prisma.cartItem.deleteMany({ where: { cartId } });
  }
}
