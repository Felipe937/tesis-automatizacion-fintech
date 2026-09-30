# Desarrollo Local con Docker Desktop (Windows)

## Prerrequisitos
- Docker Desktop con WSL2 habilitado
- `mkcert` instalado (`choco install mkcert` o `scoop install mkcert`)

## Generar certificados de desarrollo

```bash
# 1. Instalar CA local en el sistema (una sola vez)
mkcert -install

# 2. Generar certificado para localhost, n8n.localhost, traefik.localhost
#    Desde la carpeta infrastructure/
mkcert -cert-file config/traefik/certs/localhost.pem \
       -key-file config/traefik/certs/localhost-key.pem \
       localhost n8n.localhost traefik.localhost
```

## Levantar el stack de desarrollo

```bash
# Desde la carpeta infrastructure/
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

## Accesos
- **n8n Editor**: https://n8n.localhost/
- **Traefik Dashboard**: https://traefik.localhost/ (credenciales en `.env`)

## Hosts (Windows)
`mkcert` configura la resolución automáticamente para `*.localhost` → `127.0.0.1`.
No necesitas editar `C:\Windows\System32\drivers\etc\hosts`.

## Detener
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
```

## Notas
- Los certificados en `config/traefik/certs/` son **solo desarrollo** (`.gitignore`).
- No hay Let's Encrypt, no hay HSTS, rate limits altos.
- Para producción usa solo `docker-compose.yml` con dominio real y DNS.