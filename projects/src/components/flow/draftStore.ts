'use client';

import { useSyncExternalStore } from 'react';

/**
 * 画布节点「草稿 + 锁定」注册表（方案甲）。
 * 任意时刻最多只有一个未保存草稿节点（dirtyNodeId）。
 * - 草稿阶段：节点本地写草稿，不触发 React Flow / 全局状态重算 → 输入不卡顿。
 * - 保存（commit）：把草稿合并后写回 flow，触发一次下游同步更新。
 * - 锁定：存在未保存草稿时，禁止添加节点 / 编辑其他节点 / 连线 / 删除 / 复制。
 *
 * 订阅分两类：
 * - useDraftVersion：草稿【内容】每变化一次触发（供 dirty 节点本地展示）。
 * - useDirtyNode：仅当 dirty 节点【新建/变更/清除】时触发（供 NodeShell 显示保存按钮 / 置灰），不随内容变化。
 */

type DataPatch = Record<string, unknown>;

let drafts = new Map<string, DataPatch>();
let dirtyNodeId: string | null = null;
let version = 0;
let dirtyVersion = 0;
const listeners = new Set<() => void>();
const dirtyListeners = new Set<() => void>();

function emit() {
  version++;
  listeners.forEach((l) => l());
}

function emitDirty() {
  dirtyVersion++;
  dirtyListeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function subscribeDirty(cb: () => void) {
  dirtyListeners.add(cb);
  return () => {
    dirtyListeners.delete(cb);
  };
}

const getSnapshot = () => version;
const getDirtySnapshot = () => dirtyVersion;

/** 订阅草稿内容版本号变化，驱动 dirty 节点本地实时展示 */
export function useDraftVersion(): number {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** 订阅 dirty 状态版本号变化，仅当新建/提交/丢弃草稿时触发，驱动 NodeShell 保存按钮与锁定置灰 */
export function useDirtyVersion(): number {
  return useSyncExternalStore(subscribeDirty, getDirtySnapshot);
}

export function getDraft(id: string): DataPatch | undefined {
  return drafts.get(id);
}

export function getDirtyNodeId(): string | null {
  return dirtyNodeId;
}

export function isLocked(): boolean {
  return dirtyNodeId !== null;
}

/** 写入草稿。若已被其它节点锁定则拒绝（返回 false）。 */
export function writeDraft(id: string, patch: DataPatch): boolean {
  if (dirtyNodeId !== null && dirtyNodeId !== id) return false;
  const cur = drafts.get(id) ?? {};
  drafts.set(id, { ...cur, ...patch });
  if (dirtyNodeId === null) {
    dirtyNodeId = id;
    emitDirty();
  }
  emit();
  return true;
}

/** 提交草稿：返回合并后的完整草稿（供调用方写回 flow），并解锁。 */
export function commitDraft(id: string): DataPatch | undefined {
  const d = drafts.get(id);
  drafts.delete(id);
  if (dirtyNodeId === id) {
    dirtyNodeId = null;
    emitDirty();
  }
  emit();
  return d;
}

/** 丢弃草稿并解锁。 */
export function discardDraft(id: string) {
  drafts.delete(id);
  if (dirtyNodeId === id) {
    dirtyNodeId = null;
    emitDirty();
  }
  emit();
}