import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AttributesService } from '../attributes/attributes.service';
import { slugify } from '../../common/utils/slugify';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import type { ParsedProductQuery } from './dto/query-products.dto';
import { validateAttributeValues } from './attribute-values.helper';
import {
  isUniqueConstraintError,
  violatesUniqueConstraint,
} from '../../common/utils/prisma-error.util';

const PRODUCT_STATUSES: ProductStatus[] = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];

const PRODUCT_INCLUDE = {
  category: true,
  brand: true,
  attributeValues: { include: { attribute: true } },
  variants: {
    include: {
      attributeValues: { include: { attribute: true } },
      prices: { include: { priceList: true } },
      inventoryItems: {
        select: { quantityOnHand: true, quantityReserved: true },
      },
    },
  },
} satisfies Prisma.ProductInclude;

/**
 * Only a true/false "in stock" flag is exposed here (never raw quantities) — availability
 * before checkout is a storefront concern, exact counts belong to `/inventory` and
 * `/reports/low-stock` which are permission-gated for staff.
 */
function variantInStock(variant: {
  inventoryItems: {
    quantityOnHand: Prisma.Decimal;
    quantityReserved: Prisma.Decimal;
  }[];
}) {
  return variant.inventoryItems.some(
    (item) => Number(item.quantityOnHand) - Number(item.quantityReserved) > 0,
  );
}

function withDisplayPrice<
  T extends {
    variants: {
      prices: { priceListId: string; amount: Prisma.Decimal }[];
      inventoryItems: {
        quantityOnHand: Prisma.Decimal;
        quantityReserved: Prisma.Decimal;
      }[];
    }[];
  },
>(product: T, retailPriceListId: string | undefined) {
  const retailAmounts = product.variants
    .flatMap((variant) => variant.prices)
    .filter((price) => price.priceListId === retailPriceListId)
    .map((price) => Number(price.amount));

  const displayPrice =
    retailAmounts.length === 0
      ? null
      : { min: Math.min(...retailAmounts), max: Math.max(...retailAmounts) };

  const variants = product.variants.map((variant) => {
    const { inventoryItems, ...rest } = variant;
    return { ...rest, inStock: variantInStock({ inventoryItems }) };
  });
  const inStock = variants.some((variant) => variant.inStock);

  return { ...product, variants, displayPrice, inStock };
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly attributesService: AttributesService,
  ) {}

  async create(dto: CreateProductDto, actorId: string) {
    const category = await this.prisma.category.findUnique({
      where: { id: dto.categoryId },
    });
    if (!category) {
      throw new NotFoundException('category not found');
    }
    if (dto.brandId) {
      const brand = await this.prisma.brand.findUnique({
        where: { id: dto.brandId },
      });
      if (!brand) {
        throw new NotFoundException('brand not found');
      }
    }

    const { variantAttributes, infoAttributes } =
      await this.attributesService.getCategoryAttributeRules(dto.categoryId);

    if (dto.type === 'SIMPLE' && variantAttributes.length > 0) {
      throw new BadRequestException(
        'this category requires variant-defining attributes; create the product as VARIABLE instead',
      );
    }
    if (dto.type === 'SIMPLE' && !dto.sku) {
      throw new BadRequestException(
        'sku is required to create a SIMPLE product',
      );
    }
    if (
      dto.sellingUnit === 'PIECE' &&
      dto.minOrderQuantity !== undefined &&
      !Number.isInteger(dto.minOrderQuantity)
    ) {
      throw new BadRequestException(
        'minOrderQuantity must be a whole number when sellingUnit is PIECE',
      );
    }

    const providedInfoValues = validateAttributeValues(
      infoAttributes,
      dto.attributeValues ?? [],
      'info',
    );

    try {
      const product = await this.prisma.$transaction(async (tx) => {
        const created = await tx.product.create({
          data: {
            categoryId: dto.categoryId,
            brandId: dto.brandId,
            name: dto.name,
            slug: slugify(dto.slug ?? dto.name),
            description: dto.description,
            type: dto.type,
            sellingUnit: dto.sellingUnit,
            minOrderQuantity: dto.minOrderQuantity ?? 1,
            attributeValues: {
              create: providedInfoValues.map((entry) => ({
                attributeId: entry.attributeId,
                value: entry.value,
              })),
            },
          },
        });

        if (dto.type === 'SIMPLE') {
          await tx.productVariant.create({
            data: {
              productId: created.id,
              sku: dto.sku!,
              barcode: dto.barcode,
              weight: dto.weight,
              combinationKey: '',
            },
          });
        }

        return created;
      });

      await this.auditService.log({
        actorId,
        action: 'product.create',
        entityType: 'product',
        entityId: product.id,
        after: product,
      });

      return this.findOne(product.id);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        if (violatesUniqueConstraint(error, 'slug')) {
          throw new ConflictException(
            'a product with this slug already exists',
          );
        }
        if (violatesUniqueConstraint(error, 'sku')) {
          throw new ConflictException(
            'a product variant with this SKU already exists',
          );
        }
        throw new ConflictException('a unique constraint was violated');
      }
      throw error;
    }
  }

  async findAll(query: ParsedProductQuery) {
    const retailList = await this.prisma.priceList.findUnique({
      where: { key: 'retail' },
    });

    const where: Prisma.ProductWhereInput = {
      status: 'PUBLISHED',
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.brandId ? { brandId: query.brandId } : {}),
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
    };

    const attributeFilterEntries = Object.entries(query.attributeFilters);
    if (attributeFilterEntries.length > 0) {
      where.AND = attributeFilterEntries.map(([key, value]) => ({
        variants: {
          some: { attributeValues: { some: { attribute: { key }, value } } },
        },
      }));
    }

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      where.variants = {
        some: {
          prices: {
            some: {
              priceListId: retailList?.id,
              amount: {
                ...(query.minPrice !== undefined
                  ? { gte: query.minPrice }
                  : {}),
                ...(query.maxPrice !== undefined
                  ? { lte: query.maxPrice }
                  : {}),
              },
            },
          },
        },
      };
    }

    const products = await this.prisma.product.findMany({
      where,
      include: PRODUCT_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = products.length > query.limit;
    const page = products.slice(0, query.limit);

    return {
      items: page.map((product) => withDisplayPrice(product, retailList?.id)),
      nextCursor: hasMore ? page[page.length - 1]?.id : null,
    };
  }

  async findAllAdmin(query: ParsedProductQuery, status?: string) {
    if (
      status !== undefined &&
      !PRODUCT_STATUSES.includes(status as ProductStatus)
    ) {
      throw new BadRequestException(
        `status must be one of: ${PRODUCT_STATUSES.join(', ')}`,
      );
    }

    const retailList = await this.prisma.priceList.findUnique({
      where: { key: 'retail' },
    });

    const where: Prisma.ProductWhereInput = {
      ...(status ? { status: status as ProductStatus } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.brandId ? { brandId: query.brandId } : {}),
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
    };

    const products = await this.prisma.product.findMany({
      where,
      include: PRODUCT_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = products.length > query.limit;
    const page = products.slice(0, query.limit);

    return {
      items: page.map((product) => withDisplayPrice(product, retailList?.id)),
      nextCursor: hasMore ? page[page.length - 1]?.id : null,
    };
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: PRODUCT_INCLUDE,
    });
    if (!product) {
      throw new NotFoundException('product not found');
    }
    const retailList = await this.prisma.priceList.findUnique({
      where: { key: 'retail' },
    });
    return withDisplayPrice(product, retailList?.id);
  }

  async findBySlug(slug: string) {
    const product = await this.prisma.product.findUnique({
      where: { slug },
      include: PRODUCT_INCLUDE,
    });
    if (!product || product.status !== 'PUBLISHED') {
      throw new NotFoundException('product not found');
    }
    const retailList = await this.prisma.priceList.findUnique({
      where: { key: 'retail' },
    });
    return withDisplayPrice(product, retailList?.id);
  }

  async update(id: string, dto: UpdateProductDto, actorId: string) {
    const before = await this.findOne(id);

    if (dto.brandId) {
      const brand = await this.prisma.brand.findUnique({
        where: { id: dto.brandId },
      });
      if (!brand) {
        throw new NotFoundException('brand not found');
      }
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        if (dto.attributeValues) {
          const { infoAttributes } =
            await this.attributesService.getCategoryAttributeRules(
              before.categoryId,
            );
          const values = validateAttributeValues(
            infoAttributes,
            dto.attributeValues,
            'info',
          );
          await tx.productAttributeValue.deleteMany({
            where: { productId: id },
          });
          if (values.length > 0) {
            await tx.productAttributeValue.createMany({
              data: values.map((entry) => ({
                productId: id,
                attributeId: entry.attributeId,
                value: entry.value,
              })),
            });
          }
        }

        return tx.product.update({
          where: { id },
          data: {
            brandId: dto.brandId,
            name: dto.name,
            slug: dto.slug ? slugify(dto.slug) : undefined,
            description: dto.description,
            sellingUnit: dto.sellingUnit,
            minOrderQuantity: dto.minOrderQuantity,
            status: dto.status,
          },
        });
      });

      await this.auditService.log({
        actorId,
        action: 'product.update',
        entityType: 'product',
        entityId: id,
        before,
        after: updated,
      });

      return this.findOne(id);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('a product with this slug already exists');
      }
      throw error;
    }
  }

  async remove(id: string, actorId: string) {
    const before = await this.findOne(id);
    if (before.status === 'PUBLISHED') {
      throw new ConflictException(
        'archive the product before deleting it (set status to ARCHIVED first)',
      );
    }
    await this.prisma.product.delete({ where: { id } });
    await this.auditService.log({
      actorId,
      action: 'product.delete',
      entityType: 'product',
      entityId: id,
      before,
    });
  }
}
