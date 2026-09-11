import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { Role } from '@prisma/client';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function loginAndGetCookie(identifier: string, password: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ identifier, password });
  if (!res.headers['set-cookie']) {
    throw new Error(`Login falló para ${identifier}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const raw = res.headers['set-cookie'] as unknown as string | string[];
  const cookies = Array.isArray(raw) ? raw : [raw];
  return cookies[0].split(';')[0];
}

// ─── Usuarios de prueba ───────────────────────────────────────────────────────

const T = {
  admin:       { id: '', identifier: '__t4_admin__',       password: 'p4Admin!23',   role: Role.ADMIN },
  participant: { id: '', identifier: '__t4_participant__', password: 'p4Part!23',    role: Role.PARTICIPANT },
  auditor:     { id: '', identifier: '__t4_auditor__',     password: 'p4Audit!23',   role: Role.AUDITOR },
};

let testSessionId = '';
let adminCookie   = '';
let partCookie    = '';
let auditCookie   = '';

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  for (const [key, data] of Object.entries(T)) {
    const user = await prisma.user.upsert({
      where:  { identifier: data.identifier },
      update: {},
      create: {
        identifier: data.identifier,
        name: `T4 ${key}`,
        passwordHash: await bcrypt.hash(data.password, 10),
        role: data.role,
        isActive: true,
      },
    });
    (T as Record<string, { id: string }>)[key].id = user.id;
  }

  adminCookie = await loginAndGetCookie(T.admin.identifier, T.admin.password);
  partCookie  = await loginAndGetCookie(T.participant.identifier, T.participant.password);
  auditCookie = await loginAndGetCookie(T.auditor.identifier, T.auditor.password);
});

afterAll(async () => {
  // Limpiar sesiones de prueba
  const sessions = await prisma.session.findMany({ where: { title: { startsWith: '__T4__' } } });
  for (const s of sessions) {
    await prisma.sessionParticipant.deleteMany({ where: { sessionId: s.id } });
    await prisma.session.delete({ where: { id: s.id } });
  }

  // Limpiar usuarios de prueba y sus logs
  const users = await prisma.user.findMany({
    where: { identifier: { in: Object.values(T).map(u => u.identifier) } },
  });
  const ids = users.map(u => u.id);
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });

  // Limpiar usuarios creados en tests de usuarios
  await prisma.user.deleteMany({ where: { identifier: { startsWith: '__t4_new__' } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });

  await prisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 1: Sesiones (CRUD)
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/sessions — Crear sesión', () => {
  test('✅ ADMIN puede crear sesión', async () => {
    const res = await request(app)
      .post('/api/sessions')
      .set('Cookie', adminCookie)
      .send({ title: '__T4__ Sesión de prueba', description: 'Desc.' });

    expect(res.status).toBe(201);
    expect(res.body.session.id).toBeDefined();
    testSessionId = res.body.session.id;
  });

  test('🚫 PARTICIPANT no puede crear sesión → 403', async () => {
    const res = await request(app)
      .post('/api/sessions')
      .set('Cookie', partCookie)
      .send({ title: '__T4__ Sesión inválida' });

    expect(res.status).toBe(403);
  });

  test('❌ Título muy corto → 400', async () => {
    const res = await request(app)
      .post('/api/sessions')
      .set('Cookie', adminCookie)
      .send({ title: 'AB' });

    expect(res.status).toBe(400);
  });

  test('❌ Sin autenticar → 401', async () => {
    const res = await request(app)
      .post('/api/sessions')
      .send({ title: 'Sesión sin auth' });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/sessions — Listar sesiones', () => {
  test('✅ ADMIN puede listar sesiones', async () => {
    const res = await request(app)
      .get('/api/sessions')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.sessions)).toBe(true);
  });

  test('✅ AUDITOR puede listar sesiones', async () => {
    const res = await request(app)
      .get('/api/sessions')
      .set('Cookie', auditCookie);

    expect(res.status).toBe(200);
  });

  test('✅ PARTICIPANT puede listar sus sesiones → 200', async () => {
    const res = await request(app)
      .get('/api/sessions')
      .set('Cookie', partCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.sessions)).toBe(true);
  });
});

describe('PATCH /api/sessions/:id — Editar sesión', () => {
  test('✅ ADMIN edita sesión en estado PENDING', async () => {
    const res = await request(app)
      .patch(`/api/sessions/${testSessionId}`)
      .set('Cookie', adminCookie)
      .send({ title: '__T4__ Sesión actualizada' });

    expect(res.status).toBe(200);
    expect(res.body.session.title).toBe('__T4__ Sesión actualizada');
  });
});

describe('PATCH /api/sessions/:id/status — Cambios de estado', () => {
  test('✅ Activar sesión (PENDING → ACTIVE)', async () => {
    const res = await request(app)
      .patch(`/api/sessions/${testSessionId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'ACTIVE' });

    expect(res.status).toBe(200);
    expect(res.body.session.status).toBe('ACTIVE');
  });

  test('🚫 No editar sesión ACTIVE → 409', async () => {
    const res = await request(app)
      .patch(`/api/sessions/${testSessionId}`)
      .set('Cookie', adminCookie)
      .send({ title: 'Intento de edición' });

    expect(res.status).toBe(409);
  });

  test('❌ Retroceder a PENDING desde ACTIVE → 409', async () => {
    const res = await request(app)
      .patch(`/api/sessions/${testSessionId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'PENDING' });

    expect(res.status).toBe(409);
  });

  test('✅ Cerrar sesión (ACTIVE → CLOSED)', async () => {
    const res = await request(app)
      .patch(`/api/sessions/${testSessionId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'CLOSED' });

    expect(res.status).toBe(200);
    expect(res.body.session.status).toBe('CLOSED');
  });

  test('❌ Estado inválido → 400', async () => {
    const res = await request(app)
      .patch(`/api/sessions/${testSessionId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'INVALID_STATE' });

    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 2: Participantes de Sesión
// ═══════════════════════════════════════════════════════════════════════════════

describe('Participantes — Agregar y Consultar', () => {
  let freshSessionId = '';

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/sessions')
      .set('Cookie', adminCookie)
      .send({ title: '__T4__ Sesión participantes' });
    freshSessionId = res.body.session.id;
  });

  afterAll(async () => {
    await prisma.sessionParticipant.deleteMany({ where: { sessionId: freshSessionId } });
    await prisma.session.delete({ where: { id: freshSessionId } });
  });

  test('✅ ADMIN agrega participante a sesión', async () => {
    const res = await request(app)
      .post(`/api/sessions/${freshSessionId}/participants`)
      .set('Cookie', adminCookie)
      .send({ userId: T.participant.id });

    expect(res.status).toBe(201);
    expect(res.body.participant.user.identifier).toBe(T.participant.identifier);
  });

  test('❌ Agregar mismo participante dos veces → 409', async () => {
    const res = await request(app)
      .post(`/api/sessions/${freshSessionId}/participants`)
      .set('Cookie', adminCookie)
      .send({ userId: T.participant.id });

    expect(res.status).toBe(409);
  });

  test('✅ Consultar participantes de la sesión', async () => {
    const res = await request(app)
      .get(`/api/sessions/${freshSessionId}/participants`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.participants[0].user.identifier).toBe(T.participant.identifier);
  });

  test('✅ Remover participante de sesión PENDING', async () => {
    const res = await request(app)
      .delete(`/api/sessions/${freshSessionId}/participants/${T.participant.id}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 3: Usuarios (CRUD)
// ═══════════════════════════════════════════════════════════════════════════════

let createdUserId = '';

describe('POST /api/users — Crear usuario', () => {
  test('✅ ADMIN crea un PARTICIPANT', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Cookie', adminCookie)
      .send({ identifier: '__t4_new__p1', name: 'Nuevo Participante', password: 'pass1234', role: 'PARTICIPANT' });

    expect(res.status).toBe(201);
    createdUserId = res.body.user.id;
  });

  test('❌ Identificador duplicado → 409', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Cookie', adminCookie)
      .send({ identifier: '__t4_new__p1', name: 'Duplicado', password: 'pass1234', role: 'PARTICIPANT' });

    expect(res.status).toBe(409);
  });

  test('❌ PARTICIPANT no puede crear usuarios → 403', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Cookie', partCookie)
      .send({ identifier: '__t4_new__p2', name: 'Intento', password: 'pass1234', role: 'PARTICIPANT' });

    expect(res.status).toBe(403);
  });

  test('❌ Contraseña muy corta → 400', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Cookie', adminCookie)
      .send({ identifier: '__t4_new__bad', name: 'Bad Pass', password: '123', role: 'PARTICIPANT' });

    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/users/:id — Editar usuario', () => {
  test('✅ ADMIN edita nombre de usuario', async () => {
    const res = await request(app)
      .patch(`/api/users/${createdUserId}`)
      .set('Cookie', adminCookie)
      .send({ name: 'Nombre Actualizado' });

    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('Nombre Actualizado');
  });
});

describe('PATCH /api/users/:id/status — Activar/Desactivar', () => {
  test('✅ ADMIN desactiva usuario', async () => {
    const res = await request(app)
      .patch(`/api/users/${createdUserId}/status`)
      .set('Cookie', adminCookie)
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.user.isActive).toBe(false);
  });

  test('✅ ADMIN reactiva usuario', async () => {
    const res = await request(app)
      .patch(`/api/users/${createdUserId}/status`)
      .set('Cookie', adminCookie)
      .send({ isActive: true });

    expect(res.status).toBe(200);
    expect(res.body.user.isActive).toBe(true);
  });

  test('❌ Sin campo isActive → 400', async () => {
    const res = await request(app)
      .patch(`/api/users/${createdUserId}/status`)
      .set('Cookie', adminCookie)
      .send({});

    expect(res.status).toBe(400);
  });
});
