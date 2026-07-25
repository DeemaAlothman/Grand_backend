import { randomUUID } from 'crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { slugify } from '../../common/utils/slugify';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

export interface CategoryTreeNode {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
  children: CategoryTreeNode[];
}

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(dto: CreateCategoryDto, actorId: string) {
    let parentPath = '/';
    if (dto.parentId) {
      const parent = await this.prisma.category.findUnique({
        where: { id: dto.parentId },
      });
      if (!parent) {
        throw new NotFoundException('parent category not found');
      }
      parentPath = parent.path;
    }

    const id = randomUUID();
    const slug = slugify(dto.slug ?? dto.name);
    const path = `${parentPath}${id}/`;

    try {
      const category = await this.prisma.category.create({
        data: {
          id,
          name: dto.name,
          slug,
          parentId: dto.parentId ?? null,
          path,
          sortOrder: dto.sortOrder ?? 0,
          imageUrl: dto.imageUrl,
          seoTitle: dto.seoTitle,
          seoDescription: dto.seoDescription,
          isActive: dto.isActive ?? true,
        },
      });

      await this.auditService.log({
        actorId,
        action: 'category.create',
        entityType: 'category',
        entityId: category.id,
        after: category,
      });

      return category;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('a category with this slug already exists');
      }
      throw error;
    }
  }

  findAll() {
    return this.prisma.category.findMany({
      orderBy: [{ path: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  async findTree(): Promise<CategoryTreeNode[]> {
    const categories = await this.findAll();
    const nodeById = new Map<string, CategoryTreeNode>();
    const roots: CategoryTreeNode[] = [];

    for (const category of categories) {
      nodeById.set(category.id, {
        id: category.id,
        name: category.name,
        slug: category.slug,
        sortOrder: category.sortOrder,
        isActive: category.isActive,
        children: [],
      });
    }

    for (const category of categories) {
      const node = nodeById.get(category.id)!;
      if (category.parentId) {
        nodeById.get(category.parentId)?.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  async findOne(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: { categoryAttributes: { include: { attribute: true } } },
    });
    if (!category) {
      throw new NotFoundException('category not found');
    }
    return category;
  }

  async update(id: string, dto: UpdateCategoryDto, actorId: string) {
    const before = await this.findOne(id);

    const data: Prisma.CategoryUpdateInput = {
      name: dto.name,
      sortOrder: dto.sortOrder,
      imageUrl: dto.imageUrl,
      seoTitle: dto.seoTitle,
      seoDescription: dto.seoDescription,
      isActive: dto.isActive,
    };
    if (dto.slug) {
      data.slug = slugify(dto.slug);
    }

    const isMoving =
      dto.parentId !== undefined && dto.parentId !== before.parentId;
    let newPath: string | undefined;

    if (isMoving) {
      let newParentPath = '/';
      if (dto.parentId) {
        if (dto.parentId === id) {
          throw new ConflictException('a category cannot be its own parent');
        }
        const newParent = await this.prisma.category.findUnique({
          where: { id: dto.parentId },
        });
        if (!newParent) {
          throw new NotFoundException('parent category not found');
        }
        if (newParent.path.startsWith(before.path)) {
          throw new ConflictException(
            'cannot move a category under its own descendant',
          );
        }
        newParentPath = newParent.path;
      }
      newPath = `${newParentPath}${id}/`;
      data.parent = dto.parentId
        ? { connect: { id: dto.parentId } }
        : { disconnect: true };
      data.path = newPath;
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const category = await tx.category.update({ where: { id }, data });

        if (isMoving && newPath) {
          await tx.$executeRaw`
            UPDATE categories
            SET path = ${newPath} || substring(path from ${before.path.length + 1})
            WHERE path LIKE ${before.path + '%'} AND id <> ${id}
          `;
        }

        return category;
      });

      await this.auditService.log({
        actorId,
        action: 'category.update',
        entityType: 'category',
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
        throw new ConflictException('a category with this slug already exists');
      }
      throw error;
    }
  }

  async remove(id: string, actorId: string) {
    const category = await this.findOne(id);
    const childrenCount = await this.prisma.category.count({
      where: { parentId: id },
    });
    if (childrenCount > 0) {
      throw new ConflictException(
        'cannot delete a category that has subcategories',
      );
    }

    await this.prisma.category.delete({ where: { id } });
    await this.auditService.log({
      actorId,
      action: 'category.delete',
      entityType: 'category',
      entityId: id,
      before: category,
    });
  }
}
