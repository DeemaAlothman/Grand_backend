/**
 * Wipes catalog data (categories, attributes, brands, products, variants, prices, inventory,
 * media, coupons) so a fresh demo can be reseeded — without touching users, roles,
 * permissions, price lists, or warehouses, which are real infrastructure, not demo content.
 *
 * Safety: refuses to run if any real order exists anywhere in the system. Orders hold a hard
 * foreign key to the variants/coupons this script deletes, so if any exist the deletes would
 * either fail outright or (worse) silently succeed and destroy real order history. Better to
 * stop and let a human look, since by design this script assumes it's cleaning up test-only
 * data on a store that hasn't taken a real sale yet.
 *
 * Usage: npx ts-node -T prisma/reset-demo-catalog.ts
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const orderCount = await prisma.order.count();
  if (orderCount > 0) {
    console.error(
      `Refusing to reset: ${orderCount} order(s) exist in the database. This script only ` +
        `expects to clean up test/demo catalog data on a store with zero real orders. Review ` +
        `manually before deleting anything.`,
    );
    process.exit(1);
  }

  console.log('No orders found — safe to reset catalog data.');

  await prisma.$transaction([
    prisma.cartItem.deleteMany({}),
    prisma.media.deleteMany({
      where: { entityType: { in: ['product', 'product_variant', 'category', 'brand'] } },
    }),
    prisma.coupon.deleteMany({}),
    prisma.inventoryMovement.deleteMany({}),
    prisma.inventoryItem.deleteMany({}),
    prisma.price.deleteMany({}),
    prisma.variantAttributeValue.deleteMany({}),
    prisma.productVariant.deleteMany({}),
    prisma.productAttributeValue.deleteMany({}),
    prisma.product.deleteMany({}),
    prisma.categoryAttribute.deleteMany({}),
    prisma.attributeOption.deleteMany({}),
    prisma.attribute.deleteMany({}),
    prisma.brand.deleteMany({}),
    prisma.category.deleteMany({}),
  ]);

  console.log('Catalog reset done. Users, roles, permissions, price lists, and warehouses were left untouched.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
