import { Role } from '@prisma/client';

// Extiende Express Request para incluir el usuario autenticado
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        identifier: string;
        name: string;
        role: Role;
        isActive: boolean;
      };
    }
  }
}
