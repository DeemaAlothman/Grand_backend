# API Contract — للفرونت

هذا الملف يوثّق كل الـ API الجاهز والمُختبر فعليًا حتى الآن، عشان فريق الفرونت يقدر يبني عليه مباشرة. يتحدّث بعد كل مرحلة تُختبر محليًا.

## معلومات أساسية

- **Base URL (تطوير):** `http://localhost:3000` (مباشر) أو `http://localhost` (عبر Nginx reverse proxy).
- **صيغة البيانات:** JSON فقط. أرسل `Content-Type: application/json` مع كل طلب فيه body.
- **المصادقة:** `Authorization: Bearer <accessToken>` على أي endpoint غير عام (Public).
- **Access Token:** صالح لمدة 15 دقيقة افتراضيًا. **Refresh Token:** صالح لمدة 7 أيام، ويتجدد (rotate) في كل استخدام — لازم يُستبدل بكل مرة تستخدمه فيها (لا يصلح لأكثر من طلب refresh واحد).
- **الأخطاء:** صيغة موحّدة `{ "statusCode": number, "message": string | string[], "error": string }`.
- **Rate limiting:** حد عام 100 طلب/دقيقة على كل الـ API. مسارات `/auth/login`, `/auth/forgot-password`, `/auth/reset-password` محدودة أكثر: 5 طلبات/دقيقة لكل IP (429 عند التجاوز).
- **Validation:** أي حقل غير معروف بالـ body يرجع 400 (whitelist صارم). كل الحقول المطلوبة إجبارية.

---

## Auth (`/auth`)

### `POST /auth/register` — Public
تسجيل عميل جديد (يُنشأ تلقائيًا بدور `customer`).

Request:
```json
{ "email": "user@example.com", "password": "MinimumLength10Chars!", "firstName": "Ali", "lastName": "Hasan" }
```
- `password`: 10-128 حرف، ويُرفض إذا كان من كلمات المرور الشائعة جدًا.
- `firstName`, `lastName`: اختياريان.

Response `201`:
```json
{ "accessToken": "...", "refreshToken": "..." }
```
Errors: `409` إذا الإيميل مسجّل مسبقًا.

### `POST /auth/login` — Public (throttled 5/min)
```json
{ "email": "user@example.com", "password": "..." }
```
Response `200`: نفس شكل `register`. Errors: `401` لبيانات خاطئة أو حساب غير `ACTIVE`.

### `POST /auth/refresh` — Public
```json
{ "refreshToken": "..." }
```
Response `200`: `{ "accessToken": "...", "refreshToken": "..." }` — **استبدل الـ refreshToken القديم بالجديد فورًا**. إعادة استخدام refresh token قديم تُلغي كل جلسات المستخدم (حماية من سرقة التوكن) وترجع `401`.

### `POST /auth/logout` — Public
```json
{ "refreshToken": "..." }
```
Response `204`. يُلغي جلسة واحدة (الجهاز الحالي).

### `POST /auth/logout-all` — يتطلب Access Token
Response `204`. يُلغي كل جلسات المستخدم على كل الأجهزة.

### `POST /auth/forgot-password` — Public (throttled 5/min)
```json
{ "email": "user@example.com" }
```
Response `200` دائمًا (حتى لو الإيميل غير موجود، لمنع اكتشاف الحسابات). يُرسل رمز إعادة تعيين عبر البريد (صالح 30 دقيقة، استخدام واحد).

### `POST /auth/reset-password` — Public (throttled 5/min)
```json
{ "token": "...", "newPassword": "MinimumLength10Chars!" }
```
Response `200`. يُلغي كل الجلسات الحالية للمستخدم بعد إعادة التعيين.

### `GET /auth/me` — يتطلب Access Token
Response `200`:
```json
{ "id": "uuid", "roleKey": "customer", "permissions": [] }
```

**الأدوار المتاحة (roleKey):** `super_admin`, `catalog_manager`, `inventory_manager`, `order_manager`, `sales_agent`, `customer`.

---

## Users (`/users`) — يتطلب صلاحية `users.manage` (super_admin فقط حاليًا)

إدارة حسابات الموظفين (إضافة موظف بدور معيّن، تغيير دوره، تفعيل/تعطيل حسابه) — قبل هذا كان التعديل الوحيد ممكن مباشرة بقاعدة البيانات.

### `GET /users`
قائمة كل المستخدمين (موظفين وعملاء). **لا يرجع `passwordHash` إطلاقًا** بأي رد من هالمجموعة.

### `GET /users/:id`

### `POST /users`
```json
{ "email": "manager@store.com", "password": "MinimumLength10Chars!", "firstName": "اختياري", "lastName": "اختياري", "roleKey": "catalog_manager" }
```
- الحساب يُنشأ **`ACTIVE` فورًا** (بخلاف `POST /auth/register` العام). `roleKey` أي دور من القائمة أعلاه، بما فيها `customer` لو حابب (نادرًا ما تحتاجها هون، `/auth/register` أنسب للعملاء العاديين).
- Errors: `409` إيميل مسجّل مسبقًا، `404` roleKey غير موجود.

### `PATCH /users/:id/role`
```json
{ "roleKey": "inventory_manager" }
```
تغيير دور مستخدم موجود فورًا (ينعكس بأول access token جديد يطلبه — التوكنات القديمة الصادرة قبل التغيير تبقى بصلاحياتها القديمة لحد ما تنتهي، 15 دقيقة كحد أقصى).

### `PATCH /users/:id/status`
```json
{ "status": "ACTIVE" }
```
`status` واحدة من: `ACTIVE`, `SUSPENDED`, `DISABLED` (`PENDING_VERIFICATION` غير مسموحة هون — حالة داخلية فقط). الحساب غير `ACTIVE` يُرفض تسجيل دخوله فورًا: `401 "Account is suspended"` أو `"Account is disabled"` حسب الحالة.

---

## Categories (`/categories`)

### `GET /categories` — Public
كل الأصناف (مسطّحة، غير شجرية)، مرتبة حسب `path`.

### `GET /categories/tree` — Public
شجرة أصناف متداخلة (nested) جاهزة للعرض بقوائم التنقل:
```json
[{ "id": "uuid", "name": "مواد الطباعة", "slug": "...", "sortOrder": 0, "isActive": true, "children": [ ... ] }]
```

### `GET /categories/:id` — Public
تفاصيل صنف واحد + الصفات المرتبطة به (`categoryAttributes`).

### `POST /categories` — يتطلب صلاحية `categories.create`
```json
{ "name": "مواد الطباعة", "slug": "optional", "parentId": "uuid|null", "sortOrder": 0, "imageUrl": "...", "seoTitle": "...", "seoDescription": "...", "isActive": true }
```
`slug` اختياري (يُولّد تلقائيًا من `name` إذا غاب، يدعم العربية). Errors: `404` إذا `parentId` غير موجود، `409` إذا الـ slug مكرر.

### `PATCH /categories/:id` — يتطلب صلاحية `categories.update`
نفس حقول الإنشاء، كلها اختيارية. تغيير `parentId` ينقل الصنف وكل أبنائه تلقائيًا (path يُحدَّث بالكامل). `409` إذا حاولت نقل صنف تحت أحد أبنائه (منع الحلقات).

### `DELETE /categories/:id` — يتطلب صلاحية `categories.delete`
Response `204`. `409` إذا كان للصنف صنف فرعي (لازم تحذف/تنقل الأبناء أولًا).

---

## Attributes (`/attributes`)

### `GET /attributes` — Public
كل الصفات مع خياراتها (`options`).

### `GET /attributes/:id` — Public

### `POST /attributes` — يتطلب صلاحية `attributes.create`
```json
{ "key": "color", "name": "اللون", "type": "COLOR_SELECT", "unit": null, "isFilterable": true }
```
`key`: snake_case إنجليزي فريد (`a-z0-9_`). `type`: واحد من `TEXT`, `SELECT`, `COLOR_SELECT`, `DECIMAL_UNIT`, `INTEGER_UNIT`, `BOOLEAN`. `409` إذا الـ key مكرر.

### `PATCH /attributes/:id` — يتطلب صلاحية `attributes.update`
`name`, `unit`, `isFilterable` فقط (لا يمكن تغيير `key` أو `type` بعد الإنشاء لتفادي كسر بيانات مرتبطة).

### `DELETE /attributes/:id` — يتطلب صلاحية `attributes.delete`
`409` إذا الصفة مرتبطة بأي صنف (فُك الربط أولًا).

### `POST /attributes/:id/options` — يتطلب صلاحية `attributes.update`
```json
{ "value": "red", "label": "أحمر", "sortOrder": 0 }
```
`409` إذا القيمة مكررة لنفس الصفة.

### `DELETE /attributes/:id/options/:optionId` — يتطلب صلاحية `attributes.update`

---

## Category ↔ Attribute linking (`/category-attributes`)

### `GET /category-attributes?categoryId=uuid` — Public
الصفات المرتبطة بصنف معيّن (تُستخدم لبناء صفحة فلترة/فورم منتج حسب الصنف).

### `POST /category-attributes` — يتطلب صلاحية `attributes.update`
```json
{ "categoryId": "uuid", "attributeId": "uuid", "isRequired": false, "isFilterable": true, "createsVariant": false, "sortOrder": 0 }
```
`createsVariant: true` يعني هاي الصفة تُنشئ متغيرات منتج مستقلة (Phase 2). `409` إذا الربط موجود مسبقًا.

### `DELETE /category-attributes/:categoryId/:attributeId` — يتطلب صلاحية `attributes.update`

---

## Brands (`/brands`)

### `GET /brands` — Public
### `GET /brands/:id` — Public

### `POST /brands` — يتطلب صلاحية `products.create`
```json
{ "name": "Roland", "slug": "optional", "isActive": true }
```

### `PATCH /brands/:id` — يتطلب صلاحية `products.update`
### `DELETE /brands/:id` — يتطلب صلاحية `products.delete`
`409` إذا كانت العلامة التجارية مرتبطة بمنتجات.

---

## Products (`/products`)

النموذج: كل منتج (بسيط أو متغير) له دائمًا متغير واحد على الأقل (`ProductVariant`) يحمل SKU والسعر والمخزون. المنتج البسيط = منتج بمتغير واحد ضمني تلقائيًا.

### `GET /products` — Public (قائمة/بحث/فلترة، للمتجر — تُرجع `PUBLISHED` فقط)
Query params (كلها اختيارية):
- `q`: بحث نصي بالاسم (يدعم العربية، مفهرس بـ pg_trgm).
- `categoryId`, `brandId`: uuid.
- `minPrice`, `maxPrice`: أعداد صحيحة، يُقارَنوا بسعر التجزئة (`retail`).
- `attr_<key>=value`: فلترة بصفة، مثلاً `?attr_color=red` — يمكن تكرارها لعدة صفات (AND بين الصفات المختلفة).
- `cursor`: uuid آخر عنصر بالصفحة السابقة (cursor-based pagination).
- `limit`: 1-100، افتراضي 20.

Response `200`:
```json
{ "items": [ { "...": "...", "displayPrice": { "min": 20, "max": 25 }, "inStock": true } ], "nextCursor": "uuid|null" }
```
- `displayPrice`: محسوب من أسعار التجزئة لكل متغيرات المنتج وقت الطلب (`null` إذا ما في أسعار بعد). للمنتج البسيط `min === max`.
- `inStock`: **`true`/`false` فقط، بدون أرقام فعلية** — `true` لو أي متغير من متغيرات المنتج عنده كمية متاحة (`onHand - reserved > 0`) بأي مستودع. نفس الحقل موجود على مستوى كل متغير داخل `variants[]`. الأرقام الفعلية (`quantityOnHand`/`quantityReserved`) ما بتنكشف هون أبدًا — هاي موجودة فقط بـ `/inventory` و`/reports/low-stock` للصلاحيات الإدارية.

### `GET /products/slug/:slug` — Public
تفاصيل منتج واحد للمتجر (يرجع 404 إذا مو `PUBLISHED`)، يشمل كل المتغيرات وصفاتها وأسعارها وحقل `inStock`.

### `GET /products/:id` — يتطلب صلاحية `products.read`
تفاصيل منتج بأي حالة (`DRAFT`/`PUBLISHED`/`ARCHIVED`) — للوحة الإدارة.

### `GET /products/admin` — يتطلب صلاحية `products.read`
زي `GET /products` بالضبط (نفس query params) لكن **بدون** تقييد `PUBLISHED` — ترجع كل الحالات، لأن منتج `DRAFT` أو `ARCHIVED` ما كان ظاهر بأي قائمة قبل هالـ endpoint (كنت لازم تعرف الـ id مسبقًا). أضف `status=DRAFT|PUBLISHED|ARCHIVED` لفلترة حالة معيّنة، أو اتركه فاضي لعرض الكل.

### `POST /products` — يتطلب صلاحية `products.create`
```json
{
  "categoryId": "uuid",
  "brandId": "uuid (اختياري)",
  "name": "A4 Transfer Paper 100 Sheets",
  "slug": "اختياري",
  "description": "اختياري",
  "type": "SIMPLE | VARIABLE",
  "sellingUnit": "PIECE | METER | ROLL | KILOGRAM | PACKAGE | PARCEL | SHEET",
  "minOrderQuantity": 1,
  "attributeValues": [{ "attributeId": "uuid", "value": "..." }],
  "sku": "مطلوب فقط لو type=SIMPLE",
  "barcode": "اختياري (SIMPLE فقط)",
  "weight": 0
}
```
- `attributeValues`: فقط للصفات **المعلوماتية** بالصنف (غير المُنشئة لمتغير)؛ الإلزامية منها لازم تنرسل، وإلا 400.
- إذا الصنف عنده صفات "منشئة لمتغير" (`createsVariant: true`) ولازم `type: VARIABLE` — إرسال `SIMPLE` برجع 400.
- `sellingUnit: PIECE` يفرض `minOrderQuantity` عدد صحيح (لا كسور).
- Errors: `404` صنف/علامة غير موجودة، `409` slug أو SKU مكرر.

### `PATCH /products/:id` — يتطلب صلاحية `products.update`
تحديث `name`, `slug`, `description`, `brandId`, `sellingUnit`, `minOrderQuantity`, `status` (`DRAFT|PUBLISHED|ARCHIVED`), `attributeValues` (تستبدل القيم المعلوماتية بالكامل). لا يمكن تغيير `categoryId` أو `type` بعد الإنشاء.

### `DELETE /products/:id` — يتطلب صلاحية `products.delete`
`409` إذا المنتج `PUBLISHED` — أرشفه (`status: ARCHIVED`) أولًا.

### Variants (متداخلة تحت المنتج)

- **`GET /products/:id/variants`** — يتطلب `products.read`.
- **`GET /products/:id/variants/:variantId`** — يتطلب `products.read`.
- **`POST /products/:id/variants`** — يتطلب `products.update`. للمنتجات `VARIABLE` فقط.
  ```json
  { "sku": "ECO-1L-RED", "barcode": "اختياري", "weight": 0, "attributeValues": [{ "attributeId": "uuid", "value": "red" }] }
  ```
  `attributeValues` يجب أن تغطي **بالضبط** كل الصفات "المنشئة لمتغير" بالصنف (لا نقص ولا زيادة)، وكل قيمة تُتحقق مقابل نوع الصفة (خيار من قائمة، رقم، إلخ). Errors: `400` قيمة غير صالحة أو صفة ناقصة، `409` SKU مكرر أو نفس تركيبة الصفات موجودة مسبقًا.
- **`PATCH /products/:id/variants/:variantId/status`** — يتطلب `products.update`. Body: `{ "status": "ACTIVE" | "DISABLED" }`.
- **`DELETE /products/:id/variants/:variantId`** — يتطلب `products.delete`. `409` إذا كان آخر متغير متبقي بالمنتج.

---

## Pricing

قوائم الأسعار المزروعة افتراضيًا: `retail` (تجزئة), `wholesale` (جملة).

**العملة:** عملة واحدة ثابتة `USD` لكل المبالغ بالنظام (حقل `currency` موجود بكل رد سعر لكنه دائمًا `"USD"` حاليًا — لا يوجد دعم متعدد العملات بعد). **الدقة العشرية:** رقمين عشريين لكل المبالغ (`Decimal(12,2)` بقاعدة البيانات).

### `PATCH /customers/:customerId/price-list` — يتطلب صلاحية `prices.update`
```json
{ "priceListKey": "wholesale" }
```
يربط عميل معيّن بقائمة أسعار خاصة (مثلاً جملة) بدل التجزئة الافتراضية — تُطبّق تلقائيًا على سلته وطلباته القادمة. أرسل `priceListKey: null` لإرجاعه للتجزئة.

### `POST /variants/:variantId/prices` — يتطلب صلاحية `prices.update`
```json
{ "priceListKey": "retail", "amount": 12.5 }
```
Upsert — ينشئ السعر أو يحدّثه إذا موجود لنفس المتغير/القائمة.

### `POST /prices/bulk` — يتطلب صلاحية `prices.update`
```json
{ "updates": [{ "variantId": "uuid", "priceListKey": "wholesale", "amount": 16 }, { "...": "..." }] }
```
Response: `{ "updated": 2 }`. كل التحديثات بـ transaction واحدة.

---

## Media (`/media`) — رفع الصور (منتجات، متغيرات، أصناف، علامات تجارية)

آلية الرفع من نوع presigned URL: السيرفر يوقّع رابط، الفرونت يرفع الملف مباشرة لـ MinIO/S3 (بدون ما يمر بالسيرفر)، وبعدين يخبر السيرفر إن الرفع خلص.

### `GET /media?entityType=product&entityId=uuid` — Public
يرجع كل الصور المرتبطة بكيان معيّن، مرتبة حسب `sortOrder`. `entityType` يجب أن يكون واحد من: `product`, `product_variant`, `category`, `brand`.

### `POST /media/presign` — يتطلب صلاحية `media.manage`
```json
{ "entityType": "product", "entityId": "uuid", "filename": "photo.png", "mimeType": "image/png", "size": 45210 }
```
- الأنواع المسموحة: `image/jpeg` (jpg/jpeg), `image/png` (png), `image/webp` (webp), `image/gif` (gif). الامتداد بالـ filename يجب يطابق الـ mimeType.
- الحجم الأقصى: 5MB (5242880 بايت).
- `entityId` يجب أن يشير لكيان موجود فعليًا (404 إذا لأ).

Response `201`:
```json
{ "uploadUrl": "http://localhost:9000/printing-store-media/product/uuid/random-uuid.png?X-Amz-...", "key": "product/uuid/random-uuid.png", "expiresInSeconds": 300 }
```
**الخطوة التالية على الفرونت:** ارفع الملف مباشرة بـ `PUT` إلى `uploadUrl` (بدون أي header إضافي مطلوب غير الملف نفسه)، خلال 5 دقائق قبل ما ينتهي الرابط.

### `POST /media/confirm` — يتطلب صلاحية `media.manage`
```json
{ "key": "product/uuid/random-uuid.png", "entityType": "product", "entityId": "uuid", "sortOrder": 0 }
```
يتحقق فعليًا إن الملف موجود بالتخزين (لا يثق بكلام الفرونت فقط)، وينشئ سجل `Media` ويرجعه مع `url` جاهز للعرض المباشر (`<img src>`).

### `DELETE /media/:id` — يتطلب صلاحية `media.manage`
Response `204`. يحذف الملف من التخزين والسجل من قاعدة البيانات معًا.

---

## Imports (`/imports`) — استيراد منتجات من ملف CSV (لوحة الإدارة فقط)

نظام staging: كل استيراد يمر بمرحلتين — رفع مع معاينة فورية للأخطاء (`upload`)، ثم اعتماد صريح منفصل (`commit`). الصفوف الخاطئة **لا توقف** استيراد الصفوف الصحيحة — تُستثنى فقط.

**خريطة أعمدة CSV ثابتة** (v1 — لا يوجد بعد UI لخريطة أعمدة مخصصة، هاي هي الأعمدة المتوقعة بالضبط):

| العمود | إلزامي | الوصف |
|---|---|---|
| `sku` | نعم | رمز فريد على مستوى النظام كامل |
| `productName` | نعم | اسم المنتج — الصفوف بنفس (`categorySlug`+`productName`) تُجمّع كمتغيرات لنفس المنتج |
| `categorySlug` | نعم | slug صنف موجود فعليًا |
| `brandSlug` | لا | slug علامة تجارية موجودة |
| `price` | نعم | رقم موجب — يُحفظ بقائمة سعر `retail` |
| `sellingUnit` | لا | افتراضي `PIECE` — أحد: PIECE, METER, ROLL, KILOGRAM, PACKAGE, PARCEL, SHEET |
| `weight` | لا | رقم |
| `attr_<key>` | حسب الصنف | أي عمود يبدأ بـ `attr_` يُقرأ كقيمة صفة، مثلاً `attr_color=red`. الصفات "المنشئة لمتغير" بالصنف إلزامية لكل صف. |

### `POST /imports/products` — يتطلب صلاحية `imports.manage` (multipart/form-data, حقل الملف اسمه `file`)
يرفع، يحلل، ويتحقق من كل صف **فورًا** (بدون اعتماد بعد). Response `201` = دفعة (`ImportBatch`) بكل صفوفها وحالة كل صف (`VALID` أو `ERROR` مع رسائل الخطأ بالضبط).

أخطاء يتم كشفها لكل صف: صنف/علامة تجارية غير موجودة، سعر غير رقمي، قيمة صفة غير صالحة لنوعها، SKU مكرر (بالملف أو بقاعدة البيانات فعليًا)، تركيبة صفات مكررة لنفس المنتج بالملف، أو أكثر من صف لمنتج بسيط (صنف بدون صفات منشئة لمتغير).

### `GET /imports` — يتطلب صلاحية `imports.manage`
قائمة كل دفعات الاستيراد.

### `GET /imports/:id` — يتطلب صلاحية `imports.manage`
تفاصيل دفعة واحدة مع كل صفوفها وحالتها.

### `POST /imports/:id/commit` — يتطلب صلاحية `imports.manage`
يعتمد الدفعة: الصفوف `VALID` فقط تُنشئ منتجات/متغيرات/أسعار فعليًا ضمن transaction واحدة، وتصير حالتها `COMMITTED` مع `resolvedProductId`/`resolvedVariantId`. الصفوف الخاطئة تصير `SKIPPED`. `409` إذا الدفعة مو بحالة `PREVIEWED` (يعني اتعملها commit من قبل، أو لسا ما اتعمل لها preview).

---

## Warehouses (`/warehouses`) — يتطلب صلاحية `warehouses.manage`

مستودع واحد مزروع افتراضيًا (`MAIN`) — النموذج يدعم عدة مستودعات لكن باقي الوحدات (السلة/الطلبات) تستخدم أول مستودع فعّال تلقائيًا حاليًا (لا يوجد اختيار مستودع بعد بجهة الفرونت).

- `GET /warehouses`, `GET /warehouses/:id`
- `POST /warehouses` — `{ "code": "MAIN2", "name": "فرع إربد", "isActive": true }`
- `PATCH /warehouses/:id` — `{ "name": "اختياري", "isActive": "اختياري" }`. **لا يوجد حذف فعلي للمستودعات** — تعطيل فقط (`isActive: false`)، لأن حذف مستودع فيه حركات مخزون فعلية خطير. `409` إذا حاولت تعطّل آخر مستودع فعّال بالنظام (لازم يبقى واحد فعّال على الأقل، وإلا الطلبات ما بتلاقي مستودع افتراضي).

---

## Inventory (`/inventory`)

### `GET /inventory?variantId=uuid` — يتطلب صلاحية `inventory.read`
أرصدة المخزون (`quantityOnHand`, `quantityReserved`) لكل مستودع. المتاح الفعلي = `quantityOnHand - quantityReserved`. **هاد endpoint إداري فقط** (الزبون ما عنده هالصلاحية) — لعرض التوفر بالمتجر استخدم حقل `inStock` (true/false) الموجود مباشرة برد `/products` (شوف قسم Products).

### `GET /inventory/movements?variantId=uuid` — يتطلب صلاحية `inventory.read`
سجل حركات المخزون (RECEIPT/ADJUSTMENT/RESERVE/RELEASE/DEDUCT/RETURN) — للتدقيق.

### للمخزون المنخفض: `GET /reports/low-stock` (شوف قسم Reports تحت) — مو من هون.

---

## Reports (`/reports`) — يتطلب صلاحية `reports.view`

### `GET /reports/sales?from=ISO8601&to=ISO8601`
كلا الباراميترين اختياريان (بدونهم = كل الوقت). يحسب فقط الطلبات المدفوعة فعليًا أو بعدها (`PAID` وما بعدها بالسلسلة، مو `PENDING_PAYMENT`/`CANCELLED`/`PAYMENT_FAILED`).
```json
{ "totalRevenue": 1250.5, "orderCount": 42, "byDay": [ { "date": "2026-07-29T00:00:00.000Z", "revenue": 320, "orderCount": 8 } ] }
```

### `GET /reports/low-stock?threshold=5`
`threshold` اختياري، افتراضي 5. يرجع كل صف مخزون (متغير × مستودع) يكون `available` (`onHand - reserved`) أقل من أو يساوي `threshold`، مرتبة تصاعديًا (الأقل توفرًا أولًا). هاد هو الـ endpoint المخصص لشاشة تنبيهات المخزون — لا داعي لاستدعاء `/inventory` لكل متغير يدويًا.

### `GET /reports/stagnant-products?days=30`
`days` اختياري، افتراضي 30. منتجات `PUBLISHED` ما إلها ولا طلب خلال آخر `days` يوم (مفيد لتحديد منتجات راكدة للتخفيضات أو المراجعة).

---

## Promotions / Coupons (`/coupons`)

### `GET /coupons`, `GET /coupons/:id` — يتطلب صلاحية `promotions.manage`

### `POST /coupons` — يتطلب صلاحية `promotions.manage`
```json
{
  "code": "SAVE10",
  "type": "PERCENTAGE | FIXED_AMOUNT",
  "value": 10,
  "maxUses": 100,
  "minOrderTotal": 20,
  "startsAt": "2026-08-01T00:00:00.000Z",
  "expiresAt": "2026-09-01T00:00:00.000Z",
  "isActive": true
}
```
- `code`: أحرف كبيرة وأرقام و`_`/`-` فقط، فريد. `maxUses`, `minOrderTotal`, `startsAt`, `expiresAt`, `isActive` كلها اختيارية.
- `PERCENTAGE`: `value` نسبة مئوية (مثلاً `10` = خصم 10%). `FIXED_AMOUNT`: `value` مبلغ ثابت بنفس عملة النظام.

### `PATCH /coupons/:id` — يتطلب صلاحية `promotions.manage`
نفس حقول الإنشاء، كلها اختيارية بالتحديث.

### `POST /coupons/validate` — يتطلب Access Token (**ليس Public** — عمدًا، لمنع اكتشاف أكواد الكوبونات بالتجربة العشوائية)
```json
{ "code": "SAVE10", "subtotal": 50 }
```
يتحقق من الكوبون (فعّال، ضمن تاريخه، `minOrderTotal` محقق، ولسا ما وصل `maxUses`) بدون استهلاكه فعليًا — استخدمه لعرض الخصم المتوقع بصفحة السلة قبل إتمام الطلب. الاستهلاك الفعلي (`usedCount++`) يصير فقط عند إنشاء الطلب الحقيقي عبر `couponCode` بـ`POST /orders` (شوف قسم Orders)، وهو محمي من التزامن (لو وصلوا طلبين لنفس الكوبون بآخر استخدام متاح بنفس اللحظة، وحدة بس بتنجح).

### `POST /inventory/receive` — يتطلب صلاحية `inventory.adjust`
```json
{ "variantId": "uuid", "quantity": 50, "reason": "شحنة جديدة" }
```
يزيد `quantityOnHand`. `warehouseId` اختياري (يُستخدم المستودع الافتراضي إذا غاب).

### `POST /inventory/adjustments` — يتطلب صلاحية `inventory.adjust`
```json
{ "variantId": "uuid", "quantityDelta": -3, "reason": "تسوية جرد" }
```
`reason` إجباري هون (عكس `receive`) لأنه تصحيح يدوي يحتاج تبرير. `quantityDelta` يقبل سالب. `409` إذا التسوية ستنزل الرصيد تحت الكمية المحجوزة بطلبات مفتوحة فعليًا.

---

## Cart (`/cart`) — يتطلب Access Token (سلة كل مستخدم مرتبطة بحسابه)

### `GET /cart`
```json
{ "id": "uuid", "items": [ { "id": "uuid", "variantId": "uuid", "quantity": 2, "variant": { "...": "..." } } ], "total": 50 }
```
`total`: `null` إذا في عنصر بالسلة بدون سعر تجزئة محدد (يجب حذفه أو تحديد سعره قبل إتمام الطلب).

### `POST /cart/items`
```json
{ "variantId": "uuid", "quantity": 2 }
```
إذا العنصر موجود بالسلة، الكمية **تُضاف** للكمية الحالية لا تستبدلها. يرجع السلة كاملة بعد التحديث. `400` إذا الكمية ليست عدد صحيح لمنتج وحدة بيعه غير كسرية (قطعة/عبوة/طرد/لوح)، أو أقل من الحد الأدنى للطلب.

### `PATCH /cart/items/:itemId`
```json
{ "quantity": 5 }
```
يستبدل الكمية بالقيمة المرسلة بالضبط. `quantity: 0` يحذف العنصر.

### `DELETE /cart/items/:itemId` — Response `204`
### `DELETE /cart` — يفرّغ السلة بالكامل، Response `204`

---

## Orders (`/orders`)

دورة الحالات: `DRAFT → PENDING_PAYMENT → PAID → CONFIRMED → PROCESSING → READY_TO_SHIP → SHIPPED → DELIVERED`, مع فروع استثنائية: `CANCELLED`, `PAYMENT_FAILED`, `RETURN_REQUESTED → RETURNED → REFUNDED`. أي انتقال غير مسموح يرجع `409` بوضوح.

**قواعد المخزون المرتبطة بالحالة (مهم لفهم السلوك):**
- عند إنشاء الطلب (`PENDING_PAYMENT`) يُحجز المخزون (`quantityReserved`) فورًا — يبقى محجوزًا خلال `PAID` أيضًا.
- عند `CONFIRMED` يُخصم المخزون فعليًا من `quantityOnHand` (نهائي، لا رجعة اعتيادية).
- إلغاء الطلب قبل `CONFIRMED` يحرر الحجز؛ إلغاؤه بعد `CONFIRMED` (أو إرجاعه) يعيد الكمية لـ`quantityOnHand`.
- **مهلة الدفع:** أي طلب يبقى `PENDING_PAYMENT` لأكثر من 15 دقيقة (افتراضيًا) يُلغى تلقائيًا ويتحرر حجزه عبر job خلفي (BullMQ) — لا حاجة لأي إجراء من الفرونت، لكن يُستحسن تنبيه المستخدم إذا مرّ وقت طويل بدون دفع.

### `POST /orders` — يتطلب Access Token
```json
{ "shippingAddress": { "city": "Amman", "street": "..." }, "couponCode": "SAVE10 (اختياري)" }
```
- ينشئ الطلب من **سلة المستخدم الحالية** (لا يقبل قائمة عناصر مباشرة). `400` إذا السلة فارغة أو فيها عنصر بدون سعر.
- **`409` "insufficient stock for SKU ..."** إذا المخزون المتاح أقل من المطلوب — هذا هو رد الحماية من البيع الوهمي (overselling)، مُختبر فعليًا تحت تزامن حقيقي.
- **`couponCode`:** اختياري. يُتحقق منه ويُستهلك ذريًا (atomic) أثناء الإنشاء — `409` واضح لو الكوبون وصل حده أو انتهى بنفس لحظة إنشاء طلبين متزامنين. الخصم المحسوب يظهر بحقل `discountAmount` بالرد.
- **السعر المستخدم:** يعتمد قائمة أسعار الزبون (تجزئة افتراضيًا، أو الخاصة لو مُعيّنة له عبر `PATCH /customers/:customerId/price-list` — شوف قسم Pricing) وقت إنشاء الطلب بالضبط، ويُحفظ كـ snapshot (`unitPriceSnapshot`) لا يتغيّر حتى لو تغيّر السعر لاحقًا.
- **Header اختياري `Idempotency-Key`**: نفس المفتاح يرجّع نفس الطلب دومًا بدل إنشاء طلب مكرر (مفيد لو الفرونت أعاد إرسال الطلب بسبب انقطاع شبكة).
- يُفرّغ السلة تلقائيًا عند النجاح فقط (لو فشل الطلب، السلة تبقى كما هي).

### `GET /orders/my` — طلبات المستخدم الحالي فقط

### `GET /orders/:id`
العميل يشوف طلبه هو فقط (404 لو حاول يشوف طلب غيره — مش 403، لتجنب كشف وجود الطلب لغير صاحبه). أي حدا معه صلاحية `orders.read` يشوف أي طلب. **الرد يتضمّن `items[]`, `payments[]`, `shipments[]`, `statusHistory[]` كاملين** — ما في حاجة لـ endpoint منفصل لجلب دفعات أو شحنات طلب معيّن، كلها موجودة هون مباشرة (مثلاً `paymentId` للاسترجاع تاخده من `payments[].id`، ورقم التتبع من `shipments[].trackingNumber`).

### `GET /orders` — يتطلب صلاحية `orders.read` (لوحة الإدارة)
Query params (كلها اختيارية): `status` (أي قيمة من enum الحالات)، `cursor`, `limit` (1-100، افتراضي 20) — نفس نمط `GET /products`.
```json
{ "items": [ { "...": "..." } ], "nextCursor": "uuid|null" }
```

### `PATCH /orders/:id/status` — يتطلب صلاحية `orders.updateStatus`، **أو** يكون صاحب الطلب ويطلب إلغاء فقط
```json
{ "status": "CONFIRMED", "reason": "اختياري خصوصًا عند الإلغاء" }
```
- **صاحب الطلب** (بدون أي صلاحية خاصة) يقدر يستخدم هالمسار **فقط** لإلغاء طلبه (`status: "CANCELLED"`) — أي حالة هدف تانية بترجع `403`. أي حدا معه صلاحية `orders.updateStatus` يقدر يعمل أي انتقال مسموح على أي طلب.
- طلب على طلب مو ملكك وما معك الصلاحية → `404` (نفس منطق إخفاء الوجود المستخدم بـ`GET /orders/:id`).

---

## Payments (مسارات تحت `/orders` و`/payments`)

**مزود الدفع حاليًا `mock` فقط** — لا توجد بوابة دفع حقيقية متكاملة بعد (قرار مفتوح بالتوصيف). الدفع الوهمي ينجح دائمًا إلا إذا طُلب محاكاة فشل صراحة.

### `POST /orders/:orderId/pay` — يتطلب Access Token (صاحب الطلب، أو أي حدا معه `orders.read`)
```json
{ "simulateFailure": false }
```
عند النجاح: ينشئ سجل دفع `SUCCEEDED` وينقل الطلب لـ`PAID` تلقائيًا. عند `simulateFailure: true`: سجل دفع `FAILED` والطلب يصير `PAYMENT_FAILED` (يمكن إعادة المحاولة لاحقًا بإرجاعه لـ`PENDING_PAYMENT` عبر `PATCH /orders/:id/status`). يدعم `Idempotency-Key` header أيضًا.

### `POST /payments/:paymentId/refund` — يتطلب صلاحية `orders.refund`
```json
{ "amount": 25, "reason": "اختياري" }
```
يدعم استرجاع جزئي (أكثر من refund لنفس الدفعة طالما المجموع ما يتجاوز المبلغ الأصلي). يحدّث حالة الدفع لـ`REFUNDED` تلقائيًا عند اكتمال الاسترجاع الكامل.

---

## Shipments (مسارات تحت `/orders` و`/shipments`) — يتطلب صلاحية `orders.updateStatus`

### `GET /orders/:orderId/shipments`
### `POST /orders/:orderId/shipments`
```json
{ "carrier": "Aramex", "trackingNumber": "ARX123" }
```
يتطلب أن يكون الطلب بحالة `READY_TO_SHIP`؛ ينشئ الشحنة **وينقل الطلب تلقائيًا لـ`SHIPPED`** بنفس العملية.

### `POST /shipments/:shipmentId/deliver`
يعلّم الشحنة `DELIVERED` **وينقل الطلب تلقائيًا لـ`DELIVERED`** أيضًا.

---

## Health (`/health`) — Public, للمراقبة فقط
- `GET /health/live` → `{ "status": "ok" }`
- `GET /health/ready` → حالة الاتصال بقاعدة البيانات وRedis.

---

## ملاحظات مهمة للفرونت

1. **تخزين التوكنات:** خزّن `accessToken` بالذاكرة (state) و`refreshToken` بمكان آمن (httpOnly cookie أفضل من localStorage إذا ممكن لاحقًا؛ حاليًا الـ API يرجعه بالـ body فقط، القرار بجهة الفرونت). عند كل `401` من الـ API، جرّب `refresh` تلقائيًا مرة واحدة قبل تسجيل الخروج.
2. **إعادة استخدام refresh token يُلغي كل الجلسات** — لا تحاول استخدام نفس الـ refresh token مرتين (خصوصًا بسبب React StrictMode أو تكرار الطلبات).
3. **حسابات تجريبية محليًا (seed):** `admin@printing-store.local` / `ChangeMe123!` (دور `super_admin`) — موجود بالتطوير فقط، غير موجود بالإنتاج.
4. **التحقق من البريد/الهاتف عند التسجيل غير مُفعّل بعد** (المستخدم يصير `ACTIVE` مباشرة) — سيُضاف لاحقًا مع وحدة الإشعارات.
5. **الصلاحيات (`permissions`)** ترجع مع `/auth/me` وداخل الـ access token نفسه — استخدمها لإخفاء/إظهار عناصر الواجهة، لكن لا تعتمد عليها للحماية (التحقق الحقيقي دائمًا بالسيرفر).
6. **رفع الصور جاهز** (وحدة `media`) — تدفق الرفع من 3 خطوات: `presign` → `PUT` مباشر للرابط الراجع (من الفرونت مباشرة لـ MinIO، بدون ما يمر عبر سيرفر الـ API) → `confirm`. لسا ما فيه ربط تلقائي بين صور المنتج وحقل معيّن بجدول المنتج نفسه — الصور مرتبطة بـ `entityType`/`entityId` بشكل منفصل، اجلبها عبر `GET /media?entityType=product&entityId=...`.
7. **الاستيراد من ملفات CSV جاهز** (وحدة `imports`) — لكن خريطة الأعمدة **ثابتة** حاليًا (جدول الأعمدة بالأعلى)، لا يوجد بعد واجهة لخريطة أعمدة مخصصة يختارها المستخدم، فلازم ملف CSV يطابق الأسماء بالضبط.
8. **صفحة فلترة منتج حسب صنف:** استخدم `GET /category-attributes?categoryId=X` لمعرفة أي صفات تُعرض كفلاتر (`isFilterable: true`) وأيها تُستخدم لبناء فورم إضافة منتج/متغير (`createsVariant: true` = تدخل بفورم المتغير، غير ذلك = تدخل بفورم بيانات المنتج).
9. **صفة `COLOR_SELECT`/`SELECT`:** القيم المسموحة تجيك من `attribute.options[].value` — أرسل الـ `value` بالضبط (case-sensitive) مو الـ `label`.
10. **السلة والطلبات:** إنشاء الطلب يعتمد فقط على سلة المستخدم بالسيرفر (لا ترسل قائمة عناصر يدويًا). استخدم `Idempotency-Key` header عند إنشاء الطلب وعند الدفع لتفادي التكرار بسبب ضعف الشبكة أو ضغط الزر مرتين.
11. **إلغاء طلب من الفرونت:** استخدم `PATCH /orders/:id/status` بـ`{"status":"CANCELLED"}` فقط إذا الحالة تسمح بذلك (`PENDING_PAYMENT`/`PAID`/`CONFIRMED`/`PROCESSING`) — أي انتقال غير مسموح يرجع 409 برسالة واضحة تقدر تعرضها للمستخدم مباشرة. **العميل صاحب الطلب يقدر يستخدم هالمسار مباشرة بدون أي صلاحية خاصة** (فقط للإلغاء، شوف قسم Orders لتفاصيل الفرق بين هاد وبين انتقالات الحالة الإدارية الثانية).
12. **فك ربط صفة عن صنف (`DELETE /category-attributes/:categoryId/:attributeId`) عملية آمنة:** بتحذف بس الربط، **ما بتلمس** قيم الصفة الموجودة أصلاً على منتجات/متغيرات منشأة مسبقًا — تضل محفوظة بالداتابيس حتى لو الصنف عاد ما بيطلب هالصفة. لو بدك تنظيف فعلي لازم تعمله يدويًا من لوحة تعديل كل منتج.
13. **رفع الصور من متصفح حقيقي بالإنتاج:** الرفع المباشر لـ MinIO/S3 (presigned PUT) يحتاج CORS مضبوط على الـ bucket يسمح لدومين الفرونت الفعلي — هاد مو معمول بعد بالتطوير المحلي (لأن curl/Postman ما بتطبّق CORS). لازم نضبطه قبل الإنتاج بمجرد ما يصير عندنا دومين الفرونت النهائي.
14. **سكربت فحص تلقائي للعقد:** `npm run verify:contract` (أو `VERIFY_WRITES=1 npm run verify:contract` لفحص أعمق يشمل الكتابة) بيتصل بالسيرفر المحلي الشغّال ويتحقق آليًا من أشكال الردود الفعلية (حالة المنتج بعد الإنشاء، حقول الجرد، شمول الطلب لدفعاته وشحناته، إلخ) بدل ما تسأل حدا يدويًا — شغّله أول ما يكون عندك بيئة تطوير جاهزة.
15. **إشعارات بريدية تلقائية:** الباك بيرسل إيميل (عبر Mailpit بالتطوير) تلقائيًا عند: إنشاء الطلب، استلام الدفع، الشحن، التسليم — بدون أي استدعاء من الفرونت، فقط تأكد إن حساب المستخدم عنده إيميل صحيح.