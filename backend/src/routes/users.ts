import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middlewares/requireAuth';
import { requireRoles } from '../middlewares/requireRoles';
import { createAuditLog } from '../lib/audit';

export const usersRouter = Router();

const MANAGER_ROLES = [Role.SUPERADMIN, Role.ADMIN];
const VIEWER_ROLES  = [Role.SUPERADMIN, Role.ADMIN, Role.AUDITOR];

// ─── Validación Zod ─────────────────────────────────────────────────────────

const createUserSchema = z.object({
  identifier: z.string()
    .min(2, 'El identificador debe tener al menos 2 caracteres.')
    .max(50)
    .trim()
    .regex(/^[a-zA-Z0-9._-]+$/, 'Solo se permiten letras, números, puntos, guiones y guiones bajos.'),
  name:     z.string().min(2, 'El nombre debe tener al menos 2 caracteres.').max(100).trim(),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres.'),
  role:     z.nativeEnum(Role, { errorMap: () => ({ message: 'Rol inválido.' }) }),
});

const updateUserSchema = z.object({
  name: z.string().min(2).max(100).trim().optional(),
  role: z.nativeEnum(Role).optional(),
  password: z.string().min(6).optional(),
});

// ─── GET /api/users ──────────────────────────────────────────────────────────
usersRouter.get(
  '/',
  requireAuth,
  requireRoles(VIEWER_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { role, active } = req.query;
      const where: Record<string, unknown> = {};
      if (role && Object.values(Role).includes(role as Role)) {
        where.role = role as Role;
      }
      if (active !== undefined) {
        where.isActive = active === 'true';
      }

      const users = await prisma.user.findMany({
        where,
        select: {
          id: true, identifier: true, name: true,
          role: true, isActive: true, createdAt: true,
          _count: { select: { sessions: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ total: users.length, users });
    } catch (err) {
      console.error('[USERS] Error listando usuarios:', err);
      res.status(500).json({ error: 'Error interno del servidor.' });
    }
  }
);

// ─── POST /api/users ─────────────────────────────────────────────────────────
usersRouter.post(
  '/',
  requireAuth,
  requireRoles(MANAGER_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const result = createUserSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: 'Datos inválidos.', details: result.error.flatten() });
      return;
    }

    const { identifier, name, password, role } = result.data;

    try {
      // Solo SUPERADMIN puede crear SUPERADMIN
      if (role === Role.SUPERADMIN && req.user!.role !== Role.SUPERADMIN) {
        res.status(403).json({ error: 'Solo un SUPERADMIN puede crear otro SUPERADMIN.' });
        return;
      }

      const existing = await prisma.user.findUnique({ where: { identifier } });
      if (existing) {
        res.status(409).json({ error: `El identificador "${identifier}" ya está en uso.` });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const user = await prisma.user.create({
        data:   { identifier, name, passwordHash, role },
        select: { id: true, identifier: true, name: true, role: true, isActive: true, createdAt: true },
      });

      await createAuditLog({
        action: 'USER_CREATED',
        userId: req.user!.id,
        details: { createdUserId: user.id, identifier: user.identifier, role: user.role },
      });

      res.status(201).json({ message: 'Usuario creado correctamente.', user });
    } catch (err) {
      console.error('[USERS] Error creando usuario:', err);
      res.status(500).json({ error: 'Error interno del servidor.' });
    }
  }
);

// ─── GET /api/users/:id ──────────────────────────────────────────────────────
usersRouter.get(
  '/:id',
  requireAuth,
  requireRoles(VIEWER_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = await prisma.user.findUnique({
        where:  { id: req.params.id },
        select: {
          id: true, identifier: true, name: true,
          role: true, isActive: true, createdAt: true,
          sessions: {
            select: {
              isPresent: true,
              session: { select: { id: true, title: true, status: true } },
            },
          },
        },
      });

      if (!user) { res.status(404).json({ error: 'Usuario no encontrado.' }); return; }

      res.json({ user });
    } catch (err) {
      console.error('[USERS] Error obteniendo usuario:', err);
      res.status(500).json({ error: 'Error interno del servidor.' });
    }
  }
);

// ─── PATCH /api/users/:id ────────────────────────────────────────────────────
usersRouter.patch(
  '/:id',
  requireAuth,
  requireRoles(MANAGER_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const result = updateUserSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: 'Datos inválidos.', details: result.error.flatten() });
      return;
    }

    try {
      const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (!existing) { res.status(404).json({ error: 'Usuario no encontrado.' }); return; }

      // Un ADMIN no puede cambiar el rol de un SUPERADMIN
      if (existing.role === Role.SUPERADMIN && req.user!.role !== Role.SUPERADMIN) {
        res.status(403).json({ error: 'No tienes permiso para editar a un SUPERADMIN.' });
        return;
      }

      // Un ADMIN no puede asignar el rol de SUPERADMIN
      if (result.data.role === Role.SUPERADMIN && req.user!.role !== Role.SUPERADMIN) {
        res.status(403).json({ error: 'Solo un SUPERADMIN puede asignar el rol de SUPERADMIN.' });
        return;
      }

      const updateData: Record<string, unknown> = {};
      if (result.data.name)     updateData.name = result.data.name;
      if (result.data.role)     updateData.role = result.data.role;
      if (result.data.password) updateData.passwordHash = await bcrypt.hash(result.data.password, 12);

      const user = await prisma.user.update({
        where:  { id: req.params.id },
        data:   updateData,
        select: { id: true, identifier: true, name: true, role: true, isActive: true },
      });

      await createAuditLog({
        action: 'USER_UPDATED',
        userId: req.user!.id,
        details: {
          targetUserId: user.id,
          updatedFields: Object.keys(updateData).filter(k => k !== 'passwordHash'),
        },
      });

      res.json({ message: 'Usuario actualizado.', user });
    } catch (err) {
      console.error('[USERS] Error actualizando usuario:', err);
      res.status(500).json({ error: 'Error interno del servidor.' });
    }
  }
);

// ─── PATCH /api/users/:id/status ────────────────────────────────────────────
usersRouter.patch(
  '/:id/status',
  requireAuth,
  requireRoles(MANAGER_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const schema = z.object({ isActive: z.boolean() });
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: 'Se requiere el campo "isActive" (boolean).' });
      return;
    }

    try {
      const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (!existing) { res.status(404).json({ error: 'Usuario no encontrado.' }); return; }

      // Nadie puede desactivar su propia cuenta
      if (existing.id === req.user!.id) {
        res.status(409).json({ error: 'No puedes activar/desactivar tu propia cuenta.' });
        return;
      }

      // ADMIN no puede desactivar a un SUPERADMIN
      if (existing.role === Role.SUPERADMIN && req.user!.role !== Role.SUPERADMIN) {
        res.status(403).json({ error: 'No tienes permiso para modificar a un SUPERADMIN.' });
        return;
      }

      const user = await prisma.user.update({
        where:  { id: req.params.id },
        data:   { isActive: result.data.isActive },
        select: { id: true, identifier: true, name: true, role: true, isActive: true },
      });

      await createAuditLog({
        action: result.data.isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
        userId: req.user!.id,
        details: { targetUserId: user.id, identifier: user.identifier },
      });

      res.json({
        message: `Usuario ${result.data.isActive ? 'activado' : 'desactivado'} correctamente.`,
        user,
      });
    } catch (err) {
      console.error('[USERS] Error cambiando estado de usuario:', err);
      res.status(500).json({ error: 'Error interno del servidor.' });
    }
  }
);
