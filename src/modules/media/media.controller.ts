import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { MediaService } from './media.service';
import { PresignMediaDto } from './dto/presign-media.dto';
import { ConfirmMediaDto } from './dto/confirm-media.dto';
import { MEDIA_ENTITY_TYPES } from './media.constants';

@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Public()
  @Get()
  findByEntity(
    @Query('entityType') entityType: string,
    @Query('entityId') entityId: string,
  ) {
    if (
      !MEDIA_ENTITY_TYPES.includes(
        entityType as (typeof MEDIA_ENTITY_TYPES)[number],
      )
    ) {
      return [];
    }
    return this.mediaService.findByEntity(entityType, entityId);
  }

  @RequirePermissions('media.manage')
  @Post('presign')
  presign(@Body() dto: PresignMediaDto) {
    return this.mediaService.presign(dto);
  }

  @RequirePermissions('media.manage')
  @Post('confirm')
  confirm(
    @Body() dto: ConfirmMediaDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.mediaService.confirm(dto, user.id);
  }

  @RequirePermissions('media.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.mediaService.remove(id, user.id);
  }
}
