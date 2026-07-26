import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { slugify } from '../../common/utils/slugify';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';

@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(dto: CreateBrandDto, actorId: string) {
    try {
      const brand = await this.prisma.brand.create({
        data: {
          name: dto.name,
          slug: slugify(dto.slug ?? dto.name),
          isActive: dto.isActive ?? true,
        },
      });
      await this.auditService.log({
        actorId,
        action: 'brand.create',
        entityType: 'brand',
        entityId: brand.id,
        after: brand,
      });
      return brand;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('a brand with this slug already exists');
      }
      throw error;
    }
  }

  findAll() {
    return this.prisma.brand.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: string) {
    const brand = await this.prisma.brand.findUnique({ where: { id } });
    if (!brand) {
      throw new NotFoundException('brand not found');
    }
    return brand;
  }

  async update(id: string, dto: UpdateBrandDto, actorId: string) {
    const before = await this.findOne(id);
    try {
      const updated = await this.prisma.brand.update({
        where: { id },
        data: {
          name: dto.name,
          slug: dto.slug ? slugify(dto.slug) : undefined,
          isActive: dto.isActive,
        },
      });
      await this.auditService.log({
        actorId,
        action: 'brand.update',
        entityType: 'brand',
        entityId: id,
        before,
        after: updated,
      });
      return updated;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('a brand with this slug already exists');
      }
      throw error;
    }
  }

  async remove(id: string, actorId: string) {
    const before = await this.findOne(id);
    const productsCount = await this.prisma.product.count({
      where: { brandId: id },
    });
    if (productsCount > 0) {
      throw new ConflictException(
        'cannot delete a brand that has products; unassign them first',
      );
    }
    await this.prisma.brand.delete({ where: { id } });
    await this.auditService.log({
      actorId,
      action: 'brand.delete',
      entityType: 'brand',
      entityId: id,
      before,
    });
  }
}
