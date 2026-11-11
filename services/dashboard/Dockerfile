# =============================================================================
# Dockerfile — dashboard-component (servicio HTTP del dashboard ejecutivo)
# Multi-stage: build dependencies -> runtime
# node:22-alpine, non-root user, read-only filesystem ready
#
# El componente reutiliza el cliente de Microsoft Graph de excel-reconciler
# (services/excel-reconciler/src/graphClient.js) a través del adaptador
# graphClientAdapter.js. Para que la resolución de imports funcione dentro del
# contenedor, se copian también las dependencias de excel-reconciler (mismas
# librerías que ya usa este servicio: msal-node, axios, axios-retry).
# =============================================================================

# ---- Build stage ----
FROM node:22-alpine AS builder

WORKDIR /app

# Copiar solo package files para cache de capas
COPY dashboard/package*.json ./dashboard/
COPY excel-reconciler/package*.json ./excel-reconciler/

# Instalar dependencias de producción (omitir devDependencies)
RUN cd dashboard && npm ci --omit=dev
RUN cd excel-reconciler && npm ci --omit=dev

# Copiar código fuente
COPY dashboard/src/ ./dashboard/src/
COPY excel-reconciler/src/ ./excel-reconciler/src/
COPY common/ ./common/

# ---- Runtime stage ----
FROM node:22-alpine

WORKDIR /app

# Usuario no-root (node:node existe en la imagen base)
USER node

# Copiar desde builder (ya como usuario node)
COPY --from=builder --chown=node:node /app/dashboard/node_modules ./dashboard/node_modules
COPY --from=builder --chown=node:node /app/dashboard/src ./dashboard/src
COPY --from=builder --chown=node:node /app/dashboard/package.json ./dashboard/package.json
COPY --from=builder --chown=node:node /app/excel-reconciler/node_modules ./excel-reconciler/node_modules
COPY --from=builder --chown=node:node /app/excel-reconciler/src ./excel-reconciler/src
COPY --from=builder --chown=node:node /app/common ./common

# Puerto expuesto (documentación, no se publica en el host)
EXPOSE 3002

# Healthcheck usando node nativo (sin curl)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3002/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

# Comando por defecto
CMD ["node", "dashboard/src/server.js"]
