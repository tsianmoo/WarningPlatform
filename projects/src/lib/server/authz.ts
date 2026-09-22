import { resolvePerm, canView, canOper, COMMON_KEY, type AuthSubject, type ResolvedPerm } from '@/lib/perm';
import type { PermModule, PermOp, Person, HomeConfig, RolePerm, PersonPermOverride } from '@/lib/types';
import type { AuthAccount } from '@/lib/server/auth';
import {
  getAllPersons, getAllStores, getAllDealers, getAllEmployees,
  getHomeConfig, getPermissions, getPermOverrides,
} from '@/lib/server/repo';

/**
 * 服务端鉴权（授权，区别于 auth.ts 的「认证」）。
 *
 * 修正的旧设计：旧版把权限判断全部放在浏览器里 —— 用 localStorage 里的
 * 用户显示名到 persons 里去找人，再算权限。也就是说：
 *   1. 只要改一下 localStorage 的 dn_auth，前端就会以为你是别人；
 *   2. 接口本身完全不校验权限，任何拿到接口地址的人都能改/删全部数据。
 * 现在：接口层按数据库里的角色配置重新算一遍权限，前端只负责展示。
 *
 * 语义与前端保持一致（见 perm.ts）：
 *   - admin 账号                → 全放行
 *   - 未命中任何角色/覆盖        → 默认拒绝（所有页面不可见、无任何操作）
 *   - 命中角色/覆盖             → 严格按该角色的 pages/ops 判定
 */

export class ForbiddenError extends Error {
  constructor(message = '没有权限执行该操作') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/** 权限计算结果：'all' 表示不受限（仅管理员）；其余按解析出的 pages 严格判定 */
export type AccountPerm = { resolved: ResolvedPerm; matched: boolean } | 'all';

export async function loadAccountPerm(account: AuthAccount): Promise<AccountPerm> {
  if (account.subjectType === 'admin') return 'all';

  const [persons, stores, dealers, employees, cfg, permissions, permOverrides] = await Promise.all([
    getAllPersons(), getAllStores(), getAllDealers(), getAllEmployees(),
    getHomeConfig(), getPermissions(), getPermOverrides(),
  ]);

  const home: HomeConfig = ({
    ...(cfg ?? {}),
    permissions: permissions as RolePerm[],
    permOverrides: permOverrides as PersonPermOverride[],
  } as unknown) as HomeConfig;

  let person: Person | null = null;
  let subject: AuthSubject | null = null;

  const sid = account.subjectId ?? '';
  switch (account.subjectType) {
    case 'person': {
      person = persons.find((p) => p.id === sid) ?? null;
      subject = person?.post ? { kind: 'post', key: person.post } : null;
      break;
    }
    case 'dealer':
      if (dealers.some((d) => d.id === sid)) subject = { kind: 'dealer', key: COMMON_KEY };
      break;
    case 'store':
      if (stores.some((s) => s.id === sid)) subject = { kind: 'store', key: COMMON_KEY };
      break;
    case 'employee':
      if (employees.some((e) => e.id === sid)) subject = { kind: 'employee', key: COMMON_KEY };
      break;
    default:
      break;
  }

  const resolved = resolvePerm(person, home, subject);
  return { resolved, matched: resolved.matched };
}

/**
 * 断言账号可对某模块执行给定操作之一。
 * @param mod 目标模块；null 表示不涉及具体模块（跳过）
 * @param ops 允许的操作集合（满足任一即可）；空数组表示只要求能看到该模块
 */
export async function assertModuleOp(
  account: AuthAccount,
  mod: PermModule | null,
  ops: PermOp[] = []
): Promise<void> {
  const perm = await loadAccountPerm(account);
  if (perm === 'all') return;
  // 未命中角色（matched=false）→ noPagePerms() 全部 view:false，走下面统一判定 = 拒绝
  if (!mod) return;
  if (!canView(perm.resolved, mod)) {
    throw new ForbiddenError(`没有权限访问「${mod}」`);
  }
  if (ops.length > 0 && !ops.some((op) => canOper(perm.resolved, mod, op))) {
    throw new ForbiddenError(`没有权限在「${mod}」执行该操作`);
  }
}

/** 是否可修改「权限配置」（系统-权限管理） */
export async function canManagePerms(account: AuthAccount): Promise<boolean> {
  return canManage(account, 'perms');
}

/** 是否可修改首页/导航/基础信息等全局配置 */
export async function canManageHomeConfig(account: AuthAccount): Promise<boolean> {
  return canManage(account, 'homecfg');
}

async function canManage(account: AuthAccount, mod: PermModule): Promise<boolean> {
  const perm = await loadAccountPerm(account);
  if (perm === 'all') return true;
  return canView(perm.resolved, mod) && canOper(perm.resolved, mod, 'manage');
}
