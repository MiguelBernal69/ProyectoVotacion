import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { adminRouter } from './routes/admin';
import { sessionsRouter } from './routes/sessions';
import { usersRouter } from './routes/users';
import { pollsRouter } from './routes/polls';
import { votesRouter } from './routes/votes';
import { auditRouter } from './routes/audit';
import { resultsRouter } from './routes/results';

export const app = express();

// ─── 1. Seguridad de headers HTTP (Helmet) ───────────────────────────────────
app.use(helmet());

// ─── 2. CORS con soporte de cookies ──────────────────────────────────────────
const allowedOrigins = [process.env.FRONTEND_URL ?? 'http://localhost:3000'];
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: Origen no permitido: ${origin}`));
      }
    },
    credentials: true, // Necesario para enviar/recibir cookies cross-origin
  })
);

// ─── 3. Cookie Parser ─────────────────────────────────────────────────────────
// Debe ir antes de los middlewares que leen req.cookies
app.use(cookieParser());

// ─── 4. Rate Limiting ─────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 10000 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intente más tarde.' },
});
app.use('/api', globalLimiter);

// Rate limiting estricto para el endpoint de login (contra fuerza bruta)
// Se desactiva en entorno de test para no bloquear la suite de pruebas
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de inicio de sesión. Espere 15 minutos.' },
});
app.use('/api/auth/login', loginLimiter);

// ─── 5. Parsers ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ─── 6. Logger HTTP ───────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// ─── 7. Rutas ─────────────────────────────────────────────────────────────────
app.use('/api', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/users', usersRouter);
app.use('/api', pollsRouter);
app.use('/api', votesRouter);
app.use('/api', auditRouter);
app.use('/api', resultsRouter);

// ─── 8. Ruta raíz ─────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    sistema: 'Sistema de Votación Institucional',
    version: '1.0.0',
    fase: 'Fase 5 - Configuración de Votaciones',
  });
});

// ─── 9. Ruta no encontrada ────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada.' });
});

// ─── 10. Manejador de errores global ─────────────────────────────────────────

// Body-parser lanza SyntaxError cuando el JSON está malformado.
// Capturarlo aquí devuelve 400 en lugar de 500.
app.use(
  (
    err: Error & { status?: number; type?: string },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      res.status(400).json({ error: 'JSON malformado en el cuerpo de la solicitud.' });
      return;
    }
    // Errores explícitos con status (e.g., express-rate-limit, etc.)
    if (err.status && err.status >= 400 && err.status < 500) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('[ERROR]', err.message);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
);
