#!/bin/bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COZE_WORKSPACE_PATH="$PROJECT_DIR"

# macOS 上 5000 端口默认被「隔空播放接收器」(ControlCenter) 占用，
# 因此这里允许用 PORT / DEPLOY_RUN_PORT 覆盖，避免生产启动直接撞端口。
PORT="${PORT:-5000}"
DEPLOY_RUN_PORT="${DEPLOY_RUN_PORT:-$PORT}"


start_service() {
    cd "${COZE_WORKSPACE_PATH}"
    echo "Starting HTTP service on port ${DEPLOY_RUN_PORT} for deploy..."
    # Oracle 11g 需要 Thick 模式（Instant Client）。优先用构建产物的 .oracle_ic，其次环境变量，再本地目录。
    _ic_dir=""
    if [ -d "${COZE_WORKSPACE_PATH}/.oracle_ic/instantclient_19_24" ]; then
      _ic_dir="${COZE_WORKSPACE_PATH}/.oracle_ic/instantclient_19_24"
    elif [ -d /opt/oracle/instantclient_19_24 ]; then
      _ic_dir="/opt/oracle/instantclient_19_24"
    elif [ -n "${ORACLE_LIB_DIR:-}" ] && [ -d "${ORACLE_LIB_DIR}" ]; then
      _ic_dir="${ORACLE_LIB_DIR}"
    fi
    if [ -n "${_ic_dir}" ]; then
      export ORACLE_LIB_DIR="${_ic_dir}"
      export LD_LIBRARY_PATH="${_ic_dir}:${LD_LIBRARY_PATH:-}"
    fi
    COZE_PROJECT_ENV=PROD PORT=${DEPLOY_RUN_PORT} node dist/server.js
}

echo "Starting HTTP service on port ${DEPLOY_RUN_PORT} for deploy..."
start_service
