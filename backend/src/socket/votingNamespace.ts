import { Server, Socket } from 'socket.io';
import { parse as parseCookies } from 'cookie';
import { verifyToken } from '../lib/jwt';
import { prisma } from '../lib/prisma';

interface AuthenticatedSocketData {
  userId: string;
  role: string;
}

/**
 * Registra el namespace /voting con autenticación JWT y handlers de eventos.
 */
export function registerVotingNamespace(io: Server): void {
  const voting = io.of('/voting');

  // ─── Middleware: Autenticación JWT desde cookie ───────────────────────────
  voting.use((socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie ?? '';
      const cookies = parseCookies(cookieHeader);
      const token = cookies['token']; // mismo nombre que en auth.ts

      if (!token) {
        return next(new Error('AUTH_REQUIRED'));
      }

      const payload = verifyToken(token);
      if (!payload || typeof payload === 'string') {
        return next(new Error('INVALID_TOKEN'));
      }

      // Inyectar datos del usuario en el socket para handlers posteriores
      socket.data.user = {
        userId: (payload as any).userId,
        role:   (payload as any).role,
      } as AuthenticatedSocketData;

      next();
    } catch {
      next(new Error('AUTH_FAILED'));
    }
  });

  // ─── Manejo de conexión ───────────────────────────────────────────────────
  voting.on('connection', (socket: Socket) => {
    const { userId, role } = socket.data.user as AuthenticatedSocketData;
    console.log(`[Socket /voting] Conectado: userId=${userId} role=${role} socketId=${socket.id}`);

    const handleSubscribePoll = async (payload: any) => {
      const pollId = typeof payload === 'string' ? payload : payload?.pollId;
      if (typeof pollId !== 'string' || !pollId) return;

      try {
        const poll = await prisma.poll.findUnique({
          where: { id: pollId },
          include: { options: true, session: true },
        });

        if (!poll) {
          socket.emit('error', { message: 'Votación no encontrada.' });
          return;
        }

        // Verificar pertenencia o rol de gestión
        const isManager = ['SUPERADMIN', 'ADMIN', 'PRESIDENT', 'AUDITOR'].includes(role);
        if (!isManager) {
          const participant = await prisma.sessionParticipant.findUnique({
            where: { sessionId_userId: { sessionId: poll.sessionId, userId } },
          });
          if (!participant) {
            socket.emit('error', { message: 'No estás habilitado para esta sesión.' });
            return;
          }
        }

        socket.join(`poll:${pollId}`);
        socket.join(`session:${poll.sessionId}`);
        console.log(`[Socket] ${userId} (${role}) joined poll:${pollId} & session:${poll.sessionId}`);

        // Emitir estado actual (sync)
        const [totalEligible, votedCount] = await Promise.all([
          prisma.sessionParticipant.count({
            where: { sessionId: poll.sessionId, user: { isActive: true } },
          }),
          poll.type === 'NOMINAL'
            ? prisma.nominalVote.count({ where: { pollId } })
            : prisma.secretVoterRegistry.count({ where: { pollId } }),
        ]);

        // Calcular resultados para todos los suscriptores
        const results = await Promise.all(
          poll.options.map(async (opt) => ({
            optionId: opt.id,
            text: opt.text,
            count: poll.type === 'NOMINAL'
              ? await prisma.nominalVote.count({ where: { pollId, optionId: opt.id } })
              : await prisma.secretVote.count({ where: { pollId, optionId: opt.id } }),
          }))
        );

        socket.emit('poll:sync', {
          poll: {
            id: poll.id,
            title: poll.title,
            question: poll.question,
            type: poll.type,
            status: poll.status,
            options: poll.options.map(o => ({ id: o.id, text: o.text })),
            allowVoteChange: poll.allowVoteChange,
            showResultsLive: poll.showResultsLive,
            openedAt: poll.openedAt,
            closedAt: poll.closedAt,
          },
          votedCount,
          totalEligible,
          results,
        });

      } catch (err) {
        console.error('[Socket] Error en subscribe:poll', err);
        socket.emit('error', { message: 'Error al suscribirse a la votación.' });
      }
    };

    socket.on('subscribe:poll', handleSubscribePoll);
    socket.on('join:poll', handleSubscribePoll);

    // ── subscribe:session ───────────────────────────────────────────────────
    socket.on('subscribe:session', async (sessionId: string) => {
      if (typeof sessionId !== 'string' || !sessionId) return;

      try {
        const session = await prisma.session.findUnique({ where: { id: sessionId } });
        if (!session) {
          socket.emit('error', { message: 'Sesión no encontrada.' });
          return;
        }

        // Verificar pertenencia o rol de gestión
        const isManager = ['SUPERADMIN', 'ADMIN', 'PRESIDENT', 'AUDITOR'].includes(role);
        if (!isManager) {
          const participant = await prisma.sessionParticipant.findUnique({
            where: { sessionId_userId: { sessionId, userId } },
          });
          if (!participant) {
            socket.emit('error', { message: 'No estás habilitado para esta sesión.' });
            return;
          }
        }

        socket.join(`session:${sessionId}`);
        console.log(`[Socket] ${userId} joined session:${sessionId}`);

      } catch (err) {
        console.error('[Socket] Error en subscribe:session', err);
      }
    });

    // ── Desconexión ─────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      console.log(`[Socket /voting] Desconectado: userId=${userId} reason=${reason}`);
    });
  });
}
