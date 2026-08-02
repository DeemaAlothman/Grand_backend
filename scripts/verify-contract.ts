/**
 * Hits the live dev API (docker stack must be running) and checks real response shapes
 * against claims made in API_CONTRACT.md, instead of relying on someone re-deriving them
 * by hand every time the frontend has a question. Exits non-zero if anything mismatches.
 *
 * Usage:
 *   npm run verify:contract                 # read-only checks only
 *   VERIFY_WRITES=1 npm run verify:contract  # also creates a scratch category/product to
 *                                            # observe post-create state (status, response shape)
 *
 * Env overrides: BASE_URL (default http://localhost:3000),
 * SEED_SUPERADMIN_EMAIL / SEED_SUPERADMIN_PASSWORD (must match prisma/seed.ts's dev admin).
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const ADMIN_EMAIL =
  process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@printing-store.local';
const ADMIN_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD ?? 'ChangeMe123!';
const VERIFY_WRITES = process.env.VERIFY_WRITES === '1';

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

const results: CheckResult[] = [];

function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
}

function hasKeys(obj: unknown, keys: string[]): boolean {
  return (
    !!obj &&
    typeof obj === 'object' &&
    keys.every((k) => k in (obj as Record<string, unknown>))
  );
}

async function api(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
) {
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

function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
}

async function main() {
  const login = await api('POST', '/auth/login', undefined, {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  if (login.status !== 200 && login.status !== 201) {
    console.error(
      `cannot log in as super admin (${login.status}) — is the docker stack running and seeded?\n${login.text}`,
    );
    process.exit(2);
  }
  const token = (login.json as { accessToken: string }).accessToken;
  const payload = decodeJwt(token);

  // --- super_admin JWT permissions: populated or empty? ---
  const permissions = payload.permissions;
  check(
    'super_admin JWT carries a populated permissions array',
    Array.isArray(permissions) && permissions.length > 0,
    `got ${Array.isArray(permissions) ? permissions.length : 'non-array'} entries`,
  );

  // --- InventoryLevel/InventoryMovement real field names ---
  const inv = await api('GET', '/inventory', token);
  const invSample = Array.isArray(inv.json) ? inv.json[0] : undefined;
  if (invSample) {
    check(
      'GET /inventory item has quantityOnHand & quantityReserved',
      hasKeys(invSample, ['quantityOnHand', 'quantityReserved']),
      Object.keys(invSample as object).join(', '),
    );
  } else {
    check('GET /inventory item has quantityOnHand & quantityReserved', true, 'skipped — no inventory rows yet');
  }

  const movements = await api('GET', '/inventory/movements', token);
  const moveSample = Array.isArray(movements.json)
    ? movements.json[0]
    : undefined;
  if (moveSample) {
    check(
      'GET /inventory/movements item has type & quantity',
      hasKeys(moveSample, ['type', 'quantity']),
      Object.keys(moveSample as object).join(', '),
    );
  } else {
    check('GET /inventory/movements item has type & quantity', true, 'skipped — no movement rows yet');
  }

  // --- GET /products/:id/variants includes prices? ---
  const products = await api('GET', '/products?limit=1', token);
  const firstProduct = (products.json as { items?: { id: string }[] })
    ?.items?.[0];
  if (firstProduct) {
    const variants = await api(
      'GET',
      `/products/${firstProduct.id}/variants`,
      token,
    );
    const variantSample = Array.isArray(variants.json)
      ? variants.json[0]
      : undefined;
    check(
      'GET /products/:id/variants item includes prices[]',
      hasKeys(variantSample, ['prices']),
      variantSample ? Object.keys(variantSample as object).join(', ') : 'no variants to sample',
    );
  } else {
    check('GET /products/:id/variants item includes prices[]', true, 'skipped — no published products yet');
  }

  // --- GET /category-attributes includes the full attribute definition? ---
  const categories = await api('GET', '/categories', token);
  const firstCategory = Array.isArray(categories.json)
    ? categories.json[0]
    : undefined;
  if (firstCategory) {
    const catAttrs = await api(
      'GET',
      `/category-attributes?categoryId=${(firstCategory as { id: string }).id}`,
      token,
    );
    const linkSample = Array.isArray(catAttrs.json)
      ? catAttrs.json[0]
      : undefined;
    if (linkSample) {
      check(
        'GET /category-attributes item includes full attribute definition (with options)',
        hasKeys(linkSample, ['attribute']) &&
          hasKeys((linkSample as { attribute: unknown }).attribute, ['options']),
        JSON.stringify(Object.keys(linkSample as object)),
      );
    } else {
      check(
        'GET /category-attributes item includes full attribute definition (with options)',
        true,
        'skipped — this category has no linked attributes',
      );
    }
  } else {
    check(
      'GET /category-attributes item includes full attribute definition (with options)',
      true,
      'skipped — no categories exist yet',
    );
  }

  // --- Order response includes payments[] and shipments[]? (sample any existing order) ---
  const orders = await api('GET', '/orders?limit=1', token);
  const firstOrder = (orders.json as { items?: unknown[] })?.items?.[0];
  if (firstOrder) {
    check(
      'Order detail includes payments[] and shipments[]',
      hasKeys(firstOrder, ['payments', 'shipments', 'items']),
      Object.keys(firstOrder as object).join(', '),
    );
    const itemSample = (firstOrder as { items: unknown[] }).items[0];
    if (itemSample) {
      check(
        'OrderItem has the documented snapshot fields',
        hasKeys(itemSample, [
          'productNameSnapshot',
          'skuSnapshot',
          'attributesSnapshot',
          'unitPriceSnapshot',
          'quantity',
          'lineTotal',
        ]),
        Object.keys(itemSample as object).join(', '),
      );
    }
  } else {
    check('Order detail includes payments[] and shipments[]', true, 'skipped — no orders exist yet');
  }

  // --- Write checks: product status after creation, real POST /products response shape ---
  if (VERIFY_WRITES) {
    const suffix = Date.now();
    const category = await api('POST', '/categories', token, {
      name: `verify-contract ${suffix}`,
      slug: `verify-contract-${suffix}`,
    });
    if (category.status === 201) {
      const categoryId = (category.json as { id: string }).id;
      const product = await api('POST', '/products', token, {
        categoryId,
        name: `verify-contract product ${suffix}`,
        type: 'SIMPLE',
        sellingUnit: 'PIECE',
        sku: `VERIFY-${suffix}`,
      });
      check(
        'POST /products succeeds with a minimal SIMPLE product payload',
        product.status === 201,
        `status ${product.status}: ${product.text.slice(0, 200)}`,
      );
      if (product.status === 201) {
        check(
          'New product status defaults to DRAFT',
          (product.json as { status: string }).status === 'DRAFT',
          `got status="${(product.json as { status: string }).status}"`,
        );
        check(
          'POST /products response includes id, status, variants[]',
          hasKeys(product.json, ['id', 'status', 'variants']),
          Object.keys(product.json as object).join(', '),
        );
        // Clean up the scratch product so repeated runs don't pile up test data.
        await api('DELETE', `/products/${(product.json as { id: string }).id}`, token);
      }
      // Clean up the scratch category too (only succeeds once nothing references it anymore).
      await api('DELETE', `/categories/${categoryId}`, token);
    } else {
      check(
        'POST /products succeeds with a minimal SIMPLE product payload',
        false,
        `could not create scratch category: status ${category.status}`,
      );
    }
  } else {
    console.log('(VERIFY_WRITES not set — skipping write-based checks: product creation shape/status)\n');
  }

  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`${r.pass ? 'MATCH   ' : 'MISMATCH'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
