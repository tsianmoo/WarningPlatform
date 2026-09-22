#!/bin/bash
# ============================================================================
# 店牛预警平台 —— 本地一键启动
#
#   1. 确保本机 PostgreSQL 16 在跑（没跑就拉起来）
#   2. 应用数据库迁移 + 初始化管理员账号（幂等）
#   3. 以脱离会话的方式启动 Next.js 服务，日志落到 logs/app.log
#
# 用法:
#   bash scripts/local-start.sh              # 默认端口 3100
#   PORT=8080 bash scripts/local-start.sh    # 指定端口
#   DN_KEEP_HOME=1 bash scripts/local-start.sh   # 不改 HOME（默认会改，见下）
#
# 关于 HOME：Next.js 会把偏好文件写到 ~/Library/Preferences/nextjs-nodejs/。
# 在受限/沙箱环境里这个路径可能不可写（EPERM）。因此默认把 HOME 指向项目内的
# .next-home，让整套运行时自包含。设 DN_KEEP_HOME=1 可保持真实 HOME。
# ============================================================================
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

PORT="${PORT:-3100}"
BIND_HOST="${BIND_HOST:-127.0.0.1}"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/app.log"
PID_FILE="$LOG_DIR/server.pid"
PG_DATA="${PG_DATA:-/opt/homebrew/var/postgresql@16}"
PG_CTL="${PG_CTL:-/opt/homebrew/opt/postgresql@16/bin/pg_ctl}"

NODE_BIN="${NODE_BIN:-$(command -v node)}"
TSX_BIN="$PROJECT_DIR/node_modules/.bin/tsx"

# 初始密码以 .env.local 为准（脚本只负责显示，不再硬编码）
INIT_PWD="$(sed -n 's/^DEFAULT_INITIAL_PASSWORD=//p' "$PROJECT_DIR/.env.local" 2>/dev/null | tail -1)"
INIT_PWD="${INIT_PWD:-wi15afvb}"

mkdir -p "$LOG_DIR"

if [ ! -x "$TSX_BIN" ]; then
  echo "错误：未找到 $TSX_BIN，请先在项目目录执行依赖安装（pnpm install）。" >&2
  exit 1
fi
if [ ! -f "$PROJECT_DIR/.env.local" ]; then
  echo "错误：缺少 .env.local（数据库连接与会话密钥），无法启动。" >&2
  exit 1
fi

# ---------- 1. PostgreSQL ----------
echo "[1/4] 检查 PostgreSQL ..."
if ! pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
  echo "      PostgreSQL 未运行，尝试启动（${PG_DATA}）"
  if [ -d "$PG_DATA" ] && [ -x "$PG_CTL" ]; then
    "$PG_CTL" -D "$PG_DATA" -l "$LOG_DIR/postgres.log" start >/dev/null 2>&1 || true
    for _ in $(seq 1 20); do
      pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1 && break
      sleep 1
    done
  fi
fi
if ! pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
  echo "      错误：PostgreSQL 仍不可用，详见 $LOG_DIR/postgres.log" >&2
  exit 1
fi
echo "      ✓ 已就绪 127.0.0.1:5432"

# ---------- 2. 迁移 + 管理员 ----------
echo "[2/4] 应用数据库迁移 ..."
"$NODE_BIN" scripts/db.mjs migrate
echo "[3/4] 确保管理员账号存在 ..."
"$NODE_BIN" scripts/seed.mjs

# ---------- 3. 回收旧进程 ----------
if [ -f "$PID_FILE" ]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "${OLD_PID:-}" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "      停止旧进程 $OLD_PID"
    kill -TERM -- "-$OLD_PID" 2>/dev/null || kill -TERM "$OLD_PID" 2>/dev/null || true
    sleep 1
    kill -KILL -- "-$OLD_PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi
# 端口被别的进程占着就直接退出，避免误杀
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "错误：端口 $PORT 已被占用，请换一个（PORT=xxxx ...）或先停掉占用进程。" >&2
  exit 1
fi

# ---------- 4. 启动服务 ----------
echo "[4/4] 启动服务（端口 ${PORT}）..."
: > "$LOG_FILE"

export PORT="$PORT"
export HOSTNAME="$BIND_HOST"
export NEXT_TELEMETRY_DISABLED=1
if [ "${DN_KEEP_HOME:-0}" != "1" ]; then
  export HOME="$PROJECT_DIR/.next-home"
fi
mkdir -p "$HOME"

SERVER_PID="$("$NODE_BIN" -e '
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const [cwd, logFile, cmd, ...args] = process.argv.slice(1);
const fd = fs.openSync(logFile, "a");
const child = spawn(cmd, args, {
  cwd, env: process.env, detached: true, stdio: ["ignore", fd, fd],
});
child.unref();
process.stdout.write(String(child.pid));
' "$PROJECT_DIR" "$LOG_FILE" "$TSX_BIN" src/server.ts)"

if [ -z "${SERVER_PID:-}" ]; then
  echo "错误：启动失败，未取得进程号。日志尾部：" >&2
  tail -n 30 "$LOG_FILE" >&2 || true
  exit 1
fi
echo "$SERVER_PID" > "$PID_FILE"

# 就绪探测（最多 60s，首轮编译较慢）
for i in $(seq 1 60); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "错误：服务进程已退出。日志尾部：" >&2
    tail -n 30 "$LOG_FILE" >&2 || true
    rm -f "$PID_FILE"
    exit 1
  fi
  if (exec 3<>"/dev/tcp/$BIND_HOST/$PORT") >/dev/null 2>&1; then
    exec 3<&- 2>/dev/null || true
    echo ""
    echo "✓ 启动成功"
    echo "  地址   : http://$BIND_HOST:$PORT"
    echo "  登录   : admin / ${INIT_PWD} （首次登录会强制改密）"
    echo "  进程号 : $SERVER_PID"
    echo "  日志   : $LOG_FILE"
    echo "  停止   : bash scripts/local-stop.sh"
    exit 0
  fi
  sleep 1
done

echo "错误：$PORT 端口在 60s 内未就绪。日志尾部：" >&2
tail -n 30 "$LOG_FILE" >&2 || true
exit 1
