# 数据库表结构（自动导出，请勿手改）

> 项目：店牛预警平台（warn_platform）
> 数据库：PostgreSQL 16
> 本文由 `node scripts/dump-schema.mjs` 从实际库导出，共 **31** 张表。
> 表结构以 `db/migrations/*.sql` 为准，改动请新增迁移文件后重新生成本文。

## 总览

| # | 表名 | 主键 | 外键数 | 说明 |
|---|------|------|--------|------|
| 1 | `accounts` | `id` | 0 | 登录账号。scrypt 加盐哈希，替代旧版分散在 dealers/stores/employees/persons 四张表里的明文密码列 |
| 2 | `alert_comments` | `id` | 3 | 工单的处理评论与回复 |
| 3 | `alert_rules` | `id` | 1 | 预警规则（含画布 nodes/edges、调度、适用对象） |
| 4 | `alert_task_dealers` | `task_id, dealer_id` | 2 | 工单 ↔ 经销商 关联 |
| 5 | `alert_task_status_log` | `id` | 2 | 工单状态变更流水（谁在何时改成了什么状态） |
| 6 | `alert_task_stores` | `task_id, store_id` | 2 | 工单 ↔ 店仓 关联，把 jsonb 里的 id 数组拆成真表，可按店仓直接查 |
| 7 | `alert_tasks` | `id` | 3 | 预警工单：规则命中后生成的一条待处理告警 |
| 8 | `app_config` | `id` | 0 | 全局配置（首页/登录页/导航/品牌）。单行表，id 固定为 singleton |
| 9 | `audit_log` | `id` | 0 | 操作审计日志。记录登录、改密、删除、清空等关键动作（旧版完全没有留痕） |
| 10 | `data_table_groups` | `id` | 0 | 数据表分组（文件夹） |
| 11 | `data_table_rows` | `table_id, row_index` | 1 | 数据表的行级存储：一行 = 一条记录。旧版把全部行塞进元数据的一个 jsonb，稍有数据量就撑爆请求 |
| 12 | `data_tables` | `id` | 1 | 上传的数据表元数据（字段定义、预览行、表间关联）。全量行另存 data_table_rows |
| 13 | `dealers` | `id` | 0 | 经销商字典。密码列已废弃，登录凭据统一在 accounts |
| 14 | `employees` | `id` | 2 | 员工字典，可归属经销商/店仓 |
| 15 | `health_check` | `id` | 0 | 健康检查表 |
| 16 | `hr_attributes` | `id` | 0 | 人事属性字典（职位/岗位/部门/经销商属性/店仓属性） |
| 17 | `organizations` | `id` | 1 | 组织架构（总部/分公司/部门/区域/门店），自引用成树 |
| 18 | `person_data_scopes` | `person_id` | 1 | 人员的自定义数据范围明细（自定义可见店仓集合等） |
| 19 | `person_perm_overrides` | `person_id` | 1 | 单个人员的权限覆盖，优先级高于角色模板。必须按 person_id 精确归属（旧版不看归属，导致一人覆盖作用于所有人） |
| 20 | `persons` | `id` | 4 | 人员，挂在组织节点下；岗位决定了角色模板的匹配键 |
| 21 | `roles` | `post, subject_kind` | 0 | 角色权限模板。按主体类型（岗位/经销商/店仓/员工）配置 pages 与 ops；未命中任何角色的账号走「全开」兜底 |
| 22 | `rule_edit_locks` | `rule_id` | 1 | 规则编辑锁，防多人同时编辑同一条规则 |
| 23 | `rule_executions` | `id` | 1 | 规则执行记录（计划/实际触发时间、结果、说明、历史） |
| 24 | `rule_groups` | `id` | 0 | 预警规则分组 |
| 25 | `rule_schedules` | `rule_id` | 1 | 规则调度配置（重复类型、时段、下次触发时间） |
| 26 | `schema_migrations` | `version` | 0 | 迁移版本记录，由 scripts/db.mjs 维护 |
| 27 | `sessions` | `token_hash` | 1 | 登录会话。只存 token 的 SHA-256 哈希，库被读走也无法直接冒用 |
| 28 | `stores` | `id` | 1 | 店仓字典，可归属经销商 |
| 29 | `sync_locks` | `lock_name` | 0 | 数据同步分布式锁，防同一任务并发执行 |
| 30 | `sync_resources` | `id` | 0 | 数据同步平台的通用资源表：旧版 8 张结构完全相同的表合并而来，用 type 区分（数据源/数据集/任务/实例/通道/审计）。文档型内容放 data，name/status 抽成真列便于检索统计 |
| 31 | `sync_watermarks` | `task_id` | 0 | 同步增量水位。值为真列（数值/文本各一），便于 SQL 比较，旧版埋在 jsonb 里只能取出来在内存比 |

## 表结构明细

### `accounts`

> 登录账号。scrypt 加盐哈希，替代旧版分散在 dealers/stores/employees/persons 四张表里的明文密码列

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `id` | varchar(64) | 否 | — |  |
| `username` | text | 否 | — |  |
| `password_hash` | text | 否 | — | 格式 scrypt$N$r$p$saltBase64$hashBase64；永不存明文 |
| `display_name` | text | 否 | `''::text` |  |
| `subject_type` | varchar(16) | 否 | `'person'::character varying` | 账号归属主体：admin / person / dealer / store / employee |
| `subject_id` | varchar(64) | 是 | — | 对应主体记录 id；admin 为 NULL。按此列反查权限角色 |
| `must_change_password` | boolean | 否 | `false` | 首次登录或被重置后为 true，前端强制改密 |
| `enabled` | boolean | 否 | `true` |  |
| `last_login_at` | timestamptz | 是 | — |  |
| `failed_attempts` | integer | 否 | `0` | 连续登录失败次数，达阈值即锁定 |
| `locked_until` | timestamptz | 是 | — | 锁定截止时间；NULL 表示未锁定 |
| `created_at` | timestamptz | 否 | `now()` |  |
| `updated_at` | timestamptz | 否 | `now()` |  |

**索引**

- `accounts_pkey`：public.accounts USING btree (id)
- `ix_accounts_subject`：public.accounts USING btree (subject_type, subject_id)
- `ux_accounts_username`：public.accounts USING btree (lower(username))

**触发器**：`trg_accounts_updated`

### `alert_comments`

> 工单的处理评论与回复

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `id` | varchar(64) | 否 | — |  |
| `task_id` | varchar(64) | 否 | — |  |
| `parent_id` | varchar(64) | 是 | — |  |
| `author` | text | 否 | `''::text` |  |
| `author_person_id` | varchar(64) | 是 | — |  |
| `text` | text | 否 | — |  |
| `created_at` | timestamptz | 否 | `now()` |  |
| `deleted_at` | timestamptz | 是 | — |  |

**外键**

| 列 | 引用 | 删除行为 |
|----|------|----------|
| `author_person_id` | `persons.id` | SET NULL |
| `parent_id` | `alert_comments.id` | CASCADE |
| `task_id` | `alert_tasks.id` | CASCADE |

**索引**

- `alert_comments_pkey`：public.alert_comments USING btree (id)
- `ix_alert_comments_parent`：public.alert_comments USING btree (parent_id)
- `ix_alert_comments_task`：public.alert_comments USING btree (task_id, created_at)

### `alert_rules`

> 预警规则（含画布 nodes/edges、调度、适用对象）

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `id` | varchar(64) | 否 | — |  |
| `name` | text | 否 | — |  |
| `group_id` | varchar(64) | 是 | — |  |
| `description` | text | 否 | `''::text` |  |
| `created_by` | text | 是 | — |  |
| `status` | varchar(16) | 否 | `'draft'::character varying` |  |
| `table_ids` | ARRAY | 否 | `'{}'::text[]` |  |
| `flow` | jsonb | 否 | `'{"edges": [], "nodes": []}'::jsonb` | 画布结构：{ nodes, edges }，属于文档型数据故用 jsonb |
| `targets` | jsonb | 否 | `'{}'::jsonb` |  |
| `created_at` | timestamptz | 否 | `now()` |  |
| `updated_at` | timestamptz | 否 | `now()` |  |
| `deleted_at` | timestamptz | 是 | — |  |

**外键**

| 列 | 引用 | 删除行为 |
|----|------|----------|
| `group_id` | `rule_groups.id` | SET NULL |

**CHECK 约束**

- `alert_rules_status_check`：CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'active'::character varying, 'paused'::character varying, 'ended'::character varying])::text[])))

**索引**

- `alert_rules_pkey`：public.alert_rules USING btree (id)
- `ix_alert_rules_group`：public.alert_rules USING btree (group_id) WHERE (deleted_at IS NULL)
- `ix_alert_rules_status`：public.alert_rules USING btree (status) WHERE (deleted_at IS NULL)

**触发器**：`trg_alert_rules_updated`

### `alert_task_dealers`

> 工单 ↔ 经销商 关联

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `task_id` | varchar(64) | 否 | — |  |
| `dealer_id` | varchar(64) | 否 | — |  |

**外键**

| 列 | 引用 | 删除行为 |
|----|------|----------|
| `dealer_id` | `dealers.id` | CASCADE |
| `task_id` | `alert_tasks.id` | CASCADE |

**索引**

- `alert_task_dealers_pkey`：public.alert_task_dealers USING btree (task_id, dealer_id)
- `ix_alert_task_dealers_dealer`：public.alert_task_dealers USING btree (dealer_id)

### `alert_task_status_log`

> 工单状态变更流水（谁在何时改成了什么状态）

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `id` | bigint | 否 | `nextval('alert_task_status_log_id_seq'::regclass)` |  |
| `task_id` | varchar(64) | 否 | — |  |
| `from_status` | varchar(16) | 是 | — |  |
| `to_status` | varchar(16) | 否 | — |  |
| `operator` | text | 是 | — |  |
| `operator_person_id` | varchar(64) | 是 | — |  |
| `note` | text | 是 | — |  |
| `at` | timestamptz | 否 | `now()` |  |

**外键**

| 列 | 引用 | 删除行为 |
|----|------|----------|
| `operator_person_id` | `persons.id` | SET NULL |
| `task_id` | `alert_tasks.id` | CASCADE |

**索引**

- `alert_task_status_log_pkey`：public.alert_task_status_log USING btree (id)
- `ix_alert_task_status_log_task`：public.alert_task_status_log USING btree (task_id, at)

### `alert_task_stores`

> 工单 ↔ 店仓 关联，把 jsonb 里的 id 数组拆成真表，可按店仓直接查

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `task_id` | varchar(64) | 否 | — |  |
| `store_id` | varchar(64) | 否 | — |  |

**外键**

| 列 | 引用 | 删除行为 |
|----|------|----------|
| `store_id` | `stores.id` | CASCADE |
| `task_id` | `alert_tasks.id` | CASCADE |

**索引**

- `alert_task_stores_pkey`：public.alert_task_stores USING btree (task_id, store_id)
- `ix_alert_task_stores_store`：public.alert_task_stores USING btree (store_id)

### `alert_tasks`

> 预警工单：规则命中后生成的一条待处理告警

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `id` | varchar(64) | 否 | — |  |
| `rule_id` | varchar(64) | 是 | — |  |
| `rule_name` | text | 否 | `''::text` |  |
| `level` | varchar(16) | 否 | `'warn'::character varying` |  |
| `priority` | varchar(32) | 是 | — |  |
| `title` | text | 否 | `''::text` |  |
| `content` | text | 否 | `''::text` |  |
| `reason` | text | 是 | — |  |
| `condition_desc` | text | 是 | — |  |
| `preview` | jsonb | 是 | — |  |
| `dept` | text | 否 | `''::text` |  |
| `assignee` | text | 否 | `''::text` |  |
| `assignee_person_id` | varchar(64) | 是 | — | 处理人对应的人员 id（人员 id 与显示名分离，重名也能准确归属） |
| `handoff_to` | text | 是 | — |  |
| `created_by` | text | 是 | — |  |
| `created_by_person_id` | varchar(64) | 是 | — |  |
| `status` | varchar(16) | 否 | `'new'::character varying` | 状态：new 待接收 / accepted 已接收 / processing 处理中 / done 已完成 / failed 无法处理 |
| `resolution` | text | 是 | — |  |
| `failed_reason` | text | 是 | — |  |
| `plan` | text | 是 | — |  |
| `notified` | ARRAY | 否 | `'{}'::text[]` |  |
| `accepted_at` | timestamptz | 是 | — |  |
| `started_at` | timestamptz | 是 | — |  |
| `handled_at` | timestamptz | 是 | — |  |
| `created_at` | timestamptz | 否 | `now()` |  |
| `updated_at` | timestamptz | 否 | `now()` |  |
| `deleted_at` | timestamptz | 是 | — |  |

**外键**

| 列 | 引用 | 删除行为 |
|----|------|----------|
| `assignee_person_id` | `persons.id` | SET NULL |
| `created_by_person_id` | `persons.id` | SET NULL |
| `rule_id` | `alert_rules.id` | SET NULL |

**CHECK 约束**

- `alert_tasks_level_check`：CHECK (((level)::text = ANY ((ARRAY['remind'::character varying, 'warn'::character varying, 'critical'::character varying])::text[])))
- `alert_tasks_priority_check`：CHECK (((priority IS NULL) OR ((priority)::text = ANY ((ARRAY['Important&Urgent'::character varying, 'Important'::character varying, 'Urgent'::character varying, 'Info'::character varying])::text[]))))
- `alert_tasks_status_check`：CHECK (((status)::text = ANY ((ARRAY['new'::character varying, 'accepted'::character varying, 'processing'::character varying, 'done'::character varying, 'failed'::character varying])::text[])))

**索引**

- `alert_tasks_pkey`：public.alert_tasks USING btree (id)
- `ix_alert_tasks_assignee`：public.alert_tasks USING btree (assignee_person_id, status) WHERE (deleted_at IS NULL)
- `ix_alert_tasks_created`：public.alert_tasks USING btree (created_at DESC) WHERE (deleted_at IS NULL)
- `ix_alert_tasks_rule`：public.alert_tasks USING btree (rule_id, status) WHERE (deleted_at IS NULL)
- `ix_alert_tasks_status`：public.alert_tasks USING btree (status, created_at DESC) WHERE (deleted_at IS NULL)

**触发器**：`trg_alert_tasks_updated`

### `app_config`

> 全局配置（首页/登录页/导航/品牌）。单行表，id 固定为 singleton

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `id` | varchar(64) | 否 | — |  |
| `data` | jsonb | 否 | `'{}'::jsonb` |  |
| `updated_at` | timestamptz | 否 | `now()` |  |

**索引**

- `app_config_pkey`：public.app_config USING btree (id)

**触发器**：`trg_app_config_updated`

### `audit_log`

> 操作审计日志。记录登录、改密、删除、清空等关键动作（旧版完全没有留痕）

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `id` | bigint | 否 | `nextval('audit_log_id_seq'::regclass)` |  |
| `at` | timestamptz | 否 | `now()` |  |
| `actor` | text | 是 | — | 操作人显示名；登录失败场景记的是尝试的用户名 |
| `actor_ip` | text | 是 | — |  |
| `action` | varchar(64) | 否 | — | 动作码，如 auth.login / auth.login.failed / state.delete / alert.clearAll |
| `target_type` | varchar(64) | 是 | — |  |
| `target_id` | varchar(64) | 是 | — |  |
| `detail` | jsonb | 是 | — | 动作上下文（如被删除的 id 列表） |

**索引**

- `audit_log_pkey`：public.audit_log USING btree (id)
- `ix_audit_log_actor`：public.audit_log USING btree (actor, at DESC)
- `ix_audit_log_at`：public.audit_log USING btree (at DESC)
- `ix_audit_log_target`：public.audit_log USING btree (target_type, target_id, at DESC)

### `data_table_groups`

> 数据表分组（文件夹）

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `id` | varchar(64) | 否 | — |  |
| `name` | text | 否 | — |  |
| `sort` | bigint | 否 | `0` |  |
| `created_at` | timestamptz | 否 | `now()` |  |
| `updated_at` | timestamptz | 否 | `now()` |  |
| `deleted_at` | timestamptz | 是 | — |  |

**索引**

- `data_table_groups_pkey`：public.data_table_groups USING btree (id)

**触发器**：`trg_data_table_groups_updated`

### `data_table_rows`

> 数据表的行级存储：一行 = 一条记录。旧版把全部行塞进元数据的一个 jsonb，稍有数据量就撑爆请求

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `table_id` | varchar(64) | 否 | — |  |
| `row_index` | integer | 否 | — | 行序号，与 table_id 构成主键，保证覆盖写入的顺序稳定 |
| `data` | jsonb | 否 | — |  |
| `updated_at` | timestamptz | 否 | `now()` |  |

**外键**

| 列 | 引用 | 删除行为 |
|----|------|----------|
| `table_id` | `data_tables.id` | CASCADE |

**索引**

- `data_table_rows_pkey`：public.data_table_rows USING btree (table_id, row_index)

### `data_tables`

> 上传的数据表元数据（字段定义、预览行、表间关联）。全量行另存 data_table_rows

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `id` | varchar(64) | 否 | — |  |
| `name` | text | 否 | — |  |
| `file_name` | text | 否 | `''::text` |  |
| `row_count` | bigint | 否 | `0` |  |
| `group_id` | varchar(64) | 是 | — |  |
| `fields` | jsonb | 否 | `'[]'::jsonb` | 字段定义数组（标签、类型、日期格式等） |
| `preview_rows` | jsonb | 否 | `'[]'::jsonb` | 仅预览用的小样本行，避免元数据接口过大 |
| `relations` | jsonb | 否 | `'[]'::jsonb` | 与其它表的关联关系（用于「添加关联」） |
| `prev_snapshot` | jsonb | 是 | — | 最近一次覆盖更新前的行快照，用于「返回上一步」 |
| `created_at` | timestamptz | 否 | `now()` |  |
| `updated_at` | timestamptz | 否 | `now()` |  |
| `deleted_at` | timestamptz | 是 | — |  |

**外键**

| 列 | 引用 | 删除行为 |
|----|------|----------|
| `group_id` | `data_table_groups.id` | SET NULL |

**索引**

- `data_tables_pkey`：public.data_tables USING btree (id)
- `ix_data_tables_alive`：public.data_tables USING btree (created_at) WHERE (deleted_at IS NULL)
- `ix_data_tables_group`：public.data_tables USING btree (group_id) WHERE (deleted_at IS NULL)

**触发器**：`trg_data_tables_updated`

### `dealers`

> 经销商字典。密码列已废弃，登录凭据统一在 accounts

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `id` | varchar(64) | 否 | — |  |
| `name` | text | 否 | — |  |
| `code` | text | 是 | — |  |
| `contact` | text | 是 | — |  |
| `phone` | text | 是 | — |  |
| `address` | text | 是 | — |  |
| `birthday` | text | 是 | — |  |
| `enabled` | boolean | 否 | `true` |  |
| `attrs` | jsonb | 否 | `'{}'::jsonb` |  |
| `province` | text | 是 | — |  |
| `city` | text | 是 | — |  |
| `district` | text | 是 | — |  |
| `sort` | bigint | 否 | `0` |  |
| `created_at` | timestamptz | 否 | `now()` |  |
| `updated_at` | timestamptz | 否 | `now()` |  |
| `deleted_at` | timestamptz | 是 | — |  |

**索引**

- `dealers_pkey`：public.dealers USING btree (id)
- `ix_dealers_alive`：public.dealers USING btree (sort) WHERE (deleted_at IS NULL)
- `ux_dealers_code`：public.dealers USING btree (code) WHERE ((deleted_at IS NULL) AND (code IS NOT NULL))

**触发器**：`trg_dealers_updated`

### `employees`

> 员工字典，可归属经销商/店仓

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `id` | varchar(64) | 否 | — |  |
| `code` | text | 是 | — |  |
| `name` | text | 否 | — |  |
| `dealer_id` | varchar(64) | 是 | — |  |
| `store_id` | varchar(64) | 是 | — |  |
| `post` | text | 是 | — |  |
| `on_duty` | boolean | 否 | `true` |  |
| `enabled` | boolean | 否 | `true` |  |
| `attrs` | jsonb | 否 | `'{}'::jsonb` |  |
| `sort` | bigint | 否 | `0` |  |
| `created_at` | timestamptz | 否 | `now()` |  |
| `updated_at` | timestamptz | 否 | `now()` |  |
| `deleted_at` | timestamptz | 是 | — |  |

**外键**

| 列 | 引用 | 删除行为 |
|----|------|----------|
| `dealer_id` | `dealers.id` | SET NULL |
| `store_id` | `stores.id` | SET NULL |

**索引**

- `employees_pkey`：public.employees USING btree (id)
- `ix_employees_dealer`：public.employees USING btree (dealer_id) WHERE (deleted_at IS NULL)
- `ix_employees_store`：public.employees USING btree (store_id) WHERE (deleted_at IS NULL)
- `ux_employees_code`：public.employees USING btree (code) WHERE ((deleted_at IS NULL) AND (code IS NOT NULL))

**触发器**：`trg_employees_updated`

### `health_check`

> 健康检查表

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `id` | integer | 否 | `nextval('health_check_id_seq'::regclass)` |  |
| `updated_at` | timestamptz | 否 | `now()` |  |

**索引**

- `health_check_pkey`：public.health_check USING btree (id)

### `hr_attributes`

> 人事属性字典（职位/岗位/部门/经销商属性/店仓属性）

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `id` | varchar(64) | 否 | — |  |
| `name` | text | 否 | — |  |
| `items` | jsonb | 否 | `'[]'::jsonb` |  |
| `category` | varchar(16) | 否 | `'person'::character varying` |  |
| `sort` | bigint | 否 | `0` |  |
| `created_at` | timestamptz | 否 | `now()` |  |
| `updated_at` | timestamptz | 否 | `now()` |  |
| `deleted_at` | timestamptz | 是 | — |  |

**CHECK 约束**

- `hr_attributes_category_check`：CHECK (((category)::text = ANY ((ARRAY['person'::character varying, 'dealer'::character varying, 'store'::character varying, 'employee'::character varying])::text[])))

**索引**

- `hr_attributes_pkey`：public.hr_attributes USING btree (id)

**触发器**：`trg_hr_attributes_updated`

### `organizations`

> 组织架构（总部/分公司/部门/区域/门店），自引用成树

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `id` | varchar(64) | 否 | — |  |
| `name` | text | 否 | — |  |
| `kind` | text | 否 | `'其他'::text` |  |
| `parent_id` | varchar(64) | 是 | — |  |
| `sort` | bigint | 否 | `0` |  |
| `created_at` | timestamptz | 否 | `now()` |  |
| `updated_at` | timestamptz | 否 | `now()` |  |
| `deleted_at` | timestamptz | 是 | — |  |

**外键**

| 列 | 引用 | 删除行为 |
|----|------|----------|
| `parent_id` | `organizations.id` | SET NULL |

**CHECK 约束**

- `organizations_kind_check`：CHECK ((kind = ANY (ARRAY['总部'::text, '分公司'::text, '部门'::text, '区域'::text, '门店'::text, '其他'::text])))

**索引**

- `ix_organizations_alive`：public.organizations USING btree (sort) WHERE (deleted_at IS NULL)
- `ix_organizations_parent`：public.organizations USING btree (parent_id)
- `organizations_pkey`：public.organizations USING btree (id)

**触发器**：`trg_organizations_updated`

### `person_data_scopes`

> 人员的自定义数据范围明细（自定义可见店仓集合等）

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `person_id` | varchar(64) | 否 | — |  |
| `table_id` | varchar(64) | 是 | — |  |
| `filters` | jsonb | 否 | `'[]'::jsonb` |  |
| `store_ids` | ARRAY | 否 | `'{}'::text[]` |  |
| `description` | text | 是 | — |  |
| `data` | jsonb | 否 | `'{}'::jsonb` |  |
| `updated_at` | timestamptz | 否 | `now()` |  |

**外键**

| 列 | 引用 | 删除行为 |
|----|------|----------|
| `person_id` | `persons.id` | CASCADE |

**索引**

- `ix_person_data_scopes_stores`：public.person_data_scopes USING gin (store_ids)
- `person_data_scopes_pkey`：public.person_data_scopes USING btree (person_id)

### `person_perm_overrides`

> 单个人员的权限覆盖，优先级高于角色模板。必须按 person_id 精确归属（旧版不看归属，导致一人覆盖作用于所有人）

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `person_id` | varchar(64) | 否 | — |  |
| `data` | jsonb | 否 | `'{}'::jsonb` |  |
| `updated_at` | timestamptz | 否 | `now()` |  |

**外键**

| 列 | 引用 | 删除行为 |
|----|------|----------|
| `person_id` | `persons.id` | CASCADE |

**索引**

- `person_perm_overrides_pkey`：public.person_perm_overrides USING btree (person_id)

**触发器**：`trg_person_perm_overrides_updated`

### `persons`

> 人员，挂在组织节点下；岗位决定了角色模板的匹配键

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `id` | varchar(64) | 否 | — |  |
| `name` | text | 否 | — |  |
| `org_id` | varchar(64) | 是 | — |  |
| `title` | text | 是 | — |  |
| `post` | text | 是 | — |  |
| `supervisor_id` | varchar(64) | 是 | — |  |
| `phone` | text | 是 | — |  |
| `email` | text | 是 | — |  |
| `username` | text | 是 | — |  |
| `id_card` | text | 是 | — |  |
| `address` | text | 是 | — |  |
| `birthday` | text | 是 | — |  |
| `dealer_id` | varchar(64) | 是 | — |  |
| `store_id` | varchar(64) | 是 | — |  |
| `enabled` | boolean | 否 | `true` |  |
| `sort` | bigint | 否 | `0` |  |
| `created_at` | timestamptz | 否 | `now()` |  |
| `updated_at` | timestamptz | 否 | `now()` |  |
| `deleted_at` | timestamptz | 是 | — |  |

**外键**

| 列 | 引用 | 删除行为 |
|----|------|----------|
| `dealer_id` | `dealers.id` | SET NULL |
| `org_id` | `organizations.id` | SET NULL |
| `store_id` | `stores.id` | SET NULL |
| `supervisor_id` | `persons.id` | SET NULL |

**索引**

- `ix_persons_org`：public.persons USING btree (org_id) WHERE (deleted_at IS NULL)
- `ix_persons_supervisor`：public.persons USING btree (supervisor_id)
- `persons_pkey`：public.persons USING btree (id)
- `ux_persons_username`：public.persons USING btree (lower(username)) WHERE ((deleted_at IS NULL) AND (username IS NOT NULL))

**触发器**：`trg_persons_updated`

### `roles`

> 角色权限模板。按主体类型（岗位/经销商/店仓/员工）配置 pages 与 ops；未命中任何角色的账号走「全开」兜底

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `post` | varchar(128) | 否 | — | 主体标识：岗位名，或经销商/店仓/员工的通用键 all |
| `subject_kind` | varchar(16) | 否 | `'post'::character varying` | 主体类型，与 post 共同构成主键 |
| `name` | text | 否 | `''::text` |  |
| `pages` | jsonb | 否 | `'{}'::jsonb` | 各页面权限：{ 模块: { view, ops:{ create,edit,delete,... } } } |
| `modules` | jsonb | 否 | `'{}'::jsonb` | 兼容旧数据的按模块授权结构，读取时迁移到 pages |
| `data_scope` | jsonb | 否 | `'{}'::jsonb` |  |
| `data_scope_type` | varchar(16) | 否 | `'self'::character varying` | 数据范围类型（从 data_scope 抽出成真列，便于 SQL 过滤） |
| `created_at` | timestamptz | 否 | `now()` |  |
| `updated_at` | timestamptz | 否 | `now()` |  |

**CHECK 约束**

- `roles_data_scope_type_check`：CHECK (((data_scope_type)::text = ANY ((ARRAY['all'::character varying, 'dealer'::character varying, 'store'::character varying, 'self'::character varying, 'managed'::character varying, 'custom'::character varying])::text[])))
- `roles_subject_kind_check`：CHECK (((subject_kind)::text = ANY ((ARRAY['post'::character varying, 'dealer'::character varying, 'store'::character varying, 'employee'::character varying])::text[])))

**索引**

- `roles_pkey`：public.roles USING btree (post, subject_kind)

**触发器**：`trg_roles_updated`

### `rule_edit_locks`

> 规则编辑锁，防多人同时编辑同一条规则

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `rule_id` | varchar(64) | 否 | — |  |
| `owner` | text | 否 | — |  |
| `acquired_at` | timestamptz | 否 | `now()` |  |
| `expires_at` | timestamptz | 否 | — |  |

**外键**

| 列 | 引用 | 删除行为 |
|----|------|----------|
| `rule_id` | `alert_rules.id` | CASCADE |

**索引**

- `ix_rule_edit_locks_expires`：public.rule_edit_locks USING btree (expires_at)
- `rule_edit_locks_pkey`：public.rule_edit_locks USING btree (rule_id)

### `rule_executions`

> 规则执行记录（计划/实际触发时间、结果、说明、历史）

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `id` | varchar(64) | 否 | — |  |
| `rule_id` | varchar(64) | 否 | — |  |
| `status` | varchar(16) | 否 | `'pending'::character varying` |  |
| `scheduled_at` | timestamptz | 是 | — |  |
| `triggered_at` | timestamptz | 是 | — |  |
| `next_trigger_at` | timestamptz | 是 | — |  |
| `completion_desc` | text | 是 | — |  |
| `action_note` | text | 是 | — |  |
| `history` | jsonb | 否 | `'[]'::jsonb` |  |
| `created_at` | timestamptz | 否 | `now()` |  |
| `updated_at` | timestamptz | 否 | `now()` |  |

**外键**

| 列 | 引用 | 删除行为 |
|----|------|----------|
| `rule_id` | `alert_rules.id` | CASCADE |

**CHECK 约束**

- `rule_executions_status_check`：CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'completed'::character varying, 'rescheduled'::character varying, 'ended'::character varying])::text[])))

**索引**

- `ix_rule_executions_rule`：public.rule_executions USING btree (rule_id, created_at DESC)
- `rule_executions_pkey`：public.rule_executions USING btree (id)

**触发器**：`trg_rule_executions_updated`

### `rule_groups`

> 预警规则分组

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `id` | varchar(64) | 否 | — |  |
| `name` | text | 否 | — |  |
| `created_at` | timestamptz | 否 | `now()` |  |
| `updated_at` | timestamptz | 否 | `now()` |  |
| `deleted_at` | timestamptz | 是 | — |  |

**索引**

- `rule_groups_pkey`：public.rule_groups USING btree (id)

**触发器**：`trg_rule_groups_updated`

### `rule_schedules`

> 规则调度配置（重复类型、时段、下次触发时间）

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `rule_id` | varchar(64) | 否 | — |  |
| `repeat_type` | varchar(16) | 否 | `'daily'::character varying` |  |
| `time_of_day` | varchar(8) | 是 | — |  |
| `weekdays` | ARRAY | 否 | `'{}'::integer[]` |  |
| `month_days` | ARRAY | 否 | `'{}'::integer[]` |  |
| `custom_interval` | integer | 否 | `1` |  |
| `start_date` | date | 是 | — |  |
| `end_date` | date | 是 | — |  |
| `next_trigger_at` | timestamptz | 是 | — |  |
| `enabled` | boolean | 否 | `true` |  |
| `updated_at` | timestamptz | 否 | `now()` |  |

**外键**

| 列 | 引用 | 删除行为 |
|----|------|----------|
| `rule_id` | `alert_rules.id` | CASCADE |

**CHECK 约束**

- `rule_schedules_repeat_type_check`：CHECK (((repeat_type)::text = ANY ((ARRAY['once'::character varying, 'daily'::character varying, 'weekly'::character varying, 'monthly'::character varying, 'custom'::character varying])::text[])))

**索引**

- `ix_rule_schedules_next`：public.rule_schedules USING btree (next_trigger_at) WHERE enabled
- `rule_schedules_pkey`：public.rule_schedules USING btree (rule_id)

**触发器**：`trg_rule_schedules_updated`

### `schema_migrations`

> 迁移版本记录，由 scripts/db.mjs 维护

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `version` | text | 否 | — |  |
| `applied_at` | timestamptz | 否 | `now()` |  |

**索引**

- `schema_migrations_pkey`：public.schema_migrations USING btree (version)

### `sessions`

> 登录会话。只存 token 的 SHA-256 哈希，库被读走也无法直接冒用

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `token_hash` | text | 否 | — | 会话令牌的 SHA-256（主键），明文 token 仅在 Cookie 中 |
| `account_id` | varchar(64) | 否 | — |  |
| `created_at` | timestamptz | 否 | `now()` |  |
| `expires_at` | timestamptz | 否 | — | 过期时间，过期行由后台清理 |
| `last_seen_at` | timestamptz | 否 | `now()` |  |
| `ip` | text | 是 | — |  |
| `user_agent` | text | 是 | — |  |

**外键**

| 列 | 引用 | 删除行为 |
|----|------|----------|
| `account_id` | `accounts.id` | CASCADE |

**索引**

- `ix_sessions_account`：public.sessions USING btree (account_id)
- `ix_sessions_expires`：public.sessions USING btree (expires_at)
- `sessions_pkey`：public.sessions USING btree (token_hash)

### `stores`

> 店仓字典，可归属经销商

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `id` | varchar(64) | 否 | — |  |
| `name` | text | 否 | — |  |
| `code` | text | 是 | — |  |
| `contact` | text | 是 | — |  |
| `phone` | text | 是 | — |  |
| `address` | text | 是 | — |  |
| `birthday` | text | 是 | — |  |
| `enabled` | boolean | 否 | `true` |  |
| `attrs` | jsonb | 否 | `'{}'::jsonb` |  |
| `dealer_id` | varchar(64) | 是 | — |  |
| `brand` | text | 是 | — |  |
| `company` | text | 是 | — |  |
| `department` | text | 是 | — |  |
| `sales_area` | text | 是 | — |  |
| `district` | text | 是 | — |  |
| `allow_retail` | boolean | 否 | `false` |  |
| `sort` | bigint | 否 | `0` |  |
| `created_at` | timestamptz | 否 | `now()` |  |
| `updated_at` | timestamptz | 否 | `now()` |  |
| `deleted_at` | timestamptz | 是 | — |  |

**外键**

| 列 | 引用 | 删除行为 |
|----|------|----------|
| `dealer_id` | `dealers.id` | SET NULL |

**索引**

- `ix_stores_alive`：public.stores USING btree (sort) WHERE (deleted_at IS NULL)
- `ix_stores_dealer`：public.stores USING btree (dealer_id) WHERE (deleted_at IS NULL)
- `stores_pkey`：public.stores USING btree (id)
- `ux_stores_code`：public.stores USING btree (code) WHERE ((deleted_at IS NULL) AND (code IS NOT NULL))

**触发器**：`trg_stores_updated`

### `sync_locks`

> 数据同步分布式锁，防同一任务并发执行

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `lock_name` | varchar(128) | 否 | — |  |
| `holder` | text | 是 | — |  |
| `acquired_at` | timestamptz | 否 | `now()` |  |
| `expires_at` | timestamptz | 是 | — |  |

**索引**

- `sync_locks_pkey`：public.sync_locks USING btree (lock_name)

### `sync_resources`

> 数据同步平台的通用资源表：旧版 8 张结构完全相同的表合并而来，用 type 区分（数据源/数据集/任务/实例/通道/审计）。文档型内容放 data，name/status 抽成真列便于检索统计

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `id` | varchar(64) | 否 | — |  |
| `type` | varchar(32) | 否 | — | 资源类型：sync_data_sources / sync_datasets / sync_tasks / sync_instances / sync_channels / sync_audit |
| `name` | text | 是 | — |  |
| `status` | varchar(32) | 是 | — |  |
| `data` | jsonb | 否 | `'{}'::jsonb` | 资源完整内容（各类型字段差异大，属文档型数据） |
| `created_at` | timestamptz | 否 | `now()` |  |
| `updated_at` | timestamptz | 否 | `now()` |  |

**CHECK 约束**

- `sync_resources_type_check`：CHECK (((type)::text = ANY ((ARRAY['data_source'::character varying, 'dataset'::character varying, 'task'::character varying, 'instance'::character varying, 'channel'::character varying, 'meta_cache'::character varying, 'audit'::character varying])::text[])))

**索引**

- `ix_sync_resources_type`：public.sync_resources USING btree (type, updated_at DESC)
- `sync_resources_pkey`：public.sync_resources USING btree (id)

**触发器**：`trg_sync_resources_updated`

### `sync_watermarks`

> 同步增量水位。值为真列（数值/文本各一），便于 SQL 比较，旧版埋在 jsonb 里只能取出来在内存比

| 列 | 类型 | 可空 | 默认 | 说明 |
|----|------|------|------|------|
| `task_id` | varchar(64) | 否 | — |  |
| `value_text` | text | 是 | — |  |
| `value_num` | bigint | 是 | — |  |
| `instance_id` | text | 是 | — |  |
| `updated_at` | timestamptz | 否 | `now()` |  |

**索引**

- `sync_watermarks_pkey`：public.sync_watermarks USING btree (task_id)

**触发器**：`trg_sync_watermarks_updated`
