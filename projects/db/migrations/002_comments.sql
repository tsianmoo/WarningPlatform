-- ============================================================================
-- 002_comments.sql —— 表与关键列的注释
--
-- 目的：docs/DB_SCHEMA.md 由 scripts/dump-schema.mjs 从库里导出，
-- 注释写在库里、随迁移版本化，文档才不会随代码漂移。
-- ============================================================================

-- ---------- 账号与会话 ----------
COMMENT ON TABLE accounts IS '登录账号。scrypt 加盐哈希，替代旧版分散在 dealers/stores/employees/persons 四张表里的明文密码列';
COMMENT ON COLUMN accounts.password_hash IS '格式 scrypt$N$r$p$saltBase64$hashBase64；永不存明文';
COMMENT ON COLUMN accounts.subject_type IS '账号归属主体：admin / person / dealer / store / employee';
COMMENT ON COLUMN accounts.subject_id IS '对应主体记录 id；admin 为 NULL。按此列反查权限角色';
COMMENT ON COLUMN accounts.must_change_password IS '首次登录或被重置后为 true，前端强制改密';
COMMENT ON COLUMN accounts.failed_attempts IS '连续登录失败次数，达阈值即锁定';
COMMENT ON COLUMN accounts.locked_until IS '锁定截止时间；NULL 表示未锁定';

COMMENT ON TABLE sessions IS '登录会话。只存 token 的 SHA-256 哈希，库被读走也无法直接冒用';
COMMENT ON COLUMN sessions.token_hash IS '会话令牌的 SHA-256（主键），明文 token 仅在 Cookie 中';
COMMENT ON COLUMN sessions.expires_at IS '过期时间，过期行由后台清理';

COMMENT ON TABLE roles IS '角色权限模板。按主体类型（岗位/经销商/店仓/员工）配置 pages 与 ops；未命中任何角色的账号走「全开」兜底';
COMMENT ON COLUMN roles.post IS '主体标识：岗位名，或经销商/店仓/员工的通用键 all';
COMMENT ON COLUMN roles.subject_kind IS '主体类型，与 post 共同构成主键';
COMMENT ON COLUMN roles.pages IS '各页面权限：{ 模块: { view, ops:{ create,edit,delete,... } } }';
COMMENT ON COLUMN roles.data_scope_type IS '数据范围类型（从 data_scope 抽出成真列，便于 SQL 过滤）';
COMMENT ON COLUMN roles.modules IS '兼容旧数据的按模块授权结构，读取时迁移到 pages';

COMMENT ON TABLE person_perm_overrides IS '单个人员的权限覆盖，优先级高于角色模板。必须按 person_id 精确归属（旧版不看归属，导致一人覆盖作用于所有人）';
COMMENT ON TABLE person_data_scopes IS '人员的自定义数据范围明细（自定义可见店仓集合等）';

COMMENT ON TABLE audit_log IS '操作审计日志。记录登录、改密、删除、清空等关键动作（旧版完全没有留痕）';
COMMENT ON COLUMN audit_log.actor IS '操作人显示名；登录失败场景记的是尝试的用户名';
COMMENT ON COLUMN audit_log.action IS '动作码，如 auth.login / auth.login.failed / state.delete / alert.clearAll';
COMMENT ON COLUMN audit_log.detail IS '动作上下文（如被删除的 id 列表）';

-- ---------- 组织与人事 ----------
COMMENT ON TABLE organizations IS '组织架构（总部/分公司/部门/区域/门店），自引用成树';
COMMENT ON TABLE persons IS '人员，挂在组织节点下；岗位决定了角色模板的匹配键';
COMMENT ON TABLE dealers IS '经销商字典。密码列已废弃，登录凭据统一在 accounts';
COMMENT ON TABLE stores IS '店仓字典，可归属经销商';
COMMENT ON TABLE employees IS '员工字典，可归属经销商/店仓';
COMMENT ON TABLE hr_attributes IS '人事属性字典（职位/岗位/部门/经销商属性/店仓属性）';

-- ---------- 数据表 ----------
COMMENT ON TABLE data_tables IS '上传的数据表元数据（字段定义、预览行、表间关联）。全量行另存 data_table_rows';
COMMENT ON COLUMN data_tables.fields IS '字段定义数组（标签、类型、日期格式等）';
COMMENT ON COLUMN data_tables.preview_rows IS '仅预览用的小样本行，避免元数据接口过大';
COMMENT ON COLUMN data_tables.relations IS '与其它表的关联关系（用于「添加关联」）';
COMMENT ON COLUMN data_tables.prev_snapshot IS '最近一次覆盖更新前的行快照，用于「返回上一步」';

COMMENT ON TABLE data_table_rows IS '数据表的行级存储：一行 = 一条记录。旧版把全部行塞进元数据的一个 jsonb，稍有数据量就撑爆请求';
COMMENT ON COLUMN data_table_rows.row_index IS '行序号，与 table_id 构成主键，保证覆盖写入的顺序稳定';

COMMENT ON TABLE data_table_groups IS '数据表分组（文件夹）';

-- ---------- 预警规则与工单 ----------
COMMENT ON TABLE alert_rules IS '预警规则（含画布 nodes/edges、调度、适用对象）';
COMMENT ON COLUMN alert_rules.flow IS '画布结构：{ nodes, edges }，属于文档型数据故用 jsonb';
COMMENT ON TABLE rule_groups IS '预警规则分组';
COMMENT ON TABLE rule_schedules IS '规则调度配置（重复类型、时段、下次触发时间）';
COMMENT ON TABLE rule_executions IS '规则执行记录（计划/实际触发时间、结果、说明、历史）';
COMMENT ON TABLE rule_edit_locks IS '规则编辑锁，防多人同时编辑同一条规则';

COMMENT ON TABLE alert_tasks IS '预警工单：规则命中后生成的一条待处理告警';
COMMENT ON COLUMN alert_tasks.status IS '状态：new 待接收 / accepted 已接收 / processing 处理中 / done 已完成 / failed 无法处理';
COMMENT ON COLUMN alert_tasks.assignee_person_id IS '处理人对应的人员 id（人员 id 与显示名分离，重名也能准确归属）';
COMMENT ON TABLE alert_task_status_log IS '工单状态变更流水（谁在何时改成了什么状态）';
COMMENT ON TABLE alert_task_stores IS '工单 ↔ 店仓 关联，把 jsonb 里的 id 数组拆成真表，可按店仓直接查';
COMMENT ON TABLE alert_task_dealers IS '工单 ↔ 经销商 关联';
COMMENT ON TABLE alert_comments IS '工单的处理评论与回复';

-- ---------- 同步平台 ----------
COMMENT ON TABLE sync_resources IS '数据同步平台的通用资源表：旧版 8 张结构完全相同的表合并而来，用 type 区分（数据源/数据集/任务/实例/通道/审计）。文档型内容放 data，name/status 抽成真列便于检索统计';
COMMENT ON COLUMN sync_resources.type IS '资源类型：sync_data_sources / sync_datasets / sync_tasks / sync_instances / sync_channels / sync_audit';
COMMENT ON COLUMN sync_resources.data IS '资源完整内容（各类型字段差异大，属文档型数据）';
COMMENT ON TABLE sync_watermarks IS '同步增量水位。值为真列（数值/文本各一），便于 SQL 比较，旧版埋在 jsonb 里只能取出来在内存比';
COMMENT ON TABLE sync_locks IS '数据同步分布式锁，防同一任务并发执行';

-- ---------- 框架 ----------
COMMENT ON TABLE app_config IS '全局配置（首页/登录页/导航/品牌）。单行表，id 固定为 singleton';
COMMENT ON TABLE schema_migrations IS '迁移版本记录，由 scripts/db.mjs 维护';
COMMENT ON TABLE health_check IS '健康检查表';
