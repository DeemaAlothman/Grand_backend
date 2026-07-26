import { BadRequestException } from '@nestjs/common';
import type {
  CategoryAttribute,
  Attribute,
  AttributeOption,
} from '@prisma/client';
import { assertValidAttributeValue } from '../attributes/attribute-value.validator';
import type { AttributeValueInputDto } from './dto/attribute-value-input.dto';

type CategoryAttributeWithAttribute = CategoryAttribute & {
  attribute: Attribute & { options: AttributeOption[] };
};

/**
 * Validates a set of {attributeId, value} inputs against the category-defined rule set
 * (either the variant-creating attributes or the informational ones), then returns them
 * normalized. For variant attributes every rule must be satisfied exactly (they define the
 * combination); for info attributes only the required ones are mandatory.
 */
export function validateAttributeValues(
  rules: CategoryAttributeWithAttribute[],
  provided: AttributeValueInputDto[],
  mode: 'variant' | 'info',
): AttributeValueInputDto[] {
  const ruleByAttributeId = new Map(
    rules.map((rule) => [rule.attributeId, rule]),
  );
  const providedIds = new Set(provided.map((entry) => entry.attributeId));

  for (const entry of provided) {
    const rule = ruleByAttributeId.get(entry.attributeId);
    if (!rule) {
      throw new BadRequestException(
        `attribute ${entry.attributeId} is not ${mode === 'variant' ? 'a variant-creating' : 'an informational'} attribute for this category`,
      );
    }
    assertValidAttributeValue(rule.attribute, entry.value);
  }

  if (mode === 'variant') {
    for (const rule of rules) {
      if (!providedIds.has(rule.attributeId)) {
        throw new BadRequestException(
          `missing value for required variant attribute "${rule.attribute.key}"`,
        );
      }
    }
  } else {
    for (const rule of rules) {
      if (rule.isRequired && !providedIds.has(rule.attributeId)) {
        throw new BadRequestException(
          `missing value for required attribute "${rule.attribute.key}"`,
        );
      }
    }
  }

  return provided;
}

export function computeCombinationKey(
  values: AttributeValueInputDto[],
): string {
  return values
    .map((entry) => `${entry.attributeId}:${entry.value}`)
    .sort()
    .join('|');
}
