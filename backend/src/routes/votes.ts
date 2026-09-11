import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { PollStatus, PollType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middlewares/requireAuth';
import crypto from 'crypto';
import { emitVoteCount } from '../socket/emitVotingEvent';
import { createAuditLog } from '../lib/audit';

export const votesRouter = Router();

const castVoteSchema = z.object({
  optionId: z.string().uuid('El ID de la opción no es válido.'),
  voteToken: z.string().min(10, 'Token de voto requerido para votación secreta.').optional(),
});

// ─── POST /api/polls/:pollId/votes ──────────────────────────────────────────
votesRouter.post(
  '/polls/:pollId/votes',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { pollId } = req.params;
    const userId = req.user!.id;
    
    const result = castVoteSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: 'Datos inválidos.', details: result.error.flatten() });
      return;
    }

    const { optionId, voteToken } = result.data;

    try {
      // 1. Iniciar transacción atómica (Nivel SERIALIZABLE opcional, pero Prisma maneja aislamientos y unique constaints)
      const voteResult = await prisma.$transaction(async (tx) => {
        // A. Verificar estado de la votación y sesión de forma atómica
        const poll = await tx.poll.findUnique({
          where: { id: pollId },
          include: { session: true, options: true },
        });

        if (!poll) { throw new Error('NOT_FOUND'); }
        if (poll.status !== PollStatus.OPEN || poll.session.status !== 'ACTIVE') {
          throw new Error('POLL_CLOSED');
        }

        // B. Verificar que la opción pertenece a esta votación
        if (!poll.options.some(o => o.id === optionId)) {
          throw new Error('INVALID_OPTION');
        }

        // C. Verificar que el usuario está habilitado en la sesión
        const participant = await tx.sessionParticipant.findUnique({
          where: { sessionId_userId: { sessionId: poll.sessionId, userId } },
          include: { user: true },
        });

        if (!participant || !participant.user.isActive) {
          throw new Error('NOT_ELIGIBLE');
        }

        // ==========================================
        // LÓGICA DE VOTACIÓN NOMINAL
        // ==========================================
        if (poll.type === PollType.NOMINAL) {
          const existingVote = await tx.nominalVote.findUnique({
            where: { pollId_userId: { pollId, userId } },
          });

          if (existingVote) {
            if (!poll.allowVoteChange) {
              throw new Error('ALREADY_VOTED');
            }
            // Modificación
            const updated = await tx.nominalVote.update({
              where: { id: existingVote.id },
              data: { optionId },
            });
            await createAuditLog({
              action: 'VOTE_CAST',
              userId,
              details: { pollId, type: 'NOMINAL', action: 'UPDATED', optionId },
            }, tx);
            return { type: 'NOMINAL', action: 'UPDATED', vote: updated };
          } else {
            // Nuevo voto nominal
            const created = await tx.nominalVote.create({
              data: { pollId, userId, optionId },
            });
            await createAuditLog({
              action: 'VOTE_CAST',
              userId,
              details: { pollId, type: 'NOMINAL', action: 'CREATED', optionId },
            }, tx);
            return { type: 'NOMINAL', action: 'CREATED', vote: created };
          }
        }

        // ==========================================
        // LÓGICA DE VOTACIÓN SECRETA
        // ==========================================
        if (poll.type === PollType.SECRET) {
          if (!voteToken) { throw new Error('MISSING_TOKEN'); }

          // Hash del token provisto por el frontend
          const hash = crypto.createHash('sha256').update(voteToken).digest('hex');

          // Comprobar registro de asistencia (SecretVoterRegistry)
          const registry = await tx.secretVoterRegistry.findUnique({
            where: { pollId_userId: { pollId, userId } },
          });

          if (registry) {
            if (!poll.allowVoteChange) {
              throw new Error('ALREADY_VOTED');
            }

            // Buscar en la urna usando el HASH del token para confirmar propiedad del voto
            const existingSecretVote = await tx.secretVote.findUnique({
              where: { voteTokenHash: hash },
            });

            if (!existingSecretVote || existingSecretVote.pollId !== pollId) {
              throw new Error('INVALID_TOKEN');
            }

            // Actualizar el voto en la urna
            await tx.secretVote.update({
              where: { id: existingSecretVote.id },
              data: { optionId },
            });

            // Actualizar conteo de modificaciones en el registro de asistencia
            await tx.secretVoterRegistry.update({
              where: { pollId_userId: { pollId, userId } },
              data: { modifiedCount: { increment: 1 } },
            });

            await createAuditLog({
              action: 'VOTE_CAST',
              userId,
              details: { pollId, type: 'SECRET', action: 'UPDATED' }, // IMPORTANTE: Sin revelar optionId
            }, tx);

            return { type: 'SECRET', action: 'UPDATED' };
          } else {
            // Nuevo voto secreto
            // 1. Insertar en urna
            await tx.secretVote.create({
              data: { pollId, optionId, voteTokenHash: hash },
            });

            // 2. Registrar asistencia
            await tx.secretVoterRegistry.create({
              data: { pollId, userId, hasVoted: true },
            });

            await createAuditLog({
              action: 'VOTE_CAST',
              userId,
              details: { pollId, type: 'SECRET', action: 'CREATED' }, // IMPORTANTE: Sin revelar optionId
            }, tx);

            return { type: 'SECRET', action: 'CREATED' };
          }
        }
        
        throw new Error('UNKNOWN_TYPE');
      });

      res.status(200).json({ message: 'Voto registrado exitosamente.', data: voteResult });

      // Emitir actualización de conteo a todos los clientes del room (no bloqueante)
      void emitVoteCount(pollId);

    } catch (err: any) {
      // Manejo del error de Violación de Restricción Única (Condición de carrera / Doble Click)
      if (err.code === 'P2002') {
        res.status(409).json({ error: 'Condición de carrera: El voto ya fue registrado simultáneamente.' });
        return;
      }

      switch (err.message) {
        case 'NOT_FOUND':
          res.status(404).json({ error: 'Votación no encontrada.' }); break;
        case 'POLL_CLOSED':
          res.status(403).json({ error: 'La votación no está abierta.' }); break;
        case 'INVALID_OPTION':
          res.status(400).json({ error: 'La opción seleccionada no pertenece a esta votación.' }); break;
        case 'NOT_ELIGIBLE':
          res.status(403).json({ error: 'No estás habilitado para votar en esta sesión.' }); break;
        case 'ALREADY_VOTED':
          res.status(409).json({ error: 'Ya has emitido tu voto y no se permiten modificaciones.' }); break;
        case 'MISSING_TOKEN':
          res.status(400).json({ error: 'El voteToken es requerido para votaciones secretas.' }); break;
        case 'INVALID_TOKEN':
          res.status(403).json({ error: 'El token proporcionado no coincide con ningún voto registrado previamente para ser modificado.' }); break;
        default:
          console.error('[VOTES] Error registrando voto:', err);
          res.status(500).json({ error: 'Error interno del servidor.' });
      }
    }
  }
);
