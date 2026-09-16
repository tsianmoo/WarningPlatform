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
    # Oracle 11g 需要 Thick 模式（Oracle Instant Client libclntsh）。未设置 ORACLE_LIB_DIR 时自动探测常见目录。
    local _oracle_ic_dir=""
    if [ -n "${ORACLE_LIB_DIR:-}" ] && [ -d "${ORACLE_LIB_DIR}" ]; then
      _oracle_ic_dir="${ORACLE_LIB_DIR}"
    else
      _oracle_ic_dir=$(ls -d /opt/oracle/instantclient_* /usr/lib/oracle/*/client64 2>/dev/null | sort -V | tail -1 || true)
    fi
    if [ -n "${_oracle_ic_dir}" ]; then
      export ORACLE_LIB_DIR="${ORACLE_LIB_DIR:-${_oracle_ic_dir}}"
    fi
    export LD_LIBRARY_PATH="${ORACLE_LIB_DIR:-}:${LD_LIBRARY_PATH:-}"
    COZE_PROJECT_ENV=PROD PORT=${DEPLOY_RUN_PORT} node dist/server.js
}

echo "Starting HTTP service on port ${DEPLOY_RUN_PORT} for deploy..."
start_service
