#!/bin/bash
set -e

export PATH=$PATH:/usr/local/go/bin

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_DIR"

echo "==> Pulling latest changes..."
git pull origin main

echo "==> Installing dependencies..."
pnpm install

echo "==> Building web app..."
NODE_OPTIONS="--max-old-space-size=384" pnpm --filter @zettelkasten/web build

echo "==> Building Go API..."
cd apps/api
go build -o api ./main.go
cd "$REPO_DIR"

echo "==> Restarting web app..."
pm2 restart zettelkasten

echo "==> Restarting Go API..."
pm2 restart zettelkasten-api

echo "==> Done!"
pm2 status
