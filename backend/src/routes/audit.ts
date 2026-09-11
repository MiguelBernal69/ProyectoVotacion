import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middlewares/requireAuth';
import { requireRoles } from '../middlewares/requireRoles';
import { verifyAuditChain, createAuditLog } from '../lib/audit';

export const auditRouter = Router();

// SUPERADMIN, ADMIN y AUDITOR pueden acceder a endpoints de auditoría
const AUDIT_ROLES = [Role.SUPERADMIN, Role.ADMIN, Role.AUDITOR];
const ADMIN_ROLES = [Role.SUPERADMIN, Role.ADMIN];

// ─── Rate limiting estricto para endpoints de auditoría ──────────────────────
// El endpoint de verificación es computacionalmente costoso; limitamos su uso.
const auditVerifyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: process.env.NODE_ENV === 'test' ? 1000 : 10,
  message: { error: 'Demasiadas verificaciones. Espere 5 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting para el listado general (más permisivo)
const auditListLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 60,
  message: { error: 'Demasiadas solicitudes al log de auditoría.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── GET /api/audit — Listar eventos de auditoría (paginado) ──────────────────
auditRouter.get(
  '/audit',
  requireAuth,
  requireRoles(AUDIT_ROLES),
  auditListLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const page   = Math.max(1, parseInt(req.query.page as string)   || 1);
    const limit  = Math.min(100, parseInt(req.query.limit as string) || 50);
    const action = req.query.action as string | undefined;
    const userId = req.query.userId as string | undefined;
    const from   = req.query.from   as string | undefined;
    const to     = req.query.to     as string | undefined;

    try {
      const where: any = {};
      if (action) where.action = { contains: action.toUpperCase() };
      if (userId) where.userId = userId;
      if (from || to) {
        where.createdAt = {};
        if (from) where.createdAt.gte = new Date(from);
        if (to)   where.createdAt.lte = new Date(to);
      }

      const [total, events] = await Promise.all([
        prisma.auditLog.count({ where }),
        prisma.auditLog.findMany({
          where,
          include: { user: { select: { id: true, name: true, identifier: true, role: true } } },
          orderBy: { createdAt: 'desc' },
          skip:  (page - 1) * limit,
          take:  limit,
        }),
      ]);

      // Registrar el acceso al log (los auditores también son auditados)
      void createAuditLog({
        action: 'AUDIT_LOG_ACCESSED',
        userId: req.user!.id,
        details: { page, limit, filters: { action, userId, from, to }, resultsCount: events.length },
      });

      res.json({
        data: events,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    } catch (err) {
      console.error('[AUDIT] Error listando eventos:', err);
      res.status(500).json({ error: 'Error interno del servidor.' });
    }
  }
);

// ─── GET /api/audit/verify — Verificación criptográfica de la cadena ──────────
auditRouter.get(
  '/audit/verify',
  requireAuth,
  requireRoles(AUDIT_ROLES),
  auditVerifyLimiter,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await verifyAuditChain();

      // Registrar quién solicitó la verificación y el resultado
      void createAuditLog({
        action: 'AUDIT_CHAIN_VERIFIED',
        userId: req.user!.id,
        details: {
          result: result.valid ? 'VALID' : 'CORRUPTED',
          totalEvents: result.totalEvents,
          firstCorruptedId: result.firstCorruptedId ?? null,
          firstCorruptedIndex: result.firstCorruptedIndex ?? null,
          message: result.message,
        },
      });

      // Si la cadena está corrompida, registrar como sospechoso
      if (!result.valid) {
        void createAuditLog({
          action: 'INTEGRITY_VIOLATION_DETECTED',
          userId: req.user!.id,
          details: {
            severity: 'CRITICAL',
            firstCorruptedId: result.firstCorruptedId,
            firstCorruptedIndex: result.firstCorruptedIndex,
            message: result.message,
          },
        });
      }

      res.status(result.valid ? 200 : 409).json(result);
    } catch (err) {
      console.error('[AUDIT] Error verificando cadena:', err);
      res.status(500).json({ error: 'Error interno del servidor.' });
    }
  }
);

// ─── GET /api/audit/:id — Ver detalle de un evento específico ─────────────────
auditRouter.get(
  '/audit/:id',
  requireAuth,
  requireRoles(AUDIT_ROLES),
  auditListLimiter,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const event = await prisma.auditLog.findUnique({
        where: { id: req.params.id },
        include: { user: { select: { id: true, name: true, identifier: true, role: true } } },
      });

      if (!event) {
        res.status(404).json({ error: 'Evento de auditoría no encontrado.' });
        return;
      }

      res.json({ data: event });
    } catch (err) {
      console.error('[AUDIT] Error obteniendo evento:', err);
      res.status(500).json({ error: 'Error interno del servidor.' });
    }
  }
);

// ─── GET /api/audit/poll/:pollId/results — Resultados finales de votación ─────
// Solo disponible cuando la votación está CLOSED. Para secretas, no revela votante→opción.
auditRouter.get(
  '/audit/poll/:pollId/results',
  requireAuth,
  requireRoles([...AUDIT_ROLES, ...ADMIN_ROLES]),
  auditListLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const { pollId } = req.params;

    try {
      const poll = await prisma.poll.findUnique({
        where: { id: pollId },
        include: { options: true },
      });

      if (!poll) {
        res.status(404).json({ error: 'Votación no encontrada.' });
        return;
      }

      if (poll.status !== 'CLOSED') {
        res.status(403).json({ error: 'Los resultados solo están disponibles cuando la votación está CERRADA.' });
        return;
      }

      if (poll.type === 'NOMINAL') {
        // Resultados nominales: quién votó qué
        const votes = await prisma.nominalVote.findMany({
          where: { pollId },
          include: {
            user:   { select: { id: true, name: true, identifier: true } },
            option: { select: { id: true, text: true } },
          },
          orderBy: { createdAt: 'asc' },
        });

        const summary = poll.options.map(opt => ({
          optionId: opt.id,
          text:     opt.text,
          count:    votes.filter(v => v.optionId === opt.id).length,
          voters:   votes.filter(v => v.optionId === opt.id).map(v => ({
            userId:     v.user.id,
            name:       v.user.name,
            identifier: v.user.identifier,
            votedAt:    v.updatedAt,
          })),
        }));

        res.json({ type: 'NOMINAL', pollId, title: poll.title, summary, totalVotes: votes.length });

      } else {
        // Resultados secretos: solo conteos por opción, SIN revelar quién votó qué
        const counts = await Promise.all(
          poll.options.map(async (opt) => ({
            optionId: opt.id,
            text:     opt.text,
            count:    await prisma.secretVote.count({ where: { pollId, optionId: opt.id } }),
          }))
        );

        const totalVoters = await prisma.secretVoterRegistry.count({ where: { pollId } });

        res.json({
          type:         'SECRET',
          pollId,
          title:        poll.title,
          summary:      counts,
          totalVoters,
          note:         'Votación secreta: la identidad de los participantes no se revela por diseño.',
        });
      }
    } catch (err) {
      console.error('[AUDIT] Error obteniendo resultados:', err);
      res.status(500).json({ error: 'Error interno del servidor.' });
    }
  }
);
