/**
 * Seeds a rich demo catalog (nested categories, variant-creating attributes, brands, products
 * with priced/stocked variants, placeholder product/brand images, coupons) through the real
 * running API — not direct DB writes — so it goes through the same validation every real admin
 * action does. Images are the one exception: they're uploaded straight to MinIO with the
 * internal client (see scripts/lib/placeholder-image.ts for why — this is a server-side
 * write, not a browser upload, so the presigned-URL flow doesn't apply here).
 *
 * Idempotent — safe to re-run. Existing entities are matched by slug/key/sku/code and reused
 * instead of duplicated. Run `npm run reset:demo` first for a truly clean slate.
 *
 * Usage:  npx ts-node -T scripts/seed-demo-data.ts
 * Env:    BASE_URL (default http://localhost:3000 — run this from inside the api container:
 *         `docker compose exec api npm run seed:demo`), SEED_SUPERADMIN_EMAIL /
 *         SEED_SUPERADMIN_PASSWORD (reuses the admin bootstrap credentials from .env).
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client as MinioClient } from 'minio';
import { generatePlaceholderImage } from './lib/placeholder-image';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const ADMIN_EMAIL =
  process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@printing-store.local';
const ADMIN_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD ?? 'ChangeMe123!';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const minio = new MinioClient({
  endPoint: process.env.MINIO_ENDPOINT!,
  port: parseInt(process.env.MINIO_PORT ?? '9000', 10),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY,
  region: 'us-east-1',
});
const BUCKET = process.env.MINIO_BUCKET!;
const PUBLIC_ENDPOINT = process.env.MINIO_PUBLIC_ENDPOINT ?? process.env.MINIO_ENDPOINT;
const PUBLIC_PORT = process.env.MINIO_PUBLIC_PORT ?? process.env.MINIO_PORT ?? '9000';
const PUBLIC_PROTOCOL = process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http';

type RGB = [number, number, number];

interface ApiResult {
  status: number;
  json: any;
  text: string;
}

async function api(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<ApiResult> {
  // The API's global throttler allows 100 requests/60s; a full re-seed easily exceeds that
  // in a tight sequential loop, so retry on 429 with the server's own Retry-After hint.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < 10) {
      const retryAfterSec = Number(res.headers.get('retry-after'));
      const delayMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : 2000;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: res.status, json, text };
  }
}

/** Server-side upload straight to MinIO (internal client) + a direct Media row — the
 * presigned-URL flow exists for browsers, not for the server seeding its own data. */
async function attachPlaceholderImage(
  entityType: 'product' | 'brand',
  entityId: string,
  opts: { background: RGB; panel: RGB; digitColor: RGB; number: number },
) {
  const existing = await prisma.media.findFirst({ where: { entityType, entityId } });
  if (existing) return;

  const buf = generatePlaceholderImage(opts);
  const key = `${entityType}/${entityId}/${crypto.randomUUID()}.png`;
  await minio.putObject(BUCKET, key, buf, buf.length, { 'content-type': 'image/png' });
  await prisma.media.create({
    data: {
      entityType,
      entityId,
      key,
      url: `${PUBLIC_PROTOCOL}://${PUBLIC_ENDPOINT}:${PUBLIC_PORT}/${BUCKET}/${key}`,
      mimeType: 'image/png',
      size: buf.length,
      sortOrder: 0,
    },
  });
  console.log(`    + image attached (${entityType})`);
}

async function ensureCategory(
  token: string,
  dto: { name: string; slug: string; parentId?: string },
): Promise<string> {
  const created = await api('POST', '/categories', token, dto);
  if (created.status === 201) {
    console.log(`  + category created: ${dto.slug}`);
    return created.json.id;
  }
  const list = await api('GET', '/categories');
  const existing = (list.json as { id: string; slug: string }[]).find(
    (c) => c.slug === dto.slug,
  );
  if (!existing) throw new Error(`category ${dto.slug} failed: ${created.text}`);
  console.log(`  = category exists: ${dto.slug}`);
  return existing.id;
}

async function ensureBrand(
  token: string,
  dto: { name: string; slug: string },
  color: RGB,
  number: number,
): Promise<string> {
  const created = await api('POST', '/brands', token, dto);
  let id: string;
  if (created.status === 201) {
    console.log(`  + brand created: ${dto.slug}`);
    id = created.json.id;
  } else {
    const list = await api('GET', '/brands');
    const existing = (list.json as { id: string; slug: string }[]).find(
      (b) => b.slug === dto.slug,
    );
    if (!existing) throw new Error(`brand ${dto.slug} failed: ${created.text}`);
    console.log(`  = brand exists: ${dto.slug}`);
    id = existing.id;
  }
  await attachPlaceholderImage('brand', id, {
    background: color,
    panel: [255, 255, 255],
    digitColor: color,
    number,
  });
  return id;
}

async function ensureAttribute(
  token: string,
  dto: { key: string; name: string; type: string },
  options: { value: string; label: string }[],
): Promise<{ id: string; optionIds: Record<string, string> }> {
  const created = await api('POST', '/attributes', token, dto);
  let attributeId: string;
  if (created.status === 201) {
    console.log(`  + attribute created: ${dto.key}`);
    attributeId = created.json.id;
  } else {
    const list = await api('GET', '/attributes');
    const existing = (list.json as { id: string; key: string }[]).find(
      (a) => a.key === dto.key,
    );
    if (!existing) throw new Error(`attribute ${dto.key} failed: ${created.text}`);
    console.log(`  = attribute exists: ${dto.key}`);
    attributeId = existing.id;
  }

  const detail = await api('GET', `/attributes/${attributeId}`);
  const existingOptions: { id: string; value: string }[] = detail.json?.options ?? [];
  const optionIds: Record<string, string> = {};
  for (const opt of options) {
    const found = existingOptions.find((o) => o.value === opt.value);
    if (found) {
      optionIds[opt.value] = found.id;
      continue;
    }
    const optCreated = await api('POST', `/attributes/${attributeId}/options`, token, opt);
    if (optCreated.status !== 201) {
      throw new Error(`option ${opt.value} for ${dto.key} failed: ${optCreated.text}`);
    }
    optionIds[opt.value] = optCreated.json.id;
  }
  return { id: attributeId, optionIds };
}

async function ensureCategoryAttribute(
  token: string,
  dto: { categoryId: string; attributeId: string; createsVariant: boolean; isRequired?: boolean },
) {
  const res = await api('POST', '/category-attributes', token, dto);
  if (res.status === 201 || res.status === 409) return;
  throw new Error(`category-attribute link failed: ${res.text}`);
}

async function findProductBySlug(slug: string, token: string) {
  const list = await api('GET', '/products/admin?limit=100', token);
  const items = (list.json as { items: { id: string; slug: string }[] }).items;
  return items.find((p) => p.slug === slug);
}

async function ensureProduct(
  token: string,
  dto: Record<string, unknown> & { slug: string },
): Promise<string> {
  const created = await api('POST', '/products', token, dto);
  if (created.status === 201) {
    console.log(`  + product created: ${dto.slug}`);
    return created.json.id;
  }
  const existing = await findProductBySlug(dto.slug, token);
  if (!existing) throw new Error(`product ${dto.slug} failed: ${created.text}`);
  console.log(`  = product exists: ${dto.slug}`);
  return existing.id;
}

async function ensureVariant(
  token: string,
  productId: string,
  dto: { sku: string; attributeValues: { attributeId: string; value: string }[] },
): Promise<string> {
  const created = await api('POST', `/products/${productId}/variants`, token, dto);
  if (created.status === 201) {
    console.log(`    + variant created: ${dto.sku}`);
    return created.json.id;
  }
  const list = await api('GET', `/products/${productId}/variants`, token);
  const existing = (list.json as { id: string; sku: string }[]).find(
    (v) => v.sku === dto.sku,
  );
  if (!existing) throw new Error(`variant ${dto.sku} failed: ${created.text}`);
  console.log(`    = variant exists: ${dto.sku}`);
  return existing.id;
}

async function getSoleVariantId(token: string, productId: string): Promise<string> {
  const list = await api('GET', `/products/${productId}/variants`, token);
  return (list.json as { id: string }[])[0].id;
}

async function setPrice(token: string, variantId: string, priceListKey: string, amount: number) {
  const res = await api('POST', `/variants/${variantId}/prices`, token, { priceListKey, amount });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`price for ${variantId}/${priceListKey} failed: ${res.text}`);
  }
}

async function receiveStock(token: string, variantId: string, quantity: number) {
  const res = await api('POST', '/inventory/receive', token, {
    variantId,
    quantity,
    reason: 'demo seed stock',
  });
  if (res.status !== 201) throw new Error(`stock receive for ${variantId} failed: ${res.text}`);
}

async function ensureCoupon(token: string, dto: Record<string, unknown> & { code: string }) {
  const created = await api('POST', '/coupons', token, dto);
  console.log(created.status === 201 ? `  + coupon created: ${dto.code}` : `  = coupon exists: ${dto.code}`);
}

// One variant costs a bit more per unit → simple, believable wholesale discount.
function wholesaleOf(retail: number) {
  return Math.round(retail * 0.82 * 100) / 100;
}

async function main() {
  const login = await api('POST', '/auth/login', undefined, {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  if (login.status !== 200 && login.status !== 201) {
    console.error(`cannot log in as super admin (${login.status}): ${login.text}`);
    process.exit(2);
  }
  const token = (login.json as { accessToken: string }).accessToken;

  console.log('Categories:');
  const paperRoot = await ensureCategory(token, { name: 'ورق الطباعة', slug: 'printing-paper' });
  const photoPaperCat = await ensureCategory(token, {
    name: 'ورق فوتوغرافي',
    slug: 'photo-paper',
    parentId: paperRoot,
  });
  const thermalPaperCat = await ensureCategory(token, {
    name: 'ورق حراري',
    slug: 'thermal-paper',
    parentId: paperRoot,
  });

  const inkRoot = await ensureCategory(token, { name: 'أحبار وتونر', slug: 'inks-toner' });
  const liquidInkCat = await ensureCategory(token, {
    name: 'أحبار حبر سائل',
    slug: 'liquid-ink',
    parentId: inkRoot,
  });
  const tonerCat = await ensureCategory(token, {
    name: 'كارتريدج تونر',
    slug: 'toner-cartridges',
    parentId: inkRoot,
  });

  const accessoriesRoot = await ensureCategory(token, {
    name: 'ملحقات الطباعة',
    slug: 'printing-accessories',
  });
  const cleaningCat = await ensureCategory(token, {
    name: 'أدوات تنظيف',
    slug: 'cleaning-supplies',
    parentId: accessoriesRoot,
  });
  const packagingCat = await ensureCategory(token, {
    name: 'تغليف وشحن',
    slug: 'packaging-shipping',
    parentId: accessoriesRoot,
  });

  const machinesCat = await ensureCategory(token, { name: 'آلات ومعدات', slug: 'machines-equipment' });

  console.log('Brands:');
  const hp = await ensureBrand(token, { name: 'HP', slug: 'hp' }, [11, 84, 196], 1);
  const epson = await ensureBrand(token, { name: 'Epson', slug: 'epson' }, [11, 130, 84], 2);
  const canon = await ensureBrand(token, { name: 'Canon', slug: 'canon' }, [178, 20, 20], 3);
  const brother = await ensureBrand(token, { name: 'Brother', slug: 'brother' }, [120, 30, 150], 4);
  const threeM = await ensureBrand(token, { name: '3M', slug: '3m' }, [196, 130, 40], 5);
  const grand = await ensureBrand(token, { name: 'Grand', slug: 'grand' }, [26, 31, 46], 6);

  console.log('Attributes:');
  const sizeAttr = await ensureAttribute(token, { key: 'size', name: 'المقاس', type: 'SELECT' }, [
    { value: 'A4', label: 'A4' },
    { value: 'A3', label: 'A3' },
    { value: 'A5', label: 'A5' },
  ]);
  const weightAttr = await ensureAttribute(
    token,
    { key: 'paper_weight', name: 'وزن الورق', type: 'SELECT' },
    [
      { value: '120g', label: '120 غرام' },
      { value: '200g', label: '200 غرام' },
    ],
  );
  const colorAttr = await ensureAttribute(
    token,
    { key: 'ink_color', name: 'اللون', type: 'COLOR_SELECT' },
    [
      { value: 'black', label: 'أسود' },
      { value: 'cyan', label: 'سماوي' },
      { value: 'magenta', label: 'أرجواني' },
      { value: 'yellow', label: 'أصفر' },
    ],
  );
  const capacityAttr = await ensureAttribute(
    token,
    { key: 'capacity', name: 'السعة', type: 'SELECT' },
    [
      { value: '500ml', label: '500 مل' },
      { value: '1L', label: '1 لتر' },
    ],
  );

  console.log('Category-attribute links:');
  await ensureCategoryAttribute(token, {
    categoryId: photoPaperCat,
    attributeId: sizeAttr.id,
    createsVariant: true,
    isRequired: true,
  });
  await ensureCategoryAttribute(token, {
    categoryId: photoPaperCat,
    attributeId: weightAttr.id,
    createsVariant: true,
    isRequired: true,
  });
  await ensureCategoryAttribute(token, {
    categoryId: liquidInkCat,
    attributeId: colorAttr.id,
    createsVariant: true,
    isRequired: true,
  });
  await ensureCategoryAttribute(token, {
    categoryId: liquidInkCat,
    attributeId: capacityAttr.id,
    createsVariant: true,
    isRequired: true,
  });
  await ensureCategoryAttribute(token, {
    categoryId: tonerCat,
    attributeId: colorAttr.id,
    createsVariant: true,
    isRequired: true,
  });

  const paperBg: RGB = [14, 124, 134];
  const inkBg: RGB = [178, 58, 107];
  const accessoryBg: RGB = [196, 130, 40];
  const machineBg: RGB = [60, 90, 150];
  const panel: RGB = [255, 255, 255];

  let imgCounter = 0;
  const nextImg = () => ++imgCounter;

  console.log('Products:');

  // 1. Photo paper — variable on size x weight (3 of 6 possible combinations)
  const photoPaperId = await ensureProduct(token, {
    categoryId: photoPaperCat,
    brandId: hp,
    name: 'ورق تصوير فوتوغرافي لامع',
    slug: 'glossy-photo-paper',
    description: 'ورق طباعة لامع عالي الجودة، مثالي لطباعة الصور والتصاميم.',
    type: 'VARIABLE',
    sellingUnit: 'PACKAGE',
  });
  await attachPlaceholderImage('product', photoPaperId, {
    background: paperBg,
    panel,
    digitColor: paperBg,
    number: nextImg(),
  });
  const photoVariants: [string, { attributeId: string; value: string }[], number][] = [
    ['PAPER-PHOTO-A4-120', [{ attributeId: sizeAttr.id, value: 'A4' }, { attributeId: weightAttr.id, value: '120g' }], 8],
    ['PAPER-PHOTO-A4-200', [{ attributeId: sizeAttr.id, value: 'A4' }, { attributeId: weightAttr.id, value: '200g' }], 12],
    ['PAPER-PHOTO-A3-200', [{ attributeId: sizeAttr.id, value: 'A3' }, { attributeId: weightAttr.id, value: '200g' }], 20],
  ];
  for (const [sku, attributeValues, retail] of photoVariants) {
    const id = await ensureVariant(token, photoPaperId, { sku, attributeValues });
    await setPrice(token, id, 'retail', retail);
    await setPrice(token, id, 'wholesale', wholesaleOf(retail));
    await receiveStock(token, id, 100);
  }

  // 2 & 3. Thermal paper — simple products
  for (const [name, slug, sku, retail] of [
    ['ورق حراري لآلة الفواتير 57مم', 'thermal-paper-57mm', 'THERMAL-57', 3],
    ['لفة ورق حراري 80مم', 'thermal-paper-80mm', 'THERMAL-80', 4.5],
  ] as [string, string, string, number][]) {
    const id = await ensureProduct(token, {
      categoryId: thermalPaperCat,
      brandId: grand,
      name,
      slug,
      description: 'ورق حراري عالي الجودة لآلات الطباعة الحرارية.',
      type: 'SIMPLE',
      sellingUnit: 'ROLL',
      sku,
    });
    await attachPlaceholderImage('product', id, { background: paperBg, panel, digitColor: paperBg, number: nextImg() });
    const variantId = await getSoleVariantId(token, id);
    await setPrice(token, variantId, 'retail', retail);
    await setPrice(token, variantId, 'wholesale', wholesaleOf(retail));
    await receiveStock(token, variantId, 150);
  }

  // 4. Liquid ink — variable on color x capacity (4 combos)
  const liquidInkId = await ensureProduct(token, {
    categoryId: liquidInkCat,
    brandId: epson,
    name: 'حبر طابعة نافورة أصلي',
    slug: 'epson-fountain-ink',
    description: 'حبر أصلي عالي الجودة لطابعات النافورة، ألوان زاهية وثبات طويل.',
    type: 'VARIABLE',
    sellingUnit: 'PIECE',
  });
  await attachPlaceholderImage('product', liquidInkId, { background: inkBg, panel, digitColor: inkBg, number: nextImg() });
  const inkVariants: [string, { attributeId: string; value: string }[], number][] = [
    ['INK-EPSON-BLACK-500', [{ attributeId: colorAttr.id, value: 'black' }, { attributeId: capacityAttr.id, value: '500ml' }], 9],
    ['INK-EPSON-CYAN-500', [{ attributeId: colorAttr.id, value: 'cyan' }, { attributeId: capacityAttr.id, value: '500ml' }], 9],
    ['INK-EPSON-YELLOW-500', [{ attributeId: colorAttr.id, value: 'yellow' }, { attributeId: capacityAttr.id, value: '500ml' }], 9],
    ['INK-EPSON-BLACK-1L', [{ attributeId: colorAttr.id, value: 'black' }, { attributeId: capacityAttr.id, value: '1L' }], 16],
  ];
  for (const [sku, attributeValues, retail] of inkVariants) {
    const id = await ensureVariant(token, liquidInkId, { sku, attributeValues });
    await setPrice(token, id, 'retail', retail);
    await setPrice(token, id, 'wholesale', wholesaleOf(retail));
    await receiveStock(token, id, 80);
  }

  // 5. Toner cartridges — variable on color (2 combos)
  const tonerId = await ensureProduct(token, {
    categoryId: tonerCat,
    brandId: brother,
    name: 'كارتريدج تونر ليزر أصلي',
    slug: 'brother-laser-toner',
    description: 'كارتريدج تونر أصلي لطابعات الليزر، طباعة واضحة وعدد صفحات عالي.',
    type: 'VARIABLE',
    sellingUnit: 'PIECE',
  });
  await attachPlaceholderImage('product', tonerId, { background: inkBg, panel, digitColor: inkBg, number: nextImg() });
  for (const [sku, value, retail] of [
    ['TONER-BROTHER-BLACK', 'black', 25],
    ['TONER-BROTHER-CYAN', 'cyan', 30],
  ] as [string, string, number][]) {
    const id = await ensureVariant(token, tonerId, {
      sku,
      attributeValues: [{ attributeId: colorAttr.id, value }],
    });
    await setPrice(token, id, 'retail', retail);
    await setPrice(token, id, 'wholesale', wholesaleOf(retail));
    await receiveStock(token, id, 40);
  }

  // 5b. Canon toner cartridge — variable product (toner-cartridges requires the color attribute)
  const canonTonerId = await ensureProduct(token, {
    categoryId: tonerCat,
    brandId: canon,
    name: 'كارتريدج تونر ليزر أسود',
    slug: 'canon-laser-toner-black',
    description: 'كارتريدج تونر أصلي أسود لطابعات الليزر، طباعة نظيفة وعمر طويل.',
    type: 'VARIABLE',
    sellingUnit: 'PIECE',
  });
  await attachPlaceholderImage('product', canonTonerId, { background: inkBg, panel, digitColor: inkBg, number: nextImg() });
  const canonTonerVariantId = await ensureVariant(token, canonTonerId, {
    sku: 'TONER-CANON-BLACK',
    attributeValues: [{ attributeId: colorAttr.id, value: 'black' }],
  });
  await setPrice(token, canonTonerVariantId, 'retail', 27);
  await setPrice(token, canonTonerVariantId, 'wholesale', wholesaleOf(27));
  await receiveStock(token, canonTonerVariantId, 40);

  // 6-8. Cleaning supplies — simple products
  for (const [name, slug, sku, retail, unit] of [
    ['منظف رأس الطباعة', 'printer-head-cleaner', 'CLEANER-HEAD', 6, 'PIECE'],
    ['فرشاة تنظيف الطابعة', 'printer-cleaning-brush', 'CLEANER-BRUSH', 4, 'PIECE'],
    ['مناديل تنظيف الشاشات والطابعات', 'cleaning-wipes', 'CLEANER-WIPES', 3.5, 'PACKAGE'],
  ] as [string, string, string, number, string][]) {
    const id = await ensureProduct(token, {
      categoryId: cleaningCat,
      brandId: grand,
      name,
      slug,
      description: 'أدوات عناية وتنظيف يومية لإطالة عمر جهاز الطباعة.',
      type: 'SIMPLE',
      sellingUnit: unit,
      sku,
    });
    await attachPlaceholderImage('product', id, { background: accessoryBg, panel, digitColor: accessoryBg, number: nextImg() });
    const variantId = await getSoleVariantId(token, id);
    await setPrice(token, variantId, 'retail', retail);
    await setPrice(token, variantId, 'wholesale', wholesaleOf(retail));
    await receiveStock(token, variantId, 60);
  }

  // 9-11. Packaging & shipping — simple products
  for (const [name, slug, sku, retail, unit] of [
    ['شريط لاصق تغليف شفاف', 'packing-tape', 'PACK-TAPE', 3, 'PIECE'],
    ['رول فقاعات تغليف', 'bubble-wrap-roll', 'PACK-BUBBLE', 7, 'ROLL'],
    ['صندوق تغليف كرتون وسط', 'medium-cardboard-box', 'PACK-BOX-M', 2, 'PIECE'],
  ] as [string, string, string, number, string][]) {
    const id = await ensureProduct(token, {
      categoryId: packagingCat,
      brandId: threeM,
      name,
      slug,
      description: 'مستلزمات تغليف وشحن قوية لحماية المنتجات أثناء التوصيل.',
      type: 'SIMPLE',
      sellingUnit: unit,
      sku,
    });
    await attachPlaceholderImage('product', id, { background: accessoryBg, panel, digitColor: accessoryBg, number: nextImg() });
    const variantId = await getSoleVariantId(token, id);
    await setPrice(token, variantId, 'retail', retail);
    await setPrice(token, variantId, 'wholesale', wholesaleOf(retail));
    await receiveStock(token, variantId, 200);
  }

  // 12-13. Machines & equipment — simple products
  for (const [name, slug, sku, retail, unit] of [
    ['آلة قص ورق يدوية', 'manual-paper-cutter', 'MACHINE-CUTTER', 45, 'PIECE'],
    ['دباسة مكتبية كبيرة', 'heavy-duty-stapler', 'MACHINE-STAPLER', 15, 'PIECE'],
  ] as [string, string, string, number, string][]) {
    const id = await ensureProduct(token, {
      categoryId: machinesCat,
      brandId: grand,
      name,
      slug,
      description: 'معدات مكتبية للاستخدام اليومي بجودة موثوقة.',
      type: 'SIMPLE',
      sellingUnit: unit,
      sku,
    });
    await attachPlaceholderImage('product', id, { background: machineBg, panel, digitColor: machineBg, number: nextImg() });
    const variantId = await getSoleVariantId(token, id);
    await setPrice(token, variantId, 'retail', retail);
    await setPrice(token, variantId, 'wholesale', wholesaleOf(retail));
    await receiveStock(token, variantId, 20);
  }

  console.log('Publishing all products...');
  const admin = await api('GET', '/products/admin?limit=100', token);
  const adminItems = (admin.json as { items: { id: string; status: string }[] }).items;
  for (const p of adminItems) {
    if (p.status !== 'PUBLISHED') {
      await api('PATCH', `/products/${p.id}`, token, { status: 'PUBLISHED' });
    }
  }

  console.log('Coupons:');
  await ensureCoupon(token, {
    code: 'WELCOME10',
    type: 'PERCENTAGE',
    value: 10,
    minOrderTotal: 0,
  });
  await ensureCoupon(token, {
    code: 'SAVE20',
    type: 'FIXED_AMOUNT',
    value: 20,
    minOrderTotal: 100,
    maxUses: 50,
  });
  await ensureCoupon(token, {
    code: 'BULK15',
    type: 'PERCENTAGE',
    value: 15,
    minOrderTotal: 200,
  });

  console.log('\nDone. Rich demo catalog (10 categories, 4 attributes, 6 brands, 14 products, 20 variants, images, 3 coupons) is live and PUBLISHED.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
