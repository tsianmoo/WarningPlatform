import { readFileSync } from 'node:fs';

/**
 * 端到端冒烟测试：登录 → 写 → 读 → 部分提交（关键回归）→ 删除 → 校验
 * 用 Node 原生 fetch（不走 HTTP_PROXY），直连本地服务。
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3100';

// 管理员密码：优先 ADMIN_PASSWORD（.env.local 里记录的管理员当前密码），
// 其次 DEFAULT_INITIAL_PASSWORD —— 与「初始密码」区分开：新建业务账号用初始密码，
// admin 自己的密码是独立的，二者不要混用。
const INIT_PWD = process.env.ADMIN_PASSWORD
  || (/^ADMIN_PASSWORD=(.*)$/m.exec(
        readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
      )?.[1]?.trim())
  || process.env.DEFAULT_INITIAL_PASSWORD
  || (/^DEFAULT_INITIAL_PASSWORD=(.*)$/m.exec(
        readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
      )?.[1]?.trim())
  || '123456';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

async function main() {
  // ---------- 1. 登录 ----------
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: INIT_PWD }),
  });
  const setCookie = loginRes.headers.getSetCookie?.() ?? [];
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  ok('登录返回 200', loginRes.status === 200, `got ${loginRes.status}`);
  ok('下发会话 Cookie', /dn_session=/.test(cookie), cookie);
  const H = { 'Content-Type': 'application/json', Cookie: cookie };
  const j = async (r) => { try { return await r.json(); } catch { return null; } };

  // ---------- 2. 基线读取 ----------
  const st0 = await j(await fetch(`${BASE}/api/state`, { headers: H }));
  ok('GET /api/state 返回 200', st0 && !st0.error, JSON.stringify(st0)?.slice(0, 120));
  ok('响应不含明文密码字段', !JSON.stringify(st0).includes('"password_hash"'));
  const baseDealers = (st0?.dealers ?? []).length;

  // ---------- 3. 写入一个经销商 ----------
  const dealer = {
    id: 'smoke_dealer_1', name: '冒烟测试经销商', sort: 1, createdAt: Date.now(),
    code: 'SMK001', contact: '张三', phone: '13800000000', enabled: true,
  };
  const w1 = await j(await fetch(`${BASE}/api/state`, {
    method: 'POST', headers: H, body: JSON.stringify({ dealers: [dealer] }),
  }));
  ok('POST 写入经销商成功', w1?.success === true, JSON.stringify(w1)?.slice(0, 200));
  ok('写入无错误', (w1?.errors ?? []).length === 0, JSON.stringify(w1?.errors));

  // ---------- 4. 读回验证 ----------
  const st1 = await j(await fetch(`${BASE}/api/state`, { headers: H }));
  const found1 = (st1?.dealers ?? []).find((d) => d.id === dealer.id);
  ok('经销商已持久化', !!found1);
  ok('字段完整（code/contact/phone）',
    found1?.code === 'SMK001' && found1?.contact === '张三' && found1?.phone === '13800000000',
    JSON.stringify(found1));
  ok('dealer 数量 +1', (st1?.dealers ?? []).length === baseDealers + 1);

  // ---------- 5. 关键回归：部分提交不得清空其它数据 ----------
  // 旧系统：POST 以客户端提交为准 → 只提交 tableGroups 会把 dealers 全删光
  const w2 = await j(await fetch(`${BASE}/api/state`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ tableGroups: [{ id: 'smoke_tg_1', name: '冒烟分组', sort: 0 }] }),
  }));
  ok('部分提交（仅 tableGroups）成功', w2?.success === true);
  const st2 = await j(await fetch(`${BASE}/api/state`, { headers: H }));
  const survived = (st2?.dealers ?? []).find((d) => d.id === dealer.id);
  ok('★ 部分提交后经销商仍在（未丢数据）', !!survived,
    `dealers=${(st2?.dealers ?? []).length}`);
  ok('★ tableGroup 已写入', (st2?.tableGroups ?? []).some((g) => g.id === 'smoke_tg_1'));

  // ---------- 6. 显式删除 ----------
  const d1 = await j(await fetch(`${BASE}/api/state`, {
    method: 'POST', headers: H, body: JSON.stringify({ del: { dealerIds: [dealer.id] } }),
  }));
  ok('显式删除返回成功', d1?.success === true, JSON.stringify(d1)?.slice(0, 200));
  const st3 = await j(await fetch(`${BASE}/api/state`, { headers: H }));
  ok('经销商已从列表移除', !(st3?.dealers ?? []).some((d) => d.id === dealer.id));
  ok('其它数据未受影响（分组仍在）', (st3?.tableGroups ?? []).some((g) => g.id === 'smoke_tg_1'));

  // ---------- 7. 清理 ----------
  await fetch(`${BASE}/api/state`, {
    method: 'POST', headers: H, body: JSON.stringify({ del: { tableGroupIds: ['smoke_tg_1'] } }),
  });

  // ---------- 8. 未登录访问受保护接口 ----------
  const anon = await fetch(`${BASE}/api/state`);
  ok('匿名访问 /api/state 被拒（401）', anon.status === 401, `got ${anon.status}`);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('测试异常:', e); process.exit(1); });
