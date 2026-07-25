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
