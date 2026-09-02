import { Router } from 'express';
import { prisma } from '../lib/prisma';

export const healthRouter = Router();

/**
 * GET /api/health
 * Verifica que el servidor está en pie y puede comunicarse con PostgreSQL.
 * Esta ruta es pública y se usa para monitoreo y pruebas de la Fase 1.
 */
healthRouter.get('/health', async (_req, res) => {
  const start = Date.now();

  try {
    // Consulta mínima para comprobar conectividad real con PostgreSQL
    await prisma.$queryRaw`SELECT 1`;

    const latencyMs = Date.now() - start;

    return res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV ?? 'development',
      database: {
        status: 'connected',
        latencyMs,
      },
      sistema: 'Sistema de Votación Institucional',
      fase: 'Fase 1 - Infraestructura',
    });
  } catch (error) {
    const latencyMs = Date.now() - start;
    console.error('[HEALTH] Fallo al conectar con la base de datos:', error);

    return res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      database: {
        status: 'disconnected',
        latencyMs,
      },
      message: 'No se pudo conectar a la base de datos.',
    });
  }
});

/**
 * GET /api/health/db
 * Verifica además que las migraciones de Prisma han sido aplicadas
 * consultando la tabla HealthCheck creada en la Fase 1.
 */
healthRouter.get('/health/db', async (_req, res) => {
  try {
    const count = await prisma.healthCheck.count();

    return res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      healthCheckRecords: count,
      message: 'Tabla health_checks accesible. Migraciones aplicadas correctamente.',
    });
  } catch (error) {
    console.error('[HEALTH/DB] Error al consultar health_checks:', error);

    return res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      message:
        'No se pudo acceder a la tabla health_checks. ¿Se aplicaron las migraciones?',
    });
  }
});
