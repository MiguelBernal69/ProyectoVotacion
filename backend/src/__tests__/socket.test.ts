/**
 * socket.test.ts
 *
 * Pruebas de integración de Socket.IO:
 * - Autenticación por JWT en handshake
 * - subscribe:poll → poll:sync al reconectar
 * - 70 clientes simultáneos suscritos reciben poll:vote_count
 *
 * NOTA: Este archivo crea su PROPIO servidor HTTP + Socket.IO en un puerto libre
 *       para no interferir con los tests REST existentes.
 */

import { createServer } from 'http';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import bcrypt from 'bcryptjs';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { initSocket, resetSocket } from '../lib/socket';
import { registerVotingNamespace } from '../socket/votingNamespace';
import { signToken } from '../lib/jwt';
import { Role, SessionStatus, PollType, PollStatus } from '@prisma/client';
import request from 'supertest';

// ─── Setup ─────────────────────────────────────────────────────────────────────

let httpServer: ReturnType<typeof createServer>;
let serverPort: number;

const T = {
  admin: { id: '', identifier: '__t7_admin__', password: 'p7Admin!23', role: Role.ADMIN },
};
let adminToken = '';
let sessionId  = '';
let pollId     = '';

function getWsUrl() {
  return `http://localhost:${serverPort}`;
}

function createAuthClient(token: string): ClientSocket {
  return ioClient(`${getWsUrl()}/voting`, {
    autoConnect: false,
    transports: ['websocket'],
    extraHeaders: { cookie: `token=${token}` },
  });
}

beforeAll(async () => {
  // 1. Crear servidor HTTP dedicado para estos tests
  resetSocket(); // Limpiar singleton por si otro test file lo inicializó
  httpServer = createServer(app);
  const io = initSocket(httpServer);
  registerVotingNamespace(io);

  await new Promise<void>(resolve => {
    httpServer.listen(0, () => { // puerto 0 = aleatorio libre
      serverPort = (httpServer.address() as any).port;
      resolve();
    });
  });

  // 2. Crear usuario de prueba
  const user = await prisma.user.upsert({
    where: { identifier: T.admin.identifier },
    update: {},
    create: {
      identifier: T.admin.identifier,
      name: 'T7 Admin',
      passwordHash: await bcrypt.hash(T.admin.password, 10),
      role: T.admin.role,
      isActive: true,
    },
  });
  T.admin.id = user.id;

  // JWT directo (sin pasar por login)
  adminToken = signToken({ userId: user.id, role: user.role });

  // 3. Crear sesión activa, votación y opciones
  const session = await prisma.session.create({
    data: { title: 'Socket Test Session', status: SessionStatus.ACTIVE },
  });
  sessionId = session.id;

  await prisma.sessionParticipant.create({ data: { sessionId, userId: user.id } });

  const poll = await prisma.poll.create({
    data: {
      sessionId,
      title: 'Socket Poll', question: '¿Acuerdo?', type: PollType.NOMINAL,
      status: PollStatus.OPEN, allowVoteChange: false, showResultsLive: true,
      options: { create: [{ text: 'SI' }, { text: 'NO' }] },
    },
    include: { options: true },
  });
  pollId   = poll.id;
  // optionId is used only in load test below
}, 30000);

afterAll(async () => {
  await new Promise<void>(resolve => httpServer.close(() => resolve()));
  // Borrar en orden correcto para respetar FK: primero hijos, luego padres
  await prisma.auditLog.deleteMany({ where: { userId: T.admin.id } });
  await prisma.nominalVote.deleteMany({ where: { pollId } });
  await prisma.secretVoterRegistry.deleteMany({ where: { pollId } });
  await prisma.secretVote.deleteMany({ where: { pollId } });
  await prisma.sessionParticipant.deleteMany({ where: { userId: T.admin.id } });
  await prisma.pollOption.deleteMany({ where: { pollId } });
  await prisma.poll.deleteMany({ where: { sessionId } });
  await prisma.session.deleteMany({ where: { id: sessionId } });
  // Limpiar qualquier auditLog restante (eg. del login de este test)
  await prisma.auditLog.deleteMany({ where: { userId: T.admin.id } });
  await prisma.user.deleteMany({ where: { id: T.admin.id } });
  await prisma.$disconnect();
}, 30000);

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Socket.IO — Autenticación', () => {
  test('❌ Conexión sin token → desconectado', (done) => {
    const client = ioClient(`${getWsUrl()}/voting`, {
      autoConnect: false, transports: ['websocket'],
      // Sin cookie
    });

    client.on('connect_error', (err) => {
      expect(err.message).toMatch(/AUTH_REQUIRED|INVALID_TOKEN|AUTH_FAILED/);
      client.close();
      done();
    });

    client.connect();
  }, 10000);

  test('✅ Conexión con token válido → conectado', (done) => {
    const client = createAuthClient(adminToken);

    client.on('connect', () => {
      expect(client.connected).toBe(true);
      client.close();
      done();
    });

    client.on('connect_error', (err) => {
      client.close();
      done(err);
    });

    client.connect();
  }, 10000);
});

describe('Socket.IO — subscribe:poll y sync', () => {
  test('✅ Al suscribirse recibe poll:sync con estado actual', (done) => {
    const client = createAuthClient(adminToken);

    client.on('connect', () => {
      client.emit('subscribe:poll', pollId);
    });

    client.on('poll:sync', (data: any) => {
      expect(data.poll.id).toBe(pollId);
      expect(data.poll.status).toBe('OPEN');
      expect(data.poll.options.length).toBe(2);
      expect(typeof data.votedCount).toBe('number');
      expect(typeof data.totalEligible).toBe('number');
      client.close();
      done();
    });

    client.on('connect_error', (err) => { client.close(); done(err); });
    client.connect();
  }, 15000);
});

describe('Socket.IO — 70 clientes simultáneos reciben poll:vote_count', () => {
  test('🔥 70 clientes suscritos reciben actualización al votar', async () => {
    const NUM_CLIENTS = 70;

    // 1. Crear otro poll dedicado para este test (evitar conflicto con other tests)
    const loadPoll = await prisma.poll.create({
      data: {
        sessionId,
        title: 'Load Test Poll', question: '¿?', type: PollType.NOMINAL,
        status: PollStatus.OPEN, allowVoteChange: false, showResultsLive: false,
        options: { create: [{ text: 'OPT_A' }] },
      },
      include: { options: true },
    });
    const loadPollId = loadPoll.id;
    const loadOptId  = loadPoll.options[0].id;

    const clients: ClientSocket[] = [];
    
    try {
      // 2. Conectar 70 clientes y suscribirlos
      for (let i = 0; i < NUM_CLIENTS; i++) {
        clients.push(createAuthClient(adminToken));
      }

      // Conectar todos
      await Promise.all(
        clients.map(c => new Promise<void>((res, rej) => {
          c.on('connect', res);
          c.on('connect_error', rej);
          c.connect();
        }))
      );

      // Suscribir todos al poll
      const syncPromises = clients.map(c => new Promise<void>(res => {
        c.once('poll:sync', () => res());
        c.emit('subscribe:poll', loadPollId);
      }));
      await Promise.all(syncPromises);

      // 3. Registrar un voto via REST para disparar el evento
      //    (usamos el admin como participante ya que está en sessionParticipant)
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: T.admin.identifier, password: T.admin.password });
      
      const raw = loginRes.headers['set-cookie'] as unknown as string | string[];
      const cookies = Array.isArray(raw) ? raw : [raw];
      const cookie = cookies[0].split(';')[0];

      // Escuchar poll:vote_count en los 70 clientes simultáneamente
      let receivedCount = 0;
      const allReceived = new Promise<void>((resolve) => {
        clients.forEach(c => {
          c.once('poll:vote_count', (data: any) => {
            expect(data.pollId).toBe(loadPollId);
            expect(data.votedCount).toBe(1);
            receivedCount++;
            if (receivedCount === NUM_CLIENTS) resolve();
          });
        });
      });

      // Emitir el voto
      const voteRes = await request(app)
        .post(`/api/polls/${loadPollId}/votes`)
        .set('Cookie', cookie)
        .send({ optionId: loadOptId });
        
      if (voteRes.status !== 200) {
        console.error('Vote failed:', voteRes.body);
      }
      expect(voteRes.status).toBe(200);

      // Esperar a que los 70 clientes reciban el evento (timeout 10s)
      await Promise.race([
        allReceived,
        new Promise<void>((_, rej) => setTimeout(() => rej(new Error(`Solo ${receivedCount}/${NUM_CLIENTS} clientes recibieron el evento`)), 10000)),
      ]);

      expect(receivedCount).toBe(NUM_CLIENTS);

    } finally {
      clients.forEach(c => c.close());
      // Cleanup poll de carga
      await prisma.nominalVote.deleteMany({ where: { pollId: loadPollId } });
      await prisma.pollOption.deleteMany({ where: { pollId: loadPollId } });
      await prisma.poll.delete({ where: { id: loadPollId } });
    }
  }, 30000);
});
