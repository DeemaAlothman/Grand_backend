import { Module } from '@nestjs/common';
import { AttributesModule } from '../attributes/attributes.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { VariantsService } from './variants.service';

@Module({
  imports: [AttributesModule],
  controllers: [ProductsController],
  providers: [ProductsService, VariantsService],
  exports: [ProductsService, VariantsService],
})
export class ProductsModule {}
