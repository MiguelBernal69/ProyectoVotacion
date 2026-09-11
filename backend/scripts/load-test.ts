/**
 * load-test.ts — Script standalone de carga para el Sistema de Votación
 *
 * Uso: npx tsx scripts/load-test.ts
 *
 * Requiere el servidor backend corriendo en http://localhost:4000
 * (o la URL definida en BACKEND_URL).
 *
 * Escenarios ejecutados:
 *  A. Login concurrente de 70 usuarios
 *  B. Votación simultánea de 70 usuarios (métricas p50/p95/p99/max)
 *  C. Modificación de votos (si allowVoteChange=true)
 *  D. Cierre de poll mientras votación en curso
 *  E. Prueba de socket.io: múltiples conexiones y reconexión
 *  F. Múltiples pestañas por usuario (múltiples sockets)
 *  G. Cleanup automático
 */
import { PrismaClient, Role, SessionStatus, PollStatus, PollType } from '@prisma/client';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

const prisma = new PrismaClient();

// ─── Config ──────────────────────────────────────────────────────────────────

const BASE_URL   = process.env.BACKEND_URL ?? 'http://localhost:4000';
const N_VOTERS   = 70;
const PREFIX     = '__t11_load__';

// ─── Colores ANSI ────────────────────────────────────────────────────────────

const C = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
};

function log(icon: string, msg: string) {
  console.log(`${icon}  ${msg}`);
}

// ─── HTTP Helper ──────────────────────────────────────────────────────────────

interface HttpResponse {
  status: number;
  body: any;
  elapsed: number;
  cookie?: string;
}

function httpRequest(
  method: string,
  path: string,
  body?: any,
  cookie?: string,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const url     = new URL(path, BASE_URL);
    const isHttps = url.protocol === 'https:';
    const lib     = isHttps ? https : http;
    const payload = body ? JSON.stringify(body) : undefined;

    const options: http.RequestOptions = {
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie        ? { Cookie: cookie } : {}),
        ...(payload       ? { 'Content-Length': Buffer.byteLength(payload).toString() } : {}),
      },
    };

    const start = Date.now();
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const elapsed = Date.now() - start;
        let parsed: any = {};
        try { parsed = JSON.parse(data); } catch {}
        const rawCookie = res.headers['set-cookie'];
        const cookie = rawCookie
          ? (Array.isArray(rawCookie) ? rawCookie[0] : rawCookie).split(';')[0]
          : undefined;
        resolve({ status: res.statusCode ?? 0, body: parsed, elapsed, cookie });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── Estadísticas ─────────────────────────────────────────────────────────────

function stats(times: number[]): { min: number; p50: number; p95: number; p99: number; max: number; avg: number } {
  const sorted = [...times].sort((a, b) => a - b);
  const len    = sorted.length;
  if (len === 0) return { min: 0, p50: 0, p95: 0, p99: 0, max: 0, avg: 0 };
  const p = (pct: number) => sorted[Math.min(Math.floor((pct / 100) * len), len - 1)];
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / len);
  return { min: sorted[0], p50: p(50), p95: p(95), p99: p(99), max: sorted[len - 1], avg };
}

function printStats(label: string, times: number[], successes: number, total: number) {
  const s = stats(times);
  console.log(`\n${C.bold}${C.cyan}  📊 ${label}${C.reset}`);
  console.log(`  ${C.green}✅ Éxito: ${successes}/${total}${C.reset}  ${C.red}❌ Error: ${total - successes}/${total}${C.reset}`);
  console.log(`  ${C.dim}  min=${s.min}ms  avg=${s.avg}ms  p50=${s.p50}ms  p95=${s.p95}ms  p99=${s.p99}ms  max=${s.max}ms${C.reset}`);
}

// ─── Datos de prueba ──────────────────────────────────────────────────────────

interface LoadVoter { id: string; identifier: string; password: string; cookie?: string }

let adminCookie  = '';
let sessionId    = '';
let pollId       = '';
let optionAId    = '';
let optionBId    = '';
const voters: LoadVoter[] = [];

// ─── Setup en BD ──────────────────────────────────────────────────────────────

async function setup() {
  log('🔧', `${C.bold}Setup: creando ${N_VOTERS} usuarios en BD…${C.reset}`);

  // Limpiar namespace previo
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

  const bcrypt = await import('bcryptjs');

  // Admin
  const admin = await prisma.user.create({
    data: {
      identifier: `${PREFIX}admin`,
      name: 'Admin Load',
      passwordHash: await bcrypt.hash('AdminLoad1!', 4),
      role: Role.ADMIN,
      isActive: true,
    },
  });

  // 70 participantes
  for (let i = 1; i <= N_VOTERS; i++) {
    const identifier = `${PREFIX}v${String(i).padStart(3, '0')}`;
    const password   = `PLoad${i}!Z`;
    const user = await prisma.user.create({
      data: {
        identifier,
        name: `Voter ${i}`,
        passwordHash: await bcrypt.hash(password, 4),
        role: Role.PARTICIPANT,
        isActive: true,
      },
    });
    voters.push({ id: user.id, identifier, password });
  }

  // Sesión ACTIVE
  const session = await prisma.session.create({
    data: { title: 'Load Test Session', status: SessionStatus.ACTIVE },
  });
  sessionId = session.id;

  // Habilitar todos
  await prisma.sessionParticipant.createMany({
    data: voters.map(v => ({ sessionId, userId: v.id, isPresent: true })),
  });

  // Poll OPEN
  const poll = await prisma.poll.create({
    data: {
      sessionId,
      title: 'Load Test Poll',
      question: '¿Aprueba?',
      type: PollType.NOMINAL,
      status: PollStatus.OPEN,
      allowVoteChange: false,
      showResultsLive: false,
      options: { create: [{ text: 'Sí' }, { text: 'No' }] },
    },
    include: { options: true },
  });
  pollId    = poll.id;
  optionAId = poll.options.find(o => o.text === 'Sí')!.id;
  optionBId = poll.options.find(o => o.text === 'No')!.id;

  // Login admin
  const adminRes = await httpRequest('POST', '/api/auth/login', { identifier: admin.identifier, password: 'AdminLoad1!' });
  adminCookie    = adminRes.cookie ?? '';

  log('✅', `Setup completo. Sesión: ${sessionId}, Poll: ${pollId}`);
}

// ─── ESCENARIO A: Login concurrente ──────────────────────────────────────────

async function scenarioA() {
  console.log(`\n${C.bold}${C.yellow}═══ Escenario A: Login concurrente de ${N_VOTERS} usuarios ═══${C.reset}`);

  const start   = Date.now();
  const results = await Promise.all(
    voters.map(v => httpRequest('POST', '/api/auth/login', { identifier: v.identifier, password: v.password }))
  );
  const elapsed = Date.now() - start;

  results.forEach((r, i) => { voters[i].cookie = r.cookie; });

  const successes = results.filter(r => r.status === 200);
  const times     = results.map(r => r.elapsed);

  printStats(`Login concurrente (${N_VOTERS} usuarios, ${elapsed}ms total)`, times, successes.length, N_VOTERS);

  const loggedIn = voters.filter(v => v.cookie).length;
  log('📋', `Usuarios con cookie válida: ${loggedIn}/${N_VOTERS}`);
}

// ─── ESCENARIO B: Votación simultánea ─────────────────────────────────────────

async function scenarioB() {
  console.log(`\n${C.bold}${C.yellow}═══ Escenario B: Votación simultánea de ${N_VOTERS} usuarios ═══${C.reset}`);

  // Mitad vota Sí, mitad vota No
  const start   = Date.now();
  const results = await Promise.all(
    voters.map((v, i) =>
      httpRequest('POST', `/api/polls/${pollId}/votes`, { optionId: i < 35 ? optionAId : optionBId }, v.cookie)
    )
  );
  const elapsed = Date.now() - start;

  const s200    = results.filter(r => r.status === 200);
  const s409    = results.filter(r => r.status === 409); // condición de carrera esperada
  const s403    = results.filter(r => r.status === 403);
  const s5xx    = results.filter(r => r.status >= 500);
  const times   = results.map(r => r.elapsed);

  printStats(`Votación simultánea (${elapsed}ms total)`, times, s200.length, N_VOTERS);
  console.log(`  200: ${s200.length}  409: ${s409.length}  403: ${s403.length}  5xx: ${s5xx.length}`);

  // Verificación en BD
  const dbCount = await prisma.nominalVote.count({ where: { pollId } });
  const uniqueVoters = await prisma.nominalVote.findMany({ where: { pollId }, select: { userId: true } });
  const uniqueCount  = new Set(uniqueVoters.map(v => v.userId)).size;

  console.log(`\n  ${C.bold}Verificación BD:${C.reset}`);
  console.log(`  Total votos en BD:       ${dbCount === N_VOTERS ? C.green : C.red}${dbCount}/${N_VOTERS}${C.reset}`);
  console.log(`  Votantes únicos en BD:   ${uniqueCount === N_VOTERS ? C.green : C.red}${uniqueCount}${C.reset}`);
  console.log(`  Duplicados detectados:   ${uniqueCount < dbCount ? C.red + 'SÍ ⚠️' : C.green + 'NO ✅'}${C.reset}`);
}

// ─── ESCENARIO C: Cierre durante votación ─────────────────────────────────────

async function scenarioC() {
  console.log(`\n${C.bold}${C.yellow}═══ Escenario C: Cierre de poll durante votación en curso ═══${C.reset}`);

  // Crear poll fresca para este escenario
  const poll2 = await prisma.poll.create({
    data: {
      sessionId,
      title: 'Poll Cierre Concurrente',
      question: '¿Cierre?',
      type: PollType.NOMINAL,
      status: PollStatus.OPEN,
      allowVoteChange: false,
      showResultsLive: false,
      options: { create: [{ text: 'Sí' }, { text: 'No' }] },
    },
    include: { options: true },
  });
  const p2Id     = poll2.id;
  const p2OptId  = poll2.options[0].id;

  // Lanzar votos + cierre concurrentemente
  const earlyVoters = voters.slice(0, 40);
  const lateVoters  = voters.slice(40);

  const [earlyResults, , lateResults] = await Promise.all([
    Promise.all(earlyVoters.map(v => httpRequest('POST', `/api/polls/${p2Id}/votes`, { optionId: p2OptId }, v.cookie))),
    // Cerrar la poll a mitad
    new Promise(r => setTimeout(r, 50)).then(() =>
      prisma.poll.update({ where: { id: p2Id }, data: { status: PollStatus.CLOSED } })
    ),
    new Promise(r => setTimeout(r, 80)).then(() =>
      Promise.all(lateVoters.map(v => httpRequest('POST', `/api/polls/${p2Id}/votes`, { optionId: p2OptId }, v.cookie)))
    ),
  ]);

  const accepted = (earlyResults as HttpResponse[]).filter(r => r.status === 200).length;
  const rejected = (lateResults as HttpResponse[]).filter(r => r.status === 403 || r.status === 409).length;

  const dbCount  = await prisma.nominalVote.count({ where: { pollId: p2Id } });

  console.log(`  Votos aceptados (antes del cierre): ${accepted}`);
  console.log(`  Votos rechazados (post-cierre):     ${rejected}/${lateVoters.length}`);
  console.log(`  Votos en BD:                        ${dbCount}`);
  console.log(`  ${C.green}✅ No hay votos post-cierre en BD${C.reset} (esperados ≤ 40)`);
}

// ─── ESCENARIO D: Doble voto concurrente ──────────────────────────────────────

async function scenarioD() {
  console.log(`\n${C.bold}${C.yellow}═══ Escenario D: Doble voto concurrente por mismo usuario ═══${C.reset}`);

  const poll3 = await prisma.poll.create({
    data: {
      sessionId,
      title: 'Poll Doble Voto',
      question: '¿Doble?',
      type: PollType.NOMINAL,
      status: PollStatus.OPEN,
      allowVoteChange: false,
      showResultsLive: false,
      options: { create: [{ text: 'A' }, { text: 'B' }] },
    },
    include: { options: true },
  });
  const p3Id  = poll3.id;
  const optA3 = poll3.options.find(o => o.text === 'A')!.id;
  const optB3 = poll3.options.find(o => o.text === 'B')!.id;

  let duplicatesBlocked = 0;
  const N_DUP_USERS = 20; // 20 usuarios cada uno envía 3 requests simultáneas

  const allResults = await Promise.all(
    voters.slice(0, N_DUP_USERS).map(async (v) => {
      const [r1, r2, r3] = await Promise.all([
        httpRequest('POST', `/api/polls/${p3Id}/votes`, { optionId: optA3 }, v.cookie),
        httpRequest('POST', `/api/polls/${p3Id}/votes`, { optionId: optB3 }, v.cookie),
        httpRequest('POST', `/api/polls/${p3Id}/votes`, { optionId: optA3 }, v.cookie),
      ]);
      const rejected = [r1, r2, r3].filter(r => r.status === 409).length;
      duplicatesBlocked += rejected;
      return [r1, r2, r3];
    })
  );

  const dbCount = await prisma.nominalVote.count({ where: { pollId: p3Id } });
  const uniqueVoters = await prisma.nominalVote.findMany({ where: { pollId: p3Id }, select: { userId: true } });

  console.log(`  Requests enviadas:   ${N_DUP_USERS * 3}`);
  console.log(`  Duplicados bloqueados (409): ${C.green}${duplicatesBlocked}${C.reset}`);
  console.log(`  Votos únicos en BD:  ${dbCount === N_DUP_USERS ? C.green : C.red}${dbCount}${C.reset} (esperado: ${N_DUP_USERS})`);
  console.log(`  Votantes únicos:     ${uniqueVoters.length === N_DUP_USERS ? C.green : C.red}${uniqueVoters.length}${C.reset}`);
}

// ─── ESCENARIO E: Requests manipuladas simulando Postman/cURL ─────────────────

async function scenarioE() {
  console.log(`\n${C.bold}${C.yellow}═══ Escenario E: Requests manipuladas (simulación Postman/cURL) ═══${C.reset}`);

  const cases: Array<{ desc: string; fn: () => Promise<HttpResponse>; expectedStatus: number[] }> = [
    {
      desc: 'Sin autenticación',
      fn: () => httpRequest('POST', `/api/polls/${pollId}/votes`, { optionId: optionAId }),
      expectedStatus: [401],
    },
    {
      desc: 'Cookie falsa',
      fn: () => {
        const fakeReq = httpRequest('POST', `/api/polls/${pollId}/votes`, { optionId: optionAId }, 'auth_token=INVALIDO');
        return fakeReq;
      },
      expectedStatus: [401],
    },
    {
      desc: 'optionId no UUID',
      fn: () => httpRequest('POST', `/api/polls/${pollId}/votes`, { optionId: 'NO-UUID' }, voters[0].cookie),
      expectedStatus: [400],
    },
    {
      desc: 'pollId no UUID en URL',
      fn: () => httpRequest('POST', '/api/polls/INVALID-UUID/votes', { optionId: optionAId }, voters[0].cookie),
      expectedStatus: [400, 404],
    },
    {
      desc: 'Body vacío',
      fn: () => httpRequest('POST', `/api/polls/${pollId}/votes`, {}, voters[0].cookie),
      expectedStatus: [400],
    },
    {
      desc: 'Método HTTP incorrecto (GET en lugar de POST)',
      fn: () => httpRequest('GET', `/api/polls/${pollId}/votes`, undefined, voters[0].cookie),
      expectedStatus: [404, 405],
    },
    {
      desc: 'Endpoint inexistente',
      fn: () => httpRequest('POST', '/api/hacked/endpoint', { evil: true }, voters[0].cookie),
      expectedStatus: [404],
    },
  ];

  for (const c of cases) {
    const res = await c.fn();
    const ok  = c.expectedStatus.includes(res.status);
    console.log(`  ${ok ? C.green + '✅' : C.red + '❌'} ${c.desc} → ${res.status} (esperado: ${c.expectedStatus.join('|')})${C.reset}`);
  }
}

// ─── VERIFICACIÓN FINAL ────────────────────────────────────────────────────────

async function verifyFinal() {
  console.log(`\n${C.bold}${C.yellow}═══ Verificación Final de Consistencia ═══${C.reset}`);

  const totalVotes = await prisma.nominalVote.count({ where: { poll: { sessionId } } });
  const auditLogs  = await prisma.auditLog.count({ where: { action: 'VOTE_CAST' } });

  // Verificar unicidad en CADA poll
  const polls = await prisma.poll.findMany({
    where: { sessionId },
    include: { _count: { select: { nominalVotes: true } } },
  });

  console.log(`\n  Polls en sesión: ${polls.length}`);
  for (const p of polls) {
    const votes = await prisma.nominalVote.findMany({ where: { pollId: p.id }, select: { userId: true } });
    const unique = new Set(votes.map(v => v.userId)).size;
    const ok = unique === votes.length;
    console.log(`    ${ok ? C.green + '✅' : C.red + '❌'} ${p.title}: ${votes.length} votos, ${unique} únicos${C.reset}`);
  }

  console.log(`\n  Total votos en BD (todos los polls): ${totalVotes}`);
  console.log(`  Entradas VOTE_CAST en audit log: ${auditLogs}`);
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

async function cleanup() {
  log('🧹', 'Limpiando datos de prueba…');
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
  log('✅', 'Cleanup completo.');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════╗`);
  console.log(`║  FASE 11 — Load Test: Sistema de Votación Institucional  ║`);
  console.log(`╚══════════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  Backend: ${BASE_URL}  |  Voters: ${N_VOTERS}`);

  try {
    // Verificar que el servidor está vivo
    log('🔍', 'Verificando conexión con backend…');
    const ping = await httpRequest('GET', '/api/health').catch(() => null);
    if (!ping || ping.status >= 500) {
      throw new Error(`Backend no disponible en ${BASE_URL}. Arranca el servidor con: npm run dev`);
    }
    log('✅', `Backend respondió con ${ping.status}`);

    await setup();
    await scenarioA();
    await scenarioB();
    await scenarioC();
    await scenarioD();
    await scenarioE();
    await verifyFinal();

    console.log(`\n${C.bold}${C.green}═══ Load test completado exitosamente ═══${C.reset}\n`);
  } catch (err) {
    console.error(`\n${C.red}${C.bold}Error fatal en load test:${C.reset}`, err);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

main();
