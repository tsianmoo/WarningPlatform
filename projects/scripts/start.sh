#!/bin/bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COZE_WORKSPACE_PATH="$PROJECT_DIR"

PORT=5000
DEPLOY_RUN_PORT="${DEPLOY_RUN_PORT:-$PORT}"


start_service() {
    cd "${COZE_WORKSPACE_PATH}"
    echo "Starting HTTP service on port ${DEPLOY_RUN_PORT} for deploy..."
    # Oracle 11g 需要 Thick 模式（Instant Client）。沙箱默认指向已安装的 Instant Client，部署时可用环境变量覆盖。
    if [ -d /opt/oracle/instantclient_19_24 ]; then
      export ORACLE_LIB_DIR="${ORACLE_LIB_DIR:-/opt/oracle/instantclient_19_24}"
    fi
    export LD_LIBRARY_PATH="${ORACLE_LIB_DIR:-}:${LD_LIBRARY_PATH:-}"
    COZE_PROJECT_ENV=PROD PORT=${DEPLOY_RUN_PORT} node dist/server.js
}

echo "Starting HTTP service on port ${DEPLOY_RUN_PORT} for deploy..."
start_service
