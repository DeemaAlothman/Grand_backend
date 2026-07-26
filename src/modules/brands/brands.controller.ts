import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { BrandsService } from './brands.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';

@Controller('brands')
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  @Public()
  @Get()
  findAll() {
    return this.brandsService.findAll();
  }

  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.brandsService.findOne(id);
  }

  @RequirePermissions('products.create')
  @Post()
  create(@Body() dto: CreateBrandDto, @CurrentUser() user: AuthenticatedUser) {
    return this.brandsService.create(dto, user.id);
  }

  @RequirePermissions('products.update')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateBrandDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.brandsService.update(id, dto, user.id);
  }

  @RequirePermissions('products.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.brandsService.remove(id, user.id);
  }
}
