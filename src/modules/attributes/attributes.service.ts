import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateAttributeDto } from './dto/create-attribute.dto';
import { UpdateAttributeDto } from './dto/update-attribute.dto';
import { CreateAttributeOptionDto } from './dto/create-attribute-option.dto';
import { LinkCategoryAttributeDto } from './dto/link-category-attribute.dto';

@Injectable()
export class AttributesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(dto: CreateAttributeDto, actorId: string) {
    try {
      const attribute = await this.prisma.attribute.create({
        data: {
          key: dto.key,
          name: dto.name,
          type: dto.type,
          unit: dto.unit,
          isFilterable: dto.isFilterable ?? true,
        },
      });
      await this.auditService.log({
        actorId,
        action: 'attribute.create',
        entityType: 'attribute',
        entityId: attribute.id,
        after: attribute,
      });
      return attribute;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'an attribute with this key already exists',
        );
      }
      throw error;
    }
  }

  findAll() {
    return this.prisma.attribute.findMany({
      include: { options: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const attribute = await this.prisma.attribute.findUnique({
      where: { id },
      include: { options: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!attribute) {
      throw new NotFoundException('attribute not found');
    }
    return attribute;
  }

  async update(id: string, dto: UpdateAttributeDto, actorId: string) {
    const before = await this.findOne(id);
    const updated = await this.prisma.attribute.update({
      where: { id },
      data: { name: dto.name, unit: dto.unit, isFilterable: dto.isFilterable },
    });
    await this.auditService.log({
      actorId,
      action: 'attribute.update',
      entityType: 'attribute',
      entityId: id,
      before,
      after: updated,
    });
    return updated;
  }

  async remove(id: string, actorId: string) {
    const before = await this.findOne(id);
    const [linkedCategoriesCount, productValuesCount, variantValuesCount] =
      await Promise.all([
        this.prisma.categoryAttribute.count({ where: { attributeId: id } }),
        this.prisma.productAttributeValue.count({ where: { attributeId: id } }),
        this.prisma.variantAttributeValue.count({ where: { attributeId: id } }),
      ]);
    if (linkedCategoriesCount > 0) {
      throw new ConflictException(
        'cannot delete an attribute linked to categories; unlink it first or disable it instead',
      );
    }
    if (productValuesCount > 0 || variantValuesCount > 0) {
      throw new ConflictException(
        'cannot delete an attribute used by existing products or variants',
      );
    }
    await this.prisma.attribute.delete({ where: { id } });
    await this.auditService.log({
      actorId,
      action: 'attribute.delete',
      entityType: 'attribute',
      entityId: id,
      before,
    });
  }

  async addOption(
    attributeId: string,
    dto: CreateAttributeOptionDto,
    actorId: string,
  ) {
    await this.findOne(attributeId);
    try {
      const option = await this.prisma.attributeOption.create({
        data: {
          attributeId,
          value: dto.value,
          label: dto.label,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
      await this.auditService.log({
        actorId,
        action: 'attribute_option.create',
        entityType: 'attribute_option',
        entityId: option.id,
        after: option,
      });
      return option;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'this option value already exists for the attribute',
        );
      }
      throw error;
    }
  }

  async removeOption(attributeId: string, optionId: string, actorId: string) {
    const option = await this.prisma.attributeOption.findFirst({
      where: { id: optionId, attributeId },
    });
    if (!option) {
      throw new NotFoundException('attribute option not found');
    }
    await this.prisma.attributeOption.delete({ where: { id: optionId } });
    await this.auditService.log({
      actorId,
      action: 'attribute_option.delete',
      entityType: 'attribute_option',
      entityId: optionId,
      before: option,
    });
  }

  async linkToCategory(dto: LinkCategoryAttributeDto, actorId: string) {
    const [category, attribute] = await Promise.all([
      this.prisma.category.findUnique({ where: { id: dto.categoryId } }),
      this.prisma.attribute.findUnique({ where: { id: dto.attributeId } }),
    ]);
    if (!category) throw new NotFoundException('category not found');
    if (!attribute) throw new NotFoundException('attribute not found');

    try {
      const link = await this.prisma.categoryAttribute.create({
        data: {
          categoryId: dto.categoryId,
          attributeId: dto.attributeId,
          isRequired: dto.isRequired ?? false,
          isFilterable: dto.isFilterable ?? attribute.isFilterable,
          createsVariant: dto.createsVariant ?? false,
          sortOrder: dto.sortOrder ?? 0,
        },
        include: { attribute: true },
      });
      await this.auditService.log({
        actorId,
        action: 'category_attribute.link',
        entityType: 'category_attribute',
        entityId: link.id,
        after: link,
      });
      return link;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'this attribute is already linked to the category',
        );
      }
      throw error;
    }
  }

  async unlinkFromCategory(
    categoryId: string,
    attributeId: string,
    actorId: string,
  ) {
    const link = await this.prisma.categoryAttribute.findUnique({
      where: { categoryId_attributeId: { categoryId, attributeId } },
    });
    if (!link) {
      throw new NotFoundException(
        'this attribute is not linked to the category',
      );
    }
    await this.prisma.categoryAttribute.delete({ where: { id: link.id } });
    await this.auditService.log({
      actorId,
      action: 'category_attribute.unlink',
      entityType: 'category_attribute',
      entityId: link.id,
      before: link,
    });
  }

  findByCategory(categoryId: string) {
    return this.prisma.categoryAttribute.findMany({
      where: { categoryId },
      include: { attribute: { include: { options: true } } },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getCategoryAttributeRules(categoryId: string) {
    const links = await this.findByCategory(categoryId);
    return {
      variantAttributes: links.filter((link) => link.createsVariant),
      infoAttributes: links.filter((link) => !link.createsVariant),
    };
  }
}
