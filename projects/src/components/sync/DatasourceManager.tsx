'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { Field, Modal, Badge, btnPrimary, btnGhost, inputCls, Empty, useToast, usePerm } from './ui';
import type { DataSource, ColumnMeta, TableMeta } from '@/lib/sync/types';

const DB_TYPES = ['oracle', 'paimon', 'mysql', 'postgresql', 'sqlserver', 'starrocks'] as const;
const TYPE_LABEL: Record<string, string> = {
  oracle: 'Oracle', paimon: 'Paimon', mysql: 'MySQL', postgresql: 'PostgreSQL', sqlserver: 'SQL Server', starrocks: 'StarRocks',
};
const DEFAULT_PORT: Record<string, number> = { oracle: 1521, paimon: 8165, mysql: 3306, postgresql: 5432, sqlserver: 1433, starrocks: 9030 };

function emptyDs(): Partial<DataSource> {
  return {
    key: '', type: 'oracle', label: '', host: '', port: 1521, dbName: '', user: '', password: '' as any,
    encoding: 'UTF-8', connParams: '', maxActive: 10, minIdle: 2, maxWaitMs: 10000, queryTimeoutSec: 30, group: '默认', desc: '',
    health: 'unknown', consecutiveFailures: 0,
  };
}

export default function DatasourceManager() {
  const { toast, ToastView } = useToast();
  const can = usePerm();
  const [items, setItems] = useState<DataSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<DataSource> | null>(null);
  const [isEdit, setIsEdit] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [testing, setTesting] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [metaDs, setMetaDs] = useState<DataSource | null>(null);
  const [metaData, setMetaData] = useState<any>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaKeyword, setMetaKeyword] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.listDatasources();
      setItems(r.items || []);
    } catch (e: any) {
      toast(e.message, 'err');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(emptyDs()); setIsEdit(false); setTestResult(null); setOpen(true); };
  const openEdit = (ds: DataSource) => {
    setEditing({ ...ds, password: '' } as any);
    setIsEdit(true); setTestResult(null); setOpen(true);
  };
  const openCopy = (ds: DataSource) => {
    setEditing({ ...emptyDs(), label: ds.label + '(副本)', host: ds.host, port: ds.port, type: ds.type, dbName: ds.dbName, user: ds.user, encoding: ds.encoding, connParams: ds.connParams, group: ds.group });
    setIsEdit(false); setTestResult(null); setOpen(true);
  };

  const save = async () => {
    if (!editing) return;
    try {
      if (isEdit) {
        await api.updateDatasource(editing.id!, { ...editing, password: editing.password || '' });
        toast('数据源已更新');
      } else {
        await api.createDatasource(editing);
        toast('数据源已创建');
      }
      setOpen(false);
      load();
    } catch (e: any) {
      toast(e.message, 'err');
    }
  };

  const test = async () => {
    if (!editing) return;
    setTesting(true); setTestResult(null);
    try {
      const r = await api.testDatasource({ ...editing, id: editing.id }, 10000);
      setTestResult(r.health);
    } catch (e: any) {
      setTestResult({ success: false, error: e.message });
    } finally {
      setTesting(false);
    }
  };

  const remove = async (ds: DataSource) => {
    if (!confirm(`确定删除数据源「${ds.label}」？被任务引用时会拒绝。`)) return;
    try {
      await api.deleteDatasource(ds.id);
      toast('已删除');
      load();
    } catch (e: any) {
      toast(e.message, 'err');
    }
  };

  const browseMeta = async (ds: DataSource, force = false) => {
    setMetaDs(ds); setMetaOpen(true); setMetaLoading(true); setMetaData(null);
    try {
      const r = await api.browseMeta(ds.id, force);
      setMetaData(r);
    } catch (e: any) {
      toast(e.message, 'err');
    } finally {
      setMetaLoading(false);
    }
  };

  const set = (k: string, v: any) => setEditing((e) => ({ ...e, [k]: v }));
  const filteredMeta = useMemo(() => {
    if (!metaData?.schemas) return [];
    const kw = metaKeyword.toUpperCase();
    const out: any[] = [];
    for (const s of metaData.schemas) {
      const tables = kw ? (s.tables || []).filter((t: any) => t.name.toUpperCase().includes(kw)) : s.tables || [];
      if (kw ? tables.length : true) out.push({ name: s.name, tables });
    }
    return out;
  }, [metaData, metaKeyword]);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-base font-semibold text-gray-800">数据源管理</div>
          <div className="text-xs text-gray-400">配置外部数据库连接（首批支持 Oracle，其它类型接入中）</div>
        </div>
        <button className={btnPrimary} disabled={!can('create')} onClick={openCreate}>＋ 新建数据源</button>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-gray-200 bg-white">
        {loading && <div className="p-6 text-sm text-gray-400">加载中…</div>}
        {!loading && items.length === 0 && <Empty text="暂无数据源。添加表的流程：① 右上角「新建数据源」接入源库 → ② 切到「数据集」Tab 用 SQL 定义要同步的表 → ③ 在「同步任务」Tab 建任务并指定目标数据源+表名，调度后即在目标库生成/填充该表" />}
        {!loading && items.length > 0 && (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2">名称</th>
                <th className="px-3 py-2">类型</th>
                <th className="px-3 py-2">主机</th>
                <th className="px-3 py-2">库/SID</th>
                <th className="px-3 py-2">分组</th>
                <th className="px-3 py-2">健康度</th>
                <th className="px-3 py-2">最近可用</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((ds) => (
                <tr key={ds.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-800">{ds.label}</div>
                    <div className="text-xs text-gray-400">{ds.key}</div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge color={ds.type === 'oracle' ? 'red' : ds.type === 'paimon' ? 'yellow' : 'blue'}>{TYPE_LABEL[ds.type] || ds.type}</Badge>
                  </td>
                  <td className="px-3 py-2 text-gray-600">{ds.type === 'paimon' ? `${ds.host}:${ds.port}` : `${ds.host}:${ds.port}`}</td>
                  <td className="px-3 py-2 text-gray-600">{ds.dbName}</td>
                  <td className="px-3 py-2 text-gray-600">{ds.group}</td>
                  <td className="px-3 py-2">
                    {ds.health === 'normal' ? <Badge color="green">正常</Badge>
                      : ds.health === 'abnormal' ? <Badge color="red">异常</Badge>
                      : <Badge color="gray">未检测</Badge>}
                    {ds.consecutiveFailures > 0 && <span className="ml-1 text-xs text-red-500">×{ds.consecutiveFailures}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-400">{ds.lastAvailableAt ? new Date(ds.lastAvailableAt).toLocaleString() : '—'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button className="mr-1 text-xs text-blue-600 hover:underline disabled:opacity-40" onClick={() => browseMeta(ds)}>元数据</button>
                    <button className="mr-1 text-xs text-gray-600 hover:underline disabled:opacity-40" disabled={!can('create')} onClick={() => openCopy(ds)}>复制</button>
                    <button className="mr-1 text-xs text-blue-600 hover:underline disabled:opacity-40" disabled={!can('edit')} onClick={() => openEdit(ds)}>编辑</button>
                    <button className="text-xs text-red-500 hover:underline disabled:opacity-40" disabled={!can('delete')} onClick={() => remove(ds)}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 新建/编辑 */}
      <Modal title={isEdit ? '编辑数据源' : '新建数据源'} open={open} onClose={() => setOpen(false)} wide>
        {editing && (
          <div className="grid grid-cols-3 gap-3">
            <Field label="连接名称(编码)"><input className={inputCls} value={editing.key} onChange={(e) => set('key', e.target.value)} placeholder="ods_erp" /></Field>
            <Field label="显示名称"><input className={inputCls} value={editing.label} onChange={(e) => set('label', e.target.value)} /></Field>
            <Field label="类型">
              <select className={inputCls} value={editing.type} onChange={(e) => { const t = e.target.value; set('type', t); set('port', DEFAULT_PORT[t] || 1521); }}>
                {DB_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]} {t === 'oracle' || t === 'paimon' ? '✔' : '(待接入)'}</option>)}
              </select>
            </Field>
            {editing.type === 'paimon' && (
              <Field label="连接串（hdfs:// 主机:端口/仓库路径）" className="col-span-3">
                <div className="rounded border border-blue-100 bg-blue-50 px-2.5 py-1.5 text-xs text-blue-700">
                  将按 <span className="font-mono">hdfs://{editing.host || '主机'}:{editing.port || 8165}/{editing.dbName || 'paimon'}</span> 连接，无需用户名密码。
                  元数据通过 WebHDFS/HttpFS 读取（默认探测端口 {String(editing.port)}→9870→14000，可在连接参数指定 webhdfsPort/httpFsPort）；
                  如需 SQL 查询/同步，请在连接参数配置 Flink SQL Gateway：<span className="font-mono">sqlGateway=http://主机:8083</span>
                </div>
              </Field>
            )}
            <Field label="主机"><input className={inputCls} value={editing.host} onChange={(e) => set('host', e.target.value)} placeholder={editing.type === 'paimon' ? '192.168.110.6' : '192.168.1.10'} /></Field>
            <Field label="端口"><input type="number" className={inputCls} value={editing.port} onChange={(e) => set('port', Number(e.target.value))} /></Field>
            <Field label={editing.type === 'paimon' ? '仓库路径（warehouse）' : '数据库名/SID/服务名'}><input className={inputCls} value={editing.dbName} onChange={(e) => set('dbName', e.target.value)} placeholder={editing.type === 'paimon' ? 'paimon' : ''} /></Field>
            {editing.type !== 'paimon' && (
              <>
                <Field label="用户名"><input className={inputCls} value={editing.user} onChange={(e) => set('user', e.target.value)} /></Field>
                <Field label="密码（留空保持不变）"><input type="password" className={inputCls} value={(editing as any).password || ''} onChange={(e) => set('password', e.target.value)} /></Field>
                <Field label="编码">
                  <select className={inputCls} value={editing.encoding} onChange={(e) => set('encoding', e.target.value)}>
                    <option>UTF-8</option><option>GBK</option>
                  </select>
                </Field>
              </>
            )}
            <Field label={editing.type === 'paimon' ? '连接参数(webhdfsPort=…&sqlGateway=…)' : '连接参数(k=v&k2=v)'} className={editing.type === 'paimon' ? 'col-span-2' : 'col-span-2'}>
              <input className={inputCls} value={editing.connParams} onChange={(e) => set('connParams', e.target.value)} placeholder={editing.type === 'paimon' ? 'sqlGateway=http://192.168.110.6:8083' : 'oracle.sid=false'} />
            </Field>
            <Field label="分组"><input className={inputCls} value={editing.group} onChange={(e) => set('group', e.target.value)} /></Field>
            {editing.type !== 'paimon' && (
              <>
                <Field label="最大活动连接数"><input type="number" className={inputCls} value={editing.maxActive} onChange={(e) => set('maxActive', Number(e.target.value))} /></Field>
                <Field label="最小空闲连接数"><input type="number" className={inputCls} value={editing.minIdle} onChange={(e) => set('minIdle', Number(e.target.value))} /></Field>
                <Field label="连接最大等待(ms)"><input type="number" className={inputCls} value={editing.maxWaitMs} onChange={(e) => set('maxWaitMs', Number(e.target.value))} /></Field>
              </>
            )}
            <Field label="查询超时(s)"><input type="number" className={inputCls} value={editing.queryTimeoutSec} onChange={(e) => set('queryTimeoutSec', Number(e.target.value))} /></Field>
            <Field label="描述" className="col-span-3"><input className={inputCls} value={editing.desc} onChange={(e) => set('desc', e.target.value)} /></Field>
          </div>
        )}
        <div className="mt-4 flex items-center justify-between">
          <div>
            <button className={btnGhost} onClick={test} disabled={testing}>{testing ? '测试中…' : '测试连接'}</button>
            {testResult && (
              <span className={`ml-2 text-xs ${testResult.success ? 'text-green-600' : 'text-red-600'}`}>
                {testResult.success
                  ? `✓ 连通，耗时 ${testResult.elapsedMs}ms · ${testResult.version || ''} · 用户 ${testResult.user} · Schema ${testResult.schema || '-'}${testResult.mode ? ` · 模式 ${testResult.mode.toUpperCase()}` : ''}`
                  : `✗ ${testResult.error || '连接失败'}`}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button className={btnGhost} onClick={() => setOpen(false)}>取消</button>
            <button className={btnPrimary} disabled={!can('create') && !can('edit')} onClick={save}>保存</button>
          </div>
        </div>
      </Modal>

      {/* 元数据浏览 */}
      <Modal title={`元数据浏览 · ${metaDs?.label || ''}`} open={metaOpen} onClose={() => setMetaOpen(false)} wide>
        <div className="mb-2 flex items-center gap-2">
          <input className={inputCls} placeholder="搜索表" value={metaKeyword} onChange={(e) => setMetaKeyword(e.target.value)} />
          <button className={btnGhost} disabled={metaLoading} onClick={() => metaDs && browseMeta(metaDs, true)}>刷新</button>
          <span className="text-xs text-gray-400">{metaData?.cached ? '（已缓存）' : ''}</span>
        </div>
        <div className="max-h-[55vh] overflow-auto">
          {metaLoading && <div className="p-6 text-sm text-gray-400">同步元数据中，首次加载较慢…</div>}
          {!metaLoading && filteredMeta.length === 0 && <Empty text="无 Schema/表" />}
          {!metaLoading && filteredMeta.map((s: any) => (
            <div key={s.name} className="mb-3">
              <div className="mb-1 text-xs font-semibold text-gray-500">Schema {s.name}</div>
              <div className="ml-3 flex flex-wrap gap-1.5">
                {(s.tables || []).map((t: any) => (
                  <span key={`${s.name}.${t.name}`} className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-700 hover:bg-blue-50" title={t.comment || t.name}>{t.name}</span>
                ))}
                {(s.tables || []).length === 0 && <span className="text-xs text-gray-300">空</span>}
              </div>
            </div>
          ))}
        </div>
      </Modal>

      {ToastView}
    </div>
  );
}