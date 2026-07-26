import { IsString, IsUUID } from 'class-validator';

export class AttributeValueInputDto {
  @IsUUID()
  attributeId!: string;

  @IsString()
  value!: string;
}
