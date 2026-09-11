import { getIO } from '../lib/socket';
import { prisma } from '../lib/prisma';

// ─── Tipos de payload por evento ─────────────────────────────────────────────

export interface PollOpenedPayload {
  pollId: string;
  sessionId: string;
  title: string;
  question: string;
  type: string;
  options: { id: string; text: string }[];
  allowVoteChange: boolean;
  showResultsLive: boolean;
}

export interface PollClosedPayload {
  pollId: string;
  closedAt: Date | null;
}

export interface VoteCountPayload {
  pollId: string;
  votedCount: number;
  totalEligible: number;
}

export interface PollResultsPayload {
  pollId: string;
  results: { optionId: string; text: string; count: number }[];
}

export interface SessionUpdatedPayload {
  sessionId: string;
  status: string;
  title: string;
}

// ─── Helpers de emisión (llamados desde los routes REST tras confirmar en DB) ──

/**
 * Emitido cuando el presidente abre una votación.
 * Notifica a todos los clientes suscritos al room de la sesión.
 */
export async function emitPollOpened(pollId: string): Promise<void> {
  try {
    const io = getIO();
    const poll = await prisma.poll.findUnique({
      where: { id: pollId },
      include: { options: true },
    });
    if (!poll) return;

    const payload: PollOpenedPayload = {
      pollId: poll.id,
      sessionId: poll.sessionId,
      title: poll.title,
      question: poll.question,
      type: poll.type,
      options: poll.options.map(o => ({ id: o.id, text: o.text })),
      allowVoteChange: poll.allowVoteChange,
      showResultsLive: poll.showResultsLive,
    };

    io.of('/voting').to(`session:${poll.sessionId}`).emit('poll:opened', payload);
    io.of('/voting').to(`poll:${pollId}`).emit('poll:opened', payload);
  } catch (err) {
    // No es fatal — el voto ya quedó en DB, solo falla la notificación en tiempo real
    console.error('[Socket] Error emitiendo poll:opened', err);
  }
}

/**
 * Emitido cuando se cierra o cancela una votación.
 */
export async function emitPollClosed(pollId: string, cancelled = false): Promise<void> {
  try {
    const io = getIO();
    const poll = await prisma.poll.findUnique({ where: { id: pollId } });
    if (!poll) return;

    const event = cancelled ? 'poll:cancelled' : 'poll:closed';
    const payload: PollClosedPayload = { pollId, closedAt: poll.closedAt };

    io.of('/voting').to(`poll:${pollId}`).emit(event, payload);
    io.of('/voting').to(`session:${poll.sessionId}`).emit(event, payload);
  } catch (err) {
    console.error('[Socket] Error emitiendo poll:closed/cancelled', err);
  }
}

/**
 * Emitido tras registrar cualquier voto — actualiza el contador en todos los clientes.
 * Si showResultsLive=true, también emite los resultados parciales.
 */
export async function emitVoteCount(pollId: string): Promise<void> {
  console.log(`[emitVoteCount] Invocado para pollId: ${pollId}`);
  try {
    const io = getIO();
    const poll = await prisma.poll.findUnique({
      where: { id: pollId },
      include: { options: true },
    });
    if (!poll) return;

    // Calcular participantes elegibles
    const totalEligible = await prisma.sessionParticipant.count({
      where: {
        sessionId: poll.sessionId,
        user: { isActive: true },
      },
    });

    // Calcular votantes actuales
    let votedCount = 0;
    if (poll.type === 'NOMINAL') {
      votedCount = await prisma.nominalVote.count({ where: { pollId } });
    } else {
      votedCount = await prisma.secretVoterRegistry.count({ where: { pollId } });
    }

    const countPayload: VoteCountPayload = { pollId, votedCount, totalEligible };
    io.of('/voting').to(`poll:${pollId}`).emit('poll:vote_count', countPayload);

    // Si la votación muestra resultados en vivo, emitir también los parciales
    if (poll.showResultsLive) {
      let results: PollResultsPayload['results'] = [];

      if (poll.type === 'NOMINAL') {
        results = await Promise.all(
          poll.options.map(async (opt) => ({
            optionId: opt.id,
            text: opt.text,
            count: await prisma.nominalVote.count({
              where: { pollId, optionId: opt.id },
            }),
          }))
        );
      } else {
        // Para votación secreta, los resultados parciales son por opción (sin revelar quién)
        results = await Promise.all(
          poll.options.map(async (opt) => ({
            optionId: opt.id,
            text: opt.text,
            count: await prisma.secretVote.count({
              where: { pollId, optionId: opt.id },
            }),
          }))
        );
      }

      const resultsPayload: PollResultsPayload = { pollId, results };
      io.of('/voting').to(`poll:${pollId}`).emit('poll:results', resultsPayload);
    }
  } catch (err) {
    console.error('[Socket] Error emitiendo vote_count', err);
  }
}

/**
 * Emitido cuando cambia el estado de una sesión.
 */
export async function emitSessionUpdated(sessionId: string): Promise<void> {
  try {
    const io = getIO();
    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) return;

    const payload: SessionUpdatedPayload = {
      sessionId: session.id,
      status: session.status,
      title: session.title,
    };
    io.of('/voting').to(`session:${sessionId}`).emit('session:updated', payload);
  } catch (err) {
    console.error('[Socket] Error emitiendo session:updated', err);
  }
}
