import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { Role, SessionStatus, PollStatus, PollType } from '@prisma/client';


async function loginAndGetCookie(identifier: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ identifier, password });
  if (!res.headers['set-cookie']) throw new Error(`Login falló: ${res.status}`);
  const raw = res.headers['set-cookie'] as unknown as string | string[];
  const cookies = Array.isArray(raw) ? raw : [raw];
  return cookies[0].split(';')[0];
}

const T = {
  admin: { id: '', identifier: '__t9_admin__', password: 'p9Admin!23', role: Role.ADMIN },
};

let adminCookie = '';
let sessionId = '';
let pollId = '';
let actaId = '';

beforeAll(async () => {
  // Limpiar base de datos (orden inverso de dependencias)
  await prisma.auditLog.deleteMany();
  await prisma.pollResult.deleteMany();
  await prisma.nominalVote.deleteMany();
  await prisma.secretVote.deleteMany();
  await prisma.secretVoterRegistry.deleteMany();
  await prisma.sessionParticipant.deleteMany();
  await prisma.pollOption.deleteMany();
  await prisma.poll.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany({ where: { identifier: { startsWith: '__t9_' } } });

  // Crear usuario
  const user = await prisma.user.create({
    data: {
      identifier: T.admin.identifier,
      name: 'Admin T9',
      passwordHash: await bcrypt.hash(T.admin.password, 10),
      role: T.admin.role,
      isActive: true,
    },
  });
  T.admin.id = user.id;

  adminCookie = await loginAndGetCookie(T.admin.identifier, T.admin.password);

  // Crear sesión y votación
  const session = await prisma.session.create({
    data: { title: 'Sesion de Actas', status: SessionStatus.ACTIVE },
  });
  sessionId = session.id;

  const poll = await prisma.poll.create({
    data: {
      sessionId,
      title: 'Votación para Acta',
      question: '¿Aprobar?',
      type: PollType.NOMINAL,
      status: PollStatus.PENDING,
      options: { create: [{ text: 'SI' }, { text: 'NO' }] },
    },
  });
  pollId = poll.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.pollResult.deleteMany();
  await prisma.pollOption.deleteMany();
  await prisma.poll.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany({ where: { identifier: { startsWith: '__t9_' } } });
});

describe('Generación de Actas y Resultados', () => {
  it('❌ Intentar generar acta de votación PENDING debe fallar (409)', async () => {
    const res = await request(app)
      .post(`/api/polls/${pollId}/results`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/CERRADA/);
  });

  it('✅ Cerrar votación y generar acta correctamente (201)', async () => {
    // 1. Cerrar votación
    await prisma.poll.update({ where: { id: pollId }, data: { status: PollStatus.CLOSED } });

    // 2. Generar acta
    const res = await request(app)
      .post(`/api/polls/${pollId}/results`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(201);
    expect(res.body.data.contentHash).toBeDefined();
    actaId = res.body.data.id;
  });

  it('❌ Intentar generar acta si ya existe debe fallar (409)', async () => {
    const res = await request(app)
      .post(`/api/polls/${pollId}/results`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/ya fue generada/);
  });

  it('✅ GET /api/verify/:actaId — Verificación pública exitosa (200)', async () => {
    const res = await request(app).get(`/api/verify/${actaId}`);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.acta).toBeDefined();
    expect(res.body.acta.generatedBy.name).toBe('Admin T9');
  });

  it('❌ GET /api/verify/:actaId — Detectar acta corrompida (200 con valid:false)', async () => {
    // Corromper el JSON directamente en BD
    const current = await prisma.pollResult.findUnique({ where: { id: actaId } });
    if (!current) throw new Error('Acta no encontrada');

    const tamperedJson = { ...(current.resultJson as any), HACKED: true };
    await prisma.$executeRaw`UPDATE "poll_results" SET "resultJson" = ${tamperedJson}::jsonb WHERE id = ${actaId}`;

    const res = await request(app).get(`/api/verify/${actaId}`);
    expect(res.status).toBe(200); // 200 porque la petición es válida, pero el contenido dice que es inválido
    expect(res.body.valid).toBe(false);
  });
});
