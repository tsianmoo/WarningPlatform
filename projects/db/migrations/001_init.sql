-- ============================================================================
-- 店牛预警平台 · 初始化 schema
-- 版本：001_init
-- 目标库：本地 PostgreSQL 16
--
-- 设计原则（与旧版「整对象 JSONB」的关键差异）：
--   1. 凡是「要被查询、约束、统计、审计」的字段，一律抽成真列 + 索引 + 外键。
--   2. 只有「永远整份读写、不在 DB 内检索」的文档型数据才留 jsonb
--      （如规则画布 flow、上传表的字段标签 fields、工单命中快照 preview）。
--   3. 全库统一：主键 varchar(64)、时间一律 timestamptz、业务表均带
--      created_at / updated_at / deleted_at，updated_at 由触发器维护。
--   4. 写入一律增量：不存在「以入参为准删除其余行」的语义。
--   5. 删除一律软删除（deleted_at），唯一约束用 partial unique index 兼容软删。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. 基础设施
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     text PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now()
);

-- 平台健康检查表（扣子运行时依赖，保留）
CREATE TABLE IF NOT EXISTS health_check (
    id          serial PRIMARY KEY,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- updated_at 自动维护，避免依赖客户端时钟
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 1. 应用配置（替代旧 home_config：页面样式留 jsonb，权限已独立成表）
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app_config (
    id          varchar(64) PRIMARY KEY,
    data        jsonb       NOT NULL DEFAULT '{}'::jsonb,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_app_config_updated ON app_config;
CREATE TRIGGER trg_app_config_updated BEFORE UPDATE ON app_config
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. 认证（新增：旧版把密码明文散落在 4 张业务表里，且校验在浏览器完成）
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS accounts (
    id              varchar(64) PRIMARY KEY,
    username        text        NOT NULL,
    password_hash   text        NOT NULL,
    display_name    text        NOT NULL DEFAULT '',
    -- 归属主体类型：person | dealer | store | employee | admin
    subject_type    varchar(16) NOT NULL DEFAULT 'person',
    subject_id      varchar(64),
    -- 首次登录/重置后必须改密
    must_change_password boolean NOT NULL DEFAULT false,
    enabled         boolean      NOT NULL DEFAULT true,
    last_login_at   timestamptz,
    failed_attempts integer      NOT NULL DEFAULT 0,
    locked_until    timestamptz,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_accounts_username ON accounts (lower(username));
CREATE INDEX IF NOT EXISTS ix_accounts_subject ON accounts (subject_type, subject_id);

DROP TRIGGER IF EXISTS trg_accounts_updated ON accounts;
CREATE TRIGGER trg_accounts_updated BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 服务端会话：token 只存哈希，明文只在 cookie 里
CREATE TABLE IF NOT EXISTS sessions (
    token_hash  text        PRIMARY KEY,
    account_id  varchar(64) NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    ip          text,
    user_agent  text
);
CREATE INDEX IF NOT EXISTS ix_sessions_account ON sessions (account_id);
CREATE INDEX IF NOT EXISTS ix_sessions_expires ON sessions (expires_at);

-- ---------------------------------------------------------------------------
-- 3. 组织与主数据
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS organizations (
    id          varchar(64) PRIMARY KEY,
    name        text        NOT NULL,
    kind        text        NOT NULL DEFAULT '其他'
                CHECK (kind IN ('总部','分公司','部门','区域','门店','其他')),
    parent_id   varchar(64) REFERENCES organizations(id) ON DELETE SET NULL,
    sort        bigint      NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS ix_organizations_parent ON organizations (parent_id);
CREATE INDEX IF NOT EXISTS ix_organizations_alive ON organizations (sort) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_organizations_updated ON organizations;
CREATE TRIGGER trg_organizations_updated BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS dealers (
    id          varchar(64) PRIMARY KEY,
    name        text        NOT NULL,
    code        text,
    contact     text,
    phone       text,
    address     text,
    birthday    text,
    enabled     boolean     NOT NULL DEFAULT true,
    attrs       jsonb       NOT NULL DEFAULT '{}'::jsonb,
    province    text,
    city        text,
    district    text,
    sort        bigint      NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_dealers_code ON dealers (code) WHERE deleted_at IS NULL AND code IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_dealers_alive ON dealers (sort) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_dealers_updated ON dealers;
CREATE TRIGGER trg_dealers_updated BEFORE UPDATE ON dealers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS stores (
    id           varchar(64) PRIMARY KEY,
    name         text        NOT NULL,
    code         text,
    contact      text,
    phone        text,
    address      text,
    birthday     text,
    enabled      boolean     NOT NULL DEFAULT true,
    attrs        jsonb       NOT NULL DEFAULT '{}'::jsonb,
    dealer_id    varchar(64) REFERENCES dealers(id) ON DELETE SET NULL,
    brand        text,
    company      text,
    department   text,
    sales_area   text,
    district     text,
    allow_retail boolean     NOT NULL DEFAULT false,
    sort         bigint      NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    deleted_at   timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_stores_code ON stores (code) WHERE deleted_at IS NULL AND code IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_stores_dealer ON stores (dealer_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_stores_alive ON stores (sort) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_stores_updated ON stores;
CREATE TRIGGER trg_stores_updated BEFORE UPDATE ON stores
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS employees (
    id          varchar(64) PRIMARY KEY,
    code        text,
    name        text        NOT NULL,
    dealer_id   varchar(64) REFERENCES dealers(id) ON DELETE SET NULL,
    store_id    varchar(64) REFERENCES stores(id)  ON DELETE SET NULL,
    post        text,
    on_duty     boolean     NOT NULL DEFAULT true,
    enabled     boolean     NOT NULL DEFAULT true,
    attrs       jsonb       NOT NULL DEFAULT '{}'::jsonb,
    sort        bigint      NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_employees_code ON employees (code) WHERE deleted_at IS NULL AND code IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_employees_store ON employees (store_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_employees_dealer ON employees (dealer_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_employees_updated ON employees;
CREATE TRIGGER trg_employees_updated BEFORE UPDATE ON employees
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS persons (
    id            varchar(64) PRIMARY KEY,
    name          text        NOT NULL,
    org_id        varchar(64) REFERENCES organizations(id) ON DELETE SET NULL,
    title         text,
    post          text,
    supervisor_id varchar(64) REFERENCES persons(id) ON DELETE SET NULL,
    phone         text,
    email         text,
    username      text,
    id_card       text,
    address       text,
    birthday      text,
    dealer_id     varchar(64) REFERENCES dealers(id) ON DELETE SET NULL,
    store_id      varchar(64) REFERENCES stores(id)  ON DELETE SET NULL,
    enabled       boolean     NOT NULL DEFAULT true,
    sort          bigint      NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    deleted_at    timestamptz
);
CREATE INDEX IF NOT EXISTS ix_persons_org ON persons (org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_persons_supervisor ON persons (supervisor_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_persons_username ON persons (lower(username)) WHERE deleted_at IS NULL AND username IS NOT NULL;

DROP TRIGGER IF EXISTS trg_persons_updated ON persons;
CREATE TRIGGER trg_persons_updated BEFORE UPDATE ON persons
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 人事属性字典
CREATE TABLE IF NOT EXISTS hr_attributes (
    id          varchar(64) PRIMARY KEY,
    name        text        NOT NULL,
    items       jsonb       NOT NULL DEFAULT '[]'::jsonb,
    category    varchar(16) NOT NULL DEFAULT 'person'
                CHECK (category IN ('person','dealer','store','employee')),
    sort        bigint      NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);

DROP TRIGGER IF EXISTS trg_hr_attributes_updated ON hr_attributes;
CREATE TRIGGER trg_hr_attributes_updated BEFORE UPDATE ON hr_attributes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 人员数据权限范围（替代旧 persons.manage_scope 单 jsonb）
-- 语义：管理范围 = 在 table_id 这张表里，按 filters 筛出的门店集合 ∪ store_ids
-- data 列保留完整原对象（ManageScope 字段较多且整份被 UI 读写），
-- filters / store_ids / table_id 抽为真列，供服务端做数据权限判定。
CREATE TABLE IF NOT EXISTS person_data_scopes (
    person_id   varchar(64) PRIMARY KEY REFERENCES persons(id) ON DELETE CASCADE,
    table_id    varchar(64),
    filters     jsonb       NOT NULL DEFAULT '[]'::jsonb,
    store_ids   text[]      NOT NULL DEFAULT '{}',
    description text,
    data        jsonb       NOT NULL DEFAULT '{}'::jsonb,
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_person_data_scopes_stores
    ON person_data_scopes USING gin (store_ids);

-- ---------------------------------------------------------------------------
-- 4. 上传的数据表
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS data_table_groups (
    id          varchar(64) PRIMARY KEY,
    name        text        NOT NULL,
    sort        bigint      NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);

DROP TRIGGER IF EXISTS trg_data_table_groups_updated ON data_table_groups;
CREATE TRIGGER trg_data_table_groups_updated BEFORE UPDATE ON data_table_groups
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 元数据表：结构化列 + 文档型 jsonb（fields / previewRows / relations / prev 快照）
-- 关键修正：分组用 group_id 外键（旧版靠「名称字符串」匹配），行数据不在本表
CREATE TABLE IF NOT EXISTS data_tables (
    id            varchar(64) PRIMARY KEY,
    name          text        NOT NULL,
    file_name     text        NOT NULL DEFAULT '',
    row_count     bigint      NOT NULL DEFAULT 0,
    group_id      varchar(64) REFERENCES data_table_groups(id) ON DELETE SET NULL,
    fields        jsonb       NOT NULL DEFAULT '[]'::jsonb,
    preview_rows  jsonb       NOT NULL DEFAULT '[]'::jsonb,
    relations     jsonb       NOT NULL DEFAULT '[]'::jsonb,
    prev_snapshot jsonb,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    deleted_at    timestamptz
);
CREATE INDEX IF NOT EXISTS ix_data_tables_group ON data_tables (group_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_data_tables_alive ON data_tables (created_at) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_data_tables_updated ON data_tables;
CREATE TRIGGER trg_data_tables_updated BEFORE UPDATE ON data_tables
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 行级存储：一数据行 = 一条记录
-- 关键修正：row_index 只是排序位次不是身份；改用事务内批量 upsert，
--           避免旧版「先 DELETE 全表再 INSERT」导致并发读到空表
CREATE TABLE IF NOT EXISTS data_table_rows (
    table_id   varchar(64) NOT NULL REFERENCES data_tables(id) ON DELETE CASCADE,
    row_index  integer     NOT NULL,
    data       jsonb       NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (table_id, row_index)
);

-- ---------------------------------------------------------------------------
-- 5. 预警规则
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rule_groups (
    id          varchar(64) PRIMARY KEY,
    name        text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);

DROP TRIGGER IF EXISTS trg_rule_groups_updated ON rule_groups;
CREATE TRIGGER trg_rule_groups_updated BEFORE UPDATE ON rule_groups
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 规则主表。flow（画布 nodes/edges）保留 jsonb：
--   它是一份「永远整份读写、不在 DB 内检索」的文档，强行拆节点/连线表
--   只会让读写变复杂而无查询收益。但调度、执行记录、引用表必须结构化。
CREATE TABLE IF NOT EXISTS alert_rules (
    id          varchar(64) PRIMARY KEY,
    name        text        NOT NULL,
    group_id    varchar(64) REFERENCES rule_groups(id) ON DELETE SET NULL,
    description text        NOT NULL DEFAULT '',
    created_by  text,
    status      varchar(16) NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','active','paused','ended')),
    table_ids   text[]      NOT NULL DEFAULT '{}',
    flow        jsonb       NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
    targets     jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS ix_alert_rules_group ON alert_rules (group_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_alert_rules_status ON alert_rules (status) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_alert_rules_updated ON alert_rules;
CREATE TRIGGER trg_alert_rules_updated BEFORE UPDATE ON alert_rules
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 调度：调度器必须按 next_trigger_at 扫表，所以必须结构化（旧版藏在 rule.data jsonb 里）
CREATE TABLE IF NOT EXISTS rule_schedules (
    rule_id         varchar(64) PRIMARY KEY REFERENCES alert_rules(id) ON DELETE CASCADE,
    repeat_type     varchar(16) NOT NULL DEFAULT 'daily'
                    CHECK (repeat_type IN ('once','daily','weekly','monthly','custom')),
    time_of_day     varchar(8),
    weekdays        integer[]   NOT NULL DEFAULT '{}',
    month_days      integer[]   NOT NULL DEFAULT '{}',
    custom_interval integer     NOT NULL DEFAULT 1,
    start_date      date,
    end_date        date,
    next_trigger_at timestamptz,
    enabled         boolean     NOT NULL DEFAULT true,
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_rule_schedules_next ON rule_schedules (next_trigger_at) WHERE enabled;

DROP TRIGGER IF EXISTS trg_rule_schedules_updated ON rule_schedules;
CREATE TRIGGER trg_rule_schedules_updated BEFORE UPDATE ON rule_schedules
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 执行记录：独立成表，可按规则+时间查询统计（旧版藏在 alert_rules.data jsonb 数组里）
CREATE TABLE IF NOT EXISTS rule_executions (
    id               varchar(64) PRIMARY KEY,
    rule_id          varchar(64) NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    status           varchar(16) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','completed','rescheduled','ended')),
    scheduled_at     timestamptz,
    triggered_at     timestamptz,
    next_trigger_at  timestamptz,
    completion_desc  text,
    action_note      text,
    history          jsonb       NOT NULL DEFAULT '[]'::jsonb,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_rule_executions_rule ON rule_executions (rule_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_rule_executions_updated ON rule_executions;
CREATE TRIGGER trg_rule_executions_updated BEFORE UPDATE ON rule_executions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 规则编辑锁（替代旧版塞在 home_config.config.locks 里的 jsonb）
CREATE TABLE IF NOT EXISTS rule_edit_locks (
    rule_id     varchar(64) PRIMARY KEY REFERENCES alert_rules(id) ON DELETE CASCADE,
    owner       text        NOT NULL,
    acquired_at timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_rule_edit_locks_expires ON rule_edit_locks (expires_at);

-- ---------------------------------------------------------------------------
-- 6. 预警工单
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS alert_tasks (
    id              varchar(64) PRIMARY KEY,
    rule_id         varchar(64) REFERENCES alert_rules(id) ON DELETE SET NULL,
    -- 规则名保留为「触发时快照」仅供展示；归属关系以 rule_id 外键为准
    rule_name       text        NOT NULL DEFAULT '',
    level           varchar(16) NOT NULL DEFAULT 'warn'
                    CHECK (level IN ('remind','warn','critical')),
    priority        varchar(32)
                    CHECK (priority IS NULL OR priority IN ('Important&Urgent','Important','Urgent','Info')),
    title           text        NOT NULL DEFAULT '',
    content         text        NOT NULL DEFAULT '',
    reason          text,
    condition_desc  text,
    -- 命中快照：整份文档型数据，保留 jsonb
    preview         jsonb,
    dept            text        NOT NULL DEFAULT '',
    -- 旧版把「人名」当外键存，改名/重名即断链；这里补人员外键，名称列仅做展示快照
    assignee           text        NOT NULL DEFAULT '',
    assignee_person_id varchar(64) REFERENCES persons(id) ON DELETE SET NULL,
    handoff_to         text,
    created_by         text,
    created_by_person_id varchar(64) REFERENCES persons(id) ON DELETE SET NULL,
    status          varchar(16) NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new','accepted','processing','done','failed')),
    resolution      text,
    failed_reason   text,
    plan            text,
    notified        text[]      NOT NULL DEFAULT '{}',
    accepted_at     timestamptz,
    started_at      timestamptz,
    handled_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);
CREATE INDEX IF NOT EXISTS ix_alert_tasks_status  ON alert_tasks (status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_alert_tasks_rule    ON alert_tasks (rule_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_alert_tasks_assignee ON alert_tasks (assignee_person_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_alert_tasks_created ON alert_tasks (created_at DESC) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_alert_tasks_updated ON alert_tasks;
CREATE TRIGGER trg_alert_tasks_updated BEFORE UPDATE ON alert_tasks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 状态流转历史（替代旧版「只有最后一次时间戳」→ 现在可完整审计）
CREATE TABLE IF NOT EXISTS alert_task_status_log (
    id        bigserial   PRIMARY KEY,
    task_id   varchar(64) NOT NULL REFERENCES alert_tasks(id) ON DELETE CASCADE,
    from_status varchar(16),
    to_status   varchar(16) NOT NULL,
    operator    text,
    operator_person_id varchar(64) REFERENCES persons(id) ON DELETE SET NULL,
    note      text,
    at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_alert_task_status_log_task ON alert_task_status_log (task_id, at);

-- 留言（替代旧版 comments jsonb 内嵌 replies：现在可分页、可审计、并发不互相覆盖）
CREATE TABLE IF NOT EXISTS alert_comments (
    id        varchar(64) PRIMARY KEY,
    task_id   varchar(64) NOT NULL REFERENCES alert_tasks(id) ON DELETE CASCADE,
    parent_id varchar(64) REFERENCES alert_comments(id) ON DELETE CASCADE,
    author    text        NOT NULL DEFAULT '',
    author_person_id varchar(64) REFERENCES persons(id) ON DELETE SET NULL,
    text      text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_alert_comments_task ON alert_comments (task_id, created_at);
CREATE INDEX IF NOT EXISTS ix_alert_comments_parent ON alert_comments (parent_id);

-- 工单归属：门店 / 经销商（替代旧版塞在对象里、存不下来的 storeIds / dealerIds）
CREATE TABLE IF NOT EXISTS alert_task_stores (
    task_id  varchar(64) NOT NULL REFERENCES alert_tasks(id) ON DELETE CASCADE,
    store_id varchar(64) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, store_id)
);
CREATE INDEX IF NOT EXISTS ix_alert_task_stores_store ON alert_task_stores (store_id);

CREATE TABLE IF NOT EXISTS alert_task_dealers (
    task_id   varchar(64) NOT NULL REFERENCES alert_tasks(id) ON DELETE CASCADE,
    dealer_id varchar(64) NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, dealer_id)
);
CREATE INDEX IF NOT EXISTS ix_alert_task_dealers_dealer ON alert_task_dealers (dealer_id);

-- ---------------------------------------------------------------------------
-- 7. 权限（旧版把这些全塞进 home_config.config，无审计、无法单独授权、RLS 下推不了）
-- ---------------------------------------------------------------------------

-- 角色 = 岗位 / 经销商 / 店仓 / 员工 四类权限主体。
-- pages / data_scope 是「整份被 UI 读写」的配置文档，保留 jsonb；
-- 但权限主体标识与类型抽成列以便检索与约束。
CREATE TABLE IF NOT EXISTS roles (
    -- 权限主体标识：岗位名，或 dealer/store/employee 的编号
    post            varchar(128) NOT NULL,
    subject_kind    varchar(16)  NOT NULL DEFAULT 'post'
                    CHECK (subject_kind IN ('post','dealer','store','employee')),
    name            text         NOT NULL DEFAULT '',
    pages           jsonb        NOT NULL DEFAULT '{}'::jsonb,
    modules         jsonb        NOT NULL DEFAULT '{}'::jsonb,
    data_scope      jsonb        NOT NULL DEFAULT '{}'::jsonb,
    data_scope_type varchar(16)  NOT NULL DEFAULT 'self'
                    CHECK (data_scope_type IN ('all','dealer','store','self','managed','custom')),
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (post, subject_kind)
);

DROP TRIGGER IF EXISTS trg_roles_updated ON roles;
CREATE TRIGGER trg_roles_updated BEFORE UPDATE ON roles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS person_perm_overrides (
    person_id  varchar(64) PRIMARY KEY REFERENCES persons(id) ON DELETE CASCADE,
    data       jsonb       NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_person_perm_overrides_updated ON person_perm_overrides;
CREATE TRIGGER trg_person_perm_overrides_updated BEFORE UPDATE ON person_perm_overrides
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 8. 审计日志（旧版业务侧完全空白）
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_log (
    id          bigserial   PRIMARY KEY,
    at          timestamptz NOT NULL DEFAULT now(),
    actor       text,
    actor_ip    text,
    action      varchar(64) NOT NULL,
    target_type varchar(64),
    target_id   varchar(64),
    detail      jsonb
);
CREATE INDEX IF NOT EXISTS ix_audit_log_at ON audit_log (at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_log_target ON audit_log (target_type, target_id, at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_log_actor ON audit_log (actor, at DESC);

-- ---------------------------------------------------------------------------
-- 9. 数据同步（旧版 8 张结构完全相同的表 → 合并为一张 + type 列）
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sync_resources (
    id          varchar(64) PRIMARY KEY,
    type        varchar(32) NOT NULL
                CHECK (type IN ('data_source','dataset','task','instance','channel','meta_cache','audit')),
    name        text,
    status      varchar(32),
    data        jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_sync_resources_type ON sync_resources (type, updated_at DESC);

DROP TRIGGER IF EXISTS trg_sync_resources_updated ON sync_resources;
CREATE TRIGGER trg_sync_resources_updated BEFORE UPDATE ON sync_resources
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 增量水位：值抽成真列，才能用 SQL 比较（旧版塞在 jsonb 里比不了）
CREATE TABLE IF NOT EXISTS sync_watermarks (
    task_id      varchar(64) PRIMARY KEY,
    value_text   text,
    value_num    bigint,
    instance_id  text,
    updated_at   timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_sync_watermarks_updated ON sync_watermarks;
CREATE TRIGGER trg_sync_watermarks_updated BEFORE UPDATE ON sync_watermarks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS sync_locks (
    lock_name   varchar(128) PRIMARY KEY,
    holder      text,
    acquired_at timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz
);

-- ---------------------------------------------------------------------------
-- 10. 便捷视图：库中每个表的行数（仅供运维排查）
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_table_stats AS
SELECT relname AS table_name, n_live_tup AS live_rows
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC;

-- 迁移记录
INSERT INTO schema_migrations (version) VALUES ('001_init')
ON CONFLICT (version) DO NOTHING;
