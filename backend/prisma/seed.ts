import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function hash(password: string): Promise<string> {
  return bcrypt.hash(password, 12); // saltRounds=12 (seguro para producción)
}

async function main() {
  console.log('🌱 Iniciando seed...');

  // ── Usuarios del sistema ────────────────────────────────────────────────────

  const superAdmin = await prisma.user.upsert({
    where: { identifier: 'admin' },
    update: { passwordHash: await hash('admin123') },
    create: {
      identifier: 'admin',
      name: 'Administrador del Sistema',
      passwordHash: await hash('admin123'),
      role: Role.SUPERADMIN,
      isActive: true,
    },
  });

  const admin = await prisma.user.upsert({
    where: { identifier: 'admin2' },
    update: {},
    create: {
      identifier: 'admin2',
      name: 'Administrador de Sesiones',
      passwordHash: await hash('admin123'),
      role: Role.ADMIN,
      isActive: true,
    },
  });

  const president = await prisma.user.upsert({
    where: { identifier: 'presidente1' },
    update: {},
    create: {
      identifier: 'presidente1',
      name: 'Presidente de Asamblea',
      passwordHash: await hash('presi123'),
      role: Role.PRESIDENT,
      isActive: true,
    },
  });

  const auditor = await prisma.user.upsert({
    where: { identifier: 'auditor1' },
    update: {},
    create: {
      identifier: 'auditor1',
      name: 'Auditor del Sistema',
      passwordHash: await hash('audit123'),
      role: Role.AUDITOR,
      isActive: true,
    },
  });

  const participant1 = await prisma.user.upsert({
    where: { identifier: 'voto1' },
    update: {},
    create: {
      identifier: 'voto1',
      name: 'Participante Uno',
      passwordHash: await hash('voto123'),
      role: Role.PARTICIPANT,
      isActive: true,
    },
  });

  const participant2 = await prisma.user.upsert({
    where: { identifier: 'voto2' },
    update: {},
    create: {
      identifier: 'voto2',
      name: 'Participante Dos',
      passwordHash: await hash('voto123'),
      role: Role.PARTICIPANT,
      isActive: true,
    },
  });

  // Usuario inactivo (para probar bloqueo)
  const inactiveUser = await prisma.user.upsert({
    where: { identifier: 'inactivo1' },
    update: {},
    create: {
      identifier: 'inactivo1',
      name: 'Usuario Desactivado',
      passwordHash: await hash('inactivo123'),
      role: Role.PARTICIPANT,
      isActive: false,
    },
  });

  console.log('👤 Usuarios creados:');
  console.table([
    { identifier: superAdmin.identifier, role: superAdmin.role, isActive: superAdmin.isActive },
    { identifier: admin.identifier,      role: admin.role,      isActive: admin.isActive },
    { identifier: president.identifier,  role: president.role,  isActive: president.isActive },
    { identifier: auditor.identifier,    role: auditor.role,    isActive: auditor.isActive },
    { identifier: participant1.identifier, role: participant1.role, isActive: participant1.isActive },
    { identifier: participant2.identifier, role: participant2.role, isActive: participant2.isActive },
    { identifier: inactiveUser.identifier, role: inactiveUser.role, isActive: inactiveUser.isActive },
  ]);

  // ── Sesión de prueba ────────────────────────────────────────────────────────
  const existing = await prisma.session.findFirst({ where: { title: 'Sesión Ordinaria de Prueba' } });
  if (!existing) {
    await prisma.session.create({
      data: {
        title: 'Sesión Ordinaria de Prueba',
        description: 'Sesión generada automáticamente por el seed.',
        status: 'PENDING',
        participants: {
          create: [
            { userId: president.id },
            { userId: participant1.id },
            { userId: participant2.id },
          ],
        },
      },
    });
    console.log('🏢 Sesión de prueba creada.');
  } else {
    console.log('🏢 Sesión de prueba ya existe, no se vuelve a crear.');
  }

  // ── Bloque génesis del log de auditoría ─────────────────────────────────────
  const genesisExists = await prisma.auditLog.findFirst({ where: { action: 'SYSTEM_INIT' } });
  if (!genesisExists) {
    await prisma.auditLog.create({
      data: {
        action: 'SYSTEM_INIT',
        details: { message: 'Seed ejecutado correctamente' },
        hash: 'genesis-hash-00000000000',
        previousHash: '0',
      },
    });
    console.log('🛡️  Log de auditoría génesis creado.');
  }

  console.log('\n✅ Seed completado.');
  console.log('\nCredenciales de prueba:');
  console.log('  SUPERADMIN  → admin / admin123');
  console.log('  ADMIN       → admin2 / admin123');
  console.log('  PRESIDENT   → presidente1 / presi123');
  console.log('  AUDITOR     → auditor1 / audit123');
  console.log('  PARTICIPANT → voto1 / voto123');
  console.log('  INACTIVE    → inactivo1 / inactivo123');
}

main()
  .catch((e) => {
    console.error('❌ Error ejecutando seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
