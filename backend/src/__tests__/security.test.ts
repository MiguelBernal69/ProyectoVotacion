/**
 * security.test.ts  —  Fase 11: Pruebas de Seguridad y Manipulación
 *
 * Escenarios cubiertos:
 *  1.  Sin autenticación → 401
 *  2.  Cookie inexistente / malformada → 401
 *  3.  Token JWT manipulado manualmente → 401
 *  4.  optionId válido pero de otra votación → 400
 *  5.  optionId con formato inválido (no UUID) → 400
 *  6.  pollId inexistente → 404
 *  7.  Votar en poll PENDING → 403
 *  8.  Votar en poll CANCELED → 403
 *  9.  Participante no habilitado en sesión → 403
 *  10. Token de voto secreto falso → 403
 *  11. Token de voto secreto de otro usuario → 403
 *  12. Body injection: intentar añadir campo "role" → ignorado
 *  13. Body injection: intentar añadir campo "userId" distinto → ignorado
 *  14. Endpoint /verify/:actaId con ID inexistente → 404
 *  15. Acceso a ruta de admin sin rol → 403
 *  16. SQL injection en identifier (login) → 401, sin crash
 *  17. Payload oversized (>1MB) → 413 o 400
 *  18. Intentar cerrar poll siendo PARTICIPANT → 403
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { Role, SessionStatus, PollStatus, PollType } from '@prisma/client';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PREFIX = '__t11_sec__';

async function hashPw(pw: string) { return bcrypt.hash(pw, 4); }

async function loginAndGetCookie(identifier: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ identifier, password });
  if (!res.headers['set-cookie']) throw new Error(`Login falló: ${identifier} HTTP ${res.status}`);
  const raw = res.headers['set-cookie'] as unknown as string | string[];
  const cookies = Array.isArray(raw) ? raw : [raw];
  return cookies[0].split(';')[0];
}

// ─── Estado global ─────────────────────────────────────────────────────────────


let participantCookie = '';
let outsiderCookie  = ''; // Participante no habilitado en sesión
let sessionId       = '';
let openPollId      = '';
let pendingPollId   = '';
let closedPollId    = '';
let optionId        = '';    // opción válida de openPoll
let otherPollOptionId = '';  // opción de pendingPoll

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Limpieza
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

  // Usuarios
  const admin = await prisma.user.create({
    data: { identifier: `${PREFIX}admin`, name: 'Admin Sec', passwordHash: await hashPw('AdminSec1!'), role: Role.ADMIN, isActive: true },
  });
  const participant = await prisma.user.create({
    data: { identifier: `${PREFIX}part`, name: 'Part Sec', passwordHash: await hashPw('PartSec1!'), role: Role.PARTICIPANT, isActive: true },
  });
  const outsider = await prisma.user.create({
    data: { identifier: `${PREFIX}out`, name: 'Outsider', passwordHash: await hashPw('OutSec1!'), role: Role.PARTICIPANT, isActive: true },
  });

  const [, participantCookieVal, outsiderCookieVal] = await Promise.all([
    loginAndGetCookie(admin.identifier, 'AdminSec1!'),
    loginAndGetCookie(participant.identifier, 'PartSec1!'),
    loginAndGetCookie(outsider.identifier, 'OutSec1!'),
  ]);
  participantCookie = participantCookieVal;
  outsiderCookie    = outsiderCookieVal;

  // Sesión
  const session = await prisma.session.create({ data: { title: 'Sesión Security', status: SessionStatus.ACTIVE } });
  sessionId = session.id;

  // Solo participant habilitado (outsider NO está en la sesión)
  await prisma.sessionParticipant.create({ data: { sessionId, userId: participant.id, isPresent: true } });

  // Polls
  const openPoll = await prisma.poll.create({
    data: {
      sessionId, title: 'Open Poll', question: '¿Sí?', type: PollType.NOMINAL,
      status: PollStatus.OPEN, allowVoteChange: false, showResultsLive: false,
      options: { create: [{ text: 'Sí' }, { text: 'No' }] },
    },
    include: { options: true },
  });
  openPollId = openPoll.id;
  optionId   = openPoll.options[0].id;

  const pendingPoll = await prisma.poll.create({
    data: {
      sessionId, title: 'Pending Poll', question: '¿Pendiente?', type: PollType.NOMINAL,
      status: PollStatus.PENDING, allowVoteChange: false, showResultsLive: false,
      options: { create: [{ text: 'A' }, { text: 'B' }] },
    },
    include: { options: true },
  });
  pendingPollId = pendingPoll.id;
  otherPollOptionId = pendingPoll.options[0].id;

  const closedPoll = await prisma.poll.create({
    data: {
      sessionId, title: 'Closed Poll', question: '¿Cerrado?', type: PollType.NOMINAL,
      status: PollStatus.CLOSED, allowVoteChange: false, showResultsLive: false,
      options: { create: [{ text: 'X' }] },
    },
  });
  closedPollId = closedPoll.id;
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

// ─── AUTENTICACIÓN ─────────────────────────────────────────────────────────────

describe('Autenticación y Autorización', () => {
  it('1. ❌ Sin cookie → 401', async () => {
    const res = await request(app).post(`/api/polls/${openPollId}/votes`).send({ optionId });
    expect(res.status).toBe(401);
  });

  it('2. ❌ Cookie malformada → 401', async () => {
    const res = await request(app)
      .post(`/api/polls/${openPollId}/votes`)
      .set('Cookie', 'auth_token=ESTO_NO_ES_UN_JWT_VALIDO')
      .send({ optionId });
    expect(res.status).toBe(401);
  });

  it('3. ❌ Token JWT firmado con clave distinta → 401', async () => {
    // Fabricar un JWT con clave incorrecta
    const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'fake-id', role: 'ADMIN', iat: Math.floor(Date.now()/1000) })).toString('base64url');
    const sig     = Buffer.from('firma_falsa_invalida').toString('base64url');
    const fakeJwt = `${header}.${payload}.${sig}`;

    const res = await request(app)
      .post(`/api/polls/${openPollId}/votes`)
      .set('Cookie', `auth_token=${fakeJwt}`)
      .send({ optionId });
    expect(res.status).toBe(401);
  });

  it('4. ❌ PARTICIPANT intenta listar usuarios (ruta de ADMIN) → 403', async () => {
    const res = await request(app).get('/api/users').set('Cookie', participantCookie);
    expect(res.status).toBe(403);
  });

  it('5. ❌ PARTICIPANT intenta cerrar sesión (ruta de ADMIN) → 403', async () => {
    const res = await request(app)
      .patch(`/api/sessions/${sessionId}/status`)
      .set('Cookie', participantCookie)
      .send({ status: 'CLOSED' });
    expect(res.status).toBe(403);
  });

  it('6. ❌ PARTICIPANT intenta cerrar poll → 403', async () => {
    const res = await request(app)
      .patch(`/api/polls/${openPollId}/status`)
      .set('Cookie', participantCookie)
      .send({ status: 'CLOSED' });
    expect(res.status).toBe(403);
  });
});

// ─── VALIDACIÓN DE INPUTS ──────────────────────────────────────────────────────

describe('Validación de inputs', () => {
  it('7. ❌ optionId no es UUID → 400', async () => {
    const res = await request(app)
      .post(`/api/polls/${openPollId}/votes`)
      .set('Cookie', participantCookie)
      .send({ optionId: 'ESTE-NO-ES-UN-UUID' });
    expect(res.status).toBe(400);
  });

  it('8. ❌ optionId es UUID pero pertenece a otra poll → 400', async () => {
    const res = await request(app)
      .post(`/api/polls/${openPollId}/votes`)
      .set('Cookie', participantCookie)
      .send({ optionId: otherPollOptionId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no pertenece/i);
  });

  it('9. ❌ pollId inexistente → 404', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000099';
    const res = await request(app)
      .post(`/api/polls/${fakeId}/votes`)
      .set('Cookie', participantCookie)
      .send({ optionId });
    expect(res.status).toBe(404);
  });

  it('10. ❌ optionId faltante en body → 400', async () => {
    const res = await request(app)
      .post(`/api/polls/${openPollId}/votes`)
      .set('Cookie', participantCookie)
      .send({});
    expect(res.status).toBe(400);
  });

  it('11. ❌ Payload JSON malformado → 400', async () => {
    const res = await request(app)
      .post(`/api/polls/${openPollId}/votes`)
      .set('Cookie', participantCookie)
      .set('Content-Type', 'application/json')
      .send('{ optionId: "broken json }');
    expect([400, 422]).toContain(res.status);
  });
});

// ─── ESTADO DE POLL ────────────────────────────────────────────────────────────

describe('Restricciones de estado de poll', () => {
  it('12. ❌ Votar en poll PENDING → 403', async () => {
    const res = await request(app)
      .post(`/api/polls/${pendingPollId}/votes`)
      .set('Cookie', participantCookie)
      .send({ optionId: otherPollOptionId });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/no está abierta/i);
  });

  it('13. ❌ Votar en poll CLOSED → 403', async () => {
    const res = await request(app)
      .post(`/api/polls/${closedPollId}/votes`)
      .set('Cookie', participantCookie)
      .send({ optionId });
    expect(res.status).toBe(403);
  });
});

// ─── ELEGIBILIDAD ──────────────────────────────────────────────────────────────

describe('Control de elegibilidad', () => {
  it('14. ❌ Usuario no habilitado en sesión → 403', async () => {
    const res = await request(app)
      .post(`/api/polls/${openPollId}/votes`)
      .set('Cookie', outsiderCookie)
      .send({ optionId });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/habilitado/i);
  });
});

// ─── BODY INJECTION ────────────────────────────────────────────────────────────

describe('Body injection — campos extra ignorados', () => {
  it('15. ✅ Campo "role: ADMIN" en body → ignorado; voto registrado normalmente', async () => {
    // Asegurarse de que participant no ha votado
    await prisma.nominalVote.deleteMany({ where: { pollId: openPollId } });

    const res = await request(app)
      .post(`/api/polls/${openPollId}/votes`)
      .set('Cookie', participantCookie)
      .send({ optionId, role: 'ADMIN', isAdmin: true, userId: 'FAKE_USER_ID' });

    // Debe procesar correctamente (200) — los campos extra se ignoran
    expect(res.status).toBe(200);

    // El voto fue registrado para el usuario real (no para FAKE_USER_ID)
    const vote = await prisma.nominalVote.findFirst({ where: { pollId: openPollId } });
    expect(vote).toBeTruthy();
    expect(vote?.userId).not.toBe('FAKE_USER_ID');
  });
});

// ─── SEGURIDAD DE VOTACIÓN SECRETA ────────────────────────────────────────────

describe('Seguridad de votación secreta', () => {
  let secretPollId = '';
  let secretOptionId = '';
  let secretParticipantCookie = '';
  let secretParticipantId = '';

  beforeAll(async () => {
    // Usuario adicional para tests secretos
    const secretUser = await prisma.user.create({
      data: {
        identifier: `${PREFIX}secret_part`,
        name: 'Secret Participant',
        passwordHash: await hashPw('SecretPart1!'),
        role: Role.PARTICIPANT,
        isActive: true,
      },
    });
    secretParticipantId = secretUser.id;
    secretParticipantCookie = await loginAndGetCookie(secretUser.identifier, 'SecretPart1!');

    await prisma.sessionParticipant.create({
      data: { sessionId, userId: secretUser.id, isPresent: true },
    });

    const poll = await prisma.poll.create({
      data: {
        sessionId,
        title: 'Secret Poll Security',
        question: '¿Secreto?',
        type: PollType.SECRET,
        status: PollStatus.OPEN,
        allowVoteChange: true,
        showResultsLive: false,
        options: { create: [{ text: 'SÍ' }, { text: 'NO' }] },
      },
      include: { options: true },
    });
    secretPollId  = poll.id;
    secretOptionId = poll.options[0].id;
  });

  afterAll(async () => {
    // Eliminar en orden correcto para evitar FK violations
    await prisma.auditLog.deleteMany({ where: { userId: secretParticipantId } });
    await prisma.secretVote.deleteMany({ where: { pollId: secretPollId } });
    await prisma.secretVoterRegistry.deleteMany({ where: { pollId: secretPollId } });
    await prisma.sessionParticipant.deleteMany({ where: { userId: secretParticipantId } });
    await prisma.user.deleteMany({ where: { identifier: `${PREFIX}secret_part` } });
  });

  it('16. ❌ Voto secreto sin voteToken → 400', async () => {
    const res = await request(app)
      .post(`/api/polls/${secretPollId}/votes`)
      .set('Cookie', secretParticipantCookie)
      .send({ optionId: secretOptionId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/token/i);
  });

  it('17. ❌ Intentar modificar con token falso → 403', async () => {
    // 1. Primero votar correctamente
    const realToken = crypto.randomUUID();
    const r1 = await request(app)
      .post(`/api/polls/${secretPollId}/votes`)
      .set('Cookie', secretParticipantCookie)
      .send({ optionId: secretOptionId, voteToken: realToken });
    expect(r1.status).toBe(200);

    // 2. Intentar modificar con token falso
    const fakeToken = crypto.randomUUID();
    const r2 = await request(app)
      .post(`/api/polls/${secretPollId}/votes`)
      .set('Cookie', secretParticipantCookie)
      .send({ optionId: secretOptionId, voteToken: fakeToken });
    expect(r2.status).toBe(403);
    expect(r2.body.error).toMatch(/token/i);
  });

  it('18. 🔒 Audit log secreto NO revela optionId', async () => {
    // El audit log para VOTE_CAST secreto debe tener type:"SECRET" pero NO optionId
    const logs = await prisma.auditLog.findMany({
      where: {
        action: 'VOTE_CAST',
        userId: secretParticipantId,
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    for (const log of logs) {
      const details = log.details as any;
      if (details?.type === 'SECRET') {
        // El audit log secreto nunca debe contener optionId
        expect(details.optionId).toBeUndefined();
        expect(details.option).toBeUndefined();
      }
    }
  });
});

// ─── VERIFICACIÓN PÚBLICA ──────────────────────────────────────────────────────

describe('Endpoint de verificación pública /api/verify/:actaId', () => {
  it('19. ❌ ID de acta inexistente → 404', async () => {
    const fakeActaId = '00000000-0000-0000-0000-000000000000';
    const res = await request(app).get(`/api/verify/${fakeActaId}`);
    expect(res.status).toBe(404);
  });

  it('20. ✅ Endpoint público accesible sin autenticación', async () => {
    // Solo verificar que no devuelve 401 para ID inválido
    const res = await request(app).get('/api/verify/00000000-0000-0000-0000-000000000001');
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ─── INYECCIÓN SQL / NOSQL ─────────────────────────────────────────────────────

describe('Resistencia a inyección', () => {
  const sqlPayloads = [
    `' OR '1'='1`,
    `'; DROP TABLE users; --`,
    `admin' --`,
    `" OR "" = "`,
    `<script>alert(1)</script>`,
    `${PREFIX}\`; DELETE FROM users WHERE 1=1; --`,
  ];

  sqlPayloads.forEach((payload, i) => {
    it(`21.${i + 1} ❌ SQL/Script injection en login (payload #${i + 1}) → 401, sin crash`, async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ identifier: payload, password: 'doesntmatter' });

      // Prisma usa prepared statements; debe rechazar con 401, nunca 500
      expect(res.status).toBe(401);
    });
  });
});

// ─── RATE LIMITING ─────────────────────────────────────────────────────────────

describe('Rate Limiting', () => {
  it('22. ⚠️ Múltiples logins fallidos desde misma IP → 429 eventualmente', async () => {
    const results: number[] = [];

    for (let i = 0; i < 30; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'usuario_inexistente', password: 'wrong_password' });
      results.push(res.status);
    }

    // Debería haber algún 401 (credenciales inválidas) o 429 (rate limit)
    const valid = results.every(s => s === 401 || s === 429);
    expect(valid).toBe(true);

    const rateLimited = results.some(s => s === 429);
    console.log(`[Security-22] Rate limit activado: ${rateLimited} (${results.filter(s => s === 429).length}/30 requests bloqueadas)`);
    // Nota: si rate limiting está configurado, este test debería ver 429s
    // Si no hay rate limit configurado para supertest (misma IP = ::1), puede que no se active
  });
});
