'use client';

import { useSyncExternalStore } from 'react';

/**
 * 画布节点「草稿 + 编辑态」注册表（方案乙）。
 * - 草稿阶段：编辑态节点本地写草稿，不触发 React Flow / 全局状态重算 → 输入不卡顿。
 * - 保存（commit）：把草稿合并后写回 flow，触发一次下游同步更新。
 * - 编辑态：任意时刻最多一个节点处于「编辑态」（editingNodeId），仅编辑态节点的内容可交互；
 *   非编辑态节点只读，需点 NodeShell 上的「编辑」进入。编辑后点「保存」提交 / 「取消」放弃。
 * - 不再有"存在未保存草稿即锁定画布"的语义：添加组件、连线、拖拽、删除、复制均不受影响。
 *
 * 订阅分两类：
 * - useDraftVersion：草稿【内容】每变化一次触发（供编辑态节点本地展示）。
 * - useDirtyVersion：仅当编辑态【进入/切换/退出】时触发（供 NodeShell 显示编辑/保存按钮、只读态），不随内容变化。
 */

type DataPatch = Record<string, unknown>;

let drafts = new Map<string, DataPatch>();
let editingNodeId: string | null = null;
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

/** 订阅草稿内容版本号变化，驱动编辑态节点本地实时展示 */
export function useDraftVersion(): number {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** 订阅编辑态版本号变化，仅当进入/切换/退出编辑态时触发，驱动 NodeShell 按钮与只读态 */
export function useDirtyVersion(): number {
  return useSyncExternalStore(subscribeDirty, getDirtySnapshot);
}

export function getDraft(id: string): DataPatch | undefined {
  return drafts.get(id);
}

/** 当前处于编辑态的节点 id，仅一个 */
export function getEditingNodeId(): string | null {
  return editingNodeId;
}

/** 该节点是否处于编辑态（内容可交互） */
export function isEditing(id: string): boolean {
  return editingNodeId === id;
}

/** 兼容旧导出：是否处于任一编辑态 */
export function getDirtyNodeId(): string | null {
  return editingNodeId;
}

/** 兼容旧导出：编辑态不再锁定画布，恒返回 false */
export function isLocked(): boolean {
  return false;
}

/** 进入编辑态（只有编辑态节点的内容可交互）。若此前已有其它编辑态节点，切换到当前 id。 */
export function enterEdit(id: string) {
  editingNodeId = id;
  emitDirty();
}

/** 写入草稿（不锁画布，任意可写；规范上仅供编辑态节点调用）。 */
export function writeDraft(id: string, patch: DataPatch): boolean {
  const cur = drafts.get(id) ?? {};
  drafts.set(id, { ...cur, ...patch });
  emit();
  return true;
}

/** 提交草稿：返回合并后的完整草稿（供调用方写回 flow），并退出编辑态。 */
export function commitDraft(id: string): DataPatch | undefined {
  const d = drafts.get(id);
  drafts.delete(id);
  if (editingNodeId === id) {
    editingNodeId = null;
    emitDirty();
  }
  emit();
  return d;
}

/** 丢弃草稿并退出编辑态。 */
export function discardDraft(id: string) {
  drafts.delete(id);
  if (editingNodeId === id) {
    editingNodeId = null;
    emitDirty();
  }
  emit();
}