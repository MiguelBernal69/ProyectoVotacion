import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { Role, SessionStatus } from '@prisma/client';

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function loginAndGetCookie(identifier: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ identifier, password });
  if (!res.headers['set-cookie']) {
    throw new Error(`Login falló para ${identifier}: ${res.status}`);
  }
  const raw = res.headers['set-cookie'] as unknown as string | string[];
  const cookies = Array.isArray(raw) ? raw : [raw];
  return cookies[0].split(';')[0];
}

const T = {
  admin: { id: '', identifier: '__t5_admin__', password: 'p5Admin!23', role: Role.ADMIN },
  part:  { id: '', identifier: '__t5_part__',  password: 'p5Part!23',  role: Role.PARTICIPANT },
};
let adminCookie = '';
let partCookie  = '';
let sessionId   = '';
let pollId      = '';

beforeAll(async () => {
  for (const [key, data] of Object.entries(T)) {
    const user = await prisma.user.upsert({
      where:  { identifier: data.identifier },
      update: {},
      create: {
        identifier: data.identifier,
        name: `T5 ${key}`,
        passwordHash: await bcrypt.hash(data.password, 10),
        role: data.role,
        isActive: true,
      },
    });
    (T as Record<string, { id: string }>)[key].id = user.id;
  }
  adminCookie = await loginAndGetCookie(T.admin.identifier, T.admin.password);
  partCookie  = await loginAndGetCookie(T.part.identifier, T.part.password);

  // Crear sesión para las pruebas
  const session = await prisma.session.create({
    data: { title: '__T5__ Sesión para votaciones', status: SessionStatus.ACTIVE },
  });
  sessionId = session.id;

  // Agregar al participante para contar elegibles
  await prisma.sessionParticipant.create({
    data: { sessionId, userId: T.part.id },
  });
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: { in: [T.admin.id, T.part.id] } } });
  await prisma.sessionParticipant.deleteMany({ where: { sessionId } });
  await prisma.pollOption.deleteMany({ where: { poll: { sessionId } } });
  await prisma.poll.deleteMany({ where: { sessionId } });
  await prisma.session.delete({ where: { id: sessionId } });
  await prisma.user.deleteMany({ where: { id: { in: [T.admin.id, T.part.id] } } });
  await prisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE: Votaciones
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/sessions/:id/polls — Crear votación', () => {
  test('✅ ADMIN puede crear votación', async () => {
    const res = await request(app)
      .post(`/api/sessions/${sessionId}/polls`)
      .set('Cookie', adminCookie)
      .send({
        title: 'Votación T5',
        question: '¿Aprobar?',
        type: 'NOMINAL',
        options: ['A FAVOR', 'EN CONTRA', 'ABSTENCIÓN'],
      });

    expect(res.status).toBe(201);
    expect(res.body.poll.id).toBeDefined();
    expect(res.body.poll.options.length).toBe(3);
    pollId = res.body.poll.id;
  });

  test('❌ Opciones duplicadas → 400', async () => {
    const res = await request(app)
      .post(`/api/sessions/${sessionId}/polls`)
      .set('Cookie', adminCookie)
      .send({
        title: 'Voto Duplicado', question: '¿?', type: 'SECRET',
        options: ['A FAVOR', 'a favor'],
      });
    expect(res.status).toBe(400);
  });

  test('🚫 PARTICIPANT no puede crear → 403', async () => {
    const res = await request(app)
      .post(`/api/sessions/${sessionId}/polls`)
      .set('Cookie', partCookie)
      .send({ title: 'T5', question: '¿?', type: 'NOMINAL', options: ['SI', 'NO'] });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/polls/:id — Ver detalle', () => {
  test('✅ PARTICIPANT puede ver detalle y opciones', async () => {
    const res = await request(app)
      .get(`/api/polls/${pollId}`)
      .set('Cookie', partCookie);

    expect(res.status).toBe(200);
    expect(res.body.poll.title).toBe('Votación T5');
    expect(res.body.poll.options).toBeDefined();
    expect(res.body.eligibleCount).toBe(1);
  });
});

describe('PATCH /api/polls/:id — Editar votación', () => {
  test('✅ ADMIN edita configuración en estado PENDING', async () => {
    const res = await request(app)
      .patch(`/api/polls/${pollId}`)
      .set('Cookie', adminCookie)
      .send({ title: 'Votación T5 Editada', options: ['SI', 'NO'] });

    expect(res.status).toBe(200);
    expect(res.body.poll.title).toBe('Votación T5 Editada');
    expect(res.body.poll.options.length).toBe(2);
  });
});

describe('PATCH /api/polls/:id/status — Cambiar estado', () => {
  test('✅ Activar votación', async () => {
    const res = await request(app)
      .patch(`/api/polls/${pollId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'OPEN' });
    expect(res.status).toBe(200);
    expect(res.body.poll.status).toBe('OPEN');
  });

  test('❌ Editar votación OPEN → 409', async () => {
    const res = await request(app)
      .patch(`/api/polls/${pollId}`)
      .set('Cookie', adminCookie)
      .send({ title: 'Intentar editar activa' });
    expect(res.status).toBe(409);
  });

  test('✅ Cerrar votación', async () => {
    const res = await request(app)
      .patch(`/api/polls/${pollId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'CLOSED' });
    expect(res.status).toBe(200);
  });
});
