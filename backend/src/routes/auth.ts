import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/jwt';
import { requireAuth } from '../middlewares/requireAuth';

export const authRouter = Router();

// ─── Validación de entrada ─────────────────────────────────────────────────
const loginSchema = z.object({
  identifier: z.string().min(1, 'El identificador es requerido.').trim(),
  password:   z.string().min(1, 'La contraseña es requerida.'),
});

const COOKIE_OPTIONS = {
  httpOnly:  true,                                 // El JS del frontend NO puede leer la cookie
  secure:    process.env.NODE_ENV === 'production', // Solo HTTPS en producción
  sameSite:  'strict' as const,                    // Protección CSRF
  maxAge:    4 * 60 * 60 * 1000,                  // 4 horas en milisegundos
};

// ─── POST /api/auth/login ──────────────────────────────────────────────────
authRouter.post('/login', async (req: Request, res: Response): Promise<void> => {
  // 1. Validar payload con Zod
  const result = loginSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Datos inválidos.', details: result.error.flatten() });
    return;
  }

  const { identifier, password } = result.data;

  try {
    // 2. Buscar usuario
    const user = await prisma.user.findUnique({
      where: { identifier },
      select: {
        id: true,
        identifier: true,
        name: true,
        role: true,
        isActive: true,
        passwordHash: true,
        activeSessionId: true,
        lastActiveAt: true,
      },
    });

    // 3. Usuario no encontrado → mismo mensaje que contraseña incorrecta (no revelar existencia)
    if (!user) {
      res.status(401).json({ error: 'Credenciales incorrectas.' });
      return;
    }

    // 4. Cuenta desactivada (mensaje explícito)
    if (!user.isActive) {
      res.status(403).json({ error: 'Cuenta desactivada. Contacte al administrador.' });
      return;
    }

    // 5. Verificar contraseña
    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      res.status(401).json({ error: 'Credenciales incorrectas.' });
      return;
    }

    // 6. Verificar si ya existe una sesión activa registrada en la BD (solo para PARTICIPANTES)
    const isManagerRole = ['SUPERADMIN', 'ADMIN', 'PRESIDENT', 'AUDITOR'].includes(user.role);
    if (user.activeSessionId && !isManagerRole) {
      res.status(409).json({
        error:
          'Ya tienes una sesión activa en otro dispositivo. Por favor, cierra sesión en el anterior dispositivo o contacta a un administrador para liberar tu sesión.',
      });
      return;
    }

    // 7. Generar nuevo ID de sesión e instituirla en la BD
    const newSessionId = crypto.randomUUID();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        activeSessionId: newSessionId,
        lastActiveAt: new Date(),
      },
    });

    // 8. Firmar JWT (contiene userId, role y sessionId)
    const token = signToken({ userId: user.id, role: user.role, sessionId: newSessionId });

    // 9. Inyectar token como cookie HttpOnly (nunca en el body)
    res.cookie('token', token, COOKIE_OPTIONS);

    // 10. Registrar evento de auditoría
    await prisma.auditLog.create({
      data: {
        action: 'USER_LOGIN',
        userId: user.id,
        details: { identifier: user.identifier, role: user.role, sessionId: newSessionId },
        hash: `login-${user.id}-${Date.now()}`,
        previousHash: 'pending-chain',
      },
    });

    // 11. Devolver datos públicos del usuario (sin passwordHash)
    res.status(200).json({
      message: 'Sesión iniciada correctamente.',
      user: {
        id:         user.id,
        identifier: user.identifier,
        name:       user.name,
        role:       user.role,
      },
    });
  } catch (error) {
    console.error('[AUTH] Error en login:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// ─── POST /api/auth/logout ─────────────────────────────────────────────────
authRouter.post('/logout', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (req.user?.id) {
    await prisma.user.update({
      where: { id: req.user.id },
      data: { activeSessionId: null },
    });

    await prisma.auditLog.create({
      data: {
        action: 'USER_LOGOUT',
        userId: req.user.id,
        details: { identifier: req.user.identifier },
        hash: `logout-${req.user.id}-${Date.now()}`,
        previousHash: 'pending-chain',
      },
    });
  }

  res.clearCookie('token', COOKIE_OPTIONS);
  res.status(200).json({ message: 'Sesión cerrada correctamente.' });
});

// ─── GET /api/auth/me ──────────────────────────────────────────────────────
// El frontend usa este endpoint al cargar para saber si la sesión sigue activa
authRouter.get('/me', requireAuth, (req: Request, res: Response): void => {
  res.status(200).json({
    user: req.user,
  });
});
