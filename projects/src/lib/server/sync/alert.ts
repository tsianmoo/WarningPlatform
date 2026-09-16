import { sanitizeError, nowIso } from '@/lib/server/sync/tool';
import type { AlertChannel, AlertEvent } from '@/lib/sync/types';

type ChannelMap = Record<string, AlertChannel>;
/** 收敛：task+type+channelId 在窗口内只发一次 */
const suppressed: Record<string, { until: number; count: number }> = {};

function convKey(ch: AlertChannel, ev: AlertEvent) {
  return `${ev.taskId}|${ev.type}|${ch.id}`;
}

/** 尝试投递所有渠道；返回成功数 */
export async function dispatchChannel(
  ch: AlertChannel,
  ev: AlertEvent,
  tpl: { title: string; body: string }
): Promise<boolean> {
  try {
    if (ch.type === 'webhook' || ch.type === 'wecom' || ch.type === 'dingtalk' || ch.type === 'feishu') {
      return await postWebhook(ch, ev, tpl);
    }
    if (ch.type === 'smtp') {
      return await sendMail(ch, ev, tpl);
    }
    return false;
  } catch (e) {
    void e;
    return false;
  }
}

function sign(url: string, secret: string | undefined): string {
  if (!secret) return url;
  const ts = Date.now() / 1000;
  const crypto = require('crypto');
  const hex = crypto.createHmac('sha256', secret).update(`${ts}\n${secret}`).digest();
  const str = crypto.createHash('sha256').update(Buffer.concat([Buffer.from(`${ts}\n`), hex])).digest('hex');
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}timestamp=${Math.floor(ts)}&sign=${encodeURIComponent(str)}`;
}

async function postWebhook(
  ch: AlertChannel,
  ev: AlertEvent,
  tpl: { title: string; body: string }
): Promise<boolean> {
  const url = sign(ch.webhookUrl || '', ch.secret);
  let payload: unknown;
  if (ch.type === 'dingtalk') {
    payload = { msgtype: 'text', text: { content: `${tpl.title}\n${tpl.body}` } };
  } else if (ch.type === 'feishu') {
    payload = { msg_type: 'text', content: { text: `${tpl.title}\n${tpl.body}` } };
  } else {
    payload = { msgtype: 'text', text: { content: `${tpl.title}\n${tpl.body}` } };
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`webhook ${res.status}`);
  return true;
}

const BL = Buffer.from('\r\n');
function enc(s: string) {
  return Buffer.from(s, 'binary');
}
function smtpCmd(sock: any, cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const onData = (buf: Buffer) => {
      const text = buf.toString('binary');
      if (/^\d{3} /.test(text)) {
        sock.removeListener('data', onData);
        resolve(text);
      }
    };
    sock.on('data', onData);
    sock.write(cmd + BL);
    setTimeout(() => reject(new Error('SMTP 超时')), 10000);
  });
}

async function sendMail(
  ch: AlertChannel,
  ev: AlertEvent,
  tpl: { title: string; body: string }
): Promise<boolean> {
  const tls = require('tls');
  const net = require('net');
  const host = ch.host || '';
  const port = Number(ch.port || 25);
  const useTls = ch.tls || port === 465;
  const secureSocket = useTls
    ? tls.connect({ host, port, rejectUnauthorized: false })
    : net.connect({ host, port });
  await new Promise<void>((res, rej) => {
    secureSocket.once('connect', res);
    secureSocket.once('error', rej);
    setTimeout(() => rej(new Error('SMTP connect 超时')), 10000);
  });
  let s = await smtpCmd(secureSocket, '');
  await smtpCmd(secureSocket, `HELO ${host || 'localhost'}`);
  if (!useTls && ch.tls) {
    s = await smtpCmd(secureSocket, 'STARTTLS');
  }
  if (ch.user) {
    await smtpCmd(secureSocket, 'AUTH LOGIN');
    await smtpCmd(secureSocket, Buffer.from(ch.user).toString('base64'));
    await smtpCmd(secureSocket, Buffer.from(ch.passwordEnc || '').toString('base64'));
  }
  const from = ch.from || ch.user;
  await smtpCmd(secureSocket, `MAIL FROM:<${from}>`);
  const to = (ch.to || '')
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean);
  for (const t of to) await smtpCmd(secureSocket, `RCPT TO:<${t}>`);
  await smtpCmd(secureSocket, 'DATA');
  await smtpCmd(
    secureSocket,
    `From: ${from}\r\nTo: ${to.join(', ')}\r\nSubject: ${tpl.title}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${tpl.body}\r\n.`
  );
  await smtpCmd(secureSocket, 'QUIT');
  secureSocket.end();
  return true;
}

/** 触发告警：应用收敛/静默，投递多通道；返回是否已发出 */
export function fireAlert(
  channels: ChannelMap,
  ev: AlertEvent,
  cfg?: {
    suppressMinutes?: number;
    muteUntil?: string;
    silent?: boolean;
  }
) {
  void channels; void cfg;
  return { fired: false, note: '告警调度在任务执行完成后调用 fireAndDispatch' };
}

export async function dispatchAlerts(
  channels: AlertChannel[],
  ev: AlertEvent,
  templates: Record<string, { title: string; body: string }> | undefined,
  opts?: { suppressMinutes?: number }
): Promise<{ fired: number; mutedByConvergence: number }> {
  let fired = 0;
  let muted = 0;
  const tplName = ev.type;
  const tpl = templates?.[tplName] ?? defaultTpl[ev.type] ?? defaultTpl.generic;
  const title = fill(tpl.title, ev);
  const body = fill(tpl.body, ev);
  const winMin = opts?.suppressMinutes ?? 10;
  void winMin;
  for (const ch of channels) {
    if (!ch.enabled) continue;
    const key = convKey(ch, ev);
    const now = Date.now();
    const rec = suppressed[key];
    if (rec && rec.until > now) {
      rec.count++;
      muted++;
      continue;
    }
    suppressed[key] = { until: now + (opts?.suppressMinutes ?? 10) * 60000, count: 0 };
    if (await dispatchChannel(ch, ev, { title, body })) fired++;
  }
  return { fired, mutedByConvergence: muted };
}

const defaultTpl: Record<string, { title: string; body: string }> = {
  generic: {
    title: '[数据同步] ${task} ${instance}',
    body: '任务：${task}\n实例：${instance}\n级别：${severity}\n状态：${status}\n类型：${type}\n错误：${error}\n耗时：${duration}ms\n写入：${rows} 行\n时间：${time}\n看板：${dashboardUrl}',
  },
  successRecover: {
    title: '[数据同步-已恢复] ${task}',
    body: '任务 ${task}（实例 ${instance}）已恢复正常。\n时间：${time}',
  },
};

export function fillTemplate(s: string, ev: AlertEvent) {
  return fill(s, ev);
}

function fill(s: string, ev: AlertEvent) {
  const map: Record<string, string> = {
    task: ev.taskName || '',
    instance: ev.instanceId || '',
    error: ev.error || '',
    duration: String(ev.duration ?? ''),
    rows: String(ev.rows ?? ''),
    dashboardUrl: ev.dashboardUrl || '',
    time: nowIso(),
    severity: ev.severity || 'ERROR',
    status: ev.status || 'FAILED',
    type: ev.type || '',
    taskId: ev.taskId || '',
  };
  return s.replace(/\$\{(\w+)\}/g, (_, k) => map[k] ?? '');
}

export function processChannels(m: any): ChannelMap {
  return (m || {});
}