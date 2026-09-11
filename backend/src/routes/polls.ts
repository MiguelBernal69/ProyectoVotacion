import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Role, PollType, PollStatus, SessionStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middlewares/requireAuth';
import { requireRoles } from '../middlewares/requireRoles';
import { emitPollOpened, emitPollClosed } from '../socket/emitVotingEvent';
import { createAuditLog } from '../lib/audit';

export const pollsRouter = Router();

const MANAGER_ROLES = [Role.SUPERADMIN, Role.ADMIN, Role.PRESIDENT];
const VIEWER_ROLES  = [Role.SUPERADMIN, Role.ADMIN, Role.PRESIDENT, Role.AUDITOR, Role.PARTICIPANT];

// ─── Validaciones Zod ─────────────────────────────────────────────────────────

const createPollSchema = z.object({
  title:           z.string().min(3, 'El título debe tener al menos 3 caracteres.').max(200).trim(),
  question:        z.string().min(3, 'La pregunta debe tener al menos 3 caracteres.').max(500).trim(),
  type:            z.nativeEnum(PollType, { errorMap: () => ({ message: 'Tipo de votación inválido.' }) }),
  options:         z.array(z.string().min(1).max(100).trim()).min(2, 'Debe proveer al menos 2 opciones.'),
  allowVoteChange: z.boolean().optional().default(false),
  showResultsLive: z.boolean().optional().default(false),
});

const updatePollSchema = createPollSchema.partial();

const changePollStatusSchema = z.object({
  status: z.nativeEnum(PollStatus, { errorMap: () => ({ message: 'Estado inválido.' }) }),
});

// ─── POST /api/sessions/:sessionId/polls ──────────────────────────────────────
// (Notar que el :sessionId vendrá en req.params si el router se monta en app.ts)
// PERO en Express, para acceder a params del padre, hay que usar mergeParams,
// o simplemente definir la ruta explícita si se monta en `/api`.
// Montaremos este router en `/api` y definiremos la ruta completa aquí.

pollsRouter.post(
  '/sessions/:sessionId/polls',
  requireAuth,
  requireRoles(MANAGER_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const result = createPollSchema.safeParse(req.body);

    if (!result.success) {
      res.status(400).json({ error: 'Datos inválidos.', details: result.error.flatten() });
      return;
    }

    try {
      const session = await prisma.session.findUnique({ where: { id: sessionId } });
      if (!session) { res.status(404).json({ error: 'Sesión no encontrada.' }); return; }

      // Validar opciones duplicadas (case insensitive)
      const uniqueOptions = new Set(result.data.options.map(o => o.toUpperCase()));
      if (uniqueOptions.size !== result.data.options.length) {
        res.status(400).json({ error: 'Las opciones no pueden estar duplicadas.' });
        return;
      }

      // Solo se puede agregar votaciones a sesiones pendientes o activas
      if (session.status === SessionStatus.CLOSED) {
        res.status(409).json({ error: 'No se pueden agregar votaciones a una sesión cerrada.' });
        return;
      }

      const poll = await prisma.poll.create({
        data: {
          sessionId,
          title:           result.data.title,
          question:        result.data.question,
          type:            result.data.type,
          allowVoteChange: result.data.allowVoteChange,
          showResultsLive: result.data.showResultsLive,
          status:          PollStatus.PENDING,
          options: {
            create: result.data.options.map(text => ({ text })),
          },
        },
        include: { options: true },
      });

      await createAuditLog({
        action: 'POLL_CREATED',
        userId: req.user!.id,
        details: { pollId: poll.id, title: poll.title, sessionId },
      });

      res.status(201).json({ message: 'Votación creada.', poll });
    } catch (err) {
      console.error('[POLLS] Error creando votación:', err);
      res.status(500).json({ error: 'Error interno del servidor.' });
    }
  }
);

// ─── GET /api/polls/:id ──────────────────────────────────────────────────────
pollsRouter.get(
  '/polls/:id',
  requireAuth,
  requireRoles(VIEWER_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const poll = await prisma.poll.findUnique({
        where: { id: req.params.id },
        include: {
          options: true,
          session: {
            select: { id: true, title: true, status: true },
          },
        },
      });

      if (!poll) { res.status(404).json({ error: 'Votación no encontrada.' }); return; }

      // Extra: Contar elegibles (participantes de la sesión con isActive = true)
      const eligibleCount = await prisma.sessionParticipant.count({
        where: {
          sessionId: poll.sessionId,
          user: { isActive: true },
        },
      });

      res.json({ poll, eligibleCount });
    } catch (err) {
      console.error('[POLLS] Error obteniendo votación:', err);
      res.status(500).json({ error: 'Error interno del servidor.' });
    }
  }
);

// ─── PATCH /api/polls/:id ────────────────────────────────────────────────────
pollsRouter.patch(
  '/polls/:id',
  requireAuth,
  requireRoles(MANAGER_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const result = updatePollSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: 'Datos inválidos.', details: result.error.flatten() });
      return;
    }

    try {
      const existing = await prisma.poll.findUnique({
        where: { id: req.params.id },
        include: { options: true },
      });
      if (!existing) { res.status(404).json({ error: 'Votación no encontrada.' }); return; }

      if (existing.status !== PollStatus.PENDING) {
        res.status(409).json({ error: 'Solo se puede editar una votación en estado PENDIENTE.' });
        return;
      }

      // Procesar actualización (si hay opciones, reemplazamos todas)
      const updateData: any = {
        title:           result.data.title ?? existing.title,
        question:        result.data.question ?? existing.question,
        type:            result.data.type ?? existing.type,
        allowVoteChange: result.data.allowVoteChange ?? existing.allowVoteChange,
        showResultsLive: result.data.showResultsLive ?? existing.showResultsLive,
      };

      // Manejar reemplazo de opciones de forma transaccional
      let poll;
      if (result.data.options) {
        const uniqueOptions = new Set(result.data.options.map(o => o.toUpperCase()));
        if (uniqueOptions.size !== result.data.options.length) {
          res.status(400).json({ error: 'Las opciones no pueden estar duplicadas.' });
          return;
        }

        poll = await prisma.$transaction(async (tx) => {
          await tx.pollOption.deleteMany({ where: { pollId: existing.id } });
          return tx.poll.update({
            where: { id: existing.id },
            data: {
              ...updateData,
              options: { create: result.data.options!.map(text => ({ text })) },
            },
            include: { options: true },
          });
        });
      } else {
        poll = await prisma.poll.update({
          where: { id: existing.id },
          data: updateData,
          include: { options: true },
        });
      }

      await createAuditLog({
        action: 'POLL_UPDATED',
        userId: req.user!.id,
        details: { pollId: existing.id, updatedFields: Object.keys(updateData) },
      });

      res.json({ message: 'Votación actualizada.', poll });
    } catch (err) {
      console.error('[POLLS] Error actualizando votación:', err);
      res.status(500).json({ error: 'Error interno del servidor.' });
    }
  }
);

// ─── PATCH /api/polls/:id/status ─────────────────────────────────────────────
pollsRouter.patch(
  '/polls/:id/status',
  requireAuth,
  requireRoles(MANAGER_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const result = changePollStatusSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: 'Estado inválido.', details: result.error.flatten() });
      return;
    }

    const { status: newStatus } = result.data;

    try {
      const existing = await prisma.poll.findUnique({
        where: { id: req.params.id },
        include: { session: true },
      });
      if (!existing) { res.status(404).json({ error: 'Votación no encontrada.' }); return; }

      // Validar sesión activa si se quiere abrir la votación
      if (newStatus === PollStatus.OPEN && existing.session.status !== SessionStatus.ACTIVE) {
        res.status(409).json({ error: 'No se puede abrir una votación si la sesión no está ACTIVA.' });
        return;
      }

      // Validar transiciones
      const transitions: Record<PollStatus, PollStatus[]> = {
        PENDING:   [PollStatus.OPEN, PollStatus.CANCELED],
        OPEN:      [PollStatus.CLOSED, PollStatus.CANCELED],
        CLOSED:    [],
        CANCELED:  [],
      };

      if (!transitions[existing.status].includes(newStatus)) {
        res.status(409).json({
          error: `No se puede cambiar el estado de ${existing.status} a ${newStatus}.`,
        });
        return;
      }

      const updateData: any = { status: newStatus };
      if (newStatus === PollStatus.OPEN) updateData.openedAt = new Date();
      if (newStatus === PollStatus.CLOSED) updateData.closedAt = new Date();

      const poll = await prisma.poll.update({
        where: { id: existing.id },
        data: updateData,
      });

      await createAuditLog({
        action: `POLL_${newStatus}`,
        userId: req.user!.id,
        details: { pollId: poll.id, from: existing.status, to: newStatus },
      });

      res.json({ message: `Votación cambiada a ${newStatus}.`, poll });

      // Emitir evento Socket.IO DESPUÉS de la respuesta HTTP (no bloqueante)
      if (newStatus === PollStatus.OPEN) {
        void emitPollOpened(poll.id);
      } else if (newStatus === PollStatus.CLOSED) {
        void emitPollClosed(poll.id, false);
      } else if (newStatus === PollStatus.CANCELED) {
        void emitPollClosed(poll.id, true);
      }
    } catch (err) {
      console.error('[POLLS] Error cambiando estado de votación:', err);
      res.status(500).json({ error: 'Error interno del servidor.' });
    }
  }
);
