export const MEDIA_ENTITY_TYPES = [
  'product',
  'product_variant',
  'category',
  'brand',
] as const;

export const MAX_MEDIA_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

export const ALLOWED_MEDIA_MIME_TYPES: Record<string, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/gif': ['gif'],
};
