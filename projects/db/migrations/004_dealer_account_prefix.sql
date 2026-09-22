-- 004: 经销商登录账号统一加前缀 J
--
-- 背景：经销商编号与店仓编号共用同一套编码（例：3940001 既是经销商也是店仓）。
-- 两者都拿编号当登录账号时，accounts.username 的唯一索引（lower(username)）
-- 会让先同步的那一类把账号名占掉（本库实测：753 个店仓因此根本没建出账号，
-- 而用这些编号登录的店仓用户实际登进了同编号的经销商账号）。
--
-- 本次把经销商账号统一改为「J + 编号」，店仓/人员/员工仍直接用编号，
-- 两类主体的登录账号从此互不冲突。命名规则见 src/lib/types.ts 的 dealerLoginName()。

-- 1) 已有经销商账号改名（幂等：已带前缀的不动；目标名被别的账号占用则跳过）
UPDATE accounts a
   SET username = 'J' || btrim(d.code)
  FROM dealers d
 WHERE a.subject_type = 'dealer'
   AND a.subject_id = d.id
   AND d.code IS NOT NULL
   AND btrim(d.code) <> ''
   AND upper(a.username) <> upper('J' || btrim(d.code))
   AND NOT EXISTS (
     SELECT 1 FROM accounts b
      WHERE lower(b.username) = lower('J' || btrim(d.code))
        AND b.id <> a.id
   );

-- 2) 因编号被经销商占用而漏建的店仓/员工/人员账号，
--    跑 scripts/sync-login-accounts.mjs 补齐（需要按 auth.ts 的格式算 scrypt 哈希，
--    SQL 里做不了），脚本同时会再兜一遍上面的改名，确保两边一致。
