import type { SellingUnit } from '@prisma/client';

const FRACTIONAL_UNITS: SellingUnit[] = ['METER', 'ROLL', 'KILOGRAM'];

export function isFractionalSellingUnit(unit: SellingUnit): boolean {
  return FRACTIONAL_UNITS.includes(unit);
}
