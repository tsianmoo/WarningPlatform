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
  dateFormat?: string; // 类型为 date 时的原始值解析格式（空=自动识别）；运行时按此标准化为 yyyy-MM-dd
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
  /** 分组归类（如"销售/门店"等）；空串为未分组 */
  group?: string;
  /** 最近一次覆盖更新前的数据快照（用于"返回上一步"回退） */
  prev?: TableSnapshot;
}

export interface TableSnapshot {
  fileName: string;
  rowCount: number;
  fields: TableField[];
  previewRows: Record<string, string>[];
  rows?: Record<string, string | number | boolean>[];
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
  | 'logic' // 逻辑关联（如果/且/或），串联多个判断
  | 'calc' // 添加列（选择数据表/节点，逐行用函数公式计算追加新列：IF/CONCAT/文本/当前日期/日期函数/时间差）
  | 'linkjoin' // 其他表添加列（把另一张表/节点结果按匹配键对齐后，取列附加到当前表）
  | 'linkview' // 预警关联展示（把相关的其他表/节点结果，用同名匹配键关联到命中数据，供查看预警弹窗以标签页展示）
  | 'linkview_all' // 预警关联展示-全量（展示来源数据表/节点的全部行，不受基础表过滤；独立组件，按权限控制使用与数据可见）
  | 'rowsort' // 节点结果排序/格式化（选择上游节点结果，调整列顺序、重命名、改类型，并配置数值格式：单位/小数位/百分比/千分符，可指定一列升序排序）

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
    /** 可同时启用多个对比模式（同期 && 环期） */
    modes?: ('yoY' | 'ring')[];
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
  /** 区间下界（op 为 between/notBetween 时，如"3天至5天"的 3） */
  rangeMin?: string;
  /** 区间上界（op 为 between/notBetween 时，如"3天至5天"的 5） */
  rangeMax?: string;
  /** 区间下界比较符：'>'（大于）或 '>='（大于等于），默认 '>=' */
  rangeMinOp?: 'gt' | 'gte';
  /** 区间上界比较符：'<'（小于）或 '<='（小于等于），默认 '<' */
  rangeMaxOp?: 'lt' | 'lte';
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
  /** 排序方向（升序/降序）：全部维度中只能有一个字段启用排序 */
  sort?: 'asc' | 'desc';
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
  /** 该指标独立的统计时间窗（可选）：设置了则按此窗口过滤聚合，同一字段可配多条不同窗口（累销/近3天/本月…）；未设置回退到节点级 timeWindow */
  timeWindow?: TimeWindow;
  /** 聚合结果排序方向（升序/降序）：全部聚合指标中只能有一个字段启用排序 */
  sort?: 'asc' | 'desc';
}

/** 过滤条件运算符 */
export type FilterOp = 'eq' | 'neq' | 'in' | 'nin' | 'contains' | 'empty' | 'notEmpty' | 'between' | 'notBetween';

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
  op: 'eq' | 'neq' | 'in' | 'nin' | 'contains' | 'empty' | 'notEmpty' | 'between' | 'notBetween';
  /** 单选/单值算子（eq/neq/contains）使用的值 */
  value: string;
  /** 多选算子（in/nin）使用的值集合 */
  values: string[];
  /** 区间算子（between/notBetween）的下限/上限值 */
  rangeMin?: string;
  rangeMax?: string;
  /** 下限比较符：gt=>、gte=>=（默认）；上限比较符：lt=<、lte=<=（默认） */
  rangeMinOp?: 'gt' | 'gte';
  rangeMaxOp?: 'lt' | 'lte';
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
  /** 事实侧带回指标列的多选：为空（且无 factReturnField）时带回全部非键列；勾选后只带回所选列 */
  factReturnFields?: Array<{ key: string; label: string }>;
}

/** 其他表添加列节点数据：把另一张表/另一个节点的结果，按匹配键对齐后取列附加到主表 */
/** 主表与源表均可来自数据表或节点结果 */
export interface LinkJoinNodeData {
  /** 主表（要添加列的对象）来源：table=数据表 / node=节点结果 */
  mainSource?: 'table' | 'node';
  /** 主表为数据表时的表 id / 名称 */
  mainTableId?: string;
  mainTableName?: string;
  /** 主表为节点结果时的节点引用 */
  mainNode?: string;
  mainNodeLabel?: string;
  /** 源表（从中取列）来源 */
  srcSource?: 'table' | 'node';
  /** 源表为数据表时的表 id / 名称 */
  srcTableId?: string;
  srcTableName?: string;
  /** 源表为节点结果时的节点引用 */
  srcNode?: string;
  srcNodeLabel?: string;
  /** 匹配键对：主表字段 ↔ 源表字段各自选择，可配多对；为空=不匹配，源表当作单值逐行填充 */
  matchKeys?: Array<{ mainField?: string; srcField?: string }>;
  /** 从源表取哪些列追加到主表 */
  addFields?: Array<{ key: string; label: string }>;
  /** 结果命名（可选备注） */
  resultLabel?: string;
}

/** 预警关联展示 —— 单个关联标签：把来源表/节点结果按同名匹配键关联到命中数据 */
export interface LinkViewTab {
  /** 标签名（如 商品档案/库存/零售单） */
  name: string;
  /** 关联来源：table=数据表 / node=节点结果 */
  source: 'table' | 'node';
  tableId?: string;
  tableName?: string;
  srcNode?: string;
  srcNodeLabel?: string;
  /** 匹配键字段对（如 基础表[顾客手机] ↔ 关联表[顾客手机]），可多对 */
  matchKeys?: Array<{ baseField?: string; relField?: string }>;
  /** 返回列：勾选的来源列名（key）。为空则返回来源全部列 */
  returnCols?: string[];
}

/** 预警关联展示节点数据：以预警动作结果为基础上表，声明若干关联标签，供「查看预警」弹窗以标签页展示关联数据 */
export interface LinkViewNodeData {
  /** 基础上表来源：预警动作节点结果（展示其字段作为基础表字段） */
  baseNode?: string;
  baseNodeLabel?: string;
  /** 关联标签列表 */
  tabs?: LinkViewTab[];
  /** 结果命名（可选备注） */
  resultLabel?: string;
}

/** 预警关联展示-全量：单标签——选择来源数据表/节点结果，展示其全部行（不受基础表过滤），仅勾选返回列 */
export interface LinkViewAllTab {
  /** 标签名 */
  name?: string;
  /** 关联来源：table=数据表 / node=节点结果 */
  source: 'table' | 'node';
  tableId?: string;
  tableName?: string;
  srcNode?: string;
  srcNodeLabel?: string;
  /** 匹配字段（基础表字段 ↔ 关联表字段） */
  matchKeys?: Array<{ baseField?: string; relField?: string }>;
  /** 返回列：勾选的来源列名（key）。为空则返回来源全部列 */
  returnCols?: string[];
}

/** 预警关联展示-全量节点数据：独立组件，按权限（linkview_all）控制使用与数据可见 */
export interface LinkViewAllNodeData {
  /** 基础表（预警动作结果等，提供匹配字段的下侧字段选择） */
  baseNode?: string;
  baseNodeLabel?: string;
  /** 数据来源及其它标签列表（一般一个即可；支持多来源多标签） */
  tabs?: LinkViewAllTab[];
  /** 结果命名（可选备注） */
  resultLabel?: string;
}

/** 预警消息分段：弹窗展示时若 isVar 则该段为变量字段（加粗紫色） */
export interface MsgPart {
  /** 该段文本 */
  t: string;
  /** 是否为变量字段（来自 {字段} 模板替换） */
  isVar?: boolean;
}

/** 预警关联展示：查看预警弹窗按标签页展示的关联数据 */
export interface LinkViewResolved {
  /** 是否已配置关联展示 */
  enabled: boolean;
  /** 是否全量展示（来自「预警关联展示-全量」节点：展示来源全部行，不受基础表过滤；本字段用于弹窗做权限控制） */
  all?: boolean;
  /** 基础表字段（预警动作结果字段） */
  baseCols?: string[];
  /** 关联标签：每个标签已按命中行解析出关联数据 */
  tabs?: Array<{ name: string; source: 'table' | 'node'; all?: boolean; tableName?: string; srcNodeLabel?: string; matchKeys?: Array<{ baseField?: string; relField?: string }>; columns: string[]; rows: Record<string, string | number>[] }>;
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
  /** 预警关联展示：规则内 linkview 节点在此动作弹窗中是否展示（默认全部展示） */
  linkviews?: Array<{ id: string; enabled: boolean }>;
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

/** 添加列（计算列）：在所选数据表/节点结果的每一行上，用函数公式计算并追加新列 */
export interface CalcColumn {
  /** 新列名 */
  label: string;
  /** 公式（支持 Excel 风格）：IF/CONCAT/TEXT/SUBSTR/YEAR/MONTH/DAY/TODAY()/DATE/DATEDIFF 及四则与比较运算，字段用 [字段名] 引用 */
  expr: string;
}

/** 添加列节点数据 */
export interface CalcNodeData {
  /** 数据来源：数据表 / 上游节点输出（默认数据表） */
  source?: DataSourceKind;
  /** 引用的上游节点 id（source==='node' 时） */
  sourceNode?: string;
  sourceNodeLabel?: string;
  /** 来源数据表（source==='table' 时） */
  tableId?: string;
  tableName?: string;
  /** 要追加的计算列 */
  columns: CalcColumn[];
}

/** 节点结果排序/格式化 的列格式 */
export interface RowSortCol {
  /** 源字段 key（来自上游节点结果列） */
  key: string;
  /** 显示列名（可修改，默认=源字段名） */
  label: string;
  /** 数值类型：auto=自动 / number=数字 / percent=百分比 */
  type?: 'auto' | 'number' | 'percent';
  /** 数量单位：''（无）/ 千 / 万 / 百万 / 亿（数值按此缩放展示） */
  unit?: string;
  /** 小数位数 */
  decimals?: number;
  /** 单位后缀（自定义，如 元/件） */
  suffix?: string;
  /** 千分符 */
  thousandSep?: boolean;
  /** 是否在表格表头显示单位 */
  showUnit?: boolean;
  /** 是否在结果中显示（勾选控制；未显示的列在面板中沉底） */
  show?: boolean;
  /** 是否作为行转列（Pivot）字段：勾选后该列不同取值与其它行转列字段的取值组合成横向表头列，同时原列仍保留展示 */
  unpivot?: boolean;
  /** 该字段是否为「值字段」：行转列/普通视图下填充数值的列（多字段行转列时唯一值列） */
  pivotValue?: boolean;
  /** 行转列（Pivot）表头的横排组合顺序（由「转」弹窗调整；缺省时按上游出现顺序） */
  pivotOrder?: string[];
  /** 行转列表头各取值对应的自定义显示名（key 为该字段的去重取值，value 为展示名） */
  pivotLabels?: Record<string, string>;
}

/** 多横排块：在 rowsort 节点内并列输出的一个「行转列透视块」（含其值字段与表头命名） */
export interface RowSortPivot {
  /** 块唯一标识 */
  id?: string;
  /** 块显示名（预留，前端不使用展示名强校验） */
  name?: string;
  /** 行转列字段 key：该字段不同取值横向展开为表头列（如 尺寸名） */
  rowField?: string;
  /** 值字段 key：填充表头下数值的列（如 求和(库存数量) / 求和(销售数量)） */
  valueField?: string;
  /** 表头展示前缀/指标名（默认取值字段 label），用于区分同尺码不同指标（如 库存 / 销量） */
  prefix?: string;
  /** 横排表头顺序（去重值顺序，缺省按上游出现顺序） */
  order?: string[];
  /** 行转列表头取值对应自定义显示名（key=取值，value=展示名） */
  labels?: Record<string, string>;
  /** 是否在节点上启用该块（未启用则不并列输出） */
  enable?: boolean;
  /** 是否删除（软删除标记） */
  deleted?: boolean;
}

/** 节点结果排序/格式化 节点数据 */
export interface RowSortNodeData {
  /** 引用的上游节点 id */
  sourceNode?: string;
  sourceNodeLabel?: string;
  /** 各列的展示配置（顺序即表格列顺序） */
  cols: RowSortCol[];
  /** 多横排块：每个块独立指定其行转列字段、值字段与表头命名，并排列输出（与 cols 中 unpivot/pivotValue 配置并存，块优先） */
  pivots?: RowSortPivot[];
  /** 结果命名 */
  resultLabel?: string;
  /** 列转行：指标列名（默认「指标」） */
  unpivotLabel?: string;
  /** 列转行：值列名（默认「值」） */
  unpivotValueLabel?: string;
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
    | CalcNodeData
    | LinkJoinNodeData
    | LinkViewNodeData
    | LinkViewAllNodeData
    | RowSortNodeData
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

/** 通知对象来源方式 */
export type NotifyMode = 'manual' | 'store' | 'employee' | 'person';

export interface TargetSetting {
  /** 通知方式：manual=手动勾选；store=按店仓（命中门店全收）；employee=按员工（命中门店的员工）；person=按人员（管理了命中门店/员工的人员汇总） */
  mode?: NotifyMode;
  /** 适用部门 */
  departments: string[];
  /** 适用人员 */
  personnel: string[];
  /** 适用组织（组织架构 id 列表） */
  orgIds?: string[];
  /** 适用人员（人事架构人员 id 列表） */
  personIds?: string[];
  /** person（按用户）模式下进一步按职位筛选（职位标签，含督导等） */
  personPositions?: string[];
  /** person（按用户）模式下进一步按岗位筛选（岗位标签） */
  personPosts?: string[];
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
/** 数据表分组（文件夹）实体；DataTable.group 存分组名，空名=未分组 */
export interface DataTableGroup {
  id: string;
  name: string;
  createdAt: number;
}

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
  /** 创建人（展示用，持久化于 createdBy） */
  createdBy?: string;
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
  calc: '添加公式列',
  linkjoin: '其他表添加列',
  linkview: '预警关联展示',
  linkview_all: '预警关联展示-全量',
  rowsort: '节点结果排序',
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
  calc: { bg: '#FDF4FF', border: '#D946EF', text: '#A21CAF', dot: '#D946EF' },
  linkjoin: { bg: '#FAF5FF', border: '#9333EA', text: '#6B21A8', dot: '#9333EA' },
  linkview: { bg: '#FDF2F8', border: '#EC4899', text: '#BE185D', dot: '#EC4899' },
  linkview_all: { bg: '#FDF4FF', border: '#A855F7', text: '#7E22CE', dot: '#A855F7' },
  rowsort: { bg: '#F8FAFC', border: '#0EA5E9', text: '#0369A1', dot: '#0EA5E9' },
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
/** 商品维度（XI生预警预览行中的商品列提取，值来自预警自身命中内容） */
export interface AlertProductDims {
  brand?: string[];
  year?: string[];
  season?: string[];
  category?: string[];
  style?: string[];
}

/** 店仓维度（由命中店仓反查门店档案字段提取） */
export interface AlertStoreDims {
  brand?: string[];
  company?: string[];
  department?: string[];
  salesArea?: string[];
  district?: string[];
}

/** 预警可筛选维度：商品 / 店仓 两类，均按已有预警字段统计 */
export interface AlertDims {
  product?: AlertProductDims;
  store?: AlertStoreDims;
}

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
    /** 预警消息分段（变量字段段 isVar=true，弹窗加粗紫色展示） */
    msgParts?: MsgPart[];
    /** 预警关联展示（多个「预警关联展示」节点各自独立启用时的集合，弹窗分组展示） */
    linkviews?: Array<{ label: string; linkview: LinkViewResolved }>;
    /** 预警关联展示（查看预警弹窗按标签页展示的关联数据，来自「预警关联展示」节点） */
    linkview?: LinkViewResolved;
    /** 解析出的通知对象（按 store/employee/person 模式展开的门店/员工/人员），供列表与详情展示 */
    recipients?: { mode: NotifyMode; names: string[] }[];
  };
  /** 创建人（展示用，持久化于 preview.createdBy） */
  createdBy?: string;
  dept: string;
  assignee: string;
  /** 命中店仓归属的经销商 id（按数据权限归集经销商预警） */
  dealerIds?: string[];
  /** 命中店仓 id（按数据权限归集门店预警） */
  storeIds?: string[];
  /** 可筛选维度（商品/店仓，供列表按维度筛选，来自预警自身命中内容） */
  dims?: AlertDims;
  /** 通知到的接收方名称（"只看到本人"时匹配 assignee/notified） */
  notified?: string[];
  status: AlertStatus;
  handoffTo?: string;
  /** 接受时间（准备处理） */
  acceptedAt?: number;
  /** 开始处理时间（处理计时起点） */
  startedAt?: number;
  /** 完成/结束时间 */
  handledAt?: number;
  /** 处理方案（完成必填） */
  resolution?: string;
  /** 预警处理方式（数据表下方留言上方的计划输入，非必填，随时间可改） */
  plan?: string;
  /** 无法完成原因 */
  failedReason?: string;
  /** 针对该预警的沟通交流消息（含管理者意见），按时间正序 */
  comments?: AlertComment[];
  createdAt: number;
  updatedAt: number;
}

/** 预警留言消息 */
export interface AlertComment {
  id: string;
  by: string;
  text: string;
  at: number;
  /** 针对该留言的回复 */
  replies?: { id: string; by: string; text: string; at: number }[];
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
  /** 机构管理范围：依据的店仓属性 id */
  storeAttrId?: string;
  /** 机构管理范围：依据的店仓属性名（如 区部 / 销售区域） */
  storeAttrName?: string;
  /** 机构管理范围：选中的属性值（可单选/多选） */
  storeAttrValues?: string[];
  /** 机构管理范围：多个筛选条件组合（AND），每个条件=店仓属性名+选中的值 */
  filters?: { attrName: string; values: string[] }[];
  /** 机构管理范围：实际管辖的门店 id 列表 */
  storeIds?: string[];
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
  /** 单用户权限覆盖（不为空时以它为准，覆盖岗位默认权限） */
  permOverride?: PersonPermOverride;
  phone?: string;
  email?: string;
  enabled: boolean;
  sort: number;
  createdAt: number;
}

// ============ 权限管理 ============

/** 功能页面（与侧边栏导航叶子项一一对应，供"每页面每操作"细分授权） */
export type PermModule =
  | 'home'        // 首页
  | 'datatables'  // 数据表管理
  | 'rules'       // 预警规则
  | 'alerts'      // 预警列表
  | 'dealer'      // 组织-经销商管理
  | 'store'       // 组织-店仓管理
  | 'people'      // 人事-人员管理
  | 'attrs'       // 人事-属性管理
  | 'homecfg'     // 系统-首页管理
  | 'datasync'    // 数据同步平台
  | 'perms'      // 系统-权限管理
  | 'navcfg'     // 系统-导航栏管理
  | 'brandcfg'   // 系统-基础信息管理
  | 'linkview_all'; // 预警关联展示-全量（按此权限控制该节点的使用与全量数据可见）

/** 权限操作码（可勾选的最小操作单元，越细越好） */
export type PermOp =
  | 'create'    // 新增
  | 'edit'      // 编辑
  | 'delete'    // 删除
  | 'run'       // 预警规则：启用/停用
  | 'handle'    // 预警列表：处理/转交
  | 'upload'    // 数据表：上传/覆盖数据
  | 'download'  // 导出/下载
  | 'assign'    // 人员：分配岗位
  | 'resetPwd'  // 人员：重置密码
  | 'manage';   // 属性/字典维护

/**
 * 页面级功能权限：
 * - view：页面入口可见（决定侧边栏/能否进入该页面）
 * - ops：该页面下的操作（新增/编辑/删除/上传等），作用于整页资源（不细分到单个表/经销商/规则）
 */
export interface PagePerm {
  view: boolean;
  ops?: Partial<Record<PermOp, boolean>>;
}

/** 旧版模块级操作权限（兼容迁移用；新数据一律用 PagePerm） */
export interface ModuleActionPerm {
  view: boolean;
  create?: boolean;
  edit?: boolean;
  delete?: boolean;
  run?: boolean;
  handle?: boolean;
  upload?: boolean;
  assign?: boolean;
}

/** 数据权限范围 */
export type DataScopeType = 'all' | 'dealer' | 'store' | 'self' | 'managed' | 'custom';

export interface DataScope {
  type: DataScopeType;
  /** 自定义：选中的经销商 id */
  dealerIds?: string[];
  /** 自定义：选中的店仓 id */
  storeIds?: string[];
  /** 自定义：按店仓属性过滤（如区部/销售区域），各条件为 AND */
  attrFilters?: { attrName: string; values: string[] }[];
  /** managed 模式：复用用户自身 manageScope */
  useManageScope?: boolean;
  /** 冗余展示说明 */
  desc?: string;
}

/** 某个岗位（角色）的完整权限配置 */
/** 权限主体类型：岗位 / 经销商 / 店仓 / 员工 */
export type PermSubject = 'post' | 'dealer' | 'store' | 'employee';

export interface RolePerm {
  /** 权限主体标识：岗位时为岗位名，经销商/店仓/员工时为对应编号（code） */
  post: string;
  /** 权限主体类型；缺省（旧数据）视为 'post' */
  subjectKind?: PermSubject;
  /** 各页面的查看/操作权限（页面、资源、操作逐项细分） */
  pages: Partial<Record<PermModule, PagePerm>>;
  /** 数据权限范围；null 表示未配置 → 由用户归属自动推断 */
  dataScope: DataScope | null;
  createdAt?: number;
  /** 兼容旧数据（按模块授权），读取时一键迁移到 pages */
  modules?: Partial<Record<PermModule, ModuleActionPerm>>;
}

/** 单用户自定义覆盖（优先级高于岗位模板） */
export interface PersonPermOverride {
  /**
   * 归属人员 id。
   * 必须存在：旧版没有这个字段，perm.ts 只能取「第一个 enabled 的覆盖」，
   * 导致任意一个人配了自定义权限后，所有登录用户都会套用同一份覆盖（越权）。
   */
  personId?: string;
  /** 是否启用自定义（否则用岗位模板） */
  enabled?: boolean;
  pages?: Partial<Record<PermModule, PagePerm>>;
  dataScope?: DataScope | null;
  /** 兼容旧数据 */
  modules?: Partial<Record<PermModule, ModuleActionPerm>>;
}

/** 人事属性下的单个条目 */
export interface HrAttributeItem {
  id: string;
  name: string;
}

/** 属性字典分类：person=人事人员，dealer=经销商，store=店仓 */
export type AttrCategory = 'person' | 'dealer' | 'store' | 'employee';

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
  /** 省份 */
  province?: string;
  /** 城市 */
  city?: string;
  /** 区县 */
  district?: string;
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
  /** 主营品牌 */
  brand?: string;
  /** 所属分公司 */
  company?: string;
  /** 所属部门 */
  department?: string;
  /** 销售区域 */
  salesArea?: string;
  /** 区部 */
  district?: string;
  /** 是否允许零售 */
  allowRetail?: boolean;
  /** 店仓属性（挂分类标签值） */
  attrs?: DictAttrs;
}

/** 员工档案条目 */
export interface Employee {
  id: string;
  /** 员工编号 */
  code?: string;
  /** 员工姓名 */
  name: string;
  /** 所属经销商 id */
  dealerId?: string;
  /** 所属店仓 id */
  storeId?: string;
  /** 岗位 */
  post?: string;
  /** 是否在职 */
  onDuty?: boolean;
  /** 是否可用 */
  enabled?: boolean;
  /** 初始密码（登录用） */
  password?: string;
  /** 员工属性（挂分类标签值） */
  attrs?: DictAttrs;
  sort: number;
  createdAt: number;
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
  title: LoginInnerText; // 登录框内标题
  subtitle: LoginInnerText; // 登录框内副标题
  label: LoginInnerText; // 字段标签（账号/密码/验证码）统一样式
  button: LoginButton;   // 登录按钮
}

/** 登录框内文本样式 */
export interface LoginInnerText {
  text: string;          // 文本内容
  font: string;
  size: number;          // 字号
  weight: number;        // 字重
  letterSpacing: number; // 字宽（px）
  color: string;         // 颜色
  opacity: number;       // 透明度
}

/** 登录按钮样式 */
export interface LoginButton {
  text: string;          // 按钮文字
  width: number;         // 宽度（px；0 表示随内容/填满）
  height: number;        // 高度（px）
  size: number;          // 字号
  weight: number;        // 字重
  letterSpacing: number; // 字宽
  color: string;         // 文字颜色
  bgColor: string;       // 背景色
  radius: number;        // 圆角
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

/** 顶级导航菜单 key（侧边栏可命名 / 排序的菜单项） */
export type NavMenuKey = 'home' | 'datatables' | 'rules' | 'alerts' | 'org' | 'hr' | 'sys';

/** 导航菜单配置条目（名称 + 顺序由 store.list 顺序决定） */
export interface NavMenuEntry {
  key: NavMenuKey;
  label: string;
}

export interface HomeConfig {
  bgMode: 'color' | 'image';
  bgColor: string;
  bgImage: string;
  bgBlur: number;        // 背景毛玻璃（px）
  title: HomeTitleStyle;
  subtitle: HomeTitleStyle;
  loginBox: LoginBoxStyle;
  elements: HomeElement[]; // 通过「组件」添加的画布元素（文本 / 图片）
  /** 侧边栏导航菜单（命名 + 排序），顺序即显示顺序 */
  navMenus: NavMenuEntry[];
  /** 侧边栏品牌（左上角）：系统名称 + LOGO，名称支持字号/字重/颜色透明度/字间距 */
  brand: HomeTitleStyle & { logo?: string; padding?: { top: number; right: number; bottom: number; left: number } };
  /** 权限配置载体（岗位权限表 + 单用户覆盖），随 config 一并持久化 */
  permissions?: RolePerm[];
  permOverrides?: PersonPermOverride[];
}

/** 导航菜单默认顺序与名称 */
export const DEFAULT_NAV_MENUS: NavMenuEntry[] = [
  { key: 'home', label: '首页' },
  { key: 'datatables', label: '数据表管理' },
  { key: 'rules', label: '预警规则' },
  { key: 'alerts', label: '预警列表' },
  { key: 'org', label: '组织架构' },
  { key: 'hr', label: '人事管理' },
  { key: 'sys', label: '系统管理' },
];

export const DEFAULT_HOME_CONFIG: HomeConfig = {
  bgMode: 'color',
  bgColor: '#ffffff',
  bgImage: '',
  bgBlur: 0,
  title: {
    text: 'DIANNIU.YJ', font: 'system-ui', size: 61, weight: 300, letterSpacing: 23, marginLeft: 56,
    color: '#000000', opacity: 1, x: 8, y: 42,
  },
  subtitle: {
    text: '零售终端数据预警与通知助手', font: 'system-ui', size: 12, weight: 500, letterSpacing: 18, marginLeft: 58,
    color: '#000000', opacity: 0.9, x: 8, y: 48,
  },
  loginBox: {
    x: 78, y: 48, width: 342, height: 379, bgColor: '#ffffff', bgOpacity: 0.12, blur: 12, radius: 12,
    padX: 25, padY: 23, fieldHeight: 37,
    shadowColor: '#000000', shadowOpacity: 0.25, shadowX: 0, shadowY: 12, shadowBlur: 24,
    title: { text: '店牛预警平台', font: 'system-ui', size: 20, weight: 700, letterSpacing: 1, color: '#1f2937', opacity: 1 },
    subtitle: { text: '请登录您的账号', font: 'system-ui', size: 12, weight: 400, letterSpacing: 0, color: '#9ca3af', opacity: 1 },
    label: { text: '账号', font: 'system-ui', size: 12, weight: 400, letterSpacing: 0, color: '#6b7280', opacity: 1 },
    button: { text: '登录', width: 0, height: 44, size: 14, weight: 500, letterSpacing: 1, color: '#ffffff', bgColor: '#2563eb', radius: 8 },
  },
  elements: [],
  navMenus: DEFAULT_NAV_MENUS,
  brand: {
    text: 'DIANNIU.YJ', logo: '',
    font: 'system-ui', size: 22, weight: 500, letterSpacing: 3,
    color: '#000000', opacity: 1, x: 0, y: 0, marginLeft: 0,
    padding: { top: 20, right: 16, bottom: 20, left: 16 },
  },
};

export function normalizeHomeConfig(c?: Partial<HomeConfig> | null): HomeConfig {
  return {
    ...DEFAULT_HOME_CONFIG,
    ...(c || {}),
    title: { ...DEFAULT_HOME_CONFIG.title, ...(c?.title || {}) },
    subtitle: { ...DEFAULT_HOME_CONFIG.subtitle, ...(c?.subtitle || {}) },
    loginBox: { ...DEFAULT_HOME_CONFIG.loginBox, ...(c?.loginBox || {}), title: { ...DEFAULT_HOME_CONFIG.loginBox.title, ...((c?.loginBox?.title as object) || {}) }, subtitle: { ...DEFAULT_HOME_CONFIG.loginBox.subtitle, ...((c?.loginBox?.subtitle as object) || {}) }, label: { ...DEFAULT_HOME_CONFIG.loginBox.label, ...((c?.loginBox?.label as object) || {}) }, button: { ...DEFAULT_HOME_CONFIG.loginBox.button, ...((c?.loginBox?.button as object) || {}) } },
    brand: { ...DEFAULT_HOME_CONFIG.brand, ...(c?.brand || {}) },
    elements: Array.isArray(c?.elements) ? c.elements : [],
    navMenus:
      Array.isArray(c?.navMenus) && c!.navMenus.length > 0
        ? c!.navMenus
            .map((m) => {
              const def = DEFAULT_NAV_MENUS.find((d) => d.key === m.key);
              return def ? { key: def.key, label: m.label || def.label } : null;
            })
            .filter((x): x is NavMenuEntry => !!x)
        : DEFAULT_NAV_MENUS,
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