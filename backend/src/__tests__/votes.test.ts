import request from 'supertest';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
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
  admin: { id: '', identifier: '__t6_admin__', password: 'p6Admin!23', role: Role.ADMIN },
  part1: { id: '', identifier: '__t6_part1__', password: 'p6Part1!23', role: Role.PARTICIPANT },
  part2: { id: '', identifier: '__t6_part2__', password: 'p6Part2!23', role: Role.PARTICIPANT },
  part3: { id: '', identifier: '__t6_part3__', password: 'p6Part3!23', role: Role.PARTICIPANT }, // Not eligible
};

let cookies: Record<string, string> = {};
let sessionId = '';
let nominalPollId = '';
let nominalOptions: any[] = [];
let secretPollId = '';
let secretOptions: any[] = [];

beforeAll(async () => {
  for (const [key, data] of Object.entries(T)) {
    const user = await prisma.user.upsert({
      where: { identifier: data.identifier },
      update: {},
      create: {
        identifier: data.identifier,
        name: `T6 ${key}`,
        passwordHash: await bcrypt.hash(data.password, 10),
        role: data.role,
        isActive: true,
      },
    });
    (T as any)[key].id = user.id;
    cookies[key] = await loginAndGetCookie(data.identifier, data.password);
  }

  const session = await prisma.session.create({
    data: { title: 'Sesión Votación T6', status: SessionStatus.ACTIVE },
  });
  sessionId = session.id;

  // Solo part1 y part2 están habilitados
  await prisma.sessionParticipant.createMany({
    data: [
      { sessionId, userId: T.part1.id },
      { sessionId, userId: T.part2.id },
    ],
  });

  const nominalPoll = await prisma.poll.create({
    data: {
      sessionId,
      title: 'Nominal Poll', question: '?', type: PollType.NOMINAL,
      status: PollStatus.OPEN, allowVoteChange: true,
      options: { create: [{ text: 'OPT1' }, { text: 'OPT2' }] },
    },
    include: { options: true },
  });
  nominalPollId = nominalPoll.id;
  nominalOptions = nominalPoll.options;

  const secretPoll = await prisma.poll.create({
    data: {
      sessionId,
      title: 'Secret Poll', question: '?', type: PollType.SECRET,
      status: PollStatus.OPEN, allowVoteChange: true,
      options: { create: [{ text: 'YES' }, { text: 'NO' }] },
    },
    include: { options: true },
  });
  secretPollId = secretPoll.id;
  secretOptions = secretPoll.options;
});

afterAll(async () => {
  const userIds = Object.values(T).map(u => u.id);
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.nominalVote.deleteMany({ where: { pollId: nominalPollId } });
  await prisma.secretVote.deleteMany({ where: { pollId: secretPollId } });
  await prisma.secretVoterRegistry.deleteMany({ where: { pollId: secretPollId } });
  await prisma.pollOption.deleteMany({ where: { pollId: { in: [nominalPollId, secretPollId] } } });
  await prisma.poll.deleteMany({ where: { id: { in: [nominalPollId, secretPollId] } } });
  await prisma.sessionParticipant.deleteMany({ where: { sessionId } });
  await prisma.session.delete({ where: { id: sessionId } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('Votación Nominal', () => {
  test('❌ Usuario no habilitado → 403', async () => {
    const res = await request(app)
      .post(`/api/polls/${nominalPollId}/votes`)
      .set('Cookie', cookies.part3) // part3 no está en la sesión
      .send({ optionId: nominalOptions[0].id });
    expect(res.status).toBe(403);
  });

  test('✅ Participante vota exitosamente', async () => {
    const res = await request(app)
      .post(`/api/polls/${nominalPollId}/votes`)
      .set('Cookie', cookies.part1)
      .send({ optionId: nominalOptions[0].id });
    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe('CREATED');
  });

  test('✅ Participante modifica su voto', async () => {
    const res = await request(app)
      .post(`/api/polls/${nominalPollId}/votes`)
      .set('Cookie', cookies.part1)
      .send({ optionId: nominalOptions[1].id });
    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe('UPDATED');
    expect(res.body.data.vote.optionId).toBe(nominalOptions[1].id);
  });

  test('🔒 Prevenir doble voto concurrente', async () => {
    // Simulamos que part2 envía 5 peticiones al mismo tiempo
    const requests = Array(5).fill(0).map(() => 
      request(app)
        .post(`/api/polls/${nominalPollId}/votes`)
        .set('Cookie', cookies.part2)
        .send({ optionId: nominalOptions[0].id })
    );

    const responses = await Promise.all(requests);
    const successCount = responses.filter(r => r.status === 200).length;
    expect(successCount).toBeGreaterThan(0);
    
    // Al menos 1 debe ser 200 CREATED o UPDATED (depende si el primero entró rápido)
    // El resto podrían ser 200 UPDATED (porque allowVoteChange es true) o 409 P2002.
    // Para probar la barrera estricta, temporalmente apagamos allowVoteChange:
    await prisma.poll.update({ where: { id: nominalPollId }, data: { allowVoteChange: false } });

    const requests2 = Array(5).fill(0).map(() => 
      request(app)
        .post(`/api/polls/${nominalPollId}/votes`)
        .set('Cookie', cookies.part2)
        .send({ optionId: nominalOptions[1].id })
    );

    const responses2 = await Promise.all(requests2);
    // Todos deben ser 409 (ALREADY_VOTED) o P2002
    const allBlocked = responses2.every(r => r.status === 409);
    expect(allBlocked).toBe(true);

    await prisma.poll.update({ where: { id: nominalPollId }, data: { allowVoteChange: true } });
  });
});

describe('Votación Secreta', () => {
  const token = 'SECURE_RANDOM_TOKEN_12345';
  
  test('❌ Voto sin token → 400', async () => {
    const res = await request(app)
      .post(`/api/polls/${secretPollId}/votes`)
      .set('Cookie', cookies.part1)
      .send({ optionId: secretOptions[0].id });
    expect(res.status).toBe(400); // Zod atrapa esto
  });

  test('✅ Participante vota exitosamente', async () => {
    const res = await request(app)
      .post(`/api/polls/${secretPollId}/votes`)
      .set('Cookie', cookies.part1)
      .send({ optionId: secretOptions[0].id, voteToken: token });
    
    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe('CREATED');

    // Verificar anonimato absoluto en BD
    const votes = await prisma.secretVote.findMany({ where: { pollId: secretPollId } });
    expect(votes.length).toBe(1);
    expect((votes[0] as any).userId).toBeUndefined(); // no existe relation
    
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    expect(votes[0].voteTokenHash).toBe(hash);

    const registry = await prisma.secretVoterRegistry.findUnique({
      where: { pollId_userId: { pollId: secretPollId, userId: T.part1.id } }
    });
    expect(registry).not.toBeNull();
  });

  test('❌ Intentar modificar con token incorrecto → 403', async () => {
    const res = await request(app)
      .post(`/api/polls/${secretPollId}/votes`)
      .set('Cookie', cookies.part1)
      .send({ optionId: secretOptions[1].id, voteToken: 'WRONG_TOKEN' });
    
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('no coincide');
  });

  test('✅ Modificar voto secreto con token correcto', async () => {
    const res = await request(app)
      .post(`/api/polls/${secretPollId}/votes`)
      .set('Cookie', cookies.part1)
      .send({ optionId: secretOptions[1].id, voteToken: token });
    
    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe('UPDATED');

    const registry = await prisma.secretVoterRegistry.findUnique({
      where: { pollId_userId: { pollId: secretPollId, userId: T.part1.id } }
    });
    expect(registry?.modifiedCount).toBe(1);
  });
});

describe('Integridad frente a cambios de estado', () => {
  test('❌ Votar en sesión cerrada → 403', async () => {
    // Cerramos la sesión entera
    await prisma.session.update({ where: { id: sessionId }, data: { status: SessionStatus.CLOSED } });

    const res = await request(app)
      .post(`/api/polls/${nominalPollId}/votes`)
      .set('Cookie', cookies.part2)
      .send({ optionId: nominalOptions[0].id });
    
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('no está abierta');
  });
});
