# Sistema de Votación Electrónica Institucional

Sistema web para gestión de votaciones electrónicas en sesiones, conferencias, asambleas y reuniones institucionales. Soporta participantes simultáneos con garantías de seguridad, integridad, auditoría y comunicación en tiempo real.

## Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | React 19 + Vite + TypeScript + Tailwind CSS |
| Backend | Node.js + Express + TypeScript |
| Tiempo real | Socket.IO |
| Base de datos | PostgreSQL 15 |
| ORM | Prisma |
| Autenticación | JWT (HttpOnly cookies) |
| Validación | Zod |
| Infraestructura | Docker (Docker Compose + Nginx) |

---

## 🚀 Despliegue Temporal en Servidor Compartido (`app.med.umss.edu.bo` / `10.80.16.15`)

Dado que el servidor ya tiene páginas o servicios activos en el puerto **80**, este sistema está preconfigurado para ejecutarse de forma **100% aislada en el Puerto 8080**, sin interferir ni tocar los servicios existentes en el servidor.

### 1. Requisitos Previos en el Servidor
- Tener instalado **Docker** y **Docker Compose**.

### 2. Iniciar el Sistema (Despliegue)

Ejecuta desde la raíz del proyecto en el servidor:

```bash
docker compose --env-file .env up --build -d
```

### 3. Direcciones de Acceso
Una vez levantado, los usuarios accederán mediante:
- **Dominio**: `http://app.med.umss.edu.bo:8080`
- **IP Local**: `http://10.80.16.15:8080`

*(El sitio web principal en `http://app.med.umss.edu.bo/` continuará funcionando normalmente sin ninguna interrupción).*

---

## 🧹 Cómo Eliminar el Sistema después de las 3 Semanas

Cuando concluyan las 3 semanas de votación y quieras retirar el sistema completamente del servidor sin dejar ningún residuo ni afectar a otros servicios:

```bash
# 1. Detener y eliminar contenedores, redes y datos del sistema de votación:
docker compose down -v

# 2. Borrar la carpeta del proyecto (opcional):
rm -rf ProyectoVotacion
```

---

## 🔑 Credenciales de Acceso por Defecto (Seed)

| Rol | Usuario | Contraseña | Descripción |
|-----|---------|------------|-------------|
| **SUPERADMIN** | `admin` | `admin123` | Control total del sistema y usuarios |
| **ADMIN** | `admin2` | `admin123` | Creación de sesiones y puntos a votar |
| **PRESIDENT** | `presidente1` | `presi123` | Moderador de sesión *(Sin emisión de voto)* |
| **AUDITOR** | `auditor1` | `audit123` | Consulta de auditoría y actas SHA-256 |
| **PARTICIPANT** | `voto1` | `voto123` | Congresista / Votante habilitado |
| **PARTICIPANT** | `voto2` | `voto123` | Congresista / Votante habilitado |

---

## ⚙️ Variables de Entorno (`.env`)

```env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=ProyVotacion2026_SecurePass!
POSTGRES_DB=votacion_db
DATABASE_URL="postgresql://postgres:ProyVotacion2026_SecurePass!@db:5432/votacion_db?schema=public"

FRONTEND_PORT=8080
BACKEND_PORT=4000
FRONTEND_URL=http://app.med.umss.edu.bo:8080
NODE_ENV=production

JWT_SECRET=prod_a8f9c2d1e3b5467089123456789abcdef0123456789abcdef0123456789abcdef
JWT_EXPIRES_IN=8h
VITE_API_URL=/api
```
