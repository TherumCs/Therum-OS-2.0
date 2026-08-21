import { db, disconnectDb } from './lib/db.js';

// Minimal seed so the API returns real data after `prisma migrate`.
// Run: npm run build && node --env-file=.env dist/seed.js
async function main(): Promise<void> {
  const vendor = await db.vendor.upsert({
    where: { id: 'seed-vendor' },
    update: {},
    create: { id: 'seed-vendor', name: 'House Brand', platform: 'custom' },
  });

  const product = await db.product.upsert({
    where: { slug: 'starter-tee' },
    update: {},
    create: {
      name: 'Starter Tee',
      slug: 'starter-tee',
      status: 'active',
      description: 'A plain tee to prove the slice end-to-end.',
      vendorId: vendor.id,
      variants: {
        create: [
          { sku: 'TEE-S', price: 1999, inventory: 25, size: 'S' },
          { sku: 'TEE-M', price: 1999, inventory: 40, size: 'M' },
          { sku: 'TEE-L', price: 2199, inventory: 15, size: 'L' },
        ],
      },
    },
    include: { variants: true },
  });

  await db.customer.upsert({
    where: { email: 'demo@therum.studio' },
    update: {},
    create: { email: 'demo@therum.studio', name: 'Demo Customer' },
  });

  // eslint-disable-next-line no-console
  console.log(`Seeded vendor=${vendor.name}, product=${product.name} (${product.variants.length} variants), 1 customer.`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
