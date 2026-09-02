import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { healthRouter } from './routes/health';

export const app = express();

// ─── 1. Seguridad de headers HTTP (Helmet) ───────────────────────────────────
app.use(helmet());

// ─── 2. CORS ─────────────────────────────────────────────────────────────────
const allowedOrigins = [process.env.FRONTEND_URL ?? 'http://localhost:3000'];
app.use(
  cors({
    origin: (origin, callback) => {
      // Permitir requests sin origin (ej: curl, Postman en dev)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: Origen no permitido: ${origin}`));
      }
    },
    credentials: true,
  })
);

// ─── 3. Rate Limiting global ──────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 300,                  // máx 300 requests por IP por ventana
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intente más tarde.' },
});
app.use('/api', globalLimiter);

// ─── 4. Parsers ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ─── 5. Logger HTTP ──────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// ─── 6. Rutas ────────────────────────────────────────────────────────────────
app.use('/api', healthRouter);

// ─── 7. Ruta raíz ────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    sistema: 'Sistema de Votación Institucional',
    version: '1.0.0',
    fase: 'Fase 1 - Infraestructura',
    docs: '/api/health',
  });
});

// ─── 8. Manejo de rutas no encontradas ───────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada.' });
});

// ─── 9. Manejador de errores global ──────────────────────────────────────────
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error('[ERROR]', err.message);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
);
