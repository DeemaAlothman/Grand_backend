import { BadRequestException } from '@nestjs/common';
import type { ParsedProductQuery } from './dto/query-products.dto';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseUuid(raw: string | undefined, field: string): string | undefined {
  if (raw === undefined) return undefined;
  if (!UUID_RE.test(raw)) {
    throw new BadRequestException(`${field} must be a valid UUID`);
  }
  return raw;
}

function parseNonNegativeInt(
  raw: string | undefined,
  field: string,
): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new BadRequestException(`${field} must be a non-negative integer`);
  }
  return value;
}

export function parseProductQuery(
  raw: Record<string, string>,
): ParsedProductQuery {
  const attributeFilters: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('attr_')) {
      attributeFilters[key.slice('attr_'.length)] = value;
    }
  }

  const limit = parseNonNegativeInt(raw.limit, 'limit') ?? 20;
  if (limit < 1 || limit > 100) {
    throw new BadRequestException('limit must be between 1 and 100');
  }

  return {
    q: raw.q,
    categoryId: parseUuid(raw.categoryId, 'categoryId'),
    brandId: parseUuid(raw.brandId, 'brandId'),
    minPrice: parseNonNegativeInt(raw.minPrice, 'minPrice'),
    maxPrice: parseNonNegativeInt(raw.maxPrice, 'maxPrice'),
    cursor: parseUuid(raw.cursor, 'cursor'),
    limit,
    attributeFilters,
  };
}
