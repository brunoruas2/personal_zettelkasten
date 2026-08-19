#!/usr/bin/env bash
#
# Zettelkasten — recompila e sobe backend (Go, :3001) e frontend (Next.js, :3000).
#
# Requer que ./setup.sh já tenha rodado ao menos uma vez (gera apps/api/.env
# e, opcionalmente, o primeiro usuário admin).
#
# Ctrl+C derruba os dois processos.
#
# Uso:
#   ./start.sh              # instala deps, recompila web + api, sobe tudo
#   ./start.sh --no-build   # sobe o build existente sem recompilar
#
# Variáveis opcionais:
#   NODE_HEAP=384   limite de heap do Node no build (use em máquina com pouca RAM)
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

info() { printf '\033[36m==>\033[0m %s\n' "$1"; }
die()  { printf '\033[31mErro:\033[0m %s\n' "$1" >&2; exit 1; }

BUILD=1
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    *) die "Argumento desconhecido: $arg (use --no-build)" ;;
  esac
done

if [ "$BUILD" -eq 1 ]; then
  info "Instalando dependências (pnpm install)..."
  pnpm install

  info "Compilando o frontend (Next.js)..."
  NODE_OPTIONS="--max-old-space-size=${NODE_HEAP:-2048}" \
    pnpm --filter @zettelkasten/web build

  info "Compilando o backend (Go)..."
  (cd apps/api && go build -o api ./main.go)
fi

API_BIN="apps/api/api"
[ -f "$API_BIN" ] || API_BIN="apps/api/api.exe"

if [ ! -f "$API_BIN" ] || [ ! -d "apps/web/.next" ]; then
  die "Build ausente. Rode ./start.sh sem --no-build (ou ./setup.sh)."
fi

API_PID=""
cleanup() {
  if [ -n "$API_PID" ] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

info "Iniciando a API Go em http://localhost:3001 ..."
( cd apps/api && exec "./$(basename "$API_BIN")" ) &
API_PID=$!

# Dá um instante para a API abrir a porta / falhar cedo (ex.: banco travado).
sleep 2
kill -0 "$API_PID" 2>/dev/null || die "A API encerrou logo após iniciar. Verifique apps/api/.env e o banco."

info "Iniciando o frontend em http://localhost:3000 ..."
echo
echo "    Web: http://localhost:3000"
echo "    API: http://localhost:3001"
echo "    Ctrl+C para parar os dois."
echo

cd apps/web && pnpm start
