'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { Field, Modal, Badge, btnPrimary, btnGhost, inputCls, Empty, useToast, usePerm } from './ui';
import type { AlertChannel } from '@/lib/sync/types';

const CHANNEL_TYPES = ['smtp', 'wecom', 'dingtalk', 'feishu', 'webhook'];

export default function ChannelManager() {
  const { toast, ToastView } = useToast();
  const can = usePerm();
  const [items, setItems] = useState<AlertChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<AlertChannel> | null>(null);
  const [isEdit, setIsEdit] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.listChannels(); setItems(r.items || []); }
    catch (e: any) { toast(e.message, 'err'); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing({ key: '', name: '', type: 'webhook', enabled: true, host: '', port: 465, user: '', from: '', to: '', webhookUrl: '', secret: '', templateTitle: '[数据同步] ${task} 失败', templateBody: '任务:${task}\n实例:${instance}\n错误:${error}\n耗时:${duration}s\n影响行数:${rows}', group: '默认' });
    setIsEdit(false); setOpen(true);
  };
  const openEdit = (c: AlertChannel) => { setEditing({ ...c, password: '' } as any); setIsEdit(true); setOpen(true); };
  const set = (k: string, v: any) => setEditing((e) => ({ ...e, [k]: v }));

  const save = async () => {
    if (!editing) return;
    if (!editing.key || !editing.type) { toast('编码/类型 必填', 'err'); return; }
    try {
      if (isEdit) { await api.updateChannel(editing.id!, editing); toast('已更新'); }
      else { await api.createChannel(editing); toast('已创建'); }
      setOpen(false); load();
    } catch (e: any) { toast(e.message, 'err'); }
  };
  const remove = async (c: AlertChannel) => {
    if (!confirm(`删除渠道「${c.name}」？`)) return;
    try { await api.deleteChannel(c.id); toast('已删除'); load(); }
    catch (e: any) { toast(e.message, 'err'); }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-base font-semibold text-gray-800">告警通知</div>
          <div className="text-xs text-gray-400">邮件 / 企业微信 / 钉钉 / 飞书 / 通用 Webhook</div>
        </div>
        <button className={btnPrimary} disabled={!can('create')} onClick={openCreate}>＋ 新建渠道</button>
      </div>
      <div className="flex-1 overflow-auto rounded-lg border border-gray-200 bg-white">
        {loading && <div className="p-6 text-sm text-gray-400">加载中…</div>}
        {!loading && items.length === 0 && <Empty text="暂无告警渠道" />}
        {!loading && items.length > 0 && (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500">
              <tr><th className="px-3 py-2">名称</th><th className="px-3 py-2">类型</th><th className="px-3 py-2">目标</th><th className="px-3 py-2">状态</th><th className="px-3 py-2 text-right">操作</th></tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-800">{c.name}</div>
                    <div className="text-xs text-gray-400">{c.key}</div>
                  </td>
                  <td className="px-3 py-2"><Badge color="blue">{c.type}</Badge></td>
                  <td className="px-3 py-2 text-xs text-gray-500">{c.type === 'webhook' ? (c.webhookUrl || '').slice(0, 40) : c.to || c.host}</td>
                  <td className="px-3 py-2">{c.enabled ? <Badge color="green">启用</Badge> : <Badge color="gray">停用</Badge>}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button className="mr-1 text-xs text-blue-600 hover:underline disabled:opacity-40" disabled={!can('edit')} onClick={() => openEdit(c)}>编辑</button>
                    <button className="text-xs text-red-500 hover:underline disabled:opacity-40" disabled={!can('delete')} onClick={() => remove(c)}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal title={isEdit ? '编辑渠道' : '新建渠道'} open={open} onClose={() => setOpen(false)}>
        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="编码"><input className={inputCls} value={editing.key} onChange={(e) => set('key', e.target.value)} /></Field>
              <Field label="名称"><input className={inputCls} value={editing.name} onChange={(e) => set('name', e.target.value)} /></Field>
              <Field label="类型">
                <select className={inputCls} value={editing.type} onChange={(e) => set('type', e.target.value)}>
                  {CHANNEL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <label className="flex items-end gap-2 pb-1.5"><input type="checkbox" checked={!!editing.enabled} onChange={(e) => set('enabled', e.target.checked)} /><span className="text-sm">启用</span></label>
            </div>
            {editing.type === 'webhook' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Webhook URL" className="col-span-2"><input className={inputCls} value={editing.webhookUrl} onChange={(e) => set('webhookUrl', e.target.value)} /></Field>
                <Field label="签名密钥（可选）"><input className={inputCls} value={editing.secret} onChange={(e) => set('secret', e.target.value)} /></Field>
              </div>
            )}
            {editing.type === 'smtp' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="SMTP 主机"><input className={inputCls} value={editing.host} onChange={(e) => set('host', e.target.value)} /></Field>
                <Field label="端口"><input type="number" className={inputCls} value={editing.port} onChange={(e) => set('port', Number(e.target.value))} /></Field>
                <Field label="账号"><input className={inputCls} value={editing.user} onChange={(e) => set('user', e.target.value)} /></Field>
                <Field label="密码"><input type="password" className={inputCls} value={(editing as any).password || ''} onChange={(e) => set('password', e.target.value)} /></Field>
                <Field label="发件人"><input className={inputCls} value={editing.from} onChange={(e) => set('from', e.target.value)} /></Field>
                <Field label="收件人(逗号分隔)"><input className={inputCls} value={editing.to} onChange={(e) => set('to', e.target.value)} /></Field>
              </div>
            )}
            {editing.type === 'wecom' || editing.type === 'dingtalk' || editing.type === 'feishu' ? (
              <Field label={editing.type.toUpperCase() + ' Webhook URL'}><input className={inputCls} value={editing.webhookUrl} onChange={(e) => set('webhookUrl', e.target.value)} /></Field>
            ) : null}
            <Field label="标题模板"><input className={inputCls} value={editing.templateTitle} onChange={(e) => set('templateTitle', e.target.value)} /></Field>
            <Field label="正文模板"><textarea className={inputCls} rows={4} value={editing.templateBody} onChange={(e) => set('templateBody', e.target.value)} /></Field>
            <div className="flex justify-end gap-2">
              <button className={btnGhost} onClick={() => setOpen(false)}>取消</button>
              <button className={btnPrimary} onClick={save}>保存</button>
            </div>
          </div>
        )}
      </Modal>
      {ToastView}
    </div>
  );
}