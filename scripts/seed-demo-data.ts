/**
 * Seeds realistic demo catalog data (categories, attributes, brands, products, variants,
 * prices, inventory, one coupon) through the real running API — not direct DB writes — so
 * every rule the real admin UI would enforce (variant-attribute validation, combinationKey
 * uniqueness, etc.) is respected automatically. Safe to re-run: entities that already exist
 * (matched by slug/key/sku/code) are reused instead of duplicated or failing.
 *
 * Usage:  npx ts-node -T scripts/seed-demo-data.ts
 * Env:    BASE_URL (default http://localhost:3000 — the app's own internal port; run this
 *         from inside the api container, e.g. `docker compose exec api npx ts-node -T
 *         scripts/seed-demo-data.ts`), SEED_SUPERADMIN_EMAIL / SEED_SUPERADMIN_PASSWORD
 *         (reuses the same admin bootstrap credentials already in .env).
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const ADMIN_EMAIL =
  process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@printing-store.local';
const ADMIN_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD ?? 'ChangeMe123!';

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
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text };
}

async function ensureCategory(
  token: string,
  dto: { name: string; slug: string },
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
): Promise<string> {
  const created = await api('POST', '/brands', token, dto);
  if (created.status === 201) {
    console.log(`  + brand created: ${dto.slug}`);
    return created.json.id;
  }
  const list = await api('GET', '/brands');
  const existing = (list.json as { id: string; slug: string }[]).find(
    (b) => b.slug === dto.slug,
  );
  if (!existing) throw new Error(`brand ${dto.slug} failed: ${created.text}`);
  console.log(`  = brand exists: ${dto.slug}`);
  return existing.id;
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
  const existingOptions: { id: string; value: string }[] =
    detail.json?.options ?? [];
  const optionIds: Record<string, string> = {};
  for (const opt of options) {
    const found = existingOptions.find((o) => o.value === opt.value);
    if (found) {
      optionIds[opt.value] = found.id;
      continue;
    }
    const optCreated = await api(
      'POST',
      `/attributes/${attributeId}/options`,
      token,
      opt,
    );
    if (optCreated.status !== 201) {
      throw new Error(`option ${opt.value} for ${dto.key} failed: ${optCreated.text}`);
    }
    optionIds[opt.value] = optCreated.json.id;
  }
  return { id: attributeId, optionIds };
}

async function ensureCategoryAttribute(
  token: string,
  dto: {
    categoryId: string;
    attributeId: string;
    createsVariant: boolean;
    isRequired?: boolean;
  },
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
  const created = await api(
    'POST',
    `/products/${productId}/variants`,
    token,
    dto,
  );
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

async function setPrice(
  token: string,
  variantId: string,
  priceListKey: string,
  amount: number,
) {
  const res = await api('POST', `/variants/${variantId}/prices`, token, {
    priceListKey,
    amount,
  });
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
  if (res.status !== 201) {
    throw new Error(`stock receive for ${variantId} failed: ${res.text}`);
  }
}

async function ensureCoupon(
  token: string,
  dto: Record<string, unknown> & { code: string },
) {
  const created = await api('POST', '/coupons', token, dto);
  if (created.status === 201) {
    console.log(`  + coupon created: ${dto.code}`);
    return;
  }
  console.log(`  = coupon exists: ${dto.code}`);
}

async function main() {
  const login = await api('POST', '/auth/login', undefined, {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  if (login.status !== 200 && login.status !== 201) {
    console.error(
      `cannot log in as super admin (${login.status}): ${login.text}`,
    );
    process.exit(2);
  }
  const token = (login.json as { accessToken: string }).accessToken;

  console.log('Categories:');
  const paperCatId = await ensureCategory(token, {
    name: 'ورق الطباعة',
    slug: 'printing-paper',
  });
  const inkCatId = await ensureCategory(token, { name: 'أحبار', slug: 'inks' });
  const accessoriesCatId = await ensureCategory(token, {
    name: 'ملحقات الطباعة',
    slug: 'printing-accessories',
  });

  console.log('Brands:');
  const hpId = await ensureBrand(token, { name: 'HP', slug: 'hp' });
  const epsonId = await ensureBrand(token, { name: 'Epson', slug: 'epson' });
  const grandId = await ensureBrand(token, { name: 'Grand', slug: 'grand' });

  console.log('Attributes:');
  const sizeAttr = await ensureAttribute(
    token,
    { key: 'size', name: 'المقاس', type: 'SELECT' },
    [
      { value: 'A4', label: 'A4' },
      { value: 'A3', label: 'A3' },
    ],
  );
  const colorAttr = await ensureAttribute(
    token,
    { key: 'color', name: 'اللون', type: 'COLOR_SELECT' },
    [
      { value: 'red', label: 'أحمر' },
      { value: 'blue', label: 'أزرق' },
      { value: 'black', label: 'أسود' },
    ],
  );

  console.log('Category-attribute links:');
  await ensureCategoryAttribute(token, {
    categoryId: paperCatId,
    attributeId: sizeAttr.id,
    createsVariant: true,
    isRequired: true,
  });
  await ensureCategoryAttribute(token, {
    categoryId: inkCatId,
    attributeId: colorAttr.id,
    createsVariant: true,
    isRequired: true,
  });

  console.log('Products:');

  // 1. Variable product: glossy photo paper, sizes A4/A3
  const paperProductId = await ensureProduct(token, {
    categoryId: paperCatId,
    brandId: hpId,
    name: 'ورق طباعة لامع',
    slug: 'glossy-photo-paper',
    description: 'ورق طباعة لامع عالي الجودة للصور',
    type: 'VARIABLE',
    sellingUnit: 'PACKAGE',
  });
  const paperA4 = await ensureVariant(token, paperProductId, {
    sku: 'PAPER-GLOSSY-A4',
    attributeValues: [{ attributeId: sizeAttr.id, value: 'A4' }],
  });
  const paperA3 = await ensureVariant(token, paperProductId, {
    sku: 'PAPER-GLOSSY-A3',
    attributeValues: [{ attributeId: sizeAttr.id, value: 'A3' }],
  });
  await setPrice(token, paperA4, 'retail', 12.5);
  await setPrice(token, paperA4, 'wholesale', 10);
  await setPrice(token, paperA3, 'retail', 18);
  await setPrice(token, paperA3, 'wholesale', 14.5);
  await receiveStock(token, paperA4, 100);
  await receiveStock(token, paperA3, 60);

  // 2. Variable product: color printer ink, red/blue/black
  const inkProductId = await ensureProduct(token, {
    categoryId: inkCatId,
    brandId: epsonId,
    name: 'حبر طابعة ملون',
    slug: 'color-printer-ink',
    description: 'خرطوشة حبر أصلية عالية الجودة',
    type: 'VARIABLE',
    sellingUnit: 'PIECE',
  });
  const inkRed = await ensureVariant(token, inkProductId, {
    sku: 'INK-RED',
    attributeValues: [{ attributeId: colorAttr.id, value: 'red' }],
  });
  const inkBlue = await ensureVariant(token, inkProductId, {
    sku: 'INK-BLUE',
    attributeValues: [{ attributeId: colorAttr.id, value: 'blue' }],
  });
  const inkBlack = await ensureVariant(token, inkProductId, {
    sku: 'INK-BLACK',
    attributeValues: [{ attributeId: colorAttr.id, value: 'black' }],
  });
  for (const [variantId, retail] of [
    [inkRed, 15],
    [inkBlue, 15],
    [inkBlack, 13],
  ] as [string, number][]) {
    await setPrice(token, variantId, 'retail', retail);
    await setPrice(token, variantId, 'wholesale', Math.round(retail * 0.8 * 100) / 100);
    await receiveStock(token, variantId, 80);
  }

  // 3. Simple product: printer head cleaner
  const cleanerProductId = await ensureProduct(token, {
    categoryId: accessoriesCatId,
    brandId: grandId,
    name: 'منظف رأس الطابعة',
    slug: 'printer-head-cleaner',
    description: 'سائل تنظيف رأس الطابعة',
    type: 'SIMPLE',
    sellingUnit: 'PIECE',
    sku: 'CLEANER-1',
  });
  const cleanerVariants = await api(
    'GET',
    `/products/${cleanerProductId}/variants`,
    token,
  );
  const cleanerVariantId = (cleanerVariants.json as { id: string }[])[0].id;
  await setPrice(token, cleanerVariantId, 'retail', 8);
  await setPrice(token, cleanerVariantId, 'wholesale', 6);
  await receiveStock(token, cleanerVariantId, 50);

  // 4. Simple product: packing tape
  const tapeProductId = await ensureProduct(token, {
    categoryId: accessoriesCatId,
    brandId: grandId,
    name: 'شريط لاصق تغليف',
    slug: 'packing-tape',
    description: 'شريط لاصق قوي للتغليف',
    type: 'SIMPLE',
    sellingUnit: 'PIECE',
    sku: 'TAPE-1',
  });
  const tapeVariants = await api(
    'GET',
    `/products/${tapeProductId}/variants`,
    token,
  );
  const tapeVariantId = (tapeVariants.json as { id: string }[])[0].id;
  await setPrice(token, tapeVariantId, 'retail', 3.5);
  await setPrice(token, tapeVariantId, 'wholesale', 2.5);
  await receiveStock(token, tapeVariantId, 200);

  // Publish everything so it's visible on the public storefront
  console.log('Publishing products...');
  for (const id of [paperProductId, inkProductId, cleanerProductId, tapeProductId]) {
    await api('PATCH', `/products/${id}`, token, { status: 'PUBLISHED' });
  }

  console.log('Coupon:');
  await ensureCoupon(token, {
    code: 'WELCOME10',
    type: 'PERCENTAGE',
    value: 10,
    minOrderTotal: 0,
  });

  console.log('\nDone. Demo catalog is live and PUBLISHED on the storefront.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
