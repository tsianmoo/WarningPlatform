# 项目上下文

## 项目概述

预警规则画布：可视化编排预警规则（节点流 + 求值引擎），规则触发后产生预警工单，数据经 Supabase 持久化。前端读写整份对象（DataTable / AlertRule / AlertTask），经 `/api/state` 全量读取与全量覆盖式同步。

## 项目结构（多层导入）

- **工作区根（git 仓库根）**：`/workspace/projects` — 平台 `AGENTS.md` 读取与 `.coze` 入口所在
- **技术项目根（真实源码）**：`/workspace/projects/projects`（本文件所在）
- 根 `.coze`：`/workspace/projects/.coze`，`[subprojects].path = ["projects"]`
- 子项目 `.coze`：`projects/.coze`，含 `sub_id=7c8de81d`、`project_type=web`、`[dev]`/`[deploy]`（相对子项目根）
- 预览端口声明：`projects/.preview`（`expose_port=5000`）
- **scripts/ 内所有脚本基于 `SCRIPT_DIR` 推导子项目根**（`PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"`），不要依赖 `pwd` / 平台注入的 `COZE_WORKSPACE_PATH` 默认值，否则会落到工作区根（那里无 package.json）。

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4
- **持久化**: Supabase (PostgREST) + Drizzle schema 定义

## 目录结构

```
├── public/                 # 静态资源
├── scripts/                # 构建与启动脚本
│   ├── build.sh            # 构建脚本
│   ├── dev.sh              # 开发环境启动脚本
│   ├── prepare.sh          # 预处理脚本
│   └── start.sh            # 生产环境启动脚本
├── src/
│   ├── app/                # 页面路由与布局
│   ├── components/ui/      # Shadcn UI 组件库
│   ├── hooks/              # 自定义 Hooks
│   ├── lib/                # 工具库
│   │   └── utils.ts        # 通用工具函数 (cn)
│   └── server.ts           # 自定义服务端入口
├── next.config.ts          # Next.js 配置
├── package.json            # 项目依赖管理
└── tsconfig.json           # TypeScript 配置
```

- 项目文件（如 app 目录、pages 目录、components 等）默认初始化到 `src/` 目录下。

## 包管理规范

**仅允许使用 pnpm** 作为包管理器，**严禁使用 npm 或 yarn**。
**常用命令**：
- 安装依赖：`pnpm add <package>`
- 安装开发依赖：`pnpm add -D <package>`
- 安装所有依赖：`pnpm install`
- 移除依赖：`pnpm remove <package>`

## 开发规范

### 编码规范

- 默认按 TypeScript `strict` 心智写代码；优先复用当前作用域已声明的变量、函数、类型和导入，禁止引用未声明标识符或拼错变量名。
- 禁止隐式 `any` 和 `as any`；函数参数、返回值、解构项、事件对象、`catch` 错误在使用前应有明确类型或先完成类型收窄，并清理未使用的变量和导入。

### next.config 配置规范

- 配置的路径不要写死绝对路径，必须使用 path.resolve(__dirname, ...)、import.meta.dirname 或 process.cwd() 动态拼接。

### Hydration 问题防范

1. 严禁在 JSX 渲染逻辑中直接使用 typeof window、Date.now()、Math.random() 等动态数据。**必须使用 'use client' 并配合 useEffect + useState 确保动态内容仅在客户端挂载后渲染**；同时严禁非法 HTML 嵌套（如 <p> 嵌套 <div>）。
2. **禁止使用 head 标签**，优先使用 metadata，详见文档：https://nextjs.org/docs/app/api-reference/functions/generate-metadata
   1. 三方 CSS、字体等资源可在 `globals.css` 中顶部通过 `@import` 引入或使用 next/font
   2. preload, preconnect, dns-prefetch 通过 ReactDOM 的 preload、preconnect、dns-prefetch 方法引入
   3. json-ld 可阅读 https://nextjs.org/docs/app/guides/json-ld

## UI 设计与组件规范 (UI & Styling Standards)

- 模板默认预装核心组件库 `shadcn/ui`，位于`src/components/ui/`目录下
- Next.js 项目**必须默认**采用 shadcn/ui 组件、风格和规范，**除非用户指定用其他的组件和规范。**

## 规则引擎节点（预警规则画布）

- 求值引擎：`src/lib/evaluate.ts` 的 `evaluateFlow(nodes, edges, tables)`，按 `flow.nodes` 数组顺序逐节点求值（无连线时依赖数组顺序），结果写入 `outputs[nodeId]`。
- **节点数组顺序即执行顺序**：新增上游节点（如过滤/聚合）时，必须把它排在引用它的下游节点之前，否则下游 `byId(nodeId)` 取不到结果会 fallback 到错误节点。
- **求值用引用依赖补齐拓扑**：`evaluateFlow` 的拓扑排序默认只认连线（edges）。若某节点通过 data 显式引用上游（`factNode`/`sourceNode`/`universeNodeId`/`left`/`right`/`ref`），则 `collectNodeDataRefs(node)` 会把该引用也算入依赖，确保上游先求值；无引用时仍依赖数组顺序。故这些"引用型"节点（如 filljoin 关联的结果节点）可不必画线，引擎会自动等待上游就绪。
- **filljoin 匹配键去重**：输出列生成时会对匹配键（主键 + extraKeys 的全集侧）去重，同一全集键只输出一次，避免重复列。
- **计算节点可链式引用前一计算**：compute 用"两节点结果运算"（`expr.leftType='node'`）时，`expr.left.nodeId` 指向被引用节点，evaluate 用 `byId(nodeId)` 取其完整输出，`tokens` 里选该节点结果列（如第一个计算的 resultLabel"连带率"）做二次运算。`collectNodeDataRefs` 已收集 `left.nodeId`，故自动建立拓扑依赖，无需画线。
- **引用下拉（refOutputs）对同一节点去重**：`getNodeOutputs` 会给 compute 同时注册 `column` 和 `scalar` 两条同名记录（label 都是 resultLabel），若不按 nodeId 去重，下拉/列表里同一计算节点会重复显示（如两个"连带率"），极易误导为"计算组件重复"。
- **compute 的 inferNodeCols 递归带出上游字段**：`inferNodeCols` 对 compute 在"两节点结果运算"（`expr.leftType='node'`）时，会沿 `expr.left.nodeId` 递归取上游节点的全部输出列 + 追加自身结果列，供"点字段加入"候选；否则仅返回自身 resultLabel 一列。带 visited 集合防环（节点自引用即截断）。改动时注意保持该行为，否则选了数据节点后"点字段"里只有结果列、看不到上游分组的具体字段。
- **排名（rank）可链式叠加**：rank 节点输出列 = 上游全部列（baseCols 透传）+ 每个排名项「排名」「TOP档」两列。因此第二个 rank 若引用第一个 rank 节点，预览会同时带出第一个 rank 的全部列（含其"折扣排名"）并在其上追加"连带率排名"，实现"在上一排名基础上增加一列排名"。⚠️ 要达到此效果，第二个 rank 的"引用节点输出"必须选**第一个 rank 节点本身**，而不是各自引用 compute（那样拿不到上游排名列）。
- **rank/TOP 列名去重**：排名列与 TOP 档列生成时统一用 `uniq()` 避开 baseCols（上游透传列）与已用列名，冲突时追加 `#2/#3`，避免链式 rank 复用同字段时 TOP 列覆盖（旧实现只对 items 内同名去重，感知不到上游透传列）。
- **groupby 多指标可自定义结果字段名**：`GroupMetric` 每项含 `fieldKey`（字段）、`fn`（聚合方式）、`resultLabel`（**结果字段名**，可为空）。UI 指标行顺序为「选字段 → 选聚合方式 → 填空结果字段名」；`resultLabel` 空时默认列名为 `求和(字段)` 等（evaluate `outLabel: m.resultLabel || ''`，inferNodeCols `key: s(m.resultLabel) || fn(字段)` 一致）。⚠️ 改 `resultLabel` 后下游 filljoin/condition 已选旧列名的引用会失配，需下游重新选字段。
  - **groupby 预览含时间窗起止列**：groupby 结果在配置了非 `all` 时间窗且选了日期字段时，输出首两列固定为「开始日期/结束日期」（按 `resolveTimeWindow` 解析的起止，格式 `YYYY/MM/DD`），空行兜底也补；便于预览查看统计的是哪段日期（如 本周几号到几号）。<br>
- **rank 排名项可选字段（pickedCols）**：节点结果模式下应**实时用 `inferNodeCols(refNode)` 的 nodeCols 作主候选，再并入保存的 incomingCols 快照去重**——不能只信 incomingCols 快照（它可能是选 refNode 前的旧值，导致链式 rank 引用后"待排名指标列"下拉为空、看不到上游排名列）。inferNodeCols 对 rank 会递归上游全部列（可达 groupby 各指标）+ 上游排名项的「排名/TOP档」列，因此 rank 可再次对上游排名结果字段（如"折扣排名"）排序。
- **compute 的 inferNodeCols 必须透传上游列**：compute 无论"字段聚合（source==='node'）"还是"两节点结果运算（expr.left）"，输出都 = 上游主表列 + resultLabel（与 evaluate `columns:[...main.columns,label]` 对齐）。若 inferNodeCols 只返回 resultLabel，串成 rank→compute 链时会让上游全部指标列丢失，导致排名项只能选到"折扣/折扣排名/TOP档"几个字段。修复：compute case 同时递归 `sourceNode` 与 `expr.left.nodeId` 两路上游。
- **rank 的 inferNodeCols 提取 srcNode 不能用 `s(data.refNode)`**：`refNode` 是对象不是字符串，惰性 `s()`（只接受非空字符串）会返回空串，导致上游列永远无法递归带出，rank 下拉只剩自身 items 的列。必须直接取 `data.refNode.nodeId`。教训：凡 `refNode`/`left`/`right` 这类对象型引用字段，一律取 `x.nodeId`，不要经 `s()` 提取。
- 节点类型：`base/topn/groupby/filter/diff/lookup/filljoin/condition/compute/elapsed/action/logic/trigger`，类型定义在 `src/lib/types.ts`，节点编辑 UI 在 `src/components/flow/nodes.tsx`。
- **基础数据（base）取列模式**：`BaseNodeData` 支持 `columns:{key,label}[]` 多选输出列，`distinct` 去重仅当勾选**单列**时生效（多列强制不去重）。无 `columns` 时回退旧 `fieldKey/fieldLabel` 单列去重。**left fills with base/filter as 全集**: 左关联补全建议全集用 filter 结果（需选 store字段），`universeReturnFields` 支持多选/默认返回全部。
- **预警动作（action）**：`ActionNodeData` 用 `type`（`remind`提醒/`alert`预警）+ `priority`（预警时 `Important&Urgent`重要且紧急/`Important`重要不紧急/`Urgent`紧急/`Info`一般），保留旧 `level` 兼容。`content` 为**消息模板**，可插入 `{字段名}` 占位。插入字段 UI 为"先选节点、再点字段"两级选择：按节点分组展示规则内所有节点的输出列（**不限于直接输入边**，动作节点未连线也可选字段），节点下拉显示 `类型（resultLabel）` 以区分同类型多节点，选中节点后再点击其字段按钮把 `{字段名}` 插入 content。改字段名/新增节点后下拉字段会随之更新。动作节点头部自带"预览（命中店铺清单）"与"删除"按钮。⚠️ **action 是终点节点，数据流靠显式 `sourceNode?: NodeResultRef` 取上游命中数据，不依赖 edges**（整套画布 edges 常为 0，其它节点都靠显式引用字段解析依赖）。UI 提供「数据来源」下拉（复用插入字段的 nodeOptions），evaluate 的 action 分支用 `pickColumnOutput(outputs, incoming, dA.sourceNode?.nodeId)`（无 sourceNode 时回退 incoming 的含行首表）；不选数据来源 → action 预览为空并提示需配置。action 预览额外返回 `alertMessages`（`{title,content}[]`，对每个命中行渲染 content 模板，最多 50 条），NodePreview 弹窗在表格上方以卡片展示"通知消息预览（已用命中数据填充字段）"。`buildAlertsForRule`（store.tsx）生成 AlertTask 时：用 `{字段}` → 规则命中第一行的字段值做模板替换；`level` 由 `type/priority` 派生（Important&Urgent/Urgent→critical，alert→warn，remind→remind）。⚠️ 新增节点类型字段只改 UI+buildAlerts，别忘把 `alert.level` 可空处补 `?? 'warn'` 兜底。evaluate 的 base 分支按 `source!=='node' && bd.columns` 决定取列表格输出；col `columns` 只在数据表模式生效，切到节点模式会回退 fieldKey。inferNodeCols/getNodeOutputs 的 base 分支均按 selected columns 输出下游可选列。⚠️ inferNodeCols 的 groupby 分支会在配置了 `dateField`+`timeWindow`（preset≠all）时前置「开始日期/结束日期」两列，与 evaluate groupby 输出对齐（改 evaluate 的 groupby 输出列时务必同步 inferNodeCols）；inferNodeCols 也补了 `condition` 分支——透传 `leftNode/leftType(node)` 上游 rowset 的列，使预警动作从判断节点选字段能拿到上游完整列（含指标列与开始/结束日期）。插入字段下拉展示的列来自 inferNodeCols，用户须从下拉选真实列名，否则 `{字段}` 替换为空。插入字段按 **textarea 当前光标位置**插入 `{字段名}`（绑定 `contentRef`+`cursorPos`，插入后恢复焦点与光标），录入文本位置不变。⚠️ 插入字段列表优先取 `evalOuts`（action 内 `useMemo` 跑 `evaluateFlow(allNodes, edges, tables)` 得到各节点 `NodePreview.columns`，即"节点预览数据"的**真实完整列**，columns 为 string 数组，映射需同时兼容 `{key,label}` 与 string 两种形态），evaluate 失败时回退 `inferNodeCols` 推断列。UI 已移除「数据来源」下拉，action 取数完全依赖 edges incoming（evaluate 无 sourceNode 时回退 incoming 的含行首表）。
- **统计时间窗（time.ts）**：`TimeWindow` 结构含 `preset/mode/custom/compare`；`resolveTimeWindow(tw, now)` 返回 `ResolvedTimeWindow{start,end,label,compare}`。预设分周/月/季/年族及"至今"变体（`weekToDate/monthToDate/quarterToDate/yearToDate` = 从周期起始到今天之前）+ 整段（`thisWeek/thisMonth/thisQuarter/thisYear`）+历史（`lastWeek/lastMonth` 等）。
  - **compare（同期/环期）**：`tw.compare={enabled,mode:'yoY'|'ring',shift}`。`computeCompareWindow` 按窗口粒度整体平移：`yoY` 对 start/end 各回退 shift 年（同月同日→去年同期）；`ring` 按粒度前移（week→7天、month→1月、quarter→3月、year→1年、day→N天），做到"本周至今(周一到今天) 环期 = 上周一到上周今天"的子区间对齐。粒度由 `granularityOf(preset)` 从 preset 推断。改 compare 计算时注意保持"等长平移 + 保留本期子区间对齐"。evaluate 目前仅用 `start/end` 过滤行（`inWindow`）。groupby 分支已消费 compare：对同一数据源按 `twr.compare.start/end` 再聚合一次得对比组，并排输出本期/对比期/增长率%（列名形如 `求和(销售金额) · 上移 N 周期`、`…· 增长率%`）。对比期无数据的店铺该列显示 `—`。真实数据表若只有当月数据（缺上月/去年同期），环期/同比值会全为 `—`，表现像是"没有对比列"，实为无历史数据可比。
- **左关联补全 filljoin**：`universe`（全集=每行都保留的骨架）左关联 `fact`（要补充带回的指标），缺失补 `fillValue`。
  - 全集来源 `universeSource: 'table'|'node'`（node 时用 `universeNodeId` 指向上游节点，如前一补全结果）；`universeField`+`extraKeys` 为复合匹配键；`universeReturnField` 把全集自身非键列（如销量）随行带回。
  - 事实来源 `factSource: 'table'|'node'`（node 时用 `factNode`）；`factKeyField`+`extraKeys.factField` 为事实侧匹配键；`factReturnField` 指定只带回某一列指标（如「库存」），不填则带回所有非键列。
  - **匹配键必须显式手动选择，不做自动兜底**：evaluate 要求 `universeField`（全集主匹配键）与 `factKeyField`（事实主匹配键）都显式存在，否则返回提示"请先选择全集主匹配键字段/请选择事实主匹配键"，**不再自动取全集首列兜底**。⚠️ 全集侧字段来自它的源（如"直联营店仓"filter 的结果列）可选项，而事实侧字段来自事实节点列——两侧字段名可能不同（如全集是`店仓名称`、事实是`店铺名称`），用户需各自分别选择后再匹配，选错/漏选会导致匹配不上、指标列全变填充值。改动时勿恢复自动兜底。
  - 关联诊断：`evaluate.ts` 可用 esbuild 打包后 node 运行，脚本 fetch `/api/state` 取真实数据复现（见 /tmp/diag 系列脚本思路）。
- 诊断脚本可用 `npx esbuild /tmp/x.ts --bundle --platform=node --format=esm --outfile=/tmp/x.mjs` 打包后 `node /tmp/x.mjs` 运行。

## 运行与预览

- 预览链路（承自根 `.coze [dev]`）：`bash projects/scripts/prepare.sh`（装依赖）→ `bash projects/scripts/dev.sh`（`tsx watch src/server.ts`，dev server，端口取 `.preview` 的 5000）。
- 部署链路（根 `.coze [deploy]`）：`bash projects/scripts/build.sh`（`pnpm next build` + `tsup src/server.ts` → `dist/server.js`）→ `bash projects/scripts/start.sh`（`PORT=5000 node dist/server.js`）。
- **前后端同进程**：前端调后端一律用相对路径 `/api/...`，不硬编码域名/IP/localhost。
- 服务端入口 `src/server.ts`：按 `COZE_PROJECT_ENV=PROD` 区分 dev/prod，`HOSTNAME`/`PORT` 默认 localhost/5000。
- **⚠️ 部署启动必须先 `export COZE_PROJECT_ENV=PROD`**：`start.sh` 已内置；否则 `node dist/server.js` 会误走 dev 模式（`next dev` + `.next/dev` lock，可能与预览进程冲突）。部署验证用临时端口：`DEPLOY_RUN_PORT=5033 bash scripts/start.sh`。
- web 项目验收用 `test_run`（静态检查 + 服务探活 + 接口冒烟），不用 shell 绕跑。
- **lint 基准**：本项目已修至 `pnpm lint` 0 error 0 warning（禁 `any`/未用变量、JSX 内不直接 `Date.now()`/`Math.random()`/`"` 等）。改动代码后保持 `pnpm lint` / `pnpm ts-check` / `pnpm lint:style` 全绿，勿回退。

## 数据库（Supabase）

- 凭证由平台注入：`COZE_SUPABASE_URL` / `COZE_SUPABASE_ANON_KEY` / `COZE_SUPABASE_SERVICE_ROLE_KEY`；`supabase-client.ts` 按 dotenv → `coze_workload_identity`（python3，向平台拉取项目环境变量）→ 抛错的顺序加载。
- **运行环境里 shell 不一定预置这些变量**，必须通过 `coze_workload_identity` 取；本地验证 node 侧读取用 `./node_modules/.bin/tsx` 跑 client。
- 业务表（`src/storage/database/shared/schema.ts` 定义）：`data_tables`、`alert_rules`、`alert_tasks`（`health_check` 为系统表勿动）。
- 表结构迁移/建表：schema 改动用 `coze-coding-ai db upgrade`，或直接对 develop 库 exec_sql；已在线上建好三业务表并 `ENABLE ROW LEVEL SECURITY`。
- RLS：项目无 Auth（场景 A），后端用 service_role_key 天然绕过 RLS，不建 policy（无 policy 时 anon 完全被阻断，更安全）。
- `src/app/api/state`：GET 全量读、POST 全量覆盖同步；字段名 snake_case 与数据库列一致。
