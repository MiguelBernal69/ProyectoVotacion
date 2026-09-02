import { Router, Request, Response } from 'express';
import { Role } from '@prisma/client';
import { requireAuth } from '../middlewares/requireAuth';
import { requireRoles } from '../middlewares/requireRoles';

export const adminRouter = Router();

/**
 * GET /api/admin/test
 * Endpoint de prueba para validar protección de roles SUPERADMIN y ADMIN.
 * Un PARTICIPANT que intente acceder recibirá 403.
 */
adminRouter.get(
  '/test',
  requireAuth,
  requireRoles([Role.SUPERADMIN, Role.ADMIN]),
  (_req: Request, res: Response): void => {
    res.status(200).json({
      message: 'Acceso administrativo correcto.',
      allowedRoles: [Role.SUPERADMIN, Role.ADMIN],
    });
  }
);

/**
 * POST /api/admin/data
 * Simula una operación de modificación de datos.
 * Solo SUPERADMIN y ADMIN pueden modificar.
 * AUDITOR puede ver, pero NO puede modificar.
 */
adminRouter.post(
  '/data',
  requireAuth,
  requireRoles([Role.SUPERADMIN, Role.ADMIN]),
  (_req: Request, res: Response): void => {
    res.status(200).json({
      message: 'Datos modificados correctamente. (Simulación)',
    });
  }
);

/**
 * GET /api/admin/audit
 * Los AUDITORES pueden leer esta ruta pero NO pueden modificar datos.
 */
adminRouter.get(
  '/audit',
  requireAuth,
  requireRoles([Role.SUPERADMIN, Role.ADMIN, Role.AUDITOR]),
  (_req: Request, res: Response): void => {
    res.status(200).json({
      message: 'Acceso al registro de auditoría concedido.',
      user: _req.user,
    });
  }
);
