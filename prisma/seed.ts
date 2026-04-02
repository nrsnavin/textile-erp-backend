// prisma/seed.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // ── Tenant ─────────────────────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
  where:  { slug: 'demo-factory' },
  update: {},
  create: {
    id:   '80472de6-8b83-43bf-a819-d69cd8980524',
    name: 'Demo Garments Pvt Ltd',
    slug: 'demo-factory',
  },
});
  console.log('✓ Tenant:', tenant.name, '| ID:', tenant.id);

  // ── Buyer ───────────────────────────────────────────────────────────


  console.log('\n✅ Seed complete!');
  console.log('Use this tenantId in Postman:', tenant.id);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());