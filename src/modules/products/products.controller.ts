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
  Query,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { ProductsService } from './products.service';
import { VariantsService } from './variants.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateVariantDto } from './dto/create-variant.dto';
import { UpdateVariantStatusDto } from './dto/update-variant-status.dto';
import { parseProductQuery } from './parse-product-query';

@Controller('products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly variantsService: VariantsService,
  ) {}

  @Public()
  @Get()
  findAll(@Query() query: Record<string, string>) {
    return this.productsService.findAll(parseProductQuery(query));
  }

  @Public()
  @Get('slug/:slug')
  findBySlug(@Param('slug') slug: string) {
    return this.productsService.findBySlug(slug);
  }

  /**
   * Admin listing: unlike `GET /products` (storefront, PUBLISHED-only), this shows every status
   * so a draft or archived product is actually reachable from a list instead of only by a known id.
   */
  @RequirePermissions('products.read')
  @Get('admin')
  findAllAdmin(@Query() query: Record<string, string>) {
    return this.productsService.findAllAdmin(
      parseProductQuery(query),
      query.status,
    );
  }

  @RequirePermissions('products.read')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(id);
  }

  @RequirePermissions('products.create')
  @Post()
  create(
    @Body() dto: CreateProductDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.productsService.create(dto, user.id);
  }

  @RequirePermissions('products.update')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.productsService.update(id, dto, user.id);
  }

  @RequirePermissions('products.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.productsService.remove(id, user.id);
  }

  @RequirePermissions('products.read')
  @Get(':id/variants')
  findVariants(@Param('id') id: string) {
    return this.variantsService.findAllForProduct(id);
  }

  @RequirePermissions('products.read')
  @Get(':id/variants/:variantId')
  findVariant(@Param('id') id: string, @Param('variantId') variantId: string) {
    return this.variantsService.findOne(id, variantId);
  }

  @RequirePermissions('products.update')
  @Post(':id/variants')
  createVariant(
    @Param('id') id: string,
    @Body() dto: CreateVariantDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.variantsService.create(id, dto, user.id);
  }

  @RequirePermissions('products.update')
  @Patch(':id/variants/:variantId/status')
  updateVariantStatus(
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Body() dto: UpdateVariantStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.variantsService.updateStatus(
      id,
      variantId,
      dto.status,
      user.id,
    );
  }

  @RequirePermissions('products.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id/variants/:variantId')
  async removeVariant(
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.variantsService.remove(id, variantId, user.id);
  }
}
