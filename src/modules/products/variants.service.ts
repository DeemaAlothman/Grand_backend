import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AttributesService } from '../attributes/attributes.service';
import {
  isUniqueConstraintError,
  violatesUniqueConstraint,
} from '../../common/utils/prisma-error.util';
import { CreateVariantDto } from './dto/create-variant.dto';
import {
  computeCombinationKey,
  validateAttributeValues,
} from './attribute-values.helper';

@Injectable()
export class VariantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly attributesService: AttributesService,
  ) {}

  async create(productId: string, dto: CreateVariantDto, actorId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) {
      throw new NotFoundException('product not found');
    }
    if (product.type !== 'VARIABLE') {
      throw new BadRequestException(
        'only VARIABLE products can have additional variants',
      );
    }

    const { variantAttributes } =
      await this.attributesService.getCategoryAttributeRules(
        product.categoryId,
      );
    if (variantAttributes.length === 0) {
      throw new BadRequestException(
        'this category has no variant-creating attributes configured',
      );
    }

    const values = validateAttributeValues(
      variantAttributes,
      dto.attributeValues,
      'variant',
    );
    const combinationKey = computeCombinationKey(values);

    try {
      const variant = await this.prisma.productVariant.create({
        data: {
          productId,
          sku: dto.sku,
          barcode: dto.barcode,
          weight: dto.weight,
          combinationKey,
          attributeValues: {
            create: values.map((entry) => ({
              attributeId: entry.attributeId,
              value: entry.value,
            })),
          },
        },
        include: { attributeValues: { include: { attribute: true } } },
      });

      await this.auditService.log({
        actorId,
        action: 'product_variant.create',
        entityType: 'product_variant',
        entityId: variant.id,
        after: variant,
      });

      return variant;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        if (violatesUniqueConstraint(error, 'sku')) {
          throw new ConflictException('a variant with this SKU already exists');
        }
        if (violatesUniqueConstraint(error, 'combinationKey')) {
          throw new ConflictException(
            'a variant with this exact attribute combination already exists',
          );
        }
        throw new ConflictException('a unique constraint was violated');
      }
      throw error;
    }
  }

  findAllForProduct(productId: string) {
    return this.prisma.productVariant.findMany({
      where: { productId },
      include: {
        attributeValues: { include: { attribute: true } },
        prices: { include: { priceList: true } },
      },
    });
  }

  async findOne(productId: string, variantId: string) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId },
      include: {
        attributeValues: { include: { attribute: true } },
        prices: { include: { priceList: true } },
      },
    });
    if (!variant) {
      throw new NotFoundException('variant not found');
    }
    return variant;
  }

  async updateStatus(
    productId: string,
    variantId: string,
    status: 'ACTIVE' | 'DISABLED',
    actorId: string,
  ) {
    const before = await this.findOne(productId, variantId);
    const updated = await this.prisma.productVariant.update({
      where: { id: variantId },
      data: { status },
    });
    await this.auditService.log({
      actorId,
      action: 'product_variant.update_status',
      entityType: 'product_variant',
      entityId: variantId,
      before,
      after: updated,
    });
    return updated;
  }

  async remove(productId: string, variantId: string, actorId: string) {
    const before = await this.findOne(productId, variantId);
    const remainingCount = await this.prisma.productVariant.count({
      where: { productId },
    });
    if (remainingCount <= 1) {
      throw new ConflictException(
        'cannot delete the only remaining variant of a product',
      );
    }
    await this.prisma.productVariant.delete({ where: { id: variantId } });
    await this.auditService.log({
      actorId,
      action: 'product_variant.delete',
      entityType: 'product_variant',
      entityId: variantId,
      before,
    });
  }
}
