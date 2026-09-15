import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/jwt';
import { prisma } from '../lib/prisma';

/**
 * Middleware que verifica el JWT en la cookie HttpOnly.
 * Si es válido, añade req.user con datos frescos de la BD.
 * El backend nunca confía en datos del frontend para roles.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.token as string | undefined;

  if (!token) {
    res.status(401).json({ error: 'No autenticado. Se requiere sesión activa.' });
    return;
  }

  try {
    const payload = verifyToken(token);

    // Siempre verificar contra la BD para obtener datos actuales y verificar isActive y activeSessionId
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        identifier: true,
        name: true,
        role: true,
        isActive: true,
        activeSessionId: true,
      },
    });

    if (!user) {
      res.status(401).json({ error: 'Usuario no encontrado. El token es inválido.' });
      return;
    }

    if (!user.isActive) {
      res.clearCookie('token');
      res.status(403).json({ error: 'Cuenta desactivada. Contacte al administrador.' });
      return;
    }

    // Verificar si la sesión guardada en la cookie aún coincide con la sesión activa en BD
    if (payload.sessionId && payload.sessionId !== user.activeSessionId) {
      res.clearCookie('token');
      res.status(401).json({ error: 'Tu sesión ha sido cerrada o liberada en este dispositivo.' });
      return;
    }

    // Actualizar última actividad sin bloquear
    void prisma.user.update({
      where: { id: user.id },
      data: { lastActiveAt: new Date() },
    }).catch(() => {});

    req.user = user;
    next();
  } catch {
    // Token expirado, malformado o firma inválida
    res.clearCookie('token');
    res.status(401).json({ error: 'Sesión inválida o expirada. Por favor, inicie sesión de nuevo.' });
  }
}
