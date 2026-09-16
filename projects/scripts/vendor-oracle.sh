#!/bin/bash
# 将 Oracle Instant Client（含 libaio）就绪到 ${PROJECT_DIR}/.oracle_ic/instantclient_19_24，
# 使 oracle.ts 的 Thick 模式与 start.sh/dev.sh 都能在无系统级安装的情况下直接使用。
# 幂等：已存在产物则跳过；首选项 = $ORACLE_LIB_DIR > 本地已有 IC 目录 > 联网下载。
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VENDOR_DIR="${PROJECT_DIR}/.oracle_ic"
IC_LIB_NAME="libclntsh.so"
TARGET_DIR="${VENDOR_DIR}/instantclient_19_24"

IC_URL="https://download.oracle.com/otn_software/linux/instantclient/1924000/instantclient-basic-linux.x64-19.24.0.0.0dbru.zip"
IC_UNZIP_DIR="instantclient_19_24"

# libaio 是 libclntsh.so 的硬依赖；Ubuntu 24.04 改名为 libaio.so.1t64，需带进产物。
need_libaio() { ldd "$TARGET_DIR/$IC_LIB_NAME" 2>/dev/null | grep -q "libaio.so.1" || true; }

bundle_libaio() {
  # 把系统 libaio 复制进产物目录，规避目标机无 libaio 导致的 dlopen 失败
  local cand=""
  for f in /usr/lib/x86_64-linux-gnu/libaio.so.1t64 /usr/lib/x86_64-linux-gnu/libaio.so.1 /lib/x86_64-linux-gnu/libaio.so.1t64 /lib/x86_64-linux-gnu/libaio.so.1; do
    if [ -e "$f" ]; then cand="$f"; break; fi
  done
  if [ -n "$cand" ]; then
    cp -L "$cand" "$TARGET_DIR/libaio.so.1" 2>/dev/null || true
    cp -L "$cand" "$TARGET_DIR/libaio.so.1t64" 2>/dev/null || true
  fi
}

if [ -f "${TARGET_DIR}/${IC_LIB_NAME}" ]; then
  echo "Oracle Instant Client already vendored at ${TARGET_DIR} — skip"
  bundle_libaio
  exit 0
fi

## 1) 显式 ORACLE_LIB_DIR
SRC=""
if [ -n "${ORACLE_LIB_DIR:-}" ] && [ -f "${ORACLE_LIB_DIR}/${IC_LIB_NAME}" ]; then
  SRC="${ORACLE_LIB_DIR}"
fi

## 2) 本地已有 IC
if [ -z "$SRC" ]; then
  for d in /opt/oracle/instantclient_* /usr/lib/oracle/*/client64 /usr/lib/oracle/*/client/lib; do
    [ -d "$d" ] || continue
    if [ -f "${d}/${IC_LIB_NAME}" ]; then SRC="$d"; break; fi
  done
fi

if [ -n "$SRC" ]; then
  echo "Using local Oracle Instant Client: ${SRC}"
  mkdir -p "$TARGET_DIR"
  cp -a "${SRC}/." "$TARGET_DIR/"
else
  echo "No local Instant Client found; downloading ${IC_URL}"
  mkdir -p "$VENDOR_DIR"
  TMPZIP="${VENDOR_DIR}/.ic.zip"
  curl -fL --max-time 300 -o "$TMPZIP" "$IC_URL"
  if [ -d "${VENDOR_DIR}/${IC_UNZIP_DIR}" ]; then rm -rf "${VENDOR_DIR}/${IC_UNZIP_DIR}"; fi
  (cd "$VENDOR_DIR" && unzip -q "$TMPZIP")
  rm -f "$TMPZIP"
  mv "${VENDOR_DIR}/${IC_UNZIP_DIR}" "$TARGET_DIR"
fi

bundle_libaio

if [ ! -f "${TARGET_DIR}/${IC_LIB_NAME}" ]; then
  echo "ERROR: Oracle Instant Client vendor failed — ${TARGET_DIR}/${IC_LIB_NAME} missing" >&2
  exit 1
fi
echo "Oracle Instant Client vendored to ${TARGET_DIR}"