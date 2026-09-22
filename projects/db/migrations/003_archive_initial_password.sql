-- 003: 档案级初始密码
--
-- 背景：人事管理/店仓管理/经销商/员工建档时可以填写「初始密码」，
-- 但 persons/dealers/stores/employees 四张表此前没有 password 列，
-- 该值被静默丢弃，登录账号一律使用系统默认初始密码（DEFAULT_INITIAL_PASSWORD），
-- 造成「管理员明明设了密码却登录不上」的问题。
--
-- 本次为四张业务表补上 password 列（明文仅作为「初始密码」语义存储，
-- 真正的登录凭据仍然以 scrypt 哈希存于 accounts 表）。

ALTER TABLE persons  ADD COLUMN IF NOT EXISTS password text;
ALTER TABLE dealers  ADD COLUMN IF NOT EXISTS password text;
ALTER TABLE stores   ADD COLUMN IF NOT EXISTS password text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS password text;
