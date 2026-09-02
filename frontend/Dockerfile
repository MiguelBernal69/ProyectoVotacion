# Frontend Dockerfile — solo para DESPLIEGUE en producción
# En desarrollo local: npm run dev (Vite dev server)

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ─── Build estático ────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# VITE_API_URL debe pasarse como build-arg en producción
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ─── Servir con nginx (imagen mínima) ─────────────────────────
FROM nginx:alpine AS production
COPY --from=builder /app/dist /usr/share/nginx/html

# Config nginx para SPA (redirige todas las rutas a index.html)
RUN printf 'server {\n\
    listen 80;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
    # Seguridad\n\
    add_header X-Frame-Options DENY;\n\
    add_header X-Content-Type-Options nosniff;\n\
    add_header Referrer-Policy strict-origin-when-cross-origin;\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
