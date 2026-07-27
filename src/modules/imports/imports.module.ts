import { Module } from '@nestjs/common';
import { AttributesModule } from '../attributes/attributes.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  imports: [AttributesModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
