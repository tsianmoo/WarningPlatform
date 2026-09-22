#!/bin/bash
# ============================================================================
# 店牛预警平台 —— 停止本地服务
#
#   bash scripts/local-stop.sh            # 只停应用
#   STOP_PG=1 bash scripts/local-stop.sh  # 连 PostgreSQL 一起停
# ============================================================================
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PID_FILE="$PROJECT_DIR/logs/server.pid"

if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "${PID:-}" ] && kill -0 "$PID" 2>/dev/null; then
    echo "停止应用进程 $PID ..."
    kill -TERM -- "-$PID" 2>/dev/null || kill -TERM "$PID" 2>/dev/null || true
    sleep 2
    kill -KILL -- "-$PID" 2>/dev/null || true
    echo "✓ 应用已停止"
  else
    echo "应用进程不存在（PID 记录为 ${PID:-空}）"
  fi
  rm -f "$PID_FILE"
else
  echo "未找到 ${PID_FILE}，应用可能未在运行"
fi

if [ "${STOP_PG:-0}" = "1" ]; then
  PG_DATA="${PG_DATA:-/opt/homebrew/var/postgresql@16}"
  PG_CTL="${PG_CTL:-/opt/homebrew/opt/postgresql@16/bin/pg_ctl}"
  if pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
    echo "停止 PostgreSQL ..."
    "$PG_CTL" -D "$PG_DATA" stop -m fast >/dev/null 2>&1 || true
    echo "✓ PostgreSQL 已停止"
  fi
fi
