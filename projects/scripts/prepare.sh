#!/bin/bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COZE_WORKSPACE_PATH="$PROJECT_DIR"

cd "${COZE_WORKSPACE_PATH}"

echo "Installing dependencies..."
pnpm install --prefer-frozen-lockfile --prefer-offline --loglevel debug --reporter=append-only
if command -v coze-dev > /dev/null 2>&1 && coze-dev check-bins --help > /dev/null 2>&1; then
  coze-dev check-bins --fix
fi
