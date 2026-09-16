#!/bin/bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COZE_WORKSPACE_PATH="$PROJECT_DIR"

cd "${COZE_WORKSPACE_PATH}"

# Oracle 11g 需 Thick 模式：把 Instant Client（含 libaio）打进产物，供 start.sh 使用
bash scripts/vendor-oracle.sh || echo "WARN: vendor-oracle.sh failed (non-fatal), Thick mode may be unavailable"

echo "Installing dependencies..."
pnpm install --prefer-frozen-lockfile --prefer-offline --loglevel debug --reporter=append-only

echo "Building the Next.js project..."
pnpm next build

echo "Bundling server with tsup..."
pnpm tsup src/server.ts --format cjs --platform node --target node20 --outDir dist --no-splitting --no-minify

echo "Build completed successfully!"
