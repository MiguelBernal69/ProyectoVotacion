import { Router } from 'express';
import { prisma } from '../lib/prisma';

export const healthRouter = Router();

/**
 * GET /api/health
 * Verifica que el servidor está en pie y puede comunicarse con PostgreSQL.
 */
healthRouter.get('/health', async (_req, res) => {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV ?? 'development',
      database: { status: 'connected', latencyMs: Date.now() - start },
      sistema: 'Sistema de Votación Institucional',
      fase: 'Fase 3 - Autenticación y Autorización',
    });
  } catch (error) {
    console.error('[HEALTH] Fallo al conectar con la base de datos:', error);
    return res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      database: { status: 'disconnected', latencyMs: Date.now() - start },
    });
  }
});

/**
 * GET /api/health/db
 * Verifica que las migraciones están aplicadas consultando una tabla real.
 */
healthRouter.get('/health/db', async (_req, res) => {
  try {
    const count = await prisma.user.count();
    return res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      userCount: count,
      message: 'Base de datos accesible. Migraciones aplicadas correctamente.',
    });
  } catch (error) {
    console.error('[HEALTH/DB] Error al consultar users:', error);
    return res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      message: 'No se pudo acceder a la base de datos.',
    });
  }
});
