import { BadRequestException } from '@nestjs/common';
import type { Attribute, AttributeOption } from '@prisma/client';

type AttributeWithOptions = Attribute & { options: AttributeOption[] };

/** Validates a raw string value against an attribute's type/options before it's stored on a product or variant. */
export function assertValidAttributeValue(
  attribute: AttributeWithOptions,
  value: string,
): void {
  switch (attribute.type) {
    case 'SELECT':
    case 'COLOR_SELECT': {
      const allowed = attribute.options.map((option) => option.value);
      if (!allowed.includes(value)) {
        throw new BadRequestException(
          `invalid value "${value}" for attribute "${attribute.key}"; allowed values: ${allowed.join(', ')}`,
        );
      }
      return;
    }
    case 'DECIMAL_UNIT':
    case 'INTEGER_UNIT': {
      const numeric = Number(value);
      if (Number.isNaN(numeric)) {
        throw new BadRequestException(
          `value for attribute "${attribute.key}" must be numeric`,
        );
      }
      if (attribute.type === 'INTEGER_UNIT' && !Number.isInteger(numeric)) {
        throw new BadRequestException(
          `value for attribute "${attribute.key}" must be an integer`,
        );
      }
      return;
    }
    case 'BOOLEAN': {
      if (value !== 'true' && value !== 'false') {
        throw new BadRequestException(
          `value for attribute "${attribute.key}" must be "true" or "false"`,
        );
      }
      return;
    }
    case 'TEXT':
    default:
      return;
  }
}
