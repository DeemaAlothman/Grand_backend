import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from '@node-rs/argon2';
import { PERMISSIONS, ROLE_DEFINITIONS } from '../src/common/constants/permissions.constants';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function seedPermissions() {
  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key },
    });
  }
}

async function seedRoles() {
  for (const [roleKey, definition] of Object.entries(ROLE_DEFINITIONS)) {
    const role = await prisma.role.upsert({
      where: { key: roleKey },
      update: { name: definition.name, description: definition.description },
      create: { key: roleKey, name: definition.name, description: definition.description },
    });

    const permissions = await prisma.permission.findMany({
      where: { key: { in: definition.permissions } },
    });

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (permissions.length > 0) {
      await prisma.rolePermission.createMany({
        data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
        skipDuplicates: true,
      });
    }
  }
}

async function seedPriceLists() {
  await prisma.priceList.upsert({
    where: { key: 'retail' },
    update: {},
    create: { key: 'retail', name: 'Retail', type: 'RETAIL' },
  });
  await prisma.priceList.upsert({
    where: { key: 'wholesale' },
    update: {},
    create: { key: 'wholesale', name: 'Wholesale', type: 'WHOLESALE' },
  });
}

async function seedDevSuperAdmin() {
  if (process.env.NODE_ENV === 'production') {
    return;
  }

  const email = process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@printing-store.local';
  const password = process.env.SEED_SUPERADMIN_PASSWORD ?? 'ChangeMe123!';

  const superAdminRole = await prisma.role.findUniqueOrThrow({ where: { key: 'super_admin' } });
  const passwordHash = await argon2.hash(password);

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
      status: 'ACTIVE',
      roleId: superAdminRole.id,
      firstName: 'Super',
      lastName: 'Admin',
    },
  });

  console.log(`[seed] dev super admin ready: ${email} / ${password}`);
}

async function main() {
  await seedPermissions();
  await seedRoles();
  await seedPriceLists();
  await seedDevSuperAdmin();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
