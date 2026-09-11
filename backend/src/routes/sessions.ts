import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Role, SessionStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middlewares/requireAuth';
import { requireRoles } from '../middlewares/requireRoles';
import { createAuditLog } from '../lib/audit';

export const sessionsRouter = Router();

// Roles que pueden gestionar sesiones
const MANAGER_ROLES = [Role.SUPERADMIN, Role.ADMIN, Role.PRESIDENT];
// Roles que pueden ver sesiones
const VIEWER_ROLES  = [Role.SUPERADMIN, Role.ADMIN, Role.PRESIDENT, Role.AUDITOR, Role.PARTICIPANT];

// ─── Validación Zod ─────────────────────────────────────────────────────────

const createSessionSchema = z.object({
  title:       z.string().min(3, 'El título debe tener al menos 3 caracteres.').max(200).trim(),
  description: z.string().max(1000).optional().nullable(),
});

const updateSessionSchema = z.object({
  title:       z.string().min(3).max(200).trim().optional(),
  description: z.string().max(1000).optional().nullable(),
});

const changeStatusSchema = z.object({
  status: z.nativeEnum(SessionStatus, { errorMap: () => ({ message: 'Estado inválido. Use PENDING, ACTIVE o CLOSED.' }) }),
});

const addParticipantSchema = z.object({
  userId: z.string().uuid('ID de usuario inválido.'),
});

// ─── GET /api/sessions ───────────────────────────────────────────────────────
sessionsRouter.get(
  '/',
  requireAuth,
  requireRoles(VIEWER_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    try {
      // Si el usuario es PARTICIPANT, solo ve las sesiones en las que está inscrito
      const isParticipant = req.user!.role === Role.PARTICIPANT;
      const whereCondition = isParticipant
        ? { participants: { some: { userId: req.user!.id } } }
        : {};

      // Si req.query.status está presente, filtramos
      const statusFilter = req.query.status ? { status: req.query.status as SessionStatus } : {};

      const sessions = await prisma.session.findMany({
        where: { ...whereCondition, ...statusFilter },
        orderBy: { createdAt: 'desc' },
        include: {
          polls: { select: { id: true, status: true } },
          _count: {
            select: { participants: true, polls: true },
          },
        },
      });
      res.json({ sessions });
    } catch (err) {
      console.error('[SESSIONS] Error listando sesiones:', err);
      res.status(500).json({ error: 'Error interno del servidor.' });
    }
  }
);

// ─── POST /api/sessions ──────────────────────────────────────────────────────
sessionsRouter.post(
  '/',
  requireAuth,
  requireRoles(MANAGER_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const result = createSessionSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: 'Datos inválidos.', details: result.error.flatten() });
      return;
    }

    try {
      const session = await prisma.session.create({ data: result.data });

      await createAuditLog({
        action: 'SESSION_CREATED',
        userId: req.user!.id,
        details: { sessionId: session.id, title: session.title },
      });

      res.status(201).json({ message: 'Sesión creada correctamente.', session });
    } catch (err) {
      console.error('[SESSIONS] Error creando sesión:', err);
      res.status(500).json({ error: 'Error interno del servidor.' });
    }
  }
);

// ─── GET /api/sessions/:id ───────────────────────────────────────────────────
sessionsRouter.get(
  '/:id',
  requireAuth,
  requireRoles(VIEWER_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const session = await prisma.session.findUnique({
        where: { id: req.params.id },
        include: {
          participants: {
            include: {
              user: {
                select: { id: true, identifier: true, name: true, role: true, isActive: true },
              },
            },
            orderBy: { joinedAt: 'asc' },
          },
          polls: {
            select: { id: true, title: true, status: true, type: true },
          },
          _count: { select: { participants: true, polls: true } },
        },
      });

      if (!session) {
        res.status(404).json({ error: 'Sesión no encontrada.' });
        return;
      }

      // Si es participante, asegurar que está en la sesión
      if (req.user!.role === Role.PARTICIPANT) {
        const isEnrolled = session.participants.some(p => p.userId === req.user!.id);
        if (!isEnrolled) {
          res.status(403).json({ error: 'No tienes acceso a esta sesión.' });
          return;
        }
      }

      res.json({ session });
    } catch (err) {
      console.error('[SESSIONS] Error obteniendo sesión:', err);
      res.status(500).json({ error: 'Error interno del servidor.' });
    }
  }
);

// ─── PATCH /api/sessions/:id ─────────────────────────────────────────────────
sessionsRouter.patch(
  '/:id',
  requireAuth,
  requireRoles(MANAGER_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const result = updateSessionSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: 'Datos inválidos.', details: result.error.flatten() });
      return;
    }

    try {
      const existing = await prisma.session.findUnique({ where: { id: req.params.id } });
      if (!existing) { res.status(404).json({ error: 'Sesión no encontrada.' }); return; }

      // Solo editable en estado PENDING
      if (existing.status !== 'PENDING') {
        res.status(409).json({ error: 'Solo se puede editar una sesión en estado PENDIENTE.' });
        return;
      }

      const session = await prisma.session.update({
        where: { id: req.params.id },
        data:  result.data,
      });

      await createAuditLog({
        action: 'SESSION_UPDATED',
        userId: req.user!.id,
        details: { sessionId: session.id, updatedFields: Object.keys(result.data) },
      });

      res.json({ message: 'Sesión actualizada.', session });
    } catch (err) {
      console.error('[SESSIONS] Error actualizando sesión:', err);
      res.status(500).json({ error: 'Error interno del servidor.' });
    }
  }
);

// ─── PATCH /api/sessions/:id/status ─────────────────────────────────────────
sessionsRouter.patch(
  '/:id/status',
  requireAuth,
  requireRoles(MANAGER_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const result = changeStatusSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: 'Estado inválido.', details: result.error.flatten() });
      return;
    }

    const { status: newStatus } = result.data;

    try {
      const existing = await prisma.session.findUnique({ where: { id: req.params.id } });
      if (!existing) { res.status(404).json({ error: 'Sesión no encontrada.' }); return; }

      // Validar transiciones de estado permitidas
      const transitions: Record<SessionStatus, SessionStatus[]> = {
        PENDING: ['ACTIVE'],
        ACTIVE:  ['CLOSED'],
        CLOSED:  [],
      };

      if (!transitions[existing.status].includes(newStatus)) {
        res.status(409).json({
          error: `No se puede cambiar el estado de ${existing.status} a ${newStatus}.`,
          currentStatus: existing.status,
          allowed: transitions[existing.status],
        });
        return;
      }

      const session = await prisma.session.update({
        where: { id: req.params.id },
        data:  { status: newStatus },
      });

      await createAuditLog({
        action: `SESSION_${newStatus}`,
        userId: req.user!.id,
        details: { sessionId: session.id, from: existing.status, to: newStatus },
      });

      res.json({ message: `Sesión cambiada a ${newStatus}.`, session });
    } catch (err) {
      console.error('[SESSIONS] Error cambiando estado:', err);
      res.status(500).json({ error: 'Error interno del servidor.' });
    }
  }
);

// ─── GET /api/sessions/:id/participants ──────────────────────────────────────
sessionsRouter.get(
  '/:id/participants',
  requireAuth,
  requireRoles(VIEWER_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const session = await prisma.session.findUnique({ where: { id: req.params.id } });
      if (!session) { res.status(404).json({ error: 'Sesión no encontrada.' }); return; }

      const participants = await prisma.sessionParticipant.findMany({
        where: { sessionId: req.params.id },
        include: {
          user: {
            select: { id: true, identifier: true, name: true, role: true, isActive: true },
          },
        },
        orderBy: { joinedAt: 'asc' },
      });

      res.json({
        sessionId:    req.params.id,
        sessionTitle: session.title,
        total:        participants.length,
        eligible:     participants.filter(p => p.user.isActive).length,
        participants,
      });
    } catch (err) {
      console.error('[SESSIONS] Error listando participantes:', err);
      res.status(500).json({ error: 'Error interno del servidor.' });
    }
  }
);

// ─── POST /api/sessions/:id/participants ────────────────────────────────────
sessionsRouter.post(
  '/:id/participants',
  requireAuth,
  requireRoles([Role.SUPERADMIN, Role.ADMIN]),
  async (req: Request, res: Response): Promise<void> => {
    const result = addParticipantSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: 'Datos inválidos.', details: result.error.flatten() });
      return;
    }

    const { userId } = result.data;

    try {
      const session = await prisma.session.findUnique({ where: { id: req.params.id } });
      if (!session) { res.status(404).json({ error: 'Sesión no encontrada.' }); return; }

      if (session.status === 'CLOSED') {
        res.status(409).json({ error: 'No se pueden agregar participantes a una sesión cerrada.' });
        return;
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) { res.status(404).json({ error: 'Usuario no encontrado.' }); return; }

      // Verificar si ya es participante
      const existing = await prisma.sessionParticipant.findUnique({
        where: { sessionId_userId: { sessionId: req.params.id, userId } },
      });

      if (existing) {
        res.status(409).json({ error: 'El usuario ya es participante de esta sesión.' });
        return;
      }

      const participant = await prisma.sessionParticipant.create({
        data: { sessionId: req.params.id, userId },
        include: {
          user: { select: { id: true, identifier: true, name: true, role: true } },
        },
      });

      await createAuditLog({
        action: 'SESSION_PARTICIPANT_ADDED',
        userId: req.user!.id,
        details: { sessionId: req.params.id, targetUserId: userId },
      });

      res.status(201).json({ message: 'Participante agregado.', participant });
    } catch (err) {
      console.error('[SESSIONS] Error agregando participante:', err);
      res.status(500).json({ error: 'Error interno del servidor.' });
    }
  }
);

// ─── DELETE /api/sessions/:id/participants/:userId ──────────────────────────
sessionsRouter.delete(
  '/:id/participants/:userId',
  requireAuth,
  requireRoles([Role.SUPERADMIN, Role.ADMIN]),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const session = await prisma.session.findUnique({ where: { id: req.params.id } });
      if (!session) { res.status(404).json({ error: 'Sesión no encontrada.' }); return; }

      if (session.status !== 'PENDING') {
        res.status(409).json({ error: 'Solo se pueden remover participantes de sesiones en estado PENDIENTE.' });
        return;
      }

      const participant = await prisma.sessionParticipant.findUnique({
        where: { sessionId_userId: { sessionId: req.params.id, userId: req.params.userId } },
      });

      if (!participant) {
        res.status(404).json({ error: 'El usuario no es participante de esta sesión.' });
        return;
      }

      await prisma.sessionParticipant.delete({
        where: { sessionId_userId: { sessionId: req.params.id, userId: req.params.userId } },
      });

      await createAuditLog({
        action: 'SESSION_PARTICIPANT_REMOVED',
        userId: req.user!.id,
        details: { sessionId: req.params.id, targetUserId: req.params.userId },
      });

      res.json({ message: 'Participante removido de la sesión.' });
    } catch (err) {
      console.error('[SESSIONS] Error removiendo participante:', err);
      res.status(500).json({ error: 'Error interno del servidor.' });
    }
  }
);
