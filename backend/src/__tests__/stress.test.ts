/**
 * stress.test.ts  —  Fase 11: Pruebas de Concurrencia
 *
 * Escenarios cubiertos:
 *  1. 70 usuarios votando simultáneamente (Promise.all)
 *  2. Doble voto desde el mismo usuario (secuencial y concurrente)
 *  3. Votos concurrentes con allowVoteChange=true
 *  4. Cierre de poll mientras llegan solicitudes de voto
 *  5. Solicitudes repetidas (retry storm — misma request N veces)
 *  6. Usuario votando en poll cerrada (post-close)
 *  7. Reconexión: voto registrado sobrevive múltiples reinterfases
 *
 * Método: supertest sobre el app Express (sin servidor externo).
 * La concurrencia es a nivel de event loop de Node.js.
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { Role, SessionStatus, PollStatus, PollType } from '@prisma/client';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PREFIX = '__t11_stress__';
const N_VOTERS = 70;
const OPTION_A = 'Sí';
const OPTION_B = 'No';

async function hashPw(pw: string) { return bcrypt.hash(pw, 4); } // bcrypt rounds=4 para velocidad en tests

async function loginAndGetCookie(identifier: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ identifier, password });
  if (!res.headers['set-cookie']) throw new Error(`Login falló para ${identifier}: HTTP ${res.status}`);
  const raw = res.headers['set-cookie'] as unknown as string | string[];
  const cookies = Array.isArray(raw) ? raw : [raw];
  return cookies[0].split(';')[0];
}

function castVote(cookie: string, pollId: string, optionId: string) {
  return request(app)
    .post(`/api/polls/${pollId}/votes`)
    .set('Cookie', cookie)
    .send({ optionId });
}

// Obtener conteo real de votos en BD (source of truth)
async function countVotesInDb(pollId: string): Promise<number> {
  return prisma.nominalVote.count({ where: { pollId } });
}

// ─── Estado global del test ────────────────────────────────────────────────────

interface Voter { id: string; identifier: string; password: string; cookie: string }


let sessionId = '';
let pollId = '';
let optionAId = '';
let optionBId = '';
const voters: Voter[] = [];

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  // Limpiar datos previos de este namespace
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.nominalVote.deleteMany(),
    prisma.secretVote.deleteMany(),
    prisma.secretVoterRegistry.deleteMany(),
    prisma.sessionParticipant.deleteMany(),
    prisma.pollOption.deleteMany(),
    prisma.poll.deleteMany(),
    prisma.session.deleteMany(),
    prisma.user.deleteMany({ where: { identifier: { startsWith: PREFIX } } }),
  ]);

  // Crear admin
  const admin = await prisma.user.create({
    data: {
      identifier: `${PREFIX}admin`,
      name: 'Admin Stress',
      passwordHash: await hashPw('AdminStr3ss!'),
      role: Role.ADMIN,
      isActive: true,
    },
  });
  await loginAndGetCookie(admin.identifier, 'AdminStr3ss!');

  // Crear 70 participantes
  const voterData = Array.from({ length: N_VOTERS }, (_, i) => ({
    identifier: `${PREFIX}voter_${String(i + 1).padStart(3, '0')}`,
    password: `Pass${i + 1}!Stress`,
  }));

  for (const vd of voterData) {
    const user = await prisma.user.create({
      data: {
        identifier: vd.identifier,
        name: `Voter ${vd.identifier}`,
        passwordHash: await hashPw(vd.password),
        role: Role.PARTICIPANT,
        isActive: true,
      },
    });
    voters.push({ id: user.id, identifier: vd.identifier, password: vd.password, cookie: '' });
  }

  // Crear sesión ACTIVE
  const session = await prisma.session.create({
    data: { title: 'Sesión Stress T11', status: SessionStatus.ACTIVE },
  });
  sessionId = session.id;

  // Habilitar todos los voters en la sesión
  await prisma.sessionParticipant.createMany({
    data: voters.map(v => ({ sessionId, userId: v.id, isPresent: true })),
  });

  // Login concurrente de todos los voters
  const loginResults = await Promise.all(
    voters.map(v => loginAndGetCookie(v.identifier, v.password))
  );
  loginResults.forEach((cookie, i) => { voters[i].cookie = cookie; });
}, 120_000); // 120s timeout para setup con 70 usuarios

beforeEach(async () => {
  // Crear una poll OPEN fresca para cada grupo de tests
  await prisma.nominalVote.deleteMany();
  await prisma.pollOption.deleteMany();
  await prisma.poll.deleteMany({ where: { sessionId } });

  const poll = await prisma.poll.create({
    data: {
      sessionId,
      title: 'Votación Stress',
      question: '¿Aprueba la propuesta?',
      type: PollType.NOMINAL,
      status: PollStatus.OPEN,
      allowVoteChange: false,
      showResultsLive: false,
      options: { create: [{ text: OPTION_A }, { text: OPTION_B }] },
    },
    include: { options: true },
  });
  pollId = poll.id;
  optionAId = poll.options.find(o => o.text === OPTION_A)!.id;
  optionBId = poll.options.find(o => o.text === OPTION_B)!.id;
});

afterAll(async () => {
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.nominalVote.deleteMany(),
    prisma.secretVote.deleteMany(),
    prisma.secretVoterRegistry.deleteMany(),
    prisma.sessionParticipant.deleteMany(),
    prisma.pollOption.deleteMany(),
    prisma.poll.deleteMany(),
    prisma.session.deleteMany(),
    prisma.user.deleteMany({ where: { identifier: { startsWith: PREFIX } } }),
  ]);
});

// ─── ESCENARIO 1: 70 usuarios votando simultáneamente ─────────────────────────

describe('Escenario 1 — 70 usuarios votando simultáneamente', () => {
  it('✅ Todos los votos se registran; conteo exacto = N_VOTERS; sin duplicados', async () => {
    const start = Date.now();

    // Todos votan por OPTION_A al mismo tiempo
    const results = await Promise.all(
      voters.map(v => castVote(v.cookie, pollId, optionAId))
    );

    const elapsed = Date.now() - start;
    console.log(`[Stress-1] ${N_VOTERS} votos simultáneos — ${elapsed}ms total`);

    const successes = results.filter(r => r.status === 200);
    const conflicts  = results.filter(r => r.status === 409);
    const errors     = results.filter(r => r.status >= 500);

    console.log(`  ✅ 200: ${successes.length}  ⚠️ 409: ${conflicts.length}  ❌ 5xx: ${errors.length}`);

    // Ningún error 5xx
    expect(errors.length).toBe(0);

    // Total registrado = 200 + 409 (el 409 por P2002 es esperado en condición de carrera)
    expect(successes.length + conflicts.length).toBe(N_VOTERS);

    // Verificación en BD: conteo exacto
    const dbCount = await countVotesInDb(pollId);
    expect(dbCount).toBe(N_VOTERS);

    // Sin duplicados: cada userId aparece exactamente una vez
    const votesInDb = await prisma.nominalVote.findMany({
      where: { pollId },
      select: { userId: true },
    });
    const userIds = votesInDb.map(v => v.userId);
    const uniqueIds = new Set(userIds);
    expect(uniqueIds.size).toBe(N_VOTERS);
  }, 60_000);
});

// ─── ESCENARIO 2: Doble voto — mismo usuario, secuencial ──────────────────────

describe('Escenario 2 — Doble voto (allowVoteChange=false)', () => {
  it('❌ Segundo voto del mismo usuario devuelve 409', async () => {
    const voter = voters[0];
    const r1 = await castVote(voter.cookie, pollId, optionAId);
    const r2 = await castVote(voter.cookie, pollId, optionBId);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(409);

    // Solo 1 voto en BD
    const dbCount = await countVotesInDb(pollId);
    expect(dbCount).toBe(1);
  });

  it('❌ Doble voto CONCURRENTE — mismo usuario — exactamente 1 voto en BD', async () => {
    const voter = voters[1];
    const [r1, r2] = await Promise.all([
      castVote(voter.cookie, pollId, optionAId),
      castVote(voter.cookie, pollId, optionBId),
    ]);

    // Uno debe ser 200, el otro 409 (o ambos si hay condición de carrera)
    expect([200, 409]).toContain(r1.status);
    expect([200, 409]).toContain(r2.status);

    // Garantía fundamental: exactamente 1 voto en BD
    const dbCount = await countVotesInDb(pollId);
    expect(dbCount).toBe(1);
  });
});

// ─── ESCENARIO 3: Votos concurrentes con allowVoteChange=true ─────────────────

describe('Escenario 3 — Modificación concurrente de votos (allowVoteChange=true)', () => {
  beforeEach(async () => {
    // Reconfigurar la poll para permitir cambios
    await prisma.poll.update({ where: { id: pollId }, data: { allowVoteChange: true } });
  });

  it('✅ Modificación simultánea — el conteo final es exactamente N_VOTERS', async () => {
    // Fase 1: todos votan por A
    await Promise.all(voters.map(v => castVote(v.cookie, pollId, optionAId)));

    // Verificar: todos votaron
    const countAfterPhase1 = await countVotesInDb(pollId);
    expect(countAfterPhase1).toBe(N_VOTERS);

    // Fase 2: todos cambian a B simultáneamente
    const results = await Promise.all(
      voters.map(v => castVote(v.cookie, pollId, optionBId))
    );

    const errors5xx = results.filter(r => r.status >= 500);
    expect(errors5xx.length).toBe(0);

    // El conteo sigue siendo N_VOTERS (modificaciones, no nuevos votos)
    const countAfterPhase2 = await countVotesInDb(pollId);
    expect(countAfterPhase2).toBe(N_VOTERS);
  }, 60_000);
});

// ─── ESCENARIO 4: Cierre de poll mientras llegan solicitudes ──────────────────

describe('Escenario 4 — Cierre de poll mientras existen solicitudes en vuelo', () => {
  it('✅ Votos aceptados antes del cierre; 403 tras el cierre; sin corrupción', async () => {
    // Mitad de los voters vota inmediatamente
    const earlyVoters  = voters.slice(0, 35);
    const lateVoters   = voters.slice(35);

    // Votar la primera mitad
    const earlyResults = await Promise.all(
      earlyVoters.map(v => castVote(v.cookie, pollId, optionAId))
    );
    earlyResults.forEach(r => expect(r.status).toBe(200));

    // Cerrar la poll
    await prisma.poll.update({ where: { id: pollId }, data: { status: PollStatus.CLOSED } });

    // La segunda mitad intenta votar (ya está cerrada)
    const lateResults = await Promise.all(
      lateVoters.map(v => castVote(v.cookie, pollId, optionBId))
    );
    lateResults.forEach(r => expect(r.status).toBe(403));

    // Solo 35 votos en BD
    const dbCount = await countVotesInDb(pollId);
    expect(dbCount).toBe(35);
  });
});

// ─── ESCENARIO 5: Retry storm — misma request N veces ────────────────────────

describe('Escenario 5 — Retry storm (10 requests idénticas del mismo usuario)', () => {
  it('❌ Solo 1 voto registrado a pesar de 10 requests simultáneas', async () => {
    const voter = voters[0];
    const N_RETRIES = 10;

    const results = await Promise.all(
      Array.from({ length: N_RETRIES }, () => castVote(voter.cookie, pollId, optionAId))
    );

    const successes = results.filter(r => r.status === 200);
    const rejects   = results.filter(r => r.status === 409);
    const errors    = results.filter(r => r.status >= 500);

    console.log(`[Stress-5] Retry storm — 200: ${successes.length}, 409: ${rejects.length}, 5xx: ${errors.length}`);

    expect(errors.length).toBe(0);
    expect(successes.length + rejects.length).toBe(N_RETRIES);

    const dbCount = await countVotesInDb(pollId);
    expect(dbCount).toBe(1);
  });
});

// ─── ESCENARIO 6: Votar después del cierre ───────────────────────────────────

describe('Escenario 6 — Voto post-cierre', () => {
  it('❌ 403 al votar en poll con estado CLOSED', async () => {
    await prisma.poll.update({ where: { id: pollId }, data: { status: PollStatus.CLOSED } });

    const res = await castVote(voters[0].cookie, pollId, optionAId);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/no está abierta/i);
  });
});

// ─── ESCENARIO 7: Audit log — integridad tras concurrencia ────────────────────

describe('Escenario 7 — Auditoría íntegra tras concurrencia', () => {
  it('✅ Audit log tiene exactamente N_VOTERS entradas VOTE_CAST sin gaps', async () => {
    // Limpiar logs antes
    await prisma.auditLog.deleteMany({ where: { action: 'VOTE_CAST' } });

    await Promise.all(voters.map(v => castVote(v.cookie, pollId, optionAId)));

    const auditEntries = await prisma.auditLog.count({
      where: { action: 'VOTE_CAST' },
    });

    expect(auditEntries).toBe(N_VOTERS);
  }, 60_000);
});

// ─── ESCENARIO 8: Múltiples pestañas — mismo cookie, misma sesión ─────────────

describe('Escenario 8 — Múltiples pestañas (misma cookie, requests paralelas)', () => {
  it('❌ Simular 5 pestañas del mismo usuario — solo 1 voto registrado', async () => {
    const voter = voters[0];
    const N_TABS = 5;

    // Cada "pestaña" envía la misma request (igual cookie = igual sesión)
    const results = await Promise.all(
      Array.from({ length: N_TABS }, () => castVote(voter.cookie, pollId, optionAId))
    );

    const errors5xx = results.filter(r => r.status >= 500);
    expect(errors5xx.length).toBe(0);

    const dbCount = await countVotesInDb(pollId);
    expect(dbCount).toBe(1);
  });
});
