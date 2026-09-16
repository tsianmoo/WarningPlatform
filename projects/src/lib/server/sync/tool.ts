import crypto from 'node:crypto';
import { uid } from '@/lib/types';

/** 生成 8 位随机 id（与现有 uid 语义一致） */
export function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function now(): number {
  return Date.now();
}

/** 当前时间的 ISO 字符串（用于 lastRun 等字段） */
export function nowIso(): string {
  return new Date().toISOString();
}

// ---------- 密码混淆（可逆，用于落库脱敏；生产可替换为 KMS） ----------
const KEY = crypto
  .createHash('sha256')
  .update(process.env.SYNC_SECRET_KEY || 'coze-data-sync-secret-v1')
  .digest();

/** 加密为 base64(iv:tag:cipher) */
export function encSecret(plain: string): string {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

/** 解密 encSecret 产物 */
export function decSecret(payload: string): string {
  if (!payload) return '';
  const [ivB, tagB, dataB] = payload.split(':');
  if (!ivB || !tagB || !dataB) return payload; // 兼容明文
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return payload;
  }
}

/** 脱敏：保留首尾，中间打码 */
export function mask(str: string, show = 2): string {
  if (!str) return '';
  if (str.length <= show * 2) return '*'.repeat(str.length);
  return str.slice(0, show) + '*'.repeat(4) + str.slice(-show);
}

/** 错误信息脱敏：去掉密码，保留 IP */
export function sanitizeError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const cleaned = raw
    .replace(/(password\s*[:=]\s*)\S+/gi, '$1***')
    .replace(/([Pp]ass(word)?\s*=\s*)[^&;\s]+/g, '$1***');
  // Oracle 11g 不被 Thin 模式支持（NJS-138），提示改用 Thick（Instant Client）
  if (/NJS-138|this database server version are not supported/i.test(cleaned)) {
    return `${cleaned} —— Oracle 11g 及以下版本不支持 node-oracledb 的 Thin 模式，请在部署服务器设置 ORACLE_LIB_DIR 指向 Oracle Instant Client 目录（并安装 libaio）以启用 Thick 模式后重试。`;
  }
  return cleaned;
}

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${(s / 60).toFixed(1)}m`;
}

export function uid2(prefix = 'id'): string {
  return uid(prefix);
}