import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';

@Injectable()
export class WarehousesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(dto: CreateWarehouseDto, actorId: string) {
    try {
      const warehouse = await this.prisma.warehouse.create({
        data: {
          code: dto.code,
          name: dto.name,
          isActive: dto.isActive ?? true,
        },
      });
      await this.auditService.log({
        actorId,
        action: 'warehouse.create',
        entityType: 'warehouse',
        entityId: warehouse.id,
        after: warehouse,
      });
      return warehouse;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'a warehouse with this code already exists',
        );
      }
      throw error;
    }
  }

  findAll() {
    return this.prisma.warehouse.findMany({ orderBy: { code: 'asc' } });
  }

  async update(id: string, dto: UpdateWarehouseDto, actorId: string) {
    const before = await this.findOne(id);

    if (dto.isActive === false && before.isActive) {
      const otherActiveCount = await this.prisma.warehouse.count({
        where: { isActive: true, id: { not: id } },
      });
      if (otherActiveCount === 0) {
        throw new ConflictException(
          'cannot disable the only active warehouse; activate another one first',
        );
      }
    }

    const warehouse = await this.prisma.warehouse.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    await this.auditService.log({
      actorId,
      action: 'warehouse.update',
      entityType: 'warehouse',
      entityId: warehouse.id,
      before,
      after: warehouse,
    });
    return warehouse;
  }

  async findOne(id: string) {
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id } });
    if (!warehouse) {
      throw new NotFoundException('warehouse not found');
    }
    return warehouse;
  }

  async findDefault() {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!warehouse) {
      throw new NotFoundException('no active warehouse configured');
    }
    return warehouse;
  }
}
