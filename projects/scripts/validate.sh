#!/bin/bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COZE_WORKSPACE_PATH="$PROJECT_DIR"

cd "${COZE_WORKSPACE_PATH}"

echo "🔍 Running validate..."
pnpm validate
echo "✅ Validate passed!"
