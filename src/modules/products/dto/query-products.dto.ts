export interface ParsedProductQuery {
  q?: string;
  categoryId?: string;
  brandId?: string;
  minPrice?: number;
  maxPrice?: number;
  cursor?: string;
  limit: number;
  attributeFilters: Record<string, string>;
}
