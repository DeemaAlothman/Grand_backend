import {
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { ImportsService } from './imports.service';

const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024; // 5MB

@Controller('imports')
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @RequirePermissions('imports.manage')
  @Get()
  findAll() {
    return this.importsService.findAll();
  }

  @RequirePermissions('imports.manage')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.importsService.findOne(id);
  }

  @RequirePermissions('imports.manage')
  @Post('products')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_BYTES } }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.importsService.upload(file, user.id);
  }

  @RequirePermissions('imports.manage')
  @Post(':id/commit')
  commit(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.importsService.commit(id, user.id);
  }
}
