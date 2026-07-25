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
  Query,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { AttributesService } from './attributes.service';
import { CreateAttributeDto } from './dto/create-attribute.dto';
import { UpdateAttributeDto } from './dto/update-attribute.dto';
import { CreateAttributeOptionDto } from './dto/create-attribute-option.dto';
import { LinkCategoryAttributeDto } from './dto/link-category-attribute.dto';

@Controller()
export class AttributesController {
  constructor(private readonly attributesService: AttributesService) {}

  @Public()
  @Get('attributes')
  findAll() {
    return this.attributesService.findAll();
  }

  @Public()
  @Get('attributes/:id')
  findOne(@Param('id') id: string) {
    return this.attributesService.findOne(id);
  }

  @RequirePermissions('attributes.create')
  @Post('attributes')
  create(
    @Body() dto: CreateAttributeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attributesService.create(dto, user.id);
  }

  @RequirePermissions('attributes.update')
  @Patch('attributes/:id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAttributeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attributesService.update(id, dto, user.id);
  }

  @RequirePermissions('attributes.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('attributes/:id')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.attributesService.remove(id, user.id);
  }

  @RequirePermissions('attributes.update')
  @Post('attributes/:id/options')
  addOption(
    @Param('id') id: string,
    @Body() dto: CreateAttributeOptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attributesService.addOption(id, dto, user.id);
  }

  @RequirePermissions('attributes.update')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('attributes/:id/options/:optionId')
  async removeOption(
    @Param('id') id: string,
    @Param('optionId') optionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.attributesService.removeOption(id, optionId, user.id);
  }

  @Public()
  @Get('category-attributes')
  findByCategory(@Query('categoryId') categoryId: string) {
    return this.attributesService.findByCategory(categoryId);
  }

  @RequirePermissions('attributes.update')
  @Post('category-attributes')
  link(
    @Body() dto: LinkCategoryAttributeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attributesService.linkToCategory(dto, user.id);
  }

  @RequirePermissions('attributes.update')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('category-attributes/:categoryId/:attributeId')
  async unlink(
    @Param('categoryId') categoryId: string,
    @Param('attributeId') attributeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.attributesService.unlinkFromCategory(
      categoryId,
      attributeId,
      user.id,
    );
  }
}
