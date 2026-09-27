/**
 * Seeds the store's real catalog structure: the brands the company represents, the full
 * category tree (machines, advertising materials, textile printing materials, display stands,
 * accessories), and the machine line-up as VARIABLE products with one variant per size/power.
 *
 * Goes through the real running API (same validation as the admin panel), no direct DB writes.
 *
 * What it deliberately does NOT do — these need real numbers/files a human has to provide:
 *   - no prices, no stock, no images/logos
 *   - every product is left as DRAFT; publish it from the admin panel once it has a price
 *   - materials/stands/accessories only get categories; their actual products (thickness,
 *     colour, roll width...) are added from the admin panel under those categories
 *
 * Idempotent — safe to re-run. Existing entities are matched by slug/key/sku and reused.
 *
 * Usage:  docker compose exec api npm run seed:catalog
 * Env:    BASE_URL (default http://localhost:3000), SEED_SUPERADMIN_EMAIL / SEED_SUPERADMIN_PASSWORD.
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const ADMIN_EMAIL = process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@printing-store.local';
const ADMIN_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD ?? 'ChangeMe123!';

interface ApiResult {
  status: number;
  json: any;
  text: string;
}

async function api(method: string, path: string, token?: string, body?: unknown): Promise<ApiResult> {
  // Retry on 429 — the API's global throttler (100 req/60s) is easily exceeded by a full seed.
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

// ---------------------------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------------------------

const BRANDS: { key: string; name: string; slug: string }[] = [
  { key: 'unibond', name: 'UniBond', slug: 'unibond' },
  { key: 'dermax', name: 'Dermax', slug: 'dermax' },
  { key: 'hp', name: 'HP', slug: 'hp' },
  { key: 'sumipex', name: 'Sumipex', slug: 'sumipex' },
  { key: 'cosmo', name: 'Cosmo', slug: 'cosmo' },
  { key: 'kemica', name: 'Kemica', slug: 'kemica' },
  { key: 'audley', name: 'Audley', slug: 'audley' },
  { key: 'challenger', name: 'Challenger', slug: 'challenger' },
  { key: 'teneth', name: 'Teneth', slug: 'teneth' },
  { key: 'grand-laser', name: 'Grand Laser', slug: 'grand-laser' },
  { key: 'maigao', name: 'MaiGao', slug: 'maigao' },
  { key: 'kao-chimigraf', name: 'Kao Chimigraf', slug: 'kao-chimigraf' },
];

/** Variant-creating attributes. `key` of each option is also used to build SKUs. */
const ATTRIBUTES = {
  machine_size: {
    name: 'المقاس',
    options: [
      // Printers / laminators (width)
      ['30cm', '30 سم'],
      ['60cm', '60 سم'],
      ['120cm', '120 سم'],
      ['160cm', '160 سم'],
      ['180cm', '180 سم'],
      ['210cm', '210 سم'],
      ['220cm', '220 سم'],
      ['320cm', '320 سم'],
      ['500cm', '500 سم'],
      // Flat beds / work areas (cm)
      ['35x50', '35 × 50 سم'],
      ['60x90', '60 × 90 سم'],
      ['130x140', '130 × 140 سم'],
      ['250x130', '250 × 130 سم'],
      ['60x40', '60 × 40 سم'],
      ['140x90', '140 × 90 سم'],
      ['120x160', '120 × 160 سم'],
      ['30x30', '30 × 30 سم'],
      ['150x300', '150 × 300 سم'],
      ['300x150', '300 × 150 سم'],
      ['400x210', '400 × 210 سم'],
      ['600x150', '600 × 150 سم'],
      // Cutters
      ['31cm', '31 سم'],
      ['a5', 'A5'],
      ['a3', 'A3'],
      ['40cm', '40 سم'],
      ['70cm', '70 سم'],
      ['130cm', '130 سم'],
      // 3D
      ['80x80', '80 × 80'],
      ['120x120', '120 × 120'],
      ['120x120-pro', '120 × 120 Pro'],
    ],
  },
  laser_power: {
    name: 'القدرة',
    options: [
      ['30w', '30 واط'],
      ['50w', '50 واط'],
      ['80w', '80 واط'],
      ['100w', '100 واط'],
      ['150w', '150 واط'],
      ['180w', '180 واط'],
      ['3000w', '3000 واط'],
      ['6000w', '6000 واط'],
    ],
  },
} as const;

type AttrKey = keyof typeof ATTRIBUTES;

interface CategoryNode {
  name: string;
  slug: string;
  /** Variant-creating attributes linked to this category (products in it must set all of them). */
  variantAttrs?: AttrKey[];
  children?: CategoryNode[];
}

const leaves = (items: [string, string][]): CategoryNode[] =>
  items.map(([name, slug]) => ({ name, slug }));

const CATEGORY_TREE: CategoryNode[] = [
  {
    name: 'قطاع الآلات',
    slug: 'machines',
    children: [
      {
        name: 'آلات الطباعة',
        slug: 'printing-machines',
        children: [
          { name: 'طباعة Solvent و Eco Solvent', slug: 'solvent-printers', variantAttrs: ['machine_size'] },
          { name: 'طباعة UV', slug: 'uv-printers', variantAttrs: ['machine_size'] },
          { name: 'طباعة Sublimation', slug: 'sublimation-printers', variantAttrs: ['machine_size'] },
          { name: 'طباعة DTF', slug: 'dtf-printers', variantAttrs: ['machine_size'] },
          { name: 'آلات السلفنة', slug: 'laminating-machines', variantAttrs: ['machine_size'] },
          { name: 'قطع وإكسسوارات الآلات', slug: 'machine-parts' },
        ],
      },
      { name: 'آلات الليزر', slug: 'laser-machines', variantAttrs: ['machine_size', 'laser_power'] },
      { name: 'آلات CNC', slug: 'cnc-machines', variantAttrs: ['machine_size'] },
      { name: 'آلات الكتر', slug: 'cutting-plotters', variantAttrs: ['machine_size'] },
      { name: 'آلات طباعة 3D', slug: '3d-printers', variantAttrs: ['machine_size'] },
      { name: 'آلات لف الأحرف', slug: 'letter-bending-machines' },
      { name: 'آلات اللحام', slug: 'welding-machines' },
    ],
  },
  {
    name: 'المواد الإعلانية',
    slug: 'advertising-materials',
    children: [
      {
        name: 'الألواح',
        slug: 'boards',
        children: leaves([
          ['ألكوبوند', 'alucobond'],
          ['بلكسي', 'plexiglass'],
          ['فوم', 'foam-boards'],
          ['بولي كاربونات', 'polycarbonate'],
          ['بولي سترين', 'polystyrene'],
          ['روماك', 'romak'],
        ]),
      },
      {
        name: 'بنضات الأحرف',
        slug: 'letter-strips',
        children: leaves([
          ['ألمنيوم', 'letter-strips-aluminum'],
          ['كروم', 'letter-strips-chrome'],
        ]),
      },
      {
        name: 'الفلكس',
        slug: 'flex',
        children: leaves([
          ['منار', 'flex-backlit'],
          ['كتيم', 'flex-frontlit'],
          ['كوتد', 'flex-coated'],
          ['عاكس', 'flex-reflective'],
          ['قماش منار', 'flex-backlit-fabric'],
        ]),
      },
      {
        name: 'الفينيل',
        slug: 'vinyl',
        children: leaves([
          ['فينيل طباعي', 'vinyl-printable'],
          ['فينيل ملون', 'vinyl-colored'],
          ['فينيل ملون شفاف', 'vinyl-colored-transparent'],
          ['فينيل مغشى', 'vinyl-frosted'],
          ['فينيل مثقب', 'vinyl-perforated'],
          ['فينيل عاكس', 'vinyl-reflective'],
          ['فينيل حراري', 'vinyl-heat-transfer'],
          ['فينيل كربون', 'vinyl-carbon'],
          ['فينيل أرضيات', 'vinyl-floor'],
          ['فينيل مغناطيس', 'vinyl-magnetic'],
        ]),
      },
      {
        name: 'الأحبار',
        slug: 'inks',
        children: leaves([
          ['أحبار Solvent', 'inks-solvent'],
          ['أحبار Eco-Solvent', 'inks-eco-solvent'],
          ['أحبار UV', 'inks-uv'],
          ['أحبار Sublimation', 'inks-sublimation'],
        ]),
      },
      {
        name: 'ورق وأقمشة وأفلام الطباعة',
        slug: 'print-media',
        children: leaves([
          ['مواد UV DTF', 'uv-dtf-materials'],
          ['ورق Sublimation', 'print-media-sublimation-paper'],
          ['ورق Photo', 'photo-paper'],
          ['قماش الأعلام', 'flag-fabric'],
          ['قماش Canvas', 'canvas-fabric'],
          ['باكلايت فيلم PET', 'backlit-film-pet'],
          ['ورق جدران', 'wallpaper'],
        ]),
      },
    ],
  },
  {
    name: 'مواد طباعة الأقمشة',
    slug: 'textile-printing-materials',
    children: [
      {
        name: 'Sublimation',
        slug: 'textile-sublimation',
        children: leaves([
          ['ورق Sublimation', 'textile-sublimation-paper'],
          ['أحبار Sublimation', 'textile-sublimation-inks'],
        ]),
      },
      {
        name: 'DTF',
        slug: 'textile-dtf',
        children: leaves([
          ['فلم DTF', 'dtf-film'],
          ['بودرة DTF', 'dtf-powder'],
          ['أحبار DTF', 'dtf-inks'],
        ]),
      },
      {
        name: 'TPU',
        slug: 'textile-tpu',
        children: leaves([
          ['فلم TPU', 'tpu-film'],
          ['أحبار TPU', 'tpu-inks'],
        ]),
      },
      { name: 'أفلام تطريز', slug: 'embroidery-films' },
    ],
  },
  {
    name: 'قطاع العرض والإعلان',
    slug: 'display-stands',
    children: leaves([
      ['رول أب', 'roll-up'],
      ['بوب آب', 'pop-up'],
      ['ستاند شراع', 'sail-flag-stand'],
      ['ستاند تذوق', 'tasting-stand'],
      ['ستاند بروشور', 'brochure-stand'],
      ['ستاند X', 'x-stand'],
      ['ستاندات متحركة', 'mobile-stands'],
      ['ستاندات جدارية', 'wall-stands'],
    ]),
  },
  {
    name: 'الإكسسوارات',
    slug: 'accessories',
    children: [
      { name: 'السيليكون والمواد اللاصقة', slug: 'silicone-adhesives' },
      { name: 'مستلزمات LED', slug: 'led-supplies' },
      {
        name: 'المباعدات',
        slug: 'standoffs',
        children: leaves([
          ['مباعدات كروم', 'standoffs-chrome'],
          ['مباعدات بلكسي', 'standoffs-plexiglass'],
        ]),
      },
      { name: 'الريش وأدوات القص', slug: 'blades-cutting-tools' },
      { name: 'القشاطات', slug: 'squeegees' },
      { name: 'الباور سبلاي', slug: 'power-supplies' },
      { name: 'الأختام', slug: 'stamps' },
    ],
  },
];

interface MachineProduct {
  name: string;
  slug: string;
  category: string;
  brand?: string;
  skuPrefix: string;
  description: string;
  /** One entry per variant: the option values for each of the category's variant attributes. */
  variants: Partial<Record<AttrKey, string>>[];
}

const sizes = (...values: string[]) => values.map((v) => ({ machine_size: v }));

const MACHINES: MachineProduct[] = [
  // --- Challenger (industrial) ---
  {
    name: 'آلة طباعة Challenger Solvent',
    slug: 'challenger-solvent',
    category: 'solvent-printers',
    brand: 'challenger',
    skuPrefix: 'CHL-SOLV',
    description:
      'آلة طباعة صناعية Solvent من Challenger، تمتاز بالثباتية وسرعة الإنتاج، تعمل برؤوس الطباعة Seiko Alpha 1024.',
    variants: sizes('320cm', '500cm'),
  },
  {
    name: 'آلة طباعة Challenger UV مسطحة',
    slug: 'challenger-uv-flatbed',
    category: 'uv-printers',
    brand: 'challenger',
    skuPrefix: 'CHL-UVFB',
    description:
      'آلة طباعة UV مسطحة صناعية من Challenger، تمتاز بالثباتية وسرعة الإنتاج، تعمل برؤوس الطباعة Ricoh G5 / G6.',
    variants: sizes('250x130'),
  },
  {
    name: 'آلة طباعة Challenger UV Roll to Roll',
    slug: 'challenger-uv-roll-to-roll',
    category: 'uv-printers',
    brand: 'challenger',
    skuPrefix: 'CHL-UVRR',
    description:
      'آلة طباعة UV رول تو رول صناعية من Challenger، تمتاز بالثباتية وسرعة الإنتاج، تعمل برؤوس الطباعة Ricoh G5 / G6.',
    variants: sizes('320cm'),
  },
  // --- Audley (high precision, Epson i1600 / i3200 heads) ---
  {
    name: 'آلة طباعة Audley Eco Solvent',
    slug: 'audley-eco-solvent',
    category: 'solvent-printers',
    brand: 'audley',
    skuPrefix: 'AUD-ECO',
    description:
      'آلة طباعة Eco Solvent عالية الدقة من Audley، تعمل برؤوس الطباعة Epson (i1600 / i3200).',
    variants: sizes('160cm', '180cm', '210cm', '320cm'),
  },
  {
    name: 'آلة طباعة Audley UV مسطحة مع كاميرا',
    slug: 'audley-uv-flatbed',
    category: 'uv-printers',
    brand: 'audley',
    skuPrefix: 'AUD-UVFB',
    description:
      'آلة طباعة UV مسطحة عالية الدقة من Audley مع ميزة الكاميرا، تعمل برؤوس الطباعة Epson (i1600 / i3200).',
    variants: sizes('35x50', '60x90', '130x140'),
  },
  {
    name: 'آلة طباعة Audley UV Roll to Roll',
    slug: 'audley-uv-roll-to-roll',
    category: 'uv-printers',
    brand: 'audley',
    skuPrefix: 'AUD-UVRR',
    description:
      'آلة طباعة UV رول تو رول عالية الدقة من Audley، تعمل برؤوس الطباعة Epson (i1600 / i3200).',
    variants: sizes('180cm', '210cm', '320cm'),
  },
  {
    name: 'آلة طباعة Audley UV DTF',
    slug: 'audley-uv-dtf',
    category: 'uv-printers',
    brand: 'audley',
    skuPrefix: 'AUD-UVDTF',
    description: 'آلة طباعة UV DTF عالية الدقة من Audley، تعمل برؤوس الطباعة Epson (i1600 / i3200).',
    variants: sizes('30cm', '60cm'),
  },
  {
    name: 'آلة طباعة Audley UV تطريز',
    slug: 'audley-uv-embroidery',
    category: 'uv-printers',
    brand: 'audley',
    skuPrefix: 'AUD-UVEMB',
    description: 'آلة طباعة UV تطريز عالية الدقة من Audley، تعمل برؤوس الطباعة Epson (i1600 / i3200).',
    variants: sizes('60cm'),
  },
  {
    name: 'آلة طباعة Audley UV TPU',
    slug: 'audley-uv-tpu',
    category: 'uv-printers',
    brand: 'audley',
    skuPrefix: 'AUD-UVTPU',
    description: 'آلة طباعة UV TPU عالية الدقة من Audley، تعمل برؤوس الطباعة Epson (i1600 / i3200).',
    variants: sizes('60x90'),
  },
  {
    name: 'آلة طباعة Audley Sublimation على ورق ناقل - 4 رؤوس',
    slug: 'audley-sublimation-transfer-4-heads',
    category: 'sublimation-printers',
    brand: 'audley',
    skuPrefix: 'AUD-SUB-TR4',
    description:
      'آلة طباعة Sublimation على الورق الناقل من Audley بأربعة رؤوس طباعة Epson (i1600 / i3200).',
    variants: sizes('220cm'),
  },
  {
    name: 'آلة طباعة Audley Sublimation على ورق ناقل - 8 رؤوس',
    slug: 'audley-sublimation-transfer-8-heads',
    category: 'sublimation-printers',
    brand: 'audley',
    skuPrefix: 'AUD-SUB-TR8',
    description:
      'آلة طباعة Sublimation على الورق الناقل من Audley بثمانية رؤوس طباعة Epson (i1600 / i3200).',
    variants: sizes('220cm'),
  },
  {
    name: 'آلة طباعة Audley Sublimation مباشرة - 4 رؤوس',
    slug: 'audley-sublimation-direct-4-heads',
    category: 'sublimation-printers',
    brand: 'audley',
    skuPrefix: 'AUD-SUB-DIR4',
    description:
      'آلة طباعة Sublimation مباشرة على القماش من Audley بأربعة رؤوس طباعة Epson (i1600 / i3200).',
    variants: sizes('220cm'),
  },
  {
    name: 'آلة طباعة Audley DTF',
    slug: 'audley-dtf',
    category: 'dtf-printers',
    brand: 'audley',
    skuPrefix: 'AUD-DTF',
    description: 'آلة طباعة DTF عالية الدقة من Audley، تعمل برؤوس الطباعة Epson (i1600 / i3200).',
    variants: sizes('30cm', '60cm', '120cm'),
  },
  // --- Laminators (no brand given) ---
  {
    name: 'آلة سلفنة حامي - بارد',
    slug: 'hot-cold-laminator',
    category: 'laminating-machines',
    skuPrefix: 'LAM',
    description: 'آلة سلفنة تعمل على الحامي والبارد.',
    variants: sizes('30cm', '160cm'),
  },
  // --- Lasers (Grand Laser) ---
  {
    name: 'آلة ليزر CO2',
    slug: 'grand-laser-co2',
    category: 'laser-machines',
    brand: 'grand-laser',
    skuPrefix: 'GL-CO2',
    description: 'آلة ليزر CO2 للقص والحفر، متوفرة بمقاسات وقدرات مختلفة تناسب الاستخدامات الصناعية والإعلانية.',
    variants: [
      { machine_size: '60x40', laser_power: '80w' },
      { machine_size: '140x90', laser_power: '150w' },
      { machine_size: '120x160', laser_power: '150w' },
      { machine_size: '250x130', laser_power: '180w' },
    ],
  },
  {
    name: 'آلة فايبر ليزر (UV / Fiber / MOPA)',
    slug: 'grand-laser-fiber-marking',
    category: 'laser-machines',
    brand: 'grand-laser',
    skuPrefix: 'GL-FIBER',
    description:
      'آلة فايبر ليزر مخصصة لقص المعادن والنقش بدقة متناهية، مع ميزة التحكم والربط عبر الموبايل والكمبيوتر. متوفرة بتقنيات Laser UV و Laser Fiber و Laser MOPA.',
    variants: [
      { machine_size: '30x30', laser_power: '30w' },
      { machine_size: '30x30', laser_power: '50w' },
      { machine_size: '30x30', laser_power: '100w' },
    ],
  },
  {
    name: 'آلة فايبر ليزر صناعي',
    slug: 'grand-laser-fiber-industrial',
    category: 'laser-machines',
    brand: 'grand-laser',
    skuPrefix: 'GL-FIBER-IND',
    description: 'آلة فايبر ليزر صناعية مخصصة لقص المعادن ذات السماكات العالية.',
    variants: [
      { machine_size: '150x300', laser_power: '3000w' },
      { machine_size: '150x300', laser_power: '6000w' },
    ],
  },
  // --- CNC (no brand given) ---
  {
    name: 'آلة CNC',
    slug: 'cnc-router',
    category: 'cnc-machines',
    skuPrefix: 'CNC',
    description:
      'آلة CNC مصممة بأداء تشغيل فائق وقدرة عالية على تحمل ضغط العمل المستمر، متوفرة بمقاسات مختلفة.',
    variants: sizes('250x130', '300x150', '400x210', '600x150'),
  },
  // --- Cutters (Teneth) ---
  {
    name: 'آلة كتر موبايلات',
    slug: 'teneth-mobile-cutter',
    category: 'cutting-plotters',
    brand: 'teneth',
    skuPrefix: 'TEN-MOB',
    description: 'آلة كتر مخصصة لقص حمايات وشاشات الموبايلات.',
    variants: sizes('31cm'),
  },
  {
    name: 'ميني كتر',
    slug: 'teneth-mini-cutter',
    category: 'cutting-plotters',
    brand: 'teneth',
    skuPrefix: 'TEN-MINI',
    description: 'آلة كتر صغيرة الحجم بمقاس A5.',
    variants: sizes('a5'),
  },
  {
    name: 'آلة كتر تلقيم ذاتي',
    slug: 'teneth-auto-feed-cutter',
    category: 'cutting-plotters',
    brand: 'teneth',
    skuPrefix: 'TEN-AUTO',
    description: 'آلة كتر بمقاس A3 مع ميزة التلقيم الذاتي.',
    variants: sizes('a3'),
  },
  {
    name: 'آلة كتر',
    slug: 'teneth-cutting-plotter',
    category: 'cutting-plotters',
    brand: 'teneth',
    skuPrefix: 'TEN-CUT',
    description: 'آلة كتر لقص الفينيل والستيكرات، متوفرة بمقاسات مختلفة.',
    variants: sizes('40cm', '70cm', '130cm', '180cm'),
  },
  // --- 3D (MaiGao) ---
  {
    name: 'آلة طباعة 3D',
    slug: 'maigao-3d-printer',
    category: '3d-printers',
    brand: 'maigao',
    skuPrefix: 'MG-3D',
    description: 'آلة طباعة ثلاثية الأبعاد من MaiGao.',
    variants: sizes('80x80', '120x120', '120x120-pro'),
  },
];

/** Products in categories with no variant attributes → SIMPLE products. */
const SIMPLE_MACHINES: { name: string; slug: string; category: string; sku: string; description: string }[] = [
  {
    name: 'آلة لف أحرف كروم وألمنيوم',
    slug: 'letter-bender-chrome-aluminum',
    category: 'letter-bending-machines',
    sku: 'BEND-CHROME-ALU',
    description: 'آلة لف أحرف تعمل على بنضات الكروم والألمنيوم.',
  },
  {
    name: 'آلة لف أحرف ألمنيوم مع حواف',
    slug: 'letter-bender-aluminum-flanged',
    category: 'letter-bending-machines',
    sku: 'BEND-ALU-FLANGE',
    description: 'آلة لف أحرف تعمل على بنضات الألمنيوم مع الحواف.',
  },
];

// ---------------------------------------------------------------------------------------------
// Helpers (create-or-reuse)
// ---------------------------------------------------------------------------------------------

let existingCategories: { id: string; slug: string }[] | undefined;

async function ensureCategory(
  token: string,
  dto: { name: string; slug: string; parentId?: string; sortOrder: number },
): Promise<string> {
  existingCategories ??= (await api('GET', '/categories')).json ?? [];
  const existing = existingCategories!.find((c) => c.slug === dto.slug);
  if (existing) {
    console.log(`  = category exists: ${dto.slug}`);
    return existing.id;
  }
  const created = await api('POST', '/categories', token, dto);
  if (created.status !== 201) throw new Error(`category ${dto.slug} failed: ${created.text}`);
  console.log(`  + category created: ${dto.slug}`);
  existingCategories!.push({ id: created.json.id, slug: dto.slug });
  return created.json.id;
}

async function ensureBrand(token: string, dto: { name: string; slug: string }): Promise<string> {
  const created = await api('POST', '/brands', token, dto);
  if (created.status === 201) {
    console.log(`  + brand created: ${dto.slug}`);
    return created.json.id;
  }
  const list = await api('GET', '/brands');
  const existing = (list.json as { id: string; slug: string }[]).find((b) => b.slug === dto.slug);
  if (!existing) throw new Error(`brand ${dto.slug} failed: ${created.text}`);
  console.log(`  = brand exists: ${dto.slug}`);
  return existing.id;
}

async function ensureAttribute(
  token: string,
  key: string,
  name: string,
  options: readonly (readonly [string, string])[],
): Promise<string> {
  const created = await api('POST', '/attributes', token, { key, name, type: 'SELECT', isFilterable: true });
  let attributeId: string;
  if (created.status === 201) {
    console.log(`  + attribute created: ${key}`);
    attributeId = created.json.id;
  } else {
    const list = await api('GET', '/attributes');
    const existing = (list.json as { id: string; key: string }[]).find((a) => a.key === key);
    if (!existing) throw new Error(`attribute ${key} failed: ${created.text}`);
    console.log(`  = attribute exists: ${key}`);
    attributeId = existing.id;
  }

  const detail = await api('GET', `/attributes/${attributeId}`);
  const existingValues = new Set(((detail.json?.options ?? []) as { value: string }[]).map((o) => o.value));
  for (const [i, [value, label]] of options.entries()) {
    if (existingValues.has(value)) continue;
    const res = await api('POST', `/attributes/${attributeId}/options`, token, { value, label, sortOrder: i });
    if (res.status !== 201) throw new Error(`option ${value} for ${key} failed: ${res.text}`);
  }
  return attributeId;
}

async function linkCategoryAttribute(token: string, categoryId: string, attributeId: string, sortOrder: number) {
  const res = await api('POST', '/category-attributes', token, {
    categoryId,
    attributeId,
    createsVariant: true,
    isRequired: true,
    isFilterable: true,
    sortOrder,
  });
  if (res.status !== 201 && res.status !== 409) throw new Error(`category-attribute link failed: ${res.text}`);
}

let existingProducts: { id: string; slug: string }[] | undefined;

async function ensureProduct(token: string, dto: Record<string, unknown> & { slug: string }): Promise<string> {
  if (!existingProducts) {
    existingProducts = [];
    let cursor: string | null = null;
    do {
      const res = await api('GET', `/products/admin?limit=100${cursor ? `&cursor=${cursor}` : ''}`, token);
      existingProducts.push(...((res.json?.items ?? []) as { id: string; slug: string }[]));
      cursor = res.json?.nextCursor ?? null;
    } while (cursor);
  }
  const existing = existingProducts.find((p) => p.slug === dto.slug);
  if (existing) {
    console.log(`  = product exists: ${dto.slug}`);
    return existing.id;
  }
  const created = await api('POST', '/products', token, dto);
  if (created.status !== 201) throw new Error(`product ${dto.slug} failed: ${created.text}`);
  console.log(`  + product created: ${dto.slug}`);
  existingProducts.push({ id: created.json.id, slug: dto.slug });
  return created.json.id;
}

async function ensureVariant(
  token: string,
  productId: string,
  dto: { sku: string; attributeValues: { attributeId: string; value: string }[] },
) {
  const created = await api('POST', `/products/${productId}/variants`, token, dto);
  if (created.status === 201) {
    console.log(`    + variant created: ${dto.sku}`);
    return;
  }
  if (created.status === 409) {
    console.log(`    = variant exists: ${dto.sku}`);
    return;
  }
  throw new Error(`variant ${dto.sku} failed: ${created.text}`);
}

// ---------------------------------------------------------------------------------------------

async function main() {
  const login = await api('POST', '/auth/login', undefined, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (login.status !== 200 && login.status !== 201) {
    console.error(`cannot log in as super admin (${login.status}): ${login.text}`);
    process.exit(2);
  }
  const token = (login.json as { accessToken: string }).accessToken;

  console.log('Brands:');
  const brandIds: Record<string, string> = {};
  for (const brand of BRANDS) {
    brandIds[brand.key] = await ensureBrand(token, { name: brand.name, slug: brand.slug });
  }

  console.log('Attributes:');
  const attributeIds = {} as Record<AttrKey, string>;
  for (const key of Object.keys(ATTRIBUTES) as AttrKey[]) {
    attributeIds[key] = await ensureAttribute(token, key, ATTRIBUTES[key].name, ATTRIBUTES[key].options);
  }

  console.log('Categories:');
  const categoryIds: Record<string, string> = {};
  const walk = async (nodes: CategoryNode[], parentId?: string) => {
    for (const [i, node] of nodes.entries()) {
      const id = await ensureCategory(token, { name: node.name, slug: node.slug, parentId, sortOrder: i });
      categoryIds[node.slug] = id;
      for (const [j, attr] of (node.variantAttrs ?? []).entries()) {
        await linkCategoryAttribute(token, id, attributeIds[attr], j);
      }
      if (node.children) await walk(node.children, id);
    }
  };
  await walk(CATEGORY_TREE);

  console.log('Machines:');
  for (const machine of MACHINES) {
    const productId = await ensureProduct(token, {
      categoryId: categoryIds[machine.category],
      brandId: machine.brand ? brandIds[machine.brand] : undefined,
      name: machine.name,
      slug: machine.slug,
      description: machine.description,
      type: 'VARIABLE',
      sellingUnit: 'PIECE',
    });
    for (const values of machine.variants) {
      const entries = Object.entries(values) as [AttrKey, string][];
      const sku = [machine.skuPrefix, ...entries.map(([, v]) => v.toUpperCase())].join('-');
      await ensureVariant(token, productId, {
        sku,
        attributeValues: entries.map(([attr, value]) => ({ attributeId: attributeIds[attr], value })),
      });
    }
  }
  for (const machine of SIMPLE_MACHINES) {
    await ensureProduct(token, {
      categoryId: categoryIds[machine.category],
      name: machine.name,
      slug: machine.slug,
      description: machine.description,
      type: 'SIMPLE',
      sellingUnit: 'PIECE',
      sku: machine.sku,
    });
  }

  const variantCount = MACHINES.reduce((n, m) => n + m.variants.length, 0) + SIMPLE_MACHINES.length;
  console.log(
    `\nDone. ${BRANDS.length} brands, ${Object.keys(categoryIds).length} categories, ` +
      `${MACHINES.length + SIMPLE_MACHINES.length} machine products (${variantCount} variants) — all DRAFT.` +
      `\nNext: add prices + images from the admin panel, then publish each product.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
