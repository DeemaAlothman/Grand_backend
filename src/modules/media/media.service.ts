import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { MinioService } from '../../infrastructure/storage/minio.service';
import { AuditService } from '../audit/audit.service';
import { PresignMediaDto } from './dto/presign-media.dto';
import { ConfirmMediaDto } from './dto/confirm-media.dto';
import {
  ALLOWED_MEDIA_MIME_TYPES,
  MAX_MEDIA_SIZE_BYTES,
} from './media.constants';

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly minioService: MinioService,
    private readonly auditService: AuditService,
  ) {}

  private async assertEntityExists(entityType: string, entityId: string) {
    const exists = await (() => {
      switch (entityType) {
        case 'product':
          return this.prisma.product.findUnique({
            where: { id: entityId },
            select: { id: true },
          });
        case 'product_variant':
          return this.prisma.productVariant.findUnique({
            where: { id: entityId },
            select: { id: true },
          });
        case 'category':
          return this.prisma.category.findUnique({
            where: { id: entityId },
            select: { id: true },
          });
        case 'brand':
          return this.prisma.brand.findUnique({
            where: { id: entityId },
            select: { id: true },
          });
        default:
          return null;
      }
    })();
    if (!exists) {
      throw new NotFoundException(`${entityType} ${entityId} not found`);
    }
  }

  async presign(dto: PresignMediaDto) {
    const allowedExtensions = ALLOWED_MEDIA_MIME_TYPES[dto.mimeType];
    if (!allowedExtensions) {
      throw new BadRequestException(
        `mimeType "${dto.mimeType}" is not allowed; allowed types: ${Object.keys(ALLOWED_MEDIA_MIME_TYPES).join(', ')}`,
      );
    }
    if (dto.size > MAX_MEDIA_SIZE_BYTES) {
      throw new BadRequestException(
        `file exceeds the maximum allowed size of ${MAX_MEDIA_SIZE_BYTES} bytes`,
      );
    }

    const declaredExt = dto.filename.split('.').pop()?.toLowerCase();
    if (!declaredExt || !allowedExtensions.includes(declaredExt)) {
      throw new BadRequestException(
        `file extension does not match mimeType "${dto.mimeType}"; expected one of: ${allowedExtensions.join(', ')}`,
      );
    }

    await this.assertEntityExists(dto.entityType, dto.entityId);

    const key = `${dto.entityType}/${dto.entityId}/${randomUUID()}.${declaredExt}`;
    const uploadUrl = await this.minioService.presignedPutUrl(key);

    return { uploadUrl, key, expiresInSeconds: 300 };
  }

  async confirm(dto: ConfirmMediaDto, actorId: string) {
    if (!dto.key.startsWith(`${dto.entityType}/${dto.entityId}/`)) {
      throw new BadRequestException(
        'key does not match the declared entityType/entityId',
      );
    }

    const stat = await this.minioService.statObject(dto.key).catch(() => null);
    if (!stat) {
      throw new BadRequestException(
        'upload not found in storage; presign and upload the file first',
      );
    }
    if (stat.size > MAX_MEDIA_SIZE_BYTES) {
      await this.minioService.removeObject(dto.key);
      throw new BadRequestException(
        'uploaded file exceeds the maximum allowed size',
      );
    }

    const media = await this.prisma.media.create({
      data: {
        entityType: dto.entityType,
        entityId: dto.entityId,
        key: dto.key,
        url: this.minioService.publicUrl(dto.key),
        mimeType: String(
          stat.metaData?.['content-type'] ?? 'application/octet-stream',
        ),
        size: stat.size,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    await this.auditService.log({
      actorId,
      action: 'media.confirm',
      entityType: 'media',
      entityId: media.id,
      after: media,
    });

    return media;
  }

  findByEntity(entityType: string, entityId: string) {
    return this.prisma.media.findMany({
      where: { entityType, entityId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async remove(id: string, actorId: string) {
    const media = await this.prisma.media.findUnique({ where: { id } });
    if (!media) {
      throw new NotFoundException('media not found');
    }
    await this.minioService.removeObject(media.key).catch(() => undefined);
    await this.prisma.media.delete({ where: { id } });
    await this.auditService.log({
      actorId,
      action: 'media.delete',
      entityType: 'media',
      entityId: id,
      before: media,
    });
  }
}
