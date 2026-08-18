#!/usr/bin/env bash
#
# Zettelkasten — setup para self-hosting.
#
# Instala dependências, gera o .env do backend com um JWT_SECRET aleatório,
# compila frontend e backend e (opcionalmente) cria o primeiro usuário admin.
#
# Idempotente: pode rodar quantas vezes quiser. Um .env já existente nunca
# é sobrescrito.
#
# Uso:
#   ./setup.sh
#
# Variáveis opcionais:
#   NODE_HEAP=384   limite de heap do Node no build (use em VPS com pouca RAM)
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '\033[36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[33m!!\033[0m %s\n' "$1"; }
die()  { printf '\033[31mErro:\033[0m %s\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------- dependências

info "Verificando dependências..."

command -v node >/dev/null 2>&1 || die "Node.js não encontrado. Instale Node 20+: https://nodejs.org"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node 20+ é necessário (encontrado: $(node -v))."

command -v pnpm >/dev/null 2>&1 || die "pnpm não encontrado. Instale com: npm install -g pnpm"

command -v go >/dev/null 2>&1 || die "Go não encontrado. Instale Go 1.26+: https://go.dev/dl/"
GO_VER="$(go env GOVERSION | sed 's/^go//')"
GO_MAJOR="${GO_VER%%.*}"
GO_MINOR="$(printf '%s' "$GO_VER" | cut -d. -f2)"
if [ "$GO_MAJOR" -lt 1 ] || { [ "$GO_MAJOR" -eq 1 ] && [ "${GO_MINOR:-0}" -lt 26 ]; }; then
  die "Go 1.26+ é necessário (encontrado: $GO_VER)."
fi

echo "    node $(node -v) · pnpm $(pnpm -v) · go $GO_VER"

# ------------------------------------------------------------------------ .env

if [ -f apps/api/.env ]; then
  info "apps/api/.env já existe — mantido como está."
else
  info "Gerando apps/api/.env com JWT_SECRET aleatório..."

  if command -v openssl >/dev/null 2>&1; then
    SECRET="$(openssl rand -hex 32)"
  elif [ -r /dev/urandom ]; then
    SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  else
    die "Não foi possível gerar um segredo aleatório (instale openssl)."
  fi

  # Reescreve apenas a linha do JWT_SECRET; o resto do .env.example é preservado.
  awk -v secret="$SECRET" \
    '/^JWT_SECRET=/ { print "JWT_SECRET=" secret; next } { print }' \
    apps/api/.env.example > apps/api/.env

  echo "    JWT_SECRET de 256 bits gravado em apps/api/.env"
fi

# ---------------------------------------------------------------- dependências

info "Instalando dependências (pnpm install)..."
pnpm install

# ------------------------------------------------------------------- build web

info "Compilando o frontend (Next.js)..."
NODE_OPTIONS="--max-old-space-size=${NODE_HEAP:-2048}" \
  pnpm --filter @zettelkasten/web build

# ------------------------------------------------------------------- build api

info "Compilando o backend (Go)..."
(cd apps/api && go build -o api ./main.go)

# ------------------------------------------------------------------ admin user

echo
read -r -p "Criar um usuário admin agora? [S/n] " CREATE_ADMIN
CREATE_ADMIN="${CREATE_ADMIN:-S}"

if [[ "$CREATE_ADMIN" =~ ^[SsYy]$ ]]; then
  read -r -p "Usuário: " ADMIN_USER
  [ -n "$ADMIN_USER" ] || die "Usuário não pode ser vazio."

  read -r -s -p "Senha (mín. 8 caracteres): " ADMIN_PASS; echo
  [ "${#ADMIN_PASS}" -ge 8 ] || die "A senha precisa ter ao menos 8 caracteres."

  read -r -s -p "Confirme a senha: " ADMIN_PASS2; echo
  [ "$ADMIN_PASS" = "$ADMIN_PASS2" ] || die "As senhas não conferem."

  (cd apps/api && go run ./cmd/createuser/main.go \
    -username "$ADMIN_USER" -password "$ADMIN_PASS" -role admin)

  unset ADMIN_PASS ADMIN_PASS2
else
  warn "Nenhum usuário criado. Depois rode:"
  echo "    cd apps/api && go run ./cmd/createuser/main.go -username <nome> -password <senha> -role admin"
fi

# ----------------------------------------------------------------------- fim

echo
bold "Setup concluído."
echo "Para iniciar:  ./start.sh"
echo "Depois abra:   http://localhost:3000"
