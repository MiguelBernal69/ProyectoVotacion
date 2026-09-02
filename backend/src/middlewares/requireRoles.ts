import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';

/**
 * Factory de middleware que verifica que el usuario autenticado
 * tenga alguno de los roles permitidos.
 *
 * Siempre debe usarse DESPUÉS de requireAuth.
 * El rol proviene de req.user (que fue poblado desde la BD),
 * nunca desde el frontend.
 *
 * Uso: router.get('/ruta', requireAuth, requireRoles([Role.ADMIN, Role.SUPERADMIN]), handler)
 */
export function requireRoles(allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'No autenticado.' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: 'Acceso denegado.',
        detail: `Tu rol (${req.user.role}) no tiene permiso para esta acción.`,
        required: allowedRoles,
      });
      return;
    }

    next();
  };
}
