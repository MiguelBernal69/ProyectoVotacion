# Sistema de Votación Electrónica Institucional

Sistema web para gestión de votaciones electrónicas en sesiones, conferencias, asambleas y reuniones institucionales. Soporta ~70 participantes simultáneos con garantías de seguridad, integridad, auditoría y comunicación en tiempo real.

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | React 19 + Vite + TypeScript + Tailwind CSS |
| Backend | Node.js + Express + TypeScript |
| Tiempo real | Socket.IO (Fase 4) |
| Base de datos | PostgreSQL 15 |
| ORM | Prisma |
| Autenticación | JWT (HttpOnly cookies) |
| Validación | Zod |
| Infraestructura | Docker (solo producción) |

## Fases de implementación

- [x] **Fase 1** — Infraestructura base
- [ ] **Fase 2** — Autenticación, Roles y Usuarios
- [ ] **Fase 3** — Sesiones y Votaciones
- [ ] **Fase 4** — Motor de Votación con tiempo real
- [ ] **Fase 5** — Auditoría y Resultados
- [ ] **Fase 6** — Despliegue y QA

---

## Desarrollo local (sin Docker)

### Requisitos previos

- Node.js 20+
- PostgreSQL 15 instalado localmente
  - **O** solo levantar el contenedor de la BD: `docker compose up db -d`

### 1. Instalar dependencias

```powershell
# Backend
cd backend
npm install

# Frontend
cd ..\frontend
npm install
```

### 2. Configurar variables de entorno

```powershell
# Backend — editar si cambiaste las credenciales de PostgreSQL
# Archivo: backend\.env
DATABASE_URL="postgresql://votacion_user:votacion_pass_change_me@localhost:5432/votacion_db?schema=public"
PORT=4000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
```

### 3. Crear la base de datos y aplicar migraciones

```powershell
# Si usas PostgreSQL local, crea el usuario y la base primero:
psql -U postgres -c "CREATE USER votacion_user WITH PASSWORD 'votacion_pass_change_me';"
psql -U postgres -c "CREATE DATABASE votacion_db OWNER votacion_user;"

# Aplicar migraciones y seed
cd backend
npx prisma migrate dev --name init
npx prisma db seed
```

### 4. Levantar backend y frontend

Abrir **dos terminales**:

```powershell
# Terminal 1 — Backend (http://localhost:4000)
cd backend
npm run dev

# Terminal 2 — Frontend (http://localhost:3000)
cd frontend
npm run dev
```

### 5. Verificar que todo funciona

| URL | Resultado esperado |
|-----|-------------------|
| `http://localhost:3000` | Dashboard de estado del sistema |
| `http://localhost:4000/api/health` | `{ "status": "ok", "database": { "status": "connected" } }` |
| `http://localhost:4000/api/health/db` | `{ "status": "ok", "healthCheckRecords": 1 }` |

---

## Despliegue en producción (Docker)

```powershell
# Desde la raíz del proyecto
docker compose --env-file .env up --build -d

# Primera vez: aplicar migraciones
docker exec votacion_backend npx prisma migrate deploy
```

Servicios expuestos:
- Frontend (nginx): `http://tu-servidor:80`
- Backend (Express): `http://tu-servidor:4000`
- PostgreSQL: `localhost:5432` (interno)

---

## Estructura del proyecto

```text
ProyectoVotacion/
├── docker-compose.yml       # Solo producción
├── .env                     # Variables de entorno (producción)
├── .env.example             # Plantilla
├── .gitignore
├── README.md
│
├── backend/
│   ├── .env                 # Variables locales de desarrollo
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── seed.ts
│   └── src/
│       ├── index.ts         # Bootstrap + graceful shutdown
│       ├── app.ts           # Express + middlewares de seguridad
│       ├── lib/prisma.ts    # Singleton Prisma
│       └── routes/
│           └── health.ts    # GET /api/health, GET /api/health/db
│
└── frontend/
    ├── .env                 # Variables Vite (dev/prod)
    ├── Dockerfile           # Solo producción (nginx)
    ├── index.html
    ├── vite.config.ts       # Proxy /api → backend en dev
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── tsconfig.json
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── index.css
        ├── vite-env.d.ts
        └── pages/
            └── HealthDashboard.tsx
```

## Notas de desarrollo

- **Proxy automático**: Vite proxea `/api/*` → `http://localhost:4000/api/*` en desarrollo. No necesitas configurar CORS en local.
- **Hot-reload**: Tanto Vite (frontend) como `tsx watch` (backend) recargan automáticamente al guardar cambios.
- **Singleton Prisma**: Evita múltiples conexiones a la BD en hot-reload.
- **TypeScript strict**: 0 errores ni `any` implícito en ambos proyectos.

### Configuración de Seguridad (Rate Limit)

Por defecto, el límite estricto de intentos de inicio de sesión ha sido **desactivado** (permitiendo 1000 intentos) en `backend/src/app.ts` para facilitar pruebas en todos los entornos, incluyendo producción. 
Si deseas activar la protección contra fuerza bruta para el despliegue final, el administrador puede habilitarlo modificando el archivo `backend/src/app.ts`:

1. Abre `backend/src/app.ts`
2. Busca la configuración de `loginLimiter`.
3. Cambia el valor de `max` (ej. a `10` para permitir solo 10 intentos cada 15 minutos):

```typescript
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // <- Cambiar de 1000 a 10
  standardHeaders: true,
  legacyHeaders: false,
});
```
4. Reinicia el servidor backend para aplicar los cambios.




















Aplicar las migraciones a la base de datos local y regenerar el cliente: En la carpeta backend, ejecuta:

npx prisma migrate dev

o si la base de datos ya tiene estructura y solo quieres aplicar los archivos de migración pendientes sin prompt interactivo:

npx prisma migrate deploy
npx prisma generate






