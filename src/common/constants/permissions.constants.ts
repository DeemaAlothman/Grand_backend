export const PERMISSIONS = [
  'categories.create',
  'categories.read',
  'categories.update',
  'categories.delete',
  'attributes.create',
  'attributes.read',
  'attributes.update',
  'attributes.delete',
  'products.create',
  'products.read',
  'products.update',
  'products.delete',
  'prices.read',
  'prices.update',
  'inventory.read',
  'inventory.adjust',
  'warehouses.manage',
  'orders.read',
  'orders.create',
  'orders.updateStatus',
  'orders.refund',
  'users.manage',
  'roles.manage',
  'audit.read',
  'media.manage',
  'imports.manage',
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number];

export const ROLE_DEFINITIONS: Record<
  string,
  { name: string; description: string; permissions: PermissionKey[] }
> = {
  super_admin: {
    name: 'Super Admin',
    description:
      'إدارة كاملة للنظام، الصلاحيات، الإعدادات الحساسة وسجل التدقيق.',
    permissions: [...PERMISSIONS],
  },
  catalog_manager: {
    name: 'Catalog Manager',
    description: 'الأصناف، الصفات، المنتجات، الصور، الأسعار والاستيراد.',
    permissions: [
      'categories.create',
      'categories.read',
      'categories.update',
      'categories.delete',
      'attributes.create',
      'attributes.read',
      'attributes.update',
      'attributes.delete',
      'products.create',
      'products.read',
      'products.update',
      'products.delete',
      'prices.read',
      'prices.update',
      'media.manage',
      'imports.manage',
    ],
  },
  inventory_manager: {
    name: 'Inventory Manager',
    description: 'المستودعات، المخزون، التسويات والحركات.',
    permissions: [
      'inventory.read',
      'inventory.adjust',
      'warehouses.manage',
      'products.read',
      'categories.read',
    ],
  },
  order_manager: {
    name: 'Order Manager',
    description: 'الطلبات، حالات التنفيذ، الشحن والاسترجاع.',
    permissions: [
      'orders.read',
      'orders.create',
      'orders.updateStatus',
      'orders.refund',
      'products.read',
    ],
  },
  sales_agent: {
    name: 'Sales Agent',
    description: 'إنشاء طلبات للعملاء ومراجعة الأسعار الخاصة.',
    permissions: [
      'orders.read',
      'orders.create',
      'prices.read',
      'products.read',
      'categories.read',
    ],
  },
  customer: {
    name: 'Customer',
    description: 'التصفح، السلة، الطلبات، العناوين والمفضلة.',
    permissions: [],
  },
};
