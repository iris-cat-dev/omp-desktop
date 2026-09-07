#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$ROOT_DIR/packages/app"
PROJECT_NAME="${CF_PAGES_PROJECT:-omp-desktop}"
BRANCH="${CF_PAGES_BRANCH:-main}"

cd "$ROOT_DIR"

echo "==> Building web export"
npm run build:web --workspace=@omp-desktop/app

echo "==> Deploying to Cloudflare Pages ($PROJECT_NAME @ $BRANCH)"
(
  cd "$APP_DIR"
  npx wrangler pages deploy dist \
    --project-name "$PROJECT_NAME" \
    --branch "$BRANCH" \
    --commit-dirty=true
)

echo "==> Done: https://${PROJECT_NAME}.pages.dev"
