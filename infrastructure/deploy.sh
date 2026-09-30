#!/bin/bash
# =============================================================================
# deploy.sh — Script de despliegue inicial en VPS
# =============================================================================
# Uso: bash deploy.sh
# Prerrequisitos: Docker + Docker Compose instalados, dominio apuntando al VPS
# =============================================================================

set -euo pipefail

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
step() { echo -e "\n${BLUE}==>${NC} $1"; }

# ---------------------------------------------------------------------------
step "1. Verificación de prerrequisitos"
# ---------------------------------------------------------------------------
command -v docker >/dev/null 2>&1 || error "Docker no encontrado. Instala Docker primero."
command -v docker compose >/dev/null 2>&1 || error "Docker Compose v2 no encontrado."

# ---------------------------------------------------------------------------
step "2. Creando directorios de volúmenes persistentes"
# ---------------------------------------------------------------------------
VOLUMES_BASE="/opt/n8n-fintech"
mkdir -p "${VOLUMES_BASE}/postgres"
mkdir -p "${VOLUMES_BASE}/n8n"
mkdir -p "${VOLUMES_BASE}/traefik/certs"

# Permisos: n8n corre como usuario 'node' (UID 1000)
chown -R 1000:1000 "${VOLUMES_BASE}/n8n"
# acme.json de Traefik DEBE tener permisos 600
touch "${VOLUMES_BASE}/traefik/certs/acme.json"
chmod 600 "${VOLUMES_BASE}/traefik/certs/acme.json"

log "Directorios creados en ${VOLUMES_BASE}"

# ---------------------------------------------------------------------------
step "3. Verificando archivo .env"
# ---------------------------------------------------------------------------
if [ ! -f ".env" ]; then
    cp .env.example .env
    warn "Archivo .env creado desde .env.example"
    warn "⚠️  DEBES configurar todas las variables antes de continuar."
    warn "Edita el archivo: nano .env"
    exit 1
fi

# Verificar que las variables críticas no sean los valores placeholder
CRITICAL_VARS=(
    "POSTGRES_PASSWORD"
    "N8N_BASIC_AUTH_PASSWORD"
    "N8N_ENCRYPTION_KEY"
    "DOMAIN_NAME"
)

for VAR in "${CRITICAL_VARS[@]}"; do
    VALUE=$(grep "^${VAR}=" .env | cut -d'=' -f2-)
    if [[ "$VALUE" == *"REEMPLAZAR"* ]] || [ -z "$VALUE" ]; then
        error "Variable ${VAR} no configurada en .env. Edita el archivo primero."
    fi
done

log "Variables de entorno verificadas ✓"

# ---------------------------------------------------------------------------
step "4. Verificando permisos del archivo .env"
# ---------------------------------------------------------------------------
chmod 600 .env
log "Permisos de .env establecidos en 600 ✓"

# ---------------------------------------------------------------------------
step "5. Levantando los servicios"
# ---------------------------------------------------------------------------
log "Arrancando Traefik..."
docker compose up -d traefik
sleep 5

log "Arrancando PostgreSQL..."
docker compose up -d postgres
log "Esperando que PostgreSQL esté listo (máx. 60s)..."
timeout 60 bash -c 'until docker compose exec -T postgres pg_isready -U ${POSTGRES_USER:-n8n_user} 2>/dev/null; do sleep 2; done'

log "Arrancando n8n..."
docker compose up -d n8n

# ---------------------------------------------------------------------------
step "6. Estado final de los servicios"
# ---------------------------------------------------------------------------
docker compose ps

DOMAIN=$(grep "^DOMAIN_NAME=" .env | cut -d'=' -f2-)
echo ""
echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}  Despliegue completado exitosamente ✓  ${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""
echo -e "🌐 n8n URL:      ${BLUE}https://${DOMAIN}${NC}"
echo -e "🔧 Traefik:      ${BLUE}https://traefik.${DOMAIN}${NC}"
echo ""
echo -e "${YELLOW}⚠️  Notas de cumplimiento Ley 1581/2012:${NC}"
echo -e "   • Guarda N8N_ENCRYPTION_KEY en un gestor de secretos seguro."
echo -e "   • Implementa backups cifrados de /opt/n8n-fintech/postgres"
echo -e "   • Revisa logs de acceso en Traefik periódicamente."
echo -e "   • Configura alertas de seguridad en tu SIEM/SOC."
