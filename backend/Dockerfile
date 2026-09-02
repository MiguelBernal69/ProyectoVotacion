FROM node:20-alpine AS base
WORKDIR /app

# ─── Instalar dependencias ────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

# ─── Desarrollo (hot-reload con tsx watch) ───────────────────────────────────
FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generar cliente Prisma
RUN npx prisma generate
EXPOSE 4000
CMD ["npm", "run", "dev"]

# ─── Build de producción ──────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# ─── Imagen de producción (mínima) ───────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY package.json .
EXPOSE 4000
CMD ["node", "dist/index.js"]
