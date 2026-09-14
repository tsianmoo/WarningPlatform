// ============ 数据类型定义 ============

/** 字段类型 */
export type FieldType = 'string' | 'number' | 'date' | 'boolean';

/** 数据表字段（已标签化） */
export interface TableField {
  key: string; // 原始列名
  alias: string; // 标签名称（中文别名）
  type: FieldType;
  tagColor: string; // 标签颜色
  sample: string; // 样例值
}

/** 上传的数据表 */
export interface DataTable {
  id: string;
  name: string;
  fileName: string;
  createdAt: number;
  rowCount: number;
  fields: TableField[];
  /** 预览用前若干行 */
  previewRows: Record<string, string>[];
  /** 全量行（用于预览聚合/统计计算；为空时回退 previewRows） */
  rows?: Record<string, string | number | boolean>[];
  /** 关联到该表的其它表（用于"添加关联"） */
  relations?: TableRelation[];
}

/** 表间关联 */
export interface TableRelation {
  id: string;
  fieldKey: string; // 本表关联字段
  targetTable: string; // 关联目标表名
  targetField: string; // 目标表字段
  name: string;
}

// ============ 流程节点 ============

/** 节点类型 */
export type NodeKind =
  | 'trigger' // 开始
  | 'field' // 数据字段
  | 'condition' // 判断（如果/且/或）
  | 'compute' // 计算（聚合）
  | 'lookup' // 查找（跨表引用/匹配）
  | 'relation' // 关联
  | 'action' // 预警动作（终点）
  | 'time' // 时间窗口（今天/本周/本月…）
  | 'topn' // 排名取数（按维度分组、指标排序、取前N）
  | 'diff' // 反匹配/差集（基准表在排查表中没有匹配记录的行）
  | 'groupby' // 分组聚合（按维度分组，对指标求和/平均等，输出每组的值）
  | 'baseline' // 基准统计（对一组数值统计 平均/中位/最高/最低，输出一个基准值）
  | 'rank' // 排名（对每列按升降序算排名，并生成可配置的 TOP 分档）
  | 'filljoin' // 左关联补全（以全集表为准左关联事实结果，缺失键按固定值补 0）
  | 'base' // 基础数据（从一张表取一列去重值，如店仓表→全部店仓）
  | 'filter' // 过滤（对某表按多条件筛选行，支持搜索多选/单选）
  | 'elapsed' // 已过天数（本周/月/季/年或自定义区间，已过去的天数，标量）
  | 'logic'; // 逻辑关联（如果/且/或），串联多个判断

/** 比较运算符 */
export type Operator =
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'eq'
  | 'neq'
  | 'contains'
  | 'empty'
  | 'notEmpty'
  | 'between' // 在区间 [min, max]
  | 'notBetween' // 不在区间
  | 'before' // 早于（日期）
  | 'after'; // 晚于（日期）

/** 表字段引用（用于选择"哪张表的哪个字段"） */
export interface FieldRef {
  tableId: string;
  tableName: string;
  fieldKey: string;
  fieldLabel: string;
}

/** 节点输出引用（引用另一个节点算出的结果：标量基准值 或 分组列） */
export interface NodeResultRef {
  /** 被引用的节点 id */
  nodeId: string;
  /** 被引用的节点类型 */
  nodeKind: NodeKind;
  /** 显示名（如：全店平均成交 / 8月成交金额） */
  label: string;
  /** 输出形态：scalar=单个值（如全店均值）；column=逐行/逐组值（如每店成交） */
  outputKind: 'scalar' | 'column';
  /** 被引用节点的具体列（同一节点结果内两列运算时使用，如 售罄率 = 店铺成交 ÷ 库存数量） */
  col?: string;
  colLabel?: string;
}

/** 字段节点数据 */
export interface FieldNodeData extends FieldRef {
  fieldType?: FieldType;
  /** 数据来源：数据表 / 上游节点输出（默认数据表） */
  source?: DataSourceKind;
  sourceNode?: string;
  sourceNodeLabel?: string;
}

/** 时间单位 */
export type TimeUnit = 'day' | 'week' | 'month';

/** 时间窗口预设（今天/昨天/近N天/本周/本月…） */
export type TimePreset =
  | 'today'
  | 'yesterday'
  | 'dayBefore'
  | 'recent3'
  | 'recent7'
  | 'recent14'
  | 'recent30'
  | 'thisWeek'
  | 'weekToDate' // 本周至今（周一到今天）
  | 'lastWeek'
  | 'twoWeeksAgo'
  | 'thisMonth'
  | 'monthToDate' // 本月至今（1号到今天）
  | 'lastMonth'
  | 'twoMonthsAgo'
  | 'thisQuarter'
  | 'quarterToDate' // 本季至今（季初到今天）
  | 'thisYear'
  | 'yearToDate' // 本年至今（年初到今天）
  | 'specificMonth' // 指定月份（如：2025-08）
  | 'custom'
  | 'all'; // 不限日期（不限定统计时间窗）

/** 时间窗口配置 */
export interface TimeWindow {
  preset: TimePreset;
  /** 自定义（近 N 天/周/月） */
  custom?: { value: number; unit: TimeUnit };
  /** 指定月份（YYYY-MM，preset=specificMonth 时使用） */
  month?: string;
  /** 对比配置（同期 / 环期），启用后在页面上并排展示本期与对比期两列 */
  compare?: {
    enabled?: boolean;
    /** 对比模式：yoY=同期(去年同段) ring=环期(上移时间段) */
    mode?: 'yoY' | 'ring';
    /** 环期上移的单位数（默认 1） */
    shift?: number;
  };
}

/** 已解析的对比窗口（同期 / 环期） */
export interface ResolvedCompare {
  enabled: boolean;
  mode: 'yoY' | 'ring';
  start: Date;
  end: Date;
  label: string;
}

/** 条件节点数据 */
export interface ConditionNodeData extends Partial<FieldRef> {
  /** 结果命名（如：本月未开单判断），便于在画布/下游区分多个判断节点 */
  resultLabel?: string;
  logic: 'AND' | 'OR'; // 与上一节点的连接逻辑：且 / 或
  operator: Operator;
  /** 比较右值来源：常量 / 引用另一表字段 / 引用另一节点的结果 */
  valueSource: 'const' | 'field' | 'node';
  value: string; // 常量值 / 区间下界
  valueMax: string; // 区间上界
  /** 引用字段（与其它表字段对比） */
  refValue?: FieldRef;
  /** 引用节点结果（如：基准统计输出的全店均值） */
  refNode?: NodeResultRef;
  /** 左值（被比较对象）来源：上游字段节点 / 表字段 / 上游节点输出列（如查找聚合的每店成交） */
  leftSource: 'auto' | 'field' | 'node';
  /** 左值引用的节点结果（逐组值，如"8月成交金额"列） */
  leftNode?: NodeResultRef;
  /** 多条件组：对左值结果的每一行逐条件判断（每条件取结果的一个列）。
   *  存在且非空时优先于上面的单条件（operator/value）逻辑。 */
  conditions?: ConditionItem[];
  /** 条件组内部连接逻辑：and=全部满足（且），or=任一条满足（或）。默认 and */
  conditionJoin?: 'and' | 'or';
  /** 指定评估的时间窗口（如：本周） */
  timeWindow?: TimeWindow;
  /** 持续条件：连续 N 个时间单位都满足（如连续4天） */
  durationEnabled?: boolean;
  durationN?: number;
  durationUnit?: TimeUnit;
}

/** 判断节点的单条条件：针对左值结果的一列做一次判断。
 *  - op 为 'empty' / 'notEmpty' 时不看 values；
 *  - 其它 op 时按「值集合任一中命中」判断（values 含 '' 表示把"空"也视为命中）。
 */
export interface ConditionItem {
  /** 判断列（左值结果中的字段 key） */
  col?: string;
  colLabel?: string;
  op?: Operator;
  /** 可匹配的值集合；含 '' 表示匹配"空" */
  values?: string[];
  /**
   * 右值来源：'values'（常量集合）或 'node'（引用节点标量，如基准统计均值）。
   * 当为 'node' 时用 refNode 指向的节点标量与左值做大小比较。
   */
  rightSource?: 'values' | 'node';
  /** 引用节点（基准统计/标量），rightSource='node' 时有效 */
  refNode?: NodeResultRef;
}

/** 聚合函数 */
export type AggFn = 'sum' | 'avg' | 'count' | 'max' | 'min' | 'countDistinct' | 'activeDays';

/** 算术运算符（四则） */
export type ArithmeticOp = 'add' | 'sub' | 'mul' | 'div';

/**
 * 结构化（点选式）表达式的一个片段：
 * - 'field'：引用主表某一列（col 为列 key，label 为展示名）
 * - 'op'：四则运算符
 * - 'paren'：括号 '(' / ')'
 * - 'num'：常量数字
 */
export type ExprToken =
  | { kind: 'field'; col: string; label?: string }
  | { kind: 'op'; op: ArithmeticOp }
  | { kind: 'paren'; paren: '(' | ')' }
  | { kind: 'num'; value: string };

/** 计算节点二次运算：左操作数 与 右操作数 做四则运算 */
export interface ComputeExpr {
  op: ArithmeticOp;
  /**
   * 左操作数来源：
   * - 'self'：本节点的聚合结果（需选择计算字段+聚合），此时用 order 控制左右顺序
   * - 'node'：直接引用另一个节点结果（两个节点结果直接运算，无需字段聚合，如 已过天数 - 开单天数）
   */
  leftType: 'self' | 'node';
  /** 左操作数引用的节点（leftType='node' 时） */
  left?: NodeResultRef;
  /** leftType='self' 时的左右顺序：聚合在前（聚合 <op> 右） 或 右在前（右 <op> 聚合） */
  order?: 'self_first' | 'ref_first';
  /** 右操作数来源：引用节点结果 或 常量 */
  refType: 'node' | 'const';
  /** 右操作数引用的节点输出（标量/列，如"开单天数"） */
  ref?: NodeResultRef;
  /** 常量值（refType='const' 时） */
  constValue?: string;
  /**
   * 组合表达式（可选）。当设置时，以 left 引用节点的结果表（或 right 引用节点的结果表）为主表，
   * 对每一行把表达式中出现的列名替换为行内的数值，再按四则运算求值（支持 + - * / 与括号）。
   * 例如 售罄率 = "数量/(数量+库存汇总)"。优先级高于 op/ref 结构化运算。
   */
  exprText?: string;
  /**
   * 结构化（点选式）表达式片段序列。设置后优先于 exprText 与 op/ref 逐行求值。
   * 片段只能引用 left 引用节点结果表中的列（如 [数量] ÷ ([数量] + [库存汇总])）。
   */
  tokens?: ExprToken[];
}

/** 计算（聚合）节点数据 */
export interface ComputeNodeData extends Partial<FieldRef> {
  fn: AggFn;
  resultLabel: string;
  /** 数据来源：数据表 / 上游节点输出（默认数据表） */
  source?: DataSourceKind;
  sourceNode?: string;
  sourceNodeLabel?: string;
  /** 日期字段（用于按时间窗聚合过滤） */
  dateField?: string;
  dateFieldLabel?: string;
  /** 聚合统计的时间窗口（如：本周） */
  timeWindow?: TimeWindow;
  /** 计算结果对比 */
  compare?: { op: Operator; value: string } | null;
  /** 与其它组件节点结果做二次运算（如：已过天数 - 开单天数） */
  expr?: ComputeExpr | null;
}

/** 查找（跨表）节点数据 */
export interface LookupNodeData {
  /** 查询模式：field=返回单字段值；aggregate=在目标表中按匹配键聚合后带回 */
  mode?: 'field' | 'aggregate';
  /** 数据来源：数据表 / 上游节点输出（默认数据表） */
  source?: DataSourceKind;
  sourceNode?: string;
  sourceNodeLabel?: string;
  /** 查询目标表（B） */
  tableId: string;
  tableName: string;
  /** 目标表匹配字段 */
  matchField: string;
  matchFieldLabel: string;
  /** 规则侧匹配键来源（来自另一表 / 计算结果的字段） */
  key: FieldRef;
  /** 目标表要返回的字段（field 模式） */
  returnField: string;
  returnFieldLabel: string;
  returnLabel: string;

  // —— aggregate 聚合模式：在 B 表中按 matchField 分组，对汇总字段聚合后带回 ——
  /** B 表日期字段（用于时间窗过滤） */
  dateField?: string;
  dateFieldLabel?: string;
  /** 统计时间窗（指定日期/月份/本周…） */
  timeWindow?: TimeWindow;
  /** 聚合方式（求和/平均/计数/最大/最小） */
  aggFn?: AggFn;
  /** 汇总字段（如：成交金额/销售金额） */
  aggField?: string;
  aggFieldLabel?: string;
  /** 匹配键无记录时的填充值（默认 0） */
  fillZero?: boolean;
  /** 聚合结果命名（如：成交金额） */
  aggLabel?: string;
}

/** 数据源来源：数据表 或 上游节点输出结果 */
export type DataSourceKind = 'table' | 'node';

/** 基础数据节点数据：从一张数据表（或上一步节点结果）中取出某一列的全部去重值（维度全集，如店仓表→店仓列） */
export interface BaseNodeData extends Partial<FieldRef> {
  /** 数据来源：数据表 / 上游节点输出（默认数据表） */
  source?: DataSourceKind;
  /** 引用的上游节点 id（source==='node' 时） */
  sourceNode?: string;
  sourceNodeLabel?: string;
  /** 数据源表（如：店仓表） */
  tableId: string;
  tableName: string;
  /** 取用的维度字段（如：店仓列） */
  fieldKey: string;
  fieldLabel: string;
  /** 结果命名（如：全部店仓） */
  resultLabel: string;
  /** 勾选的输出列（支持多列）。为空时回退到 fieldKey 单列。 */
  columns?: { key: string; label: string }[];
  /** 是否去重（仅当勾选单列时有效；多列时强制不去重） */
  distinct?: boolean;
}

/** 关联节点数据 */
export interface RelationNodeData extends Partial<FieldRef> {
  targetTableId: string;
  targetTable: string;
  targetField: string;
  relationType: 'inner' | 'left';
  name: string;
}

/** 排名取数（TopN）节点数据：按维度分组，对指标聚合后排序，取前 N 名 */
export interface TopNNodeData {
  /** 数据来源：数据表 / 上游节点输出（默认数据表） */
  source?: DataSourceKind;
  sourceNode?: string;
  sourceNodeLabel?: string;
  /** 数据源表 */
  tableId: string;
  tableName: string;
  /** 分组维度字段（如：款色） */
  groupField: string;
  groupFieldLabel: string;
  /** 排名指标字段（如：销量/销售额） */
  metricField: string;
  metricFieldLabel: string;
  /** 指标聚合方式 */
  metricFn: 'sum' | 'count' | 'avg' | 'max';
  /** 排序方向 */
  order: 'desc' | 'asc';
  /** 取前 N 名 */
  topN: number;
  /** 用于圈定时间窗的日期字段（如：日期/统计日期列） */
  dateField: string;
  dateFieldLabel: string;
  /** 统计时间窗口（如：本周） */
  timeWindow?: TimeWindow;
  /** 结果命名（如：本周销量第1款色） */
  resultLabel: string;
}

/** 反匹配/差集节点数据：基准表中的行，在排查表里找不到满足条件的记录 */
export interface DiffNodeData {
  /** 基准表（全集，如：店仓主表） */
  baseTableId: string;
  baseTableName: string;
  /** 基准表用于对照的键字段（如：店仓编码） */
  baseField: string;
  baseFieldLabel: string;
  /** 排查表（明细，如：销售明细表） */
  checkTableId: string;
  checkTableName: string;
  /** 排查表中用于匹配基准键的字段（如：店仓编码） */
  checkField: string;
  checkFieldLabel: string;
  /** 排查表的过滤维度字段（可选，如：款色） */
  filterField: string;
  filterFieldLabel: string;
  /** 过滤维度的取值：常量（指定款色）或 引用上游 TopN 结果（暂以文本标注） */
  filterValueSource: 'const' | 'topn';
  filterValue: string;
  /** 排查表中用于圈定时间窗的日期字段（如：日期/销售日期） */
  dateField: string;
  dateFieldLabel: string;
  /** 统计时间窗口（如：本周） */
  timeWindow?: TimeWindow;
  /** 结果命名（如：本周无销售店仓） */
  resultLabel: string;
}

/** 分组聚合节点数据：按维度分组，对指标聚合，输出每个分组的值（搭积木原子） */
/** 日期分组粒度：按年/按月/按周/按天 */
export type DateGranularity = 'year' | 'month' | 'week' | 'day';

/** 单个分组维度 */
export interface GroupDim {
  /** 维度字段 key（表内列名） */
  fieldKey: string;
  /** 维度字段显示名 */
  fieldLabel?: string;
  /** 当维度字段为日期类型时的分组粒度 */
  granularity?: DateGranularity;
}

/** 分组聚合节点的单个聚合指标：字段 + 聚合方式（支持对文本字段做计数/去重计数） */
export interface GroupMetric {
  id: string;
  /** 指标字段 key（如 单据编号 / 店仓名称 / 成交金额） */
  fieldKey: string;
  /** 指标字段显示名 */
  fieldLabel?: string;
  /** 聚合方式：求和/计数/平均/最大/最小/去重计数/开单天数 */
  fn: 'sum' | 'count' | 'avg' | 'max' | 'min' | 'countDistinct' | 'activeDays';
  /** 该指标的结果列名（默认取 fn(字段名)） */
  resultLabel?: string;
}

/** 过滤条件运算符 */
export type FilterOp = 'eq' | 'neq' | 'in' | 'nin' | 'contains';

/** 单条过滤条件 */
export interface FilterCondition {
  id: string;
  fieldKey: string;
  fieldLabel: string;
  op: FilterOp;
  /** 单选取值（eq/neq/contains 用） */
  value: string;
  /** 多选取值（in/nin 用） */
  values: string[];
}

export interface GroupByNodeData {
  /** 数据来源：数据表 / 上游节点输出（默认数据表） */
  source?: DataSourceKind;
  sourceNode?: string;
  sourceNodeLabel?: string;
  /** 事实/明细表（如：零售工作薄5） */
  tableId: string;
  tableName: string;
  /** 用于圈定时间窗的日期字段 */
  dateField: string;
  dateFieldLabel: string;
  /** 统计时间窗口（如：指定月份 8月） */
  timeWindow?: TimeWindow;
  /** 分组维度字段（如：店仓），兼容保留首个维度 */
  groupField: string;
  groupFieldLabel: string;
  /** 多分组维度：每个维度一个字段；日期字段可带粒度（按年/月/周/天） */
  dims: GroupDim[];
  /** 指标字段（如：成交金额/销售金额） */
  metricField: string;
  metricFieldLabel: string;
  /** 指标聚合方式：求和/计数/平均/最大/最小/去重计数/开单天数 */
  metricFn: 'sum' | 'count' | 'avg' | 'max' | 'min' | 'countDistinct' | 'activeDays';
  /** 多指标聚合（优先于 metricField/metricFn）：每个指标一个字段 + 聚合方式 */
  metrics?: GroupMetric[];
  /** 结果命名（如：8月各店仓成交金额） */
  resultLabel: string;
}

/** 排名节点：对若干指标列按升/降序算排名，并生成可配置的 TOP 分档 */
export interface RankItem {
  id: string;
  /** 被排名的指标列（key 或 label） */
  fieldKey: string;
  fieldLabel: string;
  /** 升序(asc，值最小排第1) / 降序(desc，值最大排第1) */
  order: 'asc' | 'desc';
  /** 排序方式：whole=全量排序；group=按分组维度在组内排序 */
  mode: 'whole' | 'group';
  /** 分组维度（mode=group 时生效）：字段key列表，按序分组 */
  groupBy: { key: string; label: string }[];
  /** 排出 TOP 档：如 top10（前10%）、top10-20（10%~20%） */
  topTiersEnabled: boolean;
  /** 档位配置：title + 下限(含)/上限(不含)百分比，如 [{label:'TOP1',from:0,to:10},{label:'TOP2',from:10,to:20}] */
  topTiers: { label: string; from: number; to: number }[];
  /** 该排名的输出列名（如：连带率排名） */
  rankLabel: string;
}

export interface RankNodeData {
  /** 数据来源：dataTable 数据表 / node 节点结果 */
  source: 'table' | 'node';
  tableId?: string;
  /** 来源节点的列（用于列名提示） */
  incomingCols?: { key: string; label: string; type?: string }[];
  /** 来源节点输出 */
  refNode?: NodeResultRef;
  /** 日期字段（用于按时间窗圈定排名范围；数据表无日期字段时可留空=不限时间） */
  dateField?: string;
  dateFieldLabel?: string;
  /** 统计时间窗（可选，仅对时间窗内的记录计算排名） */
  timeWindow?: TimeWindow;
  /** 多个排名项 */
  items: RankItem[];
  resultLabel: string;
}

/** 过滤条件：对某表的行做筛选，支持单值/多值 */
export interface FilterCondition {
  id: string;
  fieldKey: string;
  fieldLabel: string;
  op: 'eq' | 'neq' | 'in' | 'nin' | 'contains';
  /** 单选/单值算子（eq/neq/contains）使用的值 */
  value: string;
  /** 多选算子（in/nin）使用的值集合 */
  values: string[];
  /** 右值来源：const=常量/下拉取值（默认）；node=引用上游节点结果值（如排名取数第一名） */
  valueSource?: 'const' | 'node';
  /** valueSource=node 时，引用的节点 id */
  refNodeId?: string;
  /** valueSource=node 时，引用节点的展示名 */
  refNodeLabel?: string;
  /** valueSource=node 时，引用节点输出中的列名（缺省取首列，如排名取数的分组列“款色”） */
  refColumn?: string;
  /** valueSource=node 时，引用列的展示名 */
  refColumnLabel?: string;
}

/** 过滤节点数据：对某张表（或上一步节点结果）按一个或多个条件筛选记录行 */
export interface FilterNodeData {
  /** 数据来源：数据表 / 上游节点输出（默认数据表） */
  source?: DataSourceKind;
  sourceNode?: string;
  sourceNodeLabel?: string;
  tableId: string;
  tableName: string;
  conditions: FilterCondition[];
  resultLabel: string;
}

/** 基准统计节点数据：对一组数值统计 平均/中位/最高/最低，输出一个基准值（搭积木原子） */
export interface BaselineNodeData {
  /** 数据来源：node=引用上游节点输出的逐组列（推荐）；table=直接选数据表数值列 */
  source?: 'node' | 'table';
  /** 引用的上游节点输出（source=node 时）：逐组列，如查找/分组聚合输出的「每店8月成交」 */
  refNode?: NodeResultRef;
  /** 数据来源表（source=table 时，通常是上游分组聚合对应的表） */
  tableId: string;
  tableName: string;
  /** 待统计的数值字段（source=table 时，如：成交金额/成交额结果列） */
  valueField: string;
  valueFieldLabel: string;
  /** 分组维度（可多个字段，空=对全部取值求一个基准；非空=按维度分组后各求基准） */
  dims?: { key: string; label: string }[];
  /**
   * 统计方式：
   * avg=所有分组平均；median=中位数；max=最高；min=最低；
   * topAvg=按指标降序取前 percent% 店铺的平均；bottomAvg=按指标降序取后 percent% 店铺的平均
   */
  baselineFn: 'avg' | 'median' | 'max' | 'min' | 'topAvg' | 'bottomAvg';
  /** topAvg/bottomAvg 取数百分比（1-100），默认 20，即取前/后 20% 店铺 */
  percent?: number;
  /** 结果命名（如：全店平均成交金额） */
  resultLabel: string;
}

/** 左关联补全节点数据：以全集表为准左关联事实结果，缺失键按固定值补 0（搭积木原子） */
/** 事实结果来源：数据表 / 上游节点结果 */
export type FillJoinFactSource = 'table' | 'node';

export interface FillJoinNodeData {
  /** 全集/主数据表（如：店仓表，含所有店仓） */
  universeTableId: string;
  universeTableName: string;
  /** 全集表里的键字段（如：店仓名称/编码） */
  universeField: string;
  universeFieldLabel: string;
  /** 事实结果来源：数据表 / 上游节点结果（默认数据表，兼容旧规则） */
  factSource?: FillJoinFactSource;
  /** 事实来源为"节点结果"时，引用的上游节点 id / 名称（如分组聚合"9月店仓开单天数"） */
  factNode?: string;
  factNodeLabel?: string;
  /** 事实结果侧的表（如：按店仓聚合的结果，来自分组聚合） */
  factTableId: string;
  factTableName: string;
  /** 事实结果侧用于匹配的键字段（与全集表键同义）；节点模式下可留空，默认取结果首列 */
  factKeyField: string;
  factKeyFieldLabel: string;
  /** 缺失键填充值（默认 0） */
  fillValue: string;
  /** 结果命名（如：含 0 成交的全部门店） */
  resultLabel: string;
  /** 追加复合匹配键（多对键，如：全集.店仓=事实.店仓 + 全集.款色=事实.款色） */
  extraKeys?: Array<{
    universeField: string;
    universeFieldLabel?: string;
    factField: string;
    factFieldLabel?: string;
  }>;
  /** 全集返回列：为空时默认返回全部列；可多选（universeReturnFields）或单列兼容（universeReturnField） */
  universeReturnField?: string;
  universeReturnLabel?: string;
  universeReturnFields?: Array<{ key: string; label: string }>;
  /** 全集来源：table（默认，选数据表）或 node（节点结果，如前一补全结果）。universeNodeId 为该节点 id */
  universeSource?: 'table' | 'node';
  universeNodeId?: string;
  /** 事实侧仅带回的指标列（如「库存」）。不填则带回事实侧所有非键列；填了则只保留该列，避免冗余杂列 */
  factReturnField?: string;
  factReturnLabel?: string;
}

/** 预警动作节点数据 */
export interface ActionNodeData {
  /** 类型：提醒 / 预警（新结构，替代 level） */
  type?: 'remind' | 'alert';
  /** 重要等级（仅 type=alert 时选择）：重要且紧急 / 重要不紧急 / 紧急但不重要 / 一般 */
  priority?: 'Important&Urgent' | 'Important' | 'Urgent' | 'Info';
  /** 旧级别字段，存量兼容（remind/warn/critical），新数据不再使用 */
  level?: 'remind' | 'warn' | 'critical';
  title: string;
  /** 提醒文案（预警描述），支持 {字段名} 模板占位，触发时替换为命中行实际值 */
  content?: string;
  /** 本动作独立的通知对象（部门/人员），不随其它动作联动 */
  notify?: TargetSetting;
  /** 命中数据来源（上游节点）：预览与触发时从此节点取命中的行/列 */
  sourceNode?: NodeResultRef;
  /** 是否启用本动作：false 表示关闭，激活时不生成对应预警（默认 true） */
  enabled?: boolean;
}

/** 时间窗口节点数据 */
export interface TimeNodeData {
  timeWindow: TimeWindow;
}

/** 逻辑关联节点数据：如果 / 且 / 或 */
export interface LogicNodeData {
  logic: 'if' | 'and' | 'or';
}

/** 已过天数节点统计范围 */
export type ElapsedScope = 'week' | 'month' | 'quarter' | 'year' | 'custom';

/** 已过天数节点数据：输出当前周期/自定义区间从起点到今天已过去的天数（标量） */
export interface ElapsedNodeData {
  scope: ElapsedScope;
  /** 结果命名（如：本月已过天数） */
  resultLabel?: string;
  /** scope=custom 时的区间起始（YYYY-MM-DD，含） */
  customStart?: string;
  /** scope=custom 时的区间结束（YYYY-MM-DD，含，默认今天） */
  customEnd?: string;
  /** 当天是否计入已过天数：true=含今天（默认）；false=不含今天（统计到昨天） */
  includeToday?: boolean;
}

/** 流程节点 */
export interface FlowNode {
  id: string;
  kind: NodeKind;
  data:
    | FieldNodeData
    | ConditionNodeData
    | ComputeNodeData
    | LookupNodeData
    | RelationNodeData
    | ActionNodeData
    | TimeNodeData
    | TopNNodeData
    | DiffNodeData
    | GroupByNodeData
    | BaselineNodeData
    | RankNodeData
    | FillJoinNodeData
    | BaseNodeData
    | LogicNodeData
    | FilterNodeData
    | ElapsedNodeData
    | Record<string, unknown>;
  position: { x: number; y: number };
}

/** 流程连线 */
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
}

// ============ 调度 ============

export type RepeatType = 'once' | 'daily' | 'weekly' | 'monthly' | 'custom';

export interface Schedule {
  repeatType: RepeatType;
  /** 每日触发时刻 HH:mm */
  timeOfDay: string;
  /** 周重复：选中的星期（1-7，周一=1） */
  weekdays: number[];
  /** 月重复：选中的日期（1-31） */
  monthDays: number[];
  /** 自定义间隔（天） */
  customInterval: number;
  /** 生效开始时间（YYYY-MM-DD） */
  startDate: string;
  /** 生效结束时间（YYYY-MM-DD），可空表示长期 */
  endDate: string;
  /** 下次触发时间（ISO） */
  nextTriggerAt: string;
}

// ============ 通知对象 ============

export interface TargetSetting {
  /** 适用部门 */
  departments: string[];
  /** 适用人员 */
  personnel: string[];
  /** 适用组织（组织架构 id 列表） */
  orgIds?: string[];
  /** 适用人员（人事架构人员 id 列表） */
  personIds?: string[];
}

// ============ 执行跟踪 ============

export type ExecutionStatus = 'pending' | 'completed' | 'rescheduled' | 'ended';

export interface ExecutionRecord {
  id: string;
  ruleId: string;
  /** 本次计划触发时间 */
  scheduledAt: string;
  /** 实际触发时间 */
  triggeredAt: string;
  status: ExecutionStatus;
  /** 完成过程的描述 */
  completionDesc?: string;
  /** 完成后下次还要触发 */
  nextTriggerAt?: string;
  /** 最近一次状态变动的操作说明 */
  actionNote?: string;
  history?: { at: string; note: string }[];
}

// ============ 预警规则 ============

export type RuleStatus = 'draft' | 'active' | 'paused' | 'ended';

/** 规则分组 */
export interface RuleGroup {
  id: string;
  name: string;
  createdAt: number;
}

export interface AlertRule {
  id: string;
  name: string;
  /** 所属规则分组 id（空串表示未分组） */
  groupId?: string;
  description: string;
  /** 本规则使用到的数据表 id 列表（支持多表） */
  tableIds: string[];
  status: RuleStatus;
  createdAt: number;
  updatedAt: number;
  flow: { nodes: FlowNode[]; edges: FlowEdge[] };
  schedule: Schedule;
  targets: TargetSetting;
  executions: ExecutionRecord[];
}

// ============ 内置部门 / 人员 ============

export const DEPARTMENTS = ['风控部', '运营部', '数据部', '安全部', '财务部', '客服部'];
export const PERSONNEL = [
  { name: '张伟', dept: '风控部' },
  { name: '李娜', dept: '运营部' },
  { name: '王强', dept: '数据部' },
  { name: '刘敏', dept: '风控部' },
  { name: '陈杰', dept: '安全部' },
  { name: '杨静', dept: '客服部' },
  { name: '赵磊', dept: '运营部' },
  { name: '孙丽', dept: '财务部' },
  { name: '周涛', dept: '数据部' },
  { name: '吴婷', dept: '安全部' },
];

export const OPERATOR_OPTIONS: { value: Operator; label: string }[] = [
  { value: 'gt', label: '大于' },
  { value: 'gte', label: '大于等于' },
  { value: 'lt', label: '小于' },
  { value: 'lte', label: '小于等于' },
  { value: 'eq', label: '等于' },
  { value: 'neq', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'between', label: '在区间内' },
  { value: 'notBetween', label: '不在区间内' },
  { value: 'before', label: '早于' },
  { value: 'after', label: '晚于' },
  { value: 'empty', label: '为空' },
  { value: 'notEmpty', label: '不为空' },
];

/** 节点类型中文名 */
export const KIND_LABEL: Record<NodeKind, string> = {
  trigger: '开始',
  field: '数据字段',
  condition: '判断',
  compute: '计算',
  lookup: '查找',
  relation: '关联',
  action: '预警动作',
  time: '时间窗口',
  topn: '排名取数',
  diff: '反匹配排查',
  groupby: '分组聚合',
  baseline: '基准统计',
  filljoin: '左关联补全',
  base: '基础数据',
  logic: '逻辑关联',
  filter: '数据过滤',
  elapsed: '已过天数',
  rank: '排名',
};

/** 节点分类色 */
export const KIND_COLOR: Record<
  NodeKind,
  { bg: string; border: string; text: string; dot: string }
> = {
  trigger: { bg: '#EFF6FF', border: '#3B82F6', text: '#1D4ED8', dot: '#3B82F6' },
  field: { bg: '#EFF6FF', border: '#3B82F6', text: '#1D4ED8', dot: '#3B82F6' },
  condition: { bg: '#F5F3FF', border: '#8B5CF6', text: '#6D28D9', dot: '#8B5CF6' },
  compute: { bg: '#ECFEFF', border: '#06B6D4', text: '#0E7490', dot: '#06B6D4' },
  lookup: { bg: '#F0FDF4', border: '#10B981', text: '#047857', dot: '#10B981' },
  relation: { bg: '#F8FAFC', border: '#64748B', text: '#334155', dot: '#64748B' },
  action: { bg: '#FFFBEB', border: '#F59E0B', text: '#B45309', dot: '#F59E0B' },
  time: { bg: '#ECFDF5', border: '#14B8A6', text: '#0F766E', dot: '#14B8A6' },
  topn: { bg: '#F0F9FF', border: '#0284C7', text: '#075985', dot: '#0284C7' },
  diff: { bg: '#FFF1F2', border: '#F43F5E', text: '#BE123C', dot: '#F43F5E' },
  groupby: { bg: '#EEF2FF', border: '#4F46E5', text: '#3730A3', dot: '#4F46E5' },
  baseline: { bg: '#F5F3FF', border: '#9333EA', text: '#6B21A8', dot: '#9333EA' },
  filljoin: { bg: '#F8FAFC', border: '#475569', text: '#334155', dot: '#475569' },
  base: { bg: '#FFF7ED', border: '#EA580C', text: '#9A3412', dot: '#EA580C' },
  logic: { bg: '#F8FAFC', border: '#9CA3AF', text: '#4B5563', dot: '#9CA3AF' },
  filter: { bg: '#F0FDF4', border: '#16A34A', text: '#166534', dot: '#16A34A' },
  elapsed: { bg: '#ECFEFF', border: '#0891B2', text: '#155E75', dot: '#0891B2' },
  rank: { bg: '#EFF6FF', border: '#2563EB', text: '#1D4ED8', dot: '#2563EB' },
};

/** 预警类型（级别→类型：提醒/预警） */
export const ACTION_TYPE_OPTIONS: { value: ActionNodeData['type']; label: string; color: string }[] = [
  { value: 'remind', label: '提醒', color: '#0EA5E9' },
  { value: 'alert', label: '预警', color: '#F59E0B' },
];

/** 重要等级（仅类型=预警时选择） */
export const PRIORITY_OPTIONS: { value: ActionNodeData['priority']; label: string; color: string }[] = [
  { value: 'Important&Urgent', label: '重要且紧急', color: '#EF4444' },
  { value: 'Important', label: '重要不紧急', color: '#F59E0B' },
  { value: 'Urgent', label: '紧急但不重要', color: '#FB923C' },
  { value: 'Info', label: '一般', color: '#94A3B8' },
];

/** 预警级别（存量兼容，映射自 type/priority） */
export const LEVEL_OPTIONS: { value: ActionNodeData['level']; label: string; color: string }[] = [
  { value: 'remind', label: '提醒', color: '#0EA5E9' },
  { value: 'warn', label: '预警', color: '#F59E0B' },
  { value: 'critical', label: '紧急', color: '#EF4444' },
];

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** 预警工单状态 */
export type AlertStatus = 'new' | 'accepted' | 'processing' | 'done' | 'failed';

/** 预警工单（由规则触发产生的待办预警） */
export interface AlertTask {
  id: string;
  ruleId: string;
  ruleName: string;
  level: ActionNodeData['level'];
  /** 重要等级（仅预警类型），如 重要且紧急/重要不紧急/紧急/一般 */
  priority?: string;
  title: string;
  content: string;
  /** 为什么预警：本次触发的具体原因说明 */
  reason?: string;
  /** 判断规则描述（如：如果店仓未开单天数在 3~5 天，提醒） */
  conditionDesc?: string;
  /** 命中预览数据（判断命中的记录，用于点击展开查看） */
  preview?: {
    columns: string[];
    rows: Record<string, string | number>[];
    /** 创建人（随 preview JSON 持久化，避免额外库列） */
    createdBy?: string;
    /** 每个店铺/店仓的预警消息（逐行渲染 action 消息模板） */
    storeMessages?: { store: string; message: string }[];
  };
  /** 创建人（展示用，持久化于 preview.createdBy） */
  createdBy?: string;
  dept: string;
  assignee: string;
  status: AlertStatus;
  handoffTo?: string;
  createdAt: number;
  updatedAt: number;
}

/** 聚合函数选项 */
export const AGG_FN_OPTIONS: { value: ComputeNodeData['fn']; label: string }[] = [
  { value: 'sum', label: '求和 SUM' },
  { value: 'avg', label: '平均值 AVG' },
  { value: 'count', label: '计数 COUNT' },
  { value: 'max', label: '最大值 MAX' },
  { value: 'min', label: '最小值 MIN' },
  { value: 'countDistinct', label: '去重计数 COUNT DISTINCT' },
  { value: 'activeDays', label: '开单天数（有成交的日期数）' },
];

/** 已过天数节点的统计范围选项 */
export const ELAPSED_SCOPE_OPTIONS: { value: ElapsedScope; label: string }[] = [
  { value: 'week', label: '本周已过天数' },
  { value: 'month', label: '本月已过天数' },
  { value: 'quarter', label: '本季已过天数' },
  { value: 'year', label: '本年已过天数' },
  { value: 'custom', label: '时间区间内已过天数' },
];

// ============ 组织架构 ============

/** 组织节点分类（平级标签，供建用户时选择归属） */
export type OrgKind = '总部' | '分公司' | '部门' | '区域' | '门店' | '其他';

export const ORG_KIND_OPTIONS: { value: OrgKind; label: string }[] = [
  { value: '总部', label: '总部' },
  { value: '分公司', label: '分公司' },
  { value: '部门', label: '部门' },
  { value: '区域', label: '区域' },
  { value: '门店', label: '门店' },
  { value: '其他', label: '其他' },
];

/** 组织节点（结构平级；保留 parentId 以支持未来树形扩展） */
export interface Organization {
  id: string;
  name: string;
  kind: OrgKind;
  parentId?: string;
  sort: number;
  createdAt: number;
}

// ============ 人事架构 ============

/** 管理范围：关联数据表字段 + 该字段下某个分类值（表示"管理该分类下的人员/门店"） */
export interface ManageScope {
  /** 数据表 id（可选，字段可能来自任意已上传表） */
  tableId?: string;
  /** 数据表字段名（如 大区 / 所属门店 / 店铺） */
  field?: string;
  /** 该字段下的分类值（如 华东大区 / 门店A） */
  value?: string;
  /** 冗余展示说明（如 "华东大区 门店人员"） */
  desc?: string;
}

/** 人员（挂到组织节点下，可设上级/职位/管理范围） */
export interface Person {
  id: string;
  name: string;
  /** 所属组织 id */
  orgId: string;
  /** 归属经销商 id */
  dealerId?: string;
  /** 归属店仓 id */
  storeId?: string;
  /** 职位 */
  title?: string;
  /** 岗位（来自「岗位管理」属性标签） */
  post?: string;
  /** 登录账号 */
  username?: string;
  /** 身份证号 */
  idCard?: string;
  /** 地址 */
  address?: string;
  /** 生日 */
  birthday?: string;
  /** 登录密码（初始=新建时设置，可随时重置） */
  password?: string;
  /** 上级人员 id（空 = 该组织最高层） */
  supervisorId?: string;
  /** 管理范围（关联数据字段 + 分类值） */
  manageScope?: ManageScope;
  phone?: string;
  email?: string;
  enabled: boolean;
  sort: number;
  createdAt: number;
}

/** 人事属性下的单个条目 */
export interface HrAttributeItem {
  id: string;
  name: string;
}

/** 属性字典分类：person=人事人员，dealer=经销商，store=店仓 */
export type AttrCategory = 'person' | 'dealer' | 'store';

/** 人事属性字典（如：部门管理 / 职位管理 / 岗位管理），每个属性下含多条条目 */
export interface HrAttribute {
  id: string;
  name: string;
  items: HrAttributeItem[];
  sort: number;
  createdAt: number;
  /** 属性归属分类，默认 person */
  category?: AttrCategory;
}

/** 字典属性值：属性名 -> 选中标签 */
export type DictAttrs = Record<string, string>;

/** 经销商字典条目 */
export interface Dealer {
  id: string;
  name: string;
  sort: number;
  createdAt: number;
  /** 经销商编号 */
  code?: string;
  /** 联系人 */
  contact?: string;
  /** 电话 */
  phone?: string;
  /** 地址 */
  address?: string;
  /** 初始密码 */
  password?: string;
  /** 生日 */
  birthday?: string;
  /** 是否启用 */
  enabled?: boolean;
  /** 经销商属性（挂分类标签值） */
  attrs?: DictAttrs;
}

/** 店仓字典条目 */
export interface Store {
  id: string;
  name: string;
  sort: number;
  createdAt: number;
  /** 上级经销商 id（可选，店仓可归属某经销商） */
  dealerId?: string;
  /** 店仓编号 */
  code?: string;
  /** 联系人 */
  contact?: string;
  /** 电话 */
  phone?: string;
  /** 地址 */
  address?: string;
  /** 初始密码 */
  password?: string;
  /** 生日 */
  birthday?: string;
  /** 是否启用 */
  enabled?: boolean;
  /** 店仓属性（挂分类标签值） */
  attrs?: DictAttrs;
}

export type AlignX = 'left' | 'center' | 'right';
export type AlignY = 'top' | 'middle' | 'bottom';

/** 登录页 / 首页展示配置（大标题、小标题、登录框、背景） */
export interface HomeTitleStyle {
  text: string;
  font: string;
  size: number;
  weight: number;        // 字重
  letterSpacing: number; // 字宽（字间距，px）
  marginLeft: number;    // 左边距（px）
  color: string;
  opacity: number;
  x: number;             // 位置：水平百分比
  y: number;             // 位置：垂直百分比
}
export interface LoginBoxStyle {
  x: number;             // 位置：水平百分比（相对预览/登录页区域）
  y: number;             // 位置：垂直百分比
  width: number;         // 宽度（px）
  height: number;        // 高度（px）
  bgColor: string;
  bgOpacity: number;     // 0-1 背景透明度
  blur: number;          // 毛玻璃（backdrop blur，px）
  radius: number;        // 圆角
  padX: number;          // 内边距：水平（px）
  padY: number;          // 内边距：垂直（px）
  fieldHeight: number;   // 登录框内输入框高度（px）
  shadowColor: string;   // 阴影颜色
  shadowOpacity: number; // 0-1 阴影透明度
  shadowX: number;       // 投影距离X（px）
  shadowY: number;       // 投影距离Y（px）
  shadowBlur: number;    // 投影模糊（px）
}
/** 画布可添加的文本组件 */
export interface HomeTextElement {
  id: string;
  type: 'text';
  text: string;
  font: string;
  size: number;
  weight: number;
  letterSpacing: number; // 字宽（px）
  color: string;
  opacity: number;
  x: number;             // 水平百分比
  y: number;             // 垂直百分比
}
/** 画布可添加的图片组件 */
export interface HomeImageElement {
  id: string;
  type: 'image';
  src: string;
  x: number;
  y: number;
  width: number;         // px
  height: number;        // px
  borderRadius: number;  // px
  opacity: number;
}
export type HomeElement = HomeTextElement | HomeImageElement;

export interface HomeConfig {
  bgMode: 'color' | 'image';
  bgColor: string;
  bgImage: string;
  bgBlur: number;        // 背景毛玻璃（px）
  title: HomeTitleStyle;
  subtitle: HomeTitleStyle;
  loginBox: LoginBoxStyle;
  elements: HomeElement[]; // 通过「组件」添加的画布元素（文本 / 图片）
}

export const DEFAULT_HOME_CONFIG: HomeConfig = {
  bgMode: 'color',
  bgColor: '#1e293b',
  bgImage: '',
  bgBlur: 0,
  title: {
    text: '店牛预警平台', font: 'system-ui', size: 44, weight: 700, letterSpacing: 4, marginLeft: 56,
    color: '#ffffff', opacity: 1, x: 8, y: 35,
  },
  subtitle: {
    text: '零售终端数据预警与通知助手', font: 'system-ui', size: 16, weight: 500, letterSpacing: 2, marginLeft: 58,
    color: '#cbd5e1', opacity: 0.9, x: 8, y: 50,
  },
  loginBox: {
    x: 66, y: 26, width: 320, height: 340, bgColor: '#ffffff', bgOpacity: 0.12, blur: 12, radius: 16,
    padX: 40, padY: 24, fieldHeight: 44,
    shadowColor: '#000000', shadowOpacity: 0.25, shadowX: 0, shadowY: 12, shadowBlur: 24,
  },
  elements: [],
};

export function normalizeHomeConfig(c?: Partial<HomeConfig> | null): HomeConfig {
  return {
    ...DEFAULT_HOME_CONFIG,
    ...(c || {}),
    title: { ...DEFAULT_HOME_CONFIG.title, ...(c?.title || {}) },
    subtitle: { ...DEFAULT_HOME_CONFIG.subtitle, ...(c?.subtitle || {}) },
    loginBox: { ...DEFAULT_HOME_CONFIG.loginBox, ...(c?.loginBox || {}) },
    elements: Array.isArray(c?.elements) ? c.elements : [],
  };
}

export const FONT_OPTIONS = [
  { label: '系统默认', value: 'system-ui' },
  { label: '黑体', value: '"Microsoft YaHei", "PingFang SC", sans-serif' },
  { label: '宋体', value: '"SimSun", serif' },
  { label: '楷体', value: '"KaiTi", "STKaiti", serif' },
  { label: '无衬线', value: 'Arial, Helvetica, sans-serif' },
  { label: '衬线', value: 'Georgia, "Times New Roman", serif' },
];