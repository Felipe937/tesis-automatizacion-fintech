# =============================================================================
# Dockerfile — excel-reconciler HTTP Service
# Multi-stage: build dependencies -> runtime
# node:22-alpine, non-root user, read-only filesystem ready
# =============================================================================

# ---- Build stage ----
FROM node:22-alpine AS builder

WORKDIR /app

# Copiar solo package files para cache de capas
COPY package*.json ./

# Instalar dependencias de producción (omitir devDependencies)
RUN npm ci --omit=dev

# Copiar código fuente
COPY src/ ./src/

# ---- Runtime stage ----
FROM node:22-alpine

WORKDIR /app

# Usuario no-root (node:node existe en la imagen base)
USER node

# Copiar desde builder (ya como usuario node)
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/package.json ./package.json

# Puerto expuesto (documentación, no publica en host)
EXPOSE 3000

# Healthcheck usando node nativo (sin curl)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

# Comando por defecto
CMD ["node", "src/server.js"]