import { pgTable, serial, timestamp, varchar, bigint, jsonb, index, text, primaryKey } from "drizzle-orm/pg-core"

// 系统健康检查表（禁止删除/修改）
export const healthCheck = pgTable("health_check", {
	id: serial().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

/**
 * 业务数据以「聚合根 + JSONB」方式持久化，前端直接读写整份对象，
 * 与 src/lib/types.ts 中的 DataTable / AlertRule 结构保持一致。
 * 单列建 GIN 索引，便于后续按内部字段检索。
 */

// 上传的数据表（字段标签 + 预览行）
export const dataTables = pgTable(
	"data_tables",
	{
		id: varchar("id", { length: 64 }).primaryKey(),
		name: varchar("name", { length: 255 }).notNull(),
		file_name: varchar("file_name", { length: 255 }).notNull().default(""),
		row_count: bigint("row_count", { mode: "number" }).notNull().default(0),
		created_at: bigint("created_at", { mode: "number" }).notNull(),
		data: jsonb("data").notNull(),
		updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
	},
	(table) => [
		index("data_tables_data_gin").using("gin", table.data),
		index("data_tables_created_idx").on(table.created_at),
	]
);

// 上传数据表的行拆解存储：一数据行 = 一条记录（单 jsonb），
// 用于支撑超大表（>20万行），避免整表塞进 data_tables.data 单 jsonb 超限。
export const dataTablesRow = pgTable(
	"data_tables_row",
	{
		id: varchar("id", { length: 64 }).notNull(),
		seq: bigint("seq", { mode: "number" }).notNull(),
		data: jsonb("data").notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.id, table.seq] }),
		index("data_tables_row_id_idx").on(table.id, table.seq),
		index("data_tables_row_id_gin").using("gin", table.data),
	]
);

// 预警规则（含画布 nodes/edges、调度、适用对象、执行记录）
export const alertRules = pgTable(
	"alert_rules",
	{
		id: varchar("id", { length: 64 }).primaryKey(),
		name: varchar("name", { length: 255 }).notNull(),
		status: varchar("status", { length: 32 }).notNull().default("draft"),
		created_at: bigint("created_at", { mode: "number" }).notNull(),
		updated_at_ms: bigint("updated_at_ms", { mode: "number" }).notNull(),
		data: jsonb("data").notNull(),
	},
	(table) => [
		index("alert_rules_status_idx").on(table.status),
		index("alert_rules_data_gin").using("gin", table.data),
	]
);

// 预警工单（由规则触发产生的待处理告警，一行一条）
export const alertTasks = pgTable(
	"alert_tasks",
	{
		id: varchar("id", { length: 64 }).primaryKey(),
		rule_id: varchar("rule_id", { length: 64 }).notNull().default(""),
		rule_name: varchar("rule_name", { length: 255 }).notNull().default(""),
		level: varchar("level", { length: 32 }).notNull().default("warn"),
		title: varchar("title", { length: 255 }).notNull().default(""),
		content: text("content").notNull().default(""),
		reason: text("reason"),
		condition_desc: text("condition_desc"),
		preview: jsonb("preview"),
		dept: varchar("dept", { length: 255 }).notNull().default(""),
		assignee: varchar("assignee", { length: 255 }).notNull().default(""),
		status: varchar("status", { length: 32 }).notNull().default("new"),
		handoff_to: varchar("handoff_to", { length: 255 }),
		created_at: bigint("created_at", { mode: "number" }).notNull(),
		updated_at: bigint("updated_at", { mode: "number" }).notNull(),
	},
	(table) => [
		index("alert_tasks_status_idx").on(table.status),
		index("alert_tasks_rule_idx").on(table.rule_id),
	]
);
