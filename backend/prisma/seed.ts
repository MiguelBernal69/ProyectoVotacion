import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Running seed...');
  await prisma.healthCheck.create({ data: { status: 'seed-ok' } });
  console.log('✅ Seed completed.');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
