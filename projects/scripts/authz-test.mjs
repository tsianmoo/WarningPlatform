import { readFileSync } from 'node:fs';

/**
 * 服务端授权（authz）端到端测试。
 *
 * 背景：旧系统只在浏览器里判断权限 —— 用 localStorage 的显示名去找人再算权限，
 * 接口本身不校验。于是「配了权限」只是界面上好看，直接调接口照样能改能删。
 *
 * 本脚本验证修复后的语义（与前端 perm.ts 一致）：
 *   - 命中角色  → 严格按该角色的 pages/ops 判定，越权写返回 403
 *   - 未命中角色 → 默认拒绝（未配置 = 无权限，写入返回 403）
 *
 * 用法：先启动服务，再 node scripts/authz-test.mjs
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3100';

const DEALER_ID = 'authz_dealer_1';
const DEALER_CODE = 'AUTHZ001';
// 经销商登录账号 = J + 编号（编号与店仓共用一套编码，靠前缀区分）
const DEALER_ACCOUNT = `J${DEALER_CODE}`;
const INIT_PWD = process.env.ADMIN_PASSWORD
  || (/^ADMIN_PASSWORD=(.*)$/m.exec(
        readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
      )?.[1]?.trim())
  || process.env.DEFAULT_INITIAL_PASSWORD
  || (/^DEFAULT_INITIAL_PASSWORD=(.*)$/m.exec(
        readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
      )?.[1]?.trim())
  || '123456';
// 新建业务账号（经销商/店仓/员工/人员）的初始密码与 admin 密码是两回事
const DEALER_INIT_PWD = process.env.DEFAULT_INITIAL_PASSWORD
  || (/^DEFAULT_INITIAL_PASSWORD=(.*)$/m.exec(
        readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
      )?.[1]?.trim())
  || '123456';
const NEW_PWD = 'Authz@2026';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

const j = async (r) => { try { return await r.json(); } catch { return null; } };
const cookieOf = (res) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');

async function login(username, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return { res, cookie: cookieOf(res), body: await j(res) };
}

async function main() {
  // ---------- 0. 管理员登录 ----------
  const admin = await login('admin', INIT_PWD);
  ok('管理员登录成功', admin.res.status === 200, `got ${admin.res.status}`);
  const adminH = { 'Content-Type': 'application/json', Cookie: admin.cookie };

  // ---------- 1. 建一个经销商（会自动生成账号，用户名 = J+编号）----------
  await fetch(`${BASE}/api/state`, {
    method: 'POST', headers: adminH,
    body: JSON.stringify({
      del: { dealerIds: [DEALER_ID] },
    }),
  }).catch(() => {});
  const mk = await j(await fetch(`${BASE}/api/state`, {
    method: 'POST', headers: adminH,
    body: JSON.stringify({
      dealers: [{ id: DEALER_ID, name: '授权测试经销商', code: DEALER_CODE, sort: 99, createdAt: Date.now(), enabled: true }],
    }),
  }));
  ok('管理员新建经销商成功', mk?.success === true, JSON.stringify(mk?.errors));

  // ---------- 2. 该经销商账号用初始密码直接登录（不强制改密） ----------
  const bare = await login(DEALER_CODE, DEALER_INIT_PWD);
  ok('经销商须用「J+编号」登录（裸编号登录被拒）', bare.res.status === 401, `got ${bare.res.status}`);
  const dl0 = await login(DEALER_ACCOUNT, DEALER_INIT_PWD);
  ok('经销商账号可登录（J+编号 + 初始密码）', dl0.res.status === 200, `got ${dl0.res.status}`);
  ok('初始密码登录不被强制改密', dl0.body?.account?.mustChangePassword === false);

  const chg = await fetch(`${BASE}/api/auth/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: dl0.cookie },
    body: JSON.stringify({ oldPassword: DEALER_INIT_PWD, newPassword: NEW_PWD }),
  });
  ok('改密成功', chg.status === 200, `got ${chg.status}`);
  const dlCookie = cookieOf(chg) || dl0.cookie;
  const dlH = { 'Content-Type': 'application/json', Cookie: dlCookie };

  // ---------- 3. 未配置角色时：全放行（开箱即用语义）----------
  // ---------- 3. 未配置角色时：默认拒绝（2026-09 语义变更：未配置 = 无权限）----------
  const open1 = await fetch(`${BASE}/api/state`, {
    method: 'POST', headers: dlH,
    body: JSON.stringify({ dealers: [{ id: DEALER_ID, name: '授权测试经销商(改名)', code: DEALER_CODE, sort: 99, createdAt: Date.now(), enabled: true }] }),
  });
  ok('未配置角色 → 写入被拒（默认拒绝）', open1.status === 403, `got ${open1.status}`);
  // 注：GET /api/state 目前对已登录账号统一返回（读通道尚未按模块拆分，与行级数据范围同属已知遗留），
  // 这里只验证写通道被拒。
  const openRead = await fetch(`${BASE}/api/state`, { headers: dlH });
  ok('未配置角色 → 读接口仍可达（写通道已拒）', openRead.status === 200, `got ${openRead.status}`);

  // ---------- 4. 管理员给「经销商」配一个只读角色 ----------
  const cfgRes = await j(await fetch(`${BASE}/api/state`, {
    method: 'POST', headers: adminH,
    body: JSON.stringify({
      config: {
        permissions: [{
          post: 'all',            // 经销商/店仓/员工类的通用键
          subjectKind: 'dealer',
          pages: { home: { view: true, ops: {} }, dealer: { view: true, ops: {} } },
          dataScope: { type: 'self' },
          createdAt: Date.now(),
        }],
        permOverrides: [],
      },
    }),
  }));
  ok('管理员配置经销商角色成功', cfgRes?.success === true, JSON.stringify(cfgRes?.errors));

  // ---------- 5. 命中角色后：越权写必须被拒 ----------
  const denied = await fetch(`${BASE}/api/state`, {
    method: 'POST', headers: dlH,
    body: JSON.stringify({ dealers: [{ id: DEALER_ID, name: '越权改名', code: DEALER_CODE, sort: 99, createdAt: Date.now(), enabled: true }] }),
  });
  const deniedBody = await j(denied);
  ok('★ 越权写经销商被拒（403）', denied.status === 403, `got ${denied.status} ${JSON.stringify(deniedBody)}`);

  const deniedDel = await fetch(`${BASE}/api/state`, {
    method: 'POST', headers: dlH,
    body: JSON.stringify({ del: { dealerIds: [DEALER_ID] } }),
  });
  ok('★ 越权删经销商被拒（403）', deniedDel.status === 403, `got ${deniedDel.status}`);

  // 未授权模块（规则）同样被拒
  const deniedRules = await fetch(`${BASE}/api/state`, {
    method: 'POST', headers: dlH,
    body: JSON.stringify({ rules: [{ id: 'authz_rule_1', name: '越权规则', enabled: true, createdAt: Date.now() }] }),
  });
  ok('★ 越权写规则被拒（403）', deniedRules.status === 403, `got ${deniedRules.status}`);

  // 只读读取仍然允许
  const stillRead = await fetch(`${BASE}/api/state`, { headers: dlH });
  ok('有 view 权限 → 仍可读取状态（200）', stillRead.status === 200, `got ${stillRead.status}`);

  // ---------- 6. 经销商不得修改权限配置（防提权）----------
  const esc = await fetch(`${BASE}/api/state`, {
    method: 'POST', headers: dlH,
    body: JSON.stringify({ config: { permissions: [{ post: 'all', subjectKind: 'dealer', pages: {}, dataScope: { type: 'all' }, createdAt: Date.now() }], permOverrides: [] } }),
  });
  // 该请求只带 config、不带实体 → 不会因实体越权被拦，config 部分应被跳过
  ok('越权改权限配置被拒或跳过', esc.status === 403 || esc.status === 200, `got ${esc.status}`);
  const permsAfter = await j(await fetch(`${BASE}/api/state`, { headers: adminH }));
  const dealerRole = (permsAfter?.config?.permissions ?? []).find((p) => p.subjectKind === 'dealer');
  ok('★ 权限配置未被提权篡改（仍是 self 范围）', dealerRole?.dataScope?.type === 'self', JSON.stringify(dealerRole?.dataScope));

  // ---------- 7. 显式删除角色 → 恢复「未命中角色 = 全放行」----------
  const delRole = await j(await fetch(`${BASE}/api/state`, {
    method: 'POST', headers: adminH,
    body: JSON.stringify({ del: { roleKeys: [{ post: 'all', subjectKind: 'dealer' }] } }),
  }));
  ok('管理员显式删除角色成功', delRole?.success === true, JSON.stringify(delRole));

  const permsCleared = await j(await fetch(`${BASE}/api/state`, { headers: adminH }));
  ok('★ 角色已从库中移除（不是只 upsert）',
    !(permsCleared?.config?.permissions ?? []).some((p) => p.subjectKind === 'dealer'));

  const open2 = await fetch(`${BASE}/api/state`, {
    method: 'POST', headers: dlH,
    body: JSON.stringify({ dealers: [{ id: DEALER_ID, name: '授权测试经销商(再改名)', code: DEALER_CODE, sort: 99, createdAt: Date.now(), enabled: true }] }),
  });
  ok('★ 角色移除后重新默认拒绝', open2.status === 403, `got ${open2.status}`);

  // ---------- 8. 清理 ----------
  await fetch(`${BASE}/api/state`, { method: 'POST', headers: adminH, body: JSON.stringify({ del: { dealerIds: [DEALER_ID] } }) });
  ok('清理完成', true);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('测试异常:', e); process.exit(1); });
