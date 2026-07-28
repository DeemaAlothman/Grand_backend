import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';

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
