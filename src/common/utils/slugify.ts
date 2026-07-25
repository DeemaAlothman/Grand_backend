/** Slugifies Arabic/Latin text: keeps letters/digits from any script, replaces the rest with hyphens. */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}
