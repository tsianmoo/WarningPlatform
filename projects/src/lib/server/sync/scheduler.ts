import { store, tryAcquireLock, releaseLock } from '@/lib/server/sync/sync-store';
import { cronNextTimes } from '@/lib/server/sync/cron';
import { runTask } from '@/lib/server/sync/engine';
import { dispatchAlerts } from '@/lib/server/sync/alert';
import { sanitizeError, nowIso } from '@/lib/server/sync/tool';
import type { AlertChannel, AlertEvent, SyncTask } from '@/lib/sync/types';

const INTERVAL_MS = 5000;
let timer: ReturnType<typeof setInterval> | null = null;
const RETRY_TIMERS = new Map<string, ReturnType<typeof setTimeout>>();

function lastRunAt(t: SyncTask): number {
  return t.lastStatus?.lastRun ? new Date(t.lastStatus.lastRun).getTime() : 0;
}

function dueAt(t: SyncTask, fromMs: number): number {
  if (t.intervalSec && t.intervalSec > 0) return fromMs + t.intervalSec * 1000;
  if (t.cron) {
    const next = cronNextTimes(t.cron, t.timezone, new Date(fromMs || Date.now()), 1);
    return next.length ? next[0].getTime() : Infinity;
  }
  if (t.expireAt) return new Date(t.expireAt).getTime();
  return Infinity;
}

class SyncScheduler {
  private started = false;
  private lastTick = 0;

  async fire(task: SyncTask, trigger: 'auto' | 'manual' | 'backfill' | 'retry', triggeredBy: string, opts: { backfill?: boolean; retryTimes?: number; retryOf?: string } = {}) {
    // 任务级互斥 + 可跳过：RUNNING 防重入由引擎保证；这里再加进程锁
    const lock = await tryAcquireLock(`sync_task:${task.id}`, 3600).catch(() => true);
    if (!lock && !task.allowParallel) {
      console.warn(`[sync] 任务 ${task.name} 已被调度 / 运行锁定，跳过本次触发`);
      return null;
    }
    try {
      task.running = true;
      await store.save('sync_tasks', task);
      const inst = await runTask(task.id, trigger, triggeredBy, opts);
      this.afterRun(task, inst);
      return inst;
    } catch (e) {
      console.error(`[sync] 任务 ${task.name} 执行异常`, sanitizeError(e));
      return null;
    } finally {
      task.running = false;
      await store.save('sync_tasks', task);
      await releaseLock(`sync_task:${task.id}`).catch(() => {});
    }
  }

  private afterRun(task: SyncTask, inst: any) {
    task.lastStatus = {
      status: inst.status,
      lastRun: nowIso(),
      lastError: inst.error,
      lastWriteRows: inst.writeRows,
    };
    void store.save('sync_tasks', task);
    // 失败自动重试（指数退避），重试生成新实例并标记 retryOf
    if (inst.status === 'failed' && task.retryTimes > 0 && (inst.retryTimes || 0) < task.retryTimes) {
      const delay = (task.retryBackoffSec || 30) * Math.pow(2, inst.retryTimes || 0);
      const nextRetry = (inst.retryTimes || 0) + 1;
      const key = `${task.id}:${inst.id}`;
      if (RETRY_TIMERS.has(key)) clearTimeout(RETRY_TIMERS.get(key));
      RETRY_TIMERS.set(
        key,
        setTimeout(() => {
          RETRY_TIMERS.delete(key);
          void this.fire(task, 'retry', 'auto-retry', { retryTimes: nextRetry, retryOf: inst.id });
        }, delay * 1000)
      );
      return;
    }
    // 告警
    const cfg = task.alert || {};
    void cfg;
    const events: AlertEvent[] = [];
    if (task.alert?.onFailure && inst.status === 'failed') {
      events.push({
        instanceId: inst.id,
        taskId: task.id,
        taskName: task.name,
        type: inst.retryOf && (inst.retryTimes || 0) >= task.retryTimes ? 'retry_failed' : 'failure',
        severity: 'ERROR',
        status: inst.status,
        error: inst.error || '任务失败',
        duration: inst.endAt ? inst.endAt - inst.startAt : undefined,
        rows: inst.writeRows,
        dashboardUrl: task.alert?.dashboardUrl,
      });
    }
    if (events.length) this.dispatch(task, events);
  }

  private async dispatch(task: SyncTask, events: AlertEvent[]) {
    try {
      const all = (await store.list('sync_channels')) as AlertChannel[];
      const ids = new Set(task.alertChannels || []);
      const channels = all.filter((c) => ids.has(c.id));
      for (const ev of events) {
        await dispatchAlerts(channels, ev, task.alert?.templates, { suppressMinutes: task.alert?.suppressMinutes });
      }
    } catch {
      /* ignore */
    }
  }

  /** 手动 / 补数触发 */
  async fireNow(task: SyncTask, opts: { trigger?: 'manual' | 'backfill'; bizDate?: string; user?: string } = {}) {
    const trigger = opts.trigger || 'manual';
    await this.fire(task, trigger, opts.user || '手动触发', { backfill: trigger === 'backfill' });
  }

  private async poll() {
    const tasks = (await store.list('sync_tasks')) as SyncTask[];
    for (const t of tasks) {
      if (!t.enabled) continue;
      if (!t.cron && !t.intervalSec && !t.expireAt) continue;
      if (t.running) continue;
      const from = lastRunAt(t);
      if (Date.now() - from < 30000) continue;
      if (t.expireAt && Date.now() > new Date(t.expireAt).getTime()) {
        // 一次性任务执行完成后自动停用
        if (t.lastStatus?.status === 'success') {
          t.enabled = false;
          void store.save('sync_tasks', t);
        }
        continue;
      }
      const due = dueAt(t, from);
      if (due === Infinity) continue;
      if (Date.now() >= due) {
        try {
          await this.fire(t, 'auto', 'scheduler');
        } catch (e) {
          console.error('[sync] periodic run failed', t.id, sanitizeError(e));
        }
      }
    }
  }

  start() {
    if (this.started) return;
    this.started = true;
    const loop = () => {
      try {
        if (Date.now() - this.lastTick < INTERVAL_MS) return;
        this.lastTick = Date.now();
        void this.poll();
      } catch (e) {
        console.error('[sync] scheduler poll error', sanitizeError(e));
      }
    };
    timer = setInterval(loop, INTERVAL_MS);
    loop();
  }
}

export const scheduler = new SyncScheduler();

export function startSchedulerOnce() {
  scheduler.start();
  void fixStaleInstances();
}

let fixDone = false;
async function fixStaleInstances() {
  if (fixDone) return;
  fixDone = true;
  try {
    const ins = (await store.list('sync_instances')) as any[];
    for (const i of ins) {
      if (i.status === 'running' || i.status === 'waiting') {
        i.status = 'failed';
        i.error = '进程重启导致运行中断（未完成批次已回滚）';
        i.endAt = Date.now();
        void store.save('sync_instances', i);
      }
    }
    const tasks = (await store.list('sync_tasks')) as SyncTask[];
    for (const t of tasks) {
      if (t.running) {
        t.running = false;
        void store.save('sync_tasks', t);
      }
    }
  } catch {
    /* noop */
  }
}