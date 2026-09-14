# 项目上下文

## 项目概述

预警规则画布：可视化编排预警规则（节点流 + 求值引擎），规则触发后产生预警工单，数据经 Supabase 持久化。前端读写整份对象（DataTable / AlertRule / AlertTask），经 `/api/state` 全量读取与全量覆盖式同步。

### 预警/规则/分组模型关联

- **预警工单** `AlertTask`：字段含 `id`(NOT NULL，落库必需，缺失时后端 `syncAlerts` 自动补齐)、`ruleId`、`ruleName`(规则标题)、`title`(预警标题)、`level`、`status`、`dept`、`assignee`、`preview`、`conditionDesc`。
- **预警标题规则**：`buildAlertsForRule`（`src/lib/store.tsx`）生成预警时，`title` 取该预警**动作节点的 `title` 字段**（`ActionNodeData.title` 的 `.trim()`），未填时回退规则标题 `rule.name`。动作节点面板已有"预警标题"输入框（带"将显示在预警列表的标题列"提示）。`ruleName` 始终为规则标题，二者可不同。
- **预警分组**：`AlertRule.groupId` 关联 `RuleGroup`(id/name/created_at)。前端 `AlertList` 经 `ruleId → rule.groupId → ruleGroups.name` 解析分组名展示；无 → '—'。分组数据经 `/api/state` 同步。
- **预警列表列结构**（`src/components/AlertList.tsx`）：序号 / 预警规则(`ruleName`) / 预警标题(`title`) / 预警分组(`groupOf`) / 预警条数 / 级别 / 部门 / 接收人 / 创建人 / 时间 / 已耗时 / 状态 / 操作。列表上方有「快捷日期标签（今天/昨天/本周/上周/本月/上月/全部，经 `quickRange` 生成 start/end 驱动 `filter.start/end`）+ 自定义日期区间 + 四项统计卡片（预警条数=总数、已完成=`done`、未完成=总数-完成-失败、无法完成=`failed`）」，统计基于当前筛选结果 `filtered` 动态计算，与列表同步联动。
- **预警动作独立开关**：动作节点数据含 `enabled?: boolean`，`buildAlertsForRule` 过滤 `enabled !== false`；配置页激活与列表页启用（`activateRule`）均会生成本规则预警。
- **全量覆盖同步风险**：`/api/state` POST 会全量覆盖数据库（upsert 传入 + 删除不在传入集合的旧预警）。`syncAlerts`（`src/lib/server/repo.ts`）已加**空集合守卫**：本次提交 alerts 为空数组时不执行 stale 删除（return），避免前端某次空同步误删全部业务预警。任何调整预警同步逻辑或新增前端触发源时，务必注意"若某次 push 的 alerts 集合不完整，会静默删掉库中其它预警"。
- **组织架构 / 人事架构**：承载预警通知对象（最终通知到"用户和人员"）。组织 `Organization`（表 `organizations`：`id/name/kind/parent_id/sort/created_at`）——用户明确"是平级标签"（总部/分公司/部门/区域/门店/其他，`kind` 分类，`parentId` 预留但默认不同）。人员 `Person`（表 `persons`：`id/name/org_id/title/post/supervisor_id/manage_scope(JSONB)/phone/email/enabled/sort/created_at`，`title`=职位、`post`=岗位，均来自「职位/岗位管理」属性标签），**挂在组织节点下**（`orgId`）；`manageScope` 用 `ManageScope{tableId,field,value,desc}` 表达"管理范围＝某数据表某字段=某分类值"（如 该店长管理"大区=华东大区"下的门店/人员）。`supervisorId` 为上级人员（空=最高层）。经 `/api/state` 的 `orgs`/`persons` 全量同步（repo `getAllOrgs/syncOrgs/getAllPersons/syncPersons`）。页面：`OrgArch.tsx`（组织分类）、`PeopleManage.tsx`（人员管理：部门极+人员增删改）、`AttrManage.tsx`（属性管理：属性+子标签），挂载于 `page.tsx` 的 `View='org'/'people'/'attrs'`（侧边导航「人事管理」父级下展开 人员管理/属性管理）。通知动作面板（`nodes.tsx` TargetPanel）通知对象已改为从 `state.persons`/`state.organizations` 动态选择（`notify.orgIds`/`personIds`），不再用写死常量 `PERSONNEL`/`DEPARTMENTS`（import 已移除）。
  - **人事架构为分层树**：总部 `org_head` 为根，其下通过 `parent_id` 挂总经办 `org_zjb` 及人事部/团购部/电商部/商品部/督导部/仓储部/财务部/企划部/全国部等部门（seed）。`OrgArch.tsx` 支持「上级组织」选择、卡片上移/下移（store `moveOrg(id,dir)`）与编辑/删除；`PeopleManage.tsx` 左侧按 `parentId` 递归渲染部门树。
  - **人事属性字典** `HrAttribute`（表 `hr_attributes`：`id/name/items(JSONB)/sort/created_at`，`items` 为 `{id,name}`[]），如 部门管理/职位管理/岗位管理，同类可增删多条条目。经 `/api/state` 的 `hrAttributes` 全量同步（repo `getAllHrAttributes/syncHrAttributes`）；在 `AttrManage.tsx` 「属性管理」页新增属性并为其下增删标签条目（store `addHrAttribute/updateHrAttribute/removeHrAttribute`；`addHrAttribute` 形参为 `Omit<HrAttribute,'id'|'createdAt'>`）。
  - **经销商 / 店仓**：经销商字典 `Dealer`（表 `dealers`：`id/name/sort/created_at`）、店仓字典 `Store`（表 `stores`），均含 `add/update/remove/move(id,dir)` store 方法 + `getAllXXX/syncXXX` repo 全量同步，经 `/api/state` 的 `dealers`/`stores` 下发。
  - **登录与首页管理**：登录页 `src/app/login/page.tsx`（`/login`，左右分屏：左=店牛预警平台大/小标题 + 背景，右=账号/密码/验证码登录；账号/密码从 `state.persons` 的 `username`/`password` 校验，验证码为前端随机 4 位、成功写 `localStorage['dn_auth']` 后跳 `/`）。`page.tsx` 首页在 `useEffect` 检测无 `dn_auth` 即 `router.replace('/login')` 做登录守卫。登录页样式由「系统管理→首页管理」（`HomeConfig.tsx`，`View='homecfg'`）配置：`home_config` 表单行 `id='home'`、`config` JSONB，存 `HomeConfig{bgMode:color|image, bgColor, bgImage(dataURL), title{subtitle{text,font,size,color,opacity}, titleX, titleY}`（大/小标题字号/颜色/透明度/字体 + 极简位置 + 背景颜色或上传图），经 `/api/state` 的 `config` 下发（store `updateHomeConfig`，reducer `UPDATE_CONFIG`）。登录页独立 fetch `/api/state` 读 config 渲染，不依赖 store。业务库 seeded `persons`(admin/123456 = 刘总)、`home_config` 默认配置。`Person` 扩展 `dealerId`/`storeId`（归属经销商/店仓），`hr_attributes` 增加 `category`(text,默认'person') 区分属性归属('person'/'dealer'/'store')。页面：`DealerStoreManage.tsx`（`kind='dealer'|'store'`，左侧字典 CRUD+上下移、右侧其下人员增删改，人员表单可自由选归属经销商/店仓）；`AttrManage.tsx` 接受 `category` prop 按分类过滤（经销商属性/店仓属性）。挂载于 `page.tsx` 的 `View='dealer'/'store'/'dattrs'/'sattrs'`（导航「组织架构」父级下：组织分类/经销商管理/经销商属性/店仓管理/店仓属性）。

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
- **预警列表（AlertList.tsx）视觉约束**：用户要求"简约高级感、杜绝 AI 味道"——禁用泛蓝渐变（去 `blue-500/blue-600` 主色）、禁用粉彩徽标堆砌（级别/状态改用 **tonal 浅底或中性 dot+文字色**）、禁用发虚重阴影与 `rounded-2xl` 大圆角（改 `rounded-xl` + `border-gray-200` + `shadow-lg`）。表头与内容均 `whitespace-nowrap`（标题栏文本、重要程度、状态、触发时间、操作列不换行）；重要程度列用「dot + label」而非大色块；主操作按钮统一 `bg-gray-800`（中性深色）而非彩色实心；序号用 `tabular-nums` 细灰。容器为白底 `rounded-xl border` 卡片而非在灰底上裸表。
- **预警列表列结构（当前版）**：序号 / 标题 / 预警条数（= `preview.storeMessages?.length` 或 `preview.rows.length`）/ 重要程度 / 适用部门 / 适用人员 / 创建人（`createdBy`）/ 创建时间（= `createdAt`）/ 已过时间 / 状态 / 操作。已删除「判断方式」列与标题下二级消息；标题列文本垂直居中（`align-middle` + `whitespace-nowrap`）；表格无边线（无外层 border、无行分割线，靠行 hover 高亮区分）。
- **店仓级预警消息（storeMessages）**：由 `buildAlertsForRule` 对每个 action 节点命中明细逐行渲染——列取 `storeMessages[].{store, message}`，`store` 取含「店/仓」的列（否则首列），`message` 用 action 消息模板 `{字段}` 替换该行值。`createdBy='系统'`（规则触发）。两者随 `preview` JSON 持久化（repo 白名单列无法新增，故塞进 preview JSON，零 schema 改动）。点击「查看」展开显示每个店铺的预警消息。

## 规则引擎节点（预警规则画布）

- 求值引擎：`src/lib/evaluate.ts` 的 `evaluateFlow(nodes, edges, tables)`，按 `flow.nodes` 数组顺序逐节点求值（无连线时依赖数组顺序），结果写入 `outputs[nodeId]`。
- **节点数组顺序即执行顺序**：新增上游节点（如过滤/聚合）时，必须把它排在引用它的下游节点之前，否则下游 `byId(nodeId)` 取不到结果会 fallback 到错误节点。
- **求值用引用依赖补齐拓扑**：`evaluateFlow` 的拓扑排序默认只认连线（edges）。若某节点通过 data 显式引用上游（`factNode`/`sourceNode`/`universeNodeId`/`left`/`right`/`ref`），则 `collectNodeDataRefs(node)` 会把该引用也算入依赖，确保上游先求值；无引用时仍依赖数组顺序。故这些"引用型"节点（如 filljoin 关联的结果节点）可不必画线，引擎会自动等待上游就绪。
- **filljoin 匹配键去重**：输出列生成时会对匹配键（主键 + extraKeys 的全集侧）去重，同一全集键只输出一次，避免重复列。
- **计算节点可链式引用前一计算**：compute 用"两节点结果运算"（`expr.leftType='node'`）时，`expr.left.nodeId` 指向被引用节点，evaluate 用 `byId(nodeId)` 取其完整输出，`tokens` 里选该节点结果列（如第一个计算的 resultLabel"连带率"）做二次运算。`collectNodeDataRefs` 已收集 `left.nodeId`，故自动建立拓扑依赖，无需画线。⚠️ **同一节点内两字段逐行运算（如 `已过天数 － 开单天数`）**：UI 把算子数值填在 `expr.left.col` 与 `expr.ref.col`（两列指向**同一个** `nodeId`），`tokens` 为空栈。`collectNodeDataRefs` **必须同时收集 `d.expr.left.nodeId` / `d.expr.ref.nodeId`**（旧代码只收集顶层 `d.left/right/ref`，漏了 `d.expr.*`，导致 compute 不依赖任何上游 → 排在 filljoin 之前求值 → `byId` 取不到上游表 → 误走成标量分支返回空）。修复后 compute 正确命中 line ~1799 的 `sameNode` 分支逐行算两列。⚠️ 若再改 `expr` 结构或新增 compute 子模式，务必确认 `collectNodeDataRefs` 覆盖所有上游 nodeId 引用（否则无连线规则的拓扑会乱序导致预览为空）。
- **引用下拉（refOutputs）对同一节点去重**：`getNodeOutputs` 会给 compute 同时注册 `column` 和 `scalar` 两条同名记录（label 都是 resultLabel），若不按 nodeId 去重，下拉/列表里同一计算节点会重复显示（如两个"连带率"），极易误导为"计算组件重复"。
- **compute 的 inferNodeCols 递归带出上游字段**：`inferNodeCols` 对 compute 在"两节点结果运算"（`expr.leftType='node'`）时，会沿 `expr.left.nodeId` 递归取上游节点的全部输出列 + 追加自身结果列，供"点字段加入"候选；否则仅返回自身 resultLabel 一列。带 visited 集合防环（节点自引用即截断）。改动时注意保持该行为，否则选了数据节点后"点字段"里只有结果列、看不到上游分组的具体字段。
- **排名（rank）可链式叠加**：rank 节点输出列 = 上游全部列（baseCols 透传）+ 每个排名项「排名」「TOP档」两列。因此第二个 rank 若引用第一个 rank 节点，预览会同时带出第一个 rank 的全部列（含其"折扣排名"）并在其上追加"连带率排名"，实现"在上一排名基础上增加一列排名"。⚠️ 要达到此效果，第二个 rank 的"引用节点输出"必须选**第一个 rank 节点本身**，而不是各自引用 compute（那样拿不到上游排名列）。
- **rank/TOP 列名去重**：排名列与 TOP 档列生成时统一用 `uniq()` 避开 baseCols（上游透传列）与已用列名，冲突时追加 `#2/#3`，避免链式 rank 复用同字段时 TOP 列覆盖（旧实现只对 items 内同名去重，感知不到上游透传列）。
- **groupby 多指标可自定义结果字段名**：`GroupMetric` 每项含 `fieldKey`（字段）、`fn`（聚合方式）、`resultLabel`（**结果字段名**，可为空）。UI 指标行顺序为「选字段 → 选聚合方式 → 填空结果字段名」；`resultLabel` 空时默认列名为 `求和(字段)` 等（evaluate `outLabel: m.resultLabel || ''`，inferNodeCols `key: s(m.resultLabel) || fn(字段)` 一致）。⚠️ 改 `resultLabel` 后下游 filljoin/condition 已选旧列名的引用会失配，需下游重新选字段。
  - **groupby 预览含时间窗起止列**：groupby 结果在配置了非 `all` 时间窗且选了日期字段时，输出「开始日期/结束日期/已过天数」+ 按所选时间窗粒度**只补一个**对应天数列「选什么显什么」：粒度 week/quarter/month/year/day 分别对应 本周天数/本季天数/本月天数/本年天数/本日天数（week=整周 7 天、month=当月总天数、year=当年总天数闰366/平365、quarter=当季总天数、day=1），均为周期**总天数**常量用于均摊/T+0 对比（起止按 `resolveTimeWindow` 解析格式 `YYYY/MM/DD`；`已过天数` 由 `calcElapsedDays` 从窗口开始日到今天独立计算，含今天；**并追加固定 4 列**：`当前日期`(今天 YYYY/MM/DD)、`周几`(如"星期一")、`第几周`(今年 ISO 周)、`剩余天数`(当前窗口结束前剩余天数=窗口总天数-已过天数，如本月剩 16)。不使用 `granularityOf` 时注意既有 preset 的粒度归属，空行兜底也补；便于预览查看统计的是哪段日期（如 本周几号到几号）、已过几天及整周期天数。改 evaluate 的 groupby 输出列时务必同步 inferNodeCols 分支。<br>
  - **groupby 分组维度可留空（全局聚合）**：`dims` 为空数组时不按任何维度分组，自动对数据源**所有 number 列**做全局聚合输出 1 行（每列名 `字段·求和`，如 `未开单天数·求和=15`）。规则：`gd.metrics` 用户已显式配置的 → 尊重用户指标；`gd.metrics` 为空 → 自动扫描 `t.fields` 中 `type==='number'` 的所有列生成 sum 指标。⚠️ 判断 userHasMetrics 用 `Array.isArray(gd.metrics) && gd.metrics.length>0`，防止把 line~1084 的 fallback push（metricField 单列）误判为"用户已配"，从而自动全列生效。groupby guard 已放开为 `!dims.length || dims.every(x=>!!x.key)`，故维度为空时也进入聚合分支（不再 return 空）。改时注意保持「无维度→全数值列聚合，有维度→按维度分组」两种语义不串。<br>
  - **groupby 空维度也须注册 scalar 输出（供判断组件右值选节点）**：空维度全局聚合（dims=[] 配 avg/sum 指标）的结果是一行，可进一步生成 `scalar`（如"平均未开单天数"，evaluate 输出 `shape:table, rows:1, scalar:{value:4.15}`）。判断组件右值"基准值"下拉只列 `scalarOutputs`（`valueSource==='node'` 时用 `pickScalarOutput` 取节点 scalar）。因此 `getNodeOutputs` 的 groupby 分支必须对**空维度**同时注册 `column` 与 `scalar` 两类输出，否则判断组件下拉看不到这类节点（用户报"只有未开单天数没有平均未开单天数"）。有维度的分组结果不注册 scalar。⚠️ eval 消费端用 `pickScalarOutput` 直接从节点输出取 scalar 值（4.15），再与本节点逐行值比较，无需拉表。<br>
- **baseline（基准统计：整列统计，无分组维度）**：用户要求**不再支持分组维度**。node 模式 UI 顺序：①统计字段=选「节点结果」（上游逐组列节点 → 存 `refNode.nodeId`）→ ②**统计列**=从该节点 `inferNodeCols` 输出列里选具体列（存 `refNode.col`/`colLabel`，复用 `NodeResultRef.col`）→ ③统计方式 → 结果命名。table 模式：①数据表→②统计字段(`valueField`)→③统计方式。统计方式 select 带 `disabled={!hasStatField}`，node 模式要求**同时选定节点结果与统计列**（`!!refNode.nodeId && !!refNode.col`）才解锁。evaluate node 模式取列：`valueKey = (refNode.col && src.columns.includes(col) ? col : null) || refNode.label || 最后一列`（col 优先，旧规则无 col 时回退 label）。对该列所有行值求基准（avg/median/max/min/topAvg/bottomAvg），输出单值 `scalar` + 单行表 `[基准项,数值]`。**命名上标题机制已内置**：`nodeTitle` 对 `baseline`/`groupby` 返回 `基准统计（resultLabel）`/`分组聚合（resultLabel）`（resultLabel 非空时）。改输出列时同步 inferNodeCols。
- **节点引用回溯 BFS 兼容对象/数组两形态**（曾用于基线 dims 收集，功能已移除但教训保留）：遍历上游 nodeId 引用时，filljoin/compute 用 `data.expr.ref/.left/.right` 且 compute 双节点运算是**对象** `{nodeId,col}`，不能只按数组 `expr.left?.[0]` 取；需兼容字符串键 `universeNodeId/factNodeId/sourceNode/aggNode/leftNodeId/rightNodeId` 与 `expr` 内对象/数组两种 ref，否则链路会断层。
- **React Flow 没有名为 `bezier` 的内置边类型**（会告警 Error#011 并回退 default）；内置曲线类型应写 `'default'` 或 `'simplebezier'`。此前把边类型写成 `'bezier'` 是错的，已改回 `'default'`（即贝塞尔曲线）。
- **添加节点不再默认连线**：`FlowCanvas.onDrop`（拖拽插入新组件）已移除"自动接 → 上一节点末尾"的逻辑（旧逻辑：画布存在 trigger 时新节点自动连到 `localNodes[last]`）。新组件落画布后**不自动连线**，由用户从节点端点手动拖出连线（`onConnect` 即默认手动连线回调）。改编辑连线的行为时勿恢复 onDrop 里的自动连边分支。
：节点结果模式下应**实时用 `inferNodeCols(refNode)` 的 nodeCols 作主候选，再并入保存的 incomingCols 快照去重**——不能只信 incomingCols 快照（它可能是选 refNode 前的旧值，导致链式 rank 引用后"待排名指标列"下拉为空、看不到上游排名列）。inferNodeCols 对 rank 会递归上游全部列（可达 groupby 各指标）+ 上游排名项的「排名/TOP档」列，因此 rank 可再次对上游排名结果字段（如"折扣排名"）排序。
- **compute 的 inferNodeCols 必须透传上游列**：compute 无论"字段聚合（source==='node'）"还是"两节点结果运算（expr.left）"，输出都 = 上游主表列 + resultLabel（与 evaluate `columns:[...main.columns,label]` 对齐）。若 inferNodeCols 只返回 resultLabel，串成 rank→compute 链时会让上游全部指标列丢失，导致排名项只能选到"折扣/折扣排名/TOP档"几个字段。修复：compute case 同时递归 `sourceNode` 与 `expr.left.nodeId` 两路上游。
- **rank 的 inferNodeCols 提取 srcNode 不能用 `s(data.refNode)`**：`refNode` 是对象不是字符串，惰性 `s()`（只接受非空字符串）会返回空串，导致上游列永远无法递归带出，rank 下拉只剩自身 items 的列。必须直接取 `data.refNode.nodeId`。教训：凡 `refNode`/`left`/`right` 这类对象型引用字段，一律取 `x.nodeId`，不要经 `s()` 提取。
- 节点类型：`base/topn/groupby/filter/diff/lookup/filljoin/condition/compute/elapsed/action/logic/trigger`，类型定义在 `src/lib/types.ts`，节点编辑 UI 在 `src/components/flow/nodes.tsx`。
- **过滤（filter）引用节点结果取全列值集合**：filter 条件 `valueSource==='node'`（引用排名/聚合节点）时，evaluate 要取该引用列**整列所有值**作候选集合、`op` 归一为 `in`（多行节点如 topn 产出的前 N 个款色），命中集合的所有行都保留；单行/单值节点回退其 `scalar`。切勿在 node 引用模式只取 `ref.rows[0][col]` —— 会丢失其余候选（复现例：排名取数前二款色，过滤只出一个款色）。scalar 节点（如基准统计）`rows` 为空但 `scalar` 有值，需据此回退单值。
- **基础数据（base）取列模式**：`BaseNodeData` 支持 `columns:{key,label}[]` 多选输出列，`distinct` 去重仅当勾选**单列**时生效（多列强制不去重）。无 `columns` 时回退旧 `fieldKey/fieldLabel` 单列去重。**left fills with base/filter as 全集**: 左关联补全建议全集用 filter 结果（需选 store字段），`universeReturnFields` 支持多选/默认返回全部。
- **预警动作（action）**：`ActionNodeData` 用 `type`（`remind`提醒/`alert`预警）+ `priority`（预警时 `Important&Urgent`重要且紧急/`Important`重要不紧急/`Urgent`紧急/`Info`一般），保留旧 `level` 兼容。`content` 为**消息模板**，可插入 `{字段名}` 占位。插入字段 UI 为"先选节点、再点字段"两级选择：按节点分组展示规则内所有节点的输出列（**不限于直接输入边**，动作节点未连线也可选字段），节点下拉显示 `类型（resultLabel）` 以区分同类型多节点，选中节点后再点击其字段按钮把 `{字段名}` 插入 content。改字段名/新增节点后下拉字段会随之更新。动作节点头部自带"预览（命中店铺清单）"与"删除"按钮。⚠️ **action 是终点节点，数据流靠显式 `sourceNode?: NodeResultRef` 取上游命中数据，不依赖 edges**（整套画布 edges 常为 0，其它节点都靠显式引用字段解析依赖）。UI 提供「数据来源」下拉（复用插入字段的 nodeOptions），evaluate 的 action 分支用 `pickColumnOutput(outputs, incoming, dA.sourceNode?.nodeId)`（无 sourceNode 时回退 incoming 的含行首表）；不选数据来源 → action 预览为空并提示需配置。action 预览额外返回 `alertMessages`（`{title,content}[]`，对每个命中行渲染 content 模板，最多 50 条），NodePreview 弹窗在表格上方以卡片展示"通知消息预览（已用命中数据填充字段）"。⚠️ **action 渲染 `{字段}` 时把规则内所有"全局标量"并入每一命中行作兜底**（无需关联店仓的全局统计值）：遍历 `outputs` 取各节点 `scalar.label/value`，以及空维度 groupby/condition 等 `shape==='table'` 单行输出的所有列值并入 `globalRow`，再 `{...globalRow, ...row}` 优先逐行值。故消息模板可直接引用「平均未开单天数」这类空维度聚合结果（即使它不是逐行业务列）：输出 `columns` 会追加全局列名、`rows[0]` 也含该全局值，`buildAlertsForRule` 的 `{字段}` → `hit.rows[0]` 替换随之生效。若不加此逻辑，action 逐行表没有该列，`{平均未开单天数}` 会替换为空（用户报"预览不显示数据，但这数据不需要关联店仓"）。`buildAlertsForRule`（store.tsx）生成 AlertTask 时：用 `{字段}` → 规则命中第一行的字段值做模板替换；`level` 由 `type/priority` 派生（Important&Urgent/Urgent→critical，alert→warn，remind→remind）。⚠️ 新增节点类型字段只改 UI+buildAlerts，别忘把 `alert.level` 可空处补 `?? 'warn'` 兜底。evaluate 的 base 分支按 `source!=='node' && bd.columns` 决定取列表格输出；col `columns` 只在数据表模式生效，切到节点模式会回退 fieldKey。inferNodeCols/getNodeOutputs 的 base 分支均按 selected columns 输出下游可选列。⚠️ inferNodeCols 的 groupby 分支会在配置了 `dateField`+`timeWindow`（preset≠all）时前置「开始日期/结束日期」两列，与 evaluate groupby 输出对齐（改 evaluate 的 groupby 输出列时务必同步 inferNodeCols）；inferNodeCols 也补了 `condition` 分支——透传 `leftNode/leftType(node)` 上游 rowset 的列，使预警动作从判断节点选字段能拿到上游完整列（含指标列与开始/结束日期）。插入字段下拉展示的列来自 inferNodeCols，用户须从下拉选真实列名，否则 `{字段}` 替换为空。插入字段按 **textarea 当前光标位置**插入 `{字段名}`（绑定 `contentRef`+`cursorPos`，插入后恢复焦点与光标），录入文本位置不变。⚠️ 插入字段列表优先取 `evalOuts`（action 内 `useMemo` 跑 `evaluateFlow(allNodes, edges, tables)` 得到各节点 `NodePreview.columns`，即"节点预览数据"的**真实完整列**，columns 为 string 数组，映射需同时兼容 `{key,label}` 与 string 两种形态），evaluate 失败时回退 `inferNodeCols` 推断列。⚠️ 性能：该 evalOuts `useMemo` 的依赖不能用 `allNodes`/`edges`（每次输入都变引用→重算 evaluateFlow→输入卡顿），必须用**排除当前 action 节点 data 的字段签名（字符串）**做 key，使 `content`/`title`/通知设置等输入不触发重算。UI 已移除「数据来源」下拉，action 取数完全依赖 edges incoming（evaluate 无 sourceNode 时回退 incoming 的含行首表）。⚠️ 拖动选择文本会带动节点移动：`NodeShell` 内容体已带 `nodrag`（标题栏可拖），但 **ActionNode 用自定义壳**，其中内容体需手动加 `nodrag`（否则整节点可拖，从输入框选文本会移动节点）。不要用 `onPointerDownCapture+stopPropagation` 全局限流——会连 input focus/IME 一起截断导致无法录入汉字。改自定义壳节点时，内容体务必加 "nodrag"，标题栏保持可拖。⚠️ 消息配置 textarea 必须保持**非受控**（`defaultValue` + `onBlur` 时 update 写回 store，`contentRef.current.value` 读当前值），`onChange` 只更新 `curPosRef.current = el.selectionStart` 不触发 state；插入字段时手动改 `el.value` 并 `setSelectionRange` 恢复光标。**不要改回受控 `value={d.content}`**——受控 + 每次击键 update 会在中文 IME 组合期间中断输入（"汉字闪一下变字母"）。<br>
- **判断（condition）条件组「等于」必须有数字/节点输入框**：`conditions` 行内的 operator 下拉含 `eq`（"等于(任一值)"），但**数字/节点比较值输入区只在 `c.op` 属于 `eq/gt/gte/lt/lte` 时渲染**（nodes.tsx 的 `isNoValue` 列表与 `(c.op === 'eq' || c.op === ...) &&` 渲染条件都必须始终把 `eq` 包含进去）。若漏掉 `eq`，则"等于"选中后不显示数值输入框，用户在其它 op 下误填入的值会以旧 `op`（如 `lt`）保存，出现"选等于填 3 却无结果、选大于等于/小于有结果"。evaluate 端 `numEq` 对 eq 的精确匹配本身正常。这条 `isNoValue`（决定是否走断言值 chips 还是数值输入）与渲染条件里的 op 集合**必须同步维护**。
- **统计时间窗（time.ts）**：`TimeWindow` 结构含 `preset/mode/custom/compare`；`resolveTimeWindow(tw, now)` 返回 `ResolvedTimeWindow{start,end,label,compare}`。预设分周/月/季/年族及"至今"变体（`weekToDate/monthToDate/quarterToDate/yearToDate` = 从周期起始到今天之前）+ 整段（`thisWeek/thisMonth/thisQuarter/thisYear`）+历史（`lastWeek/lastMonth` 等）。
  - **compare（同期/环期）**：`tw.compare={enabled,mode:'yoY'|'ring',shift}`。`computeCompareWindow` 按窗口粒度整体平移：`yoY` 对 start/end 各回退 shift 年（同月同日→去年同期）；`ring` 按粒度前移（week→7天、month→1月、quarter→3月、year→1年、day→N天），做到"本周至今(周一到今天) 环期 = 上周一到上周今天"的子区间对齐。粒度由 `granularityOf(preset)` 从 preset 推断。改 compare 计算时注意保持"等长平移 + 保留本期子区间对齐"。evaluate 目前仅用 `start/end` 过滤行（`inWindow`）。groupby 分支已消费 compare：对同一数据源按 `twr.compare.start/end` 再聚合一次得对比组，并排输出本期/对比期/增长率%（列名形如 `求和(销售金额) · 上移 N 周期`、`…· 增长率%`）。对比期无数据的店铺该列显示 `—`。真实数据表若只有当月数据（缺上月/去年同期），环期/同比值会全为 `—`，表现像是"没有对比列"，实为无历史数据可比。
- **左关联补全 filljoin**：`universe`（全集=每行都保留的骨架）左关联 `fact`（要补充带回的指标），缺失补 `fillValue`。
  - 全集来源 `universeSource: 'table'|'node'`（node 时用 `universeNodeId` 指向上游节点，如前一补全结果）；`universeField`+`extraKeys` 为复合匹配键；`universeReturnField` 把全集自身非键列（如销量）随行带回。
  - 事实来源 `factSource: 'table'|'node'`（node 时用 `factNode`）；`factKeyField`+`extraKeys.factField` 为事实侧匹配键；`factReturnField` 指定只带回某一列指标（如「库存」），不填则带回所有非键列。
  - **匹配键必须显式手动选择，不做自动兜底**：evaluate 要求 `universeField`（全集主匹配键）与 `factKeyField`（事实主匹配键）都显式存在，否则返回提示"请先选择全集主匹配键字段/请选择事实主匹配键"，**不再自动取全集首列兜底**。⚠️ 全集侧字段来自它的源（如"直联营店仓"filter 的结果列）可选项，而事实侧字段来自事实节点列——两侧字段名可能不同（如全集是`店仓名称`、事实是`店铺名称`），用户需各自分别选择后再匹配，选错/漏选会导致匹配不上、指标列全变填充值。改动时勿恢复自动兜底。
  - 关联诊断：`evaluate.ts` 可用 esbuild 打包后 node 运行，脚本 fetch `/api/state` 取真实数据复现（见 /tmp/diag 系列脚本思路）。
- 诊断脚本可用 `npx esbuild /tmp/x.ts --bundle --platform=node --format=esm --outfile=/tmp/x.mjs` 打包后 `node /tmp/x.mjs` 运行。
- **数据表删除保护 + 规则删除/复制的二次确认**：用户不允许"删数据表连带删规则"。store `REMOVE_TABLE` 已改为：若有规则 `r.tableIds?.includes(id)`，**直接拒绝删除返回原 state**（不再隐式清掉引用规则）；未引用时只删表、不动规则。UI 两层配合（DataTableManager.tsx）：删除按钮先 `tryDelete(t)` 计算引用规则 → 弹 `ui/alert-dialog`；被引用时对话框只显示"无法删除 + 引用的规则名"，仅提供「知道了」，无确认删除按钮；无引用时提供「取消 / 确认删除」二次确认。规则侧 RuleList.tsx 的删除与复制也走同一个 alert-dialog 做二次确认（copy 确认文案注明"复制后为草稿"）。⚠️ 改 REMOVE_TABLE 时勿恢复旧逻辑（删表时 `rules.filter(不含该表)`），否则又会造成"删表丢规则"。引用关系判断一律用 `r.tableIds?.includes(id)`。
- **预警列表字段为空 / 预警无法关联规则**：预警由入驻前端 `buildAlertsForRule`（store.tsx）在「激活规则/手动触发」时生成，会带全字段（ruleId/ruleName/title/conditionDesc/dept/assignee/preview）。若库里出现 `rule_id` 为空、字段全空的碎片预警，说明它不是该路径生成，直接清理。数据库无正确预警时，可用 esbuild 打包的 Node 脚本复用 `evaluateFlow`（读 `alert_rules`/`data_tables` 的 `data` 列 → 对 active 规则求值 → 按 `buildAlertsForRule` 同款逻辑构造 AlertTask → 清空 `alert_tasks` 后 `insert`），`preview` 存 `{columns, rows}`（rows 取前 200），content 用 `{field}` 按首行替换真实列值。注意库同步是前端 `/api/state` 全量覆盖，写库后前端刷新即看到。
- **预警动作（action）节点有独立开关 `enabled`**：`ActionNodeData.enabled?: boolean`（默认开启）。UI 在 action 面板顶部（名输入下方）以开关切换，`buildAlertsForRule`（store.tsx）生成时 `filter(a => a.enabled !== false)`，关闭的动作不生成预警。列表页/详情页"启用"规则走 store 新增的 `activateRule(ruleId)`（内部读 state.tables 调 `buildAlertsForRule` 后逐条 dispatch ADD_ALERT，再置 status=active），使**列表页启用也能生成预警**（不只配置页"激活规则"按钮）。⚠️ 若改动作开关语义，务必同步这三点：面板 UI、buildAlertsForRule 的过滤、activateRule/激活链路，否则会出现"配置了预警但列表没有"。
- **`alert_tasks.id` 为 NOT NULL，后端 `syncAlerts` 必须补 id**：前端 reducer（ADD_ALERT）会补 `id`，但**从 Node 脚本/后端路径注入或部分链路直接落库的 AlertTask 可能缺 id**，直接 `upsert` 会因空主键整批报错、该规则所有预警都写不进去（表现为"激活了但预警列表空"）。修复：`repo.ts syncAlerts` 里 `upsert(rows.map(a => ({ ...a, id: a.id ?? gen() })))`。❌ 前端生成的预警对象（buildAlertsForRule 返回）本来就无 id，靠 reducer 补——脚本复算时必须显式生成 id，勿复用无 id 的原生对象直接落库。

## 运行与预览

- 预览链路（承自根 `.coze [dev]`）：`bash projects/scripts/prepare.sh`（装依赖）→ `bash projects/scripts/dev.sh`（`tsx watch src/server.ts`，dev server，端口取 `.preview` 的 5000）。
- 部署链路（根 `.coze [deploy]`）：`bash projects/scripts/build.sh`（`pnpm next build` + `tsup src/server.ts` → `dist/server.js`）→ `bash projects/scripts/start.sh`（`PORT=5000 node dist/server.js`）。
- **前后端同进程**：前端调后端一律用相对路径 `/api/...`，不硬编码域名/IP/localhost。
- 服务端入口 `src/server.ts`：按 `COZE_PROJECT_ENV=PROD` 区分 dev/prod，`HOSTNAME`/`PORT` 默认 localhost/5000。
- **⚠️ 部署启动必须先 `export COZE_PROJECT_ENV=PROD`**：`start.sh` 已内置；否则 `node dist/server.js` 会误走 dev 模式（`next dev` + `.next/dev` lock，可能与预览进程冲突）。部署验证用临时端口：`DEPLOY_RUN_PORT=5033 bash scripts/start.sh`。
- web 项目验收用 `test_run`（静态检查 + 服务探活 + 接口冒烟），不用 shell 绕跑。
- **⚠️ React Flow 节点内输入/选择控件（input/textarea/select）在拖动选择文本时会触发节点移动**：已通过 FlowCanvas 容器 `onPointerDownCapture` + 目标是 input/textarea/select 时 `stopPropagation` 统一解决，改动节点表单项时勿回退。
- **画布连线样式**：边固定用 `type: 'bezier'`（贝塞尔曲线，`defaultEdgeOptions` 与 `toRfEdges` 同步）。用曲线而非 `smoothstep`——平滑过渡可避免直角折线带来的"尾部先向右折、再直角跳回左侧 target handle"的观感（用户报连线时尾端跳动）。连线层级用 `globals.css` 的 `.react-flow__edges{z-index:3}` / `.react-flow__nodes{z-index:2}` 让连线盖在重叠节点之上（bezier 边 svg 自身 pointer-events 透传，不挡节点拖拽/点击；Controls/MiniMap 仍默认 5 层在上）。改边类型/z-index 时这两处要保持一致。
- **判断方式文案 `buildConditionDesc`**（store.tsx）：预警"判断方式"列读它。判断节点把条件存 **`conditions[]` 数组**（`conditions[i].op/col/colKind/refNode/{label,nodeId}`，旧顶层 `valueSource/value/refNode` 已弃用），所以 `buildConditionDesc` **必须遍历 `conditions[]`** 拼接"如果 {col} {op 中文} {右值}"。右值优先级：`c.refNode?.label`（选了"平均未开单天数"等节点）＞ `field` 取值字段 label ＞ `between` 的 min~max ＞ 普通值。若仍按旧顶层字段拼，会得到"如果 未开单天数 大于 "（右值空）。
- **预警列表脏数据排查**：预警存在 Supabase `alert_tasks`，/api/state 的 GET 全量回读、POST 全量覆盖（`syncAlerts`）。若列表标题/条数/判断方式/适用部门全空，几乎都是库里存了**残缺记录**（`ruleId/title/ruleName/preview/createdBy` 均空、`ruleId=''`、preview 为 null、createdBy undefined）：这类记录 `ruleId=''`，激活时的去重（`find(x.ruleId===a.ruleId)`）永远匹配不到，既不刷新也不删除，从而残留占位。⚠️ **防线（已加，勿移除）**：store.tsx 新增 `isBlankAlert(a)`（`title` 与 `ruleName` 均空即判定残缺），在 **加载（REPLACE 时 `remote.alerts.filter(!isBlankAlert)`）** 与 **ADD_ALERT reducer** 两层丢弃，保证残缺既不显示也不会再被同步上库；已存在库中的残缺通过一次 `syncAlerts` 的 stale 删除（keep 不含它）即被清理。修复 buildConditionDesc 读 `conditions[]` 等只是让正常预警字段齐整，**根治残缺靠 isBlankAlert 过滤防线**。⚠️ **数据库定位（本次实证纠正）**：`exec_sql` 的 **develop Postgres 当前与 Supabase `/api/state` 同源同库**——直接对 develop 执行 `DELETE FROM alert_tasks WHERE ...` 后 `/api/state` 立即生效（实测删一条残缺后 alerts 由 2 → 1）。虽旧记录曾说过"两库独立"，但本次已证同库；稳妥做法仍以 `/api/state` JSON 为最终依据，SQL 删除后 curl 复核。
- **lint 基准**：本项目已修至 `pnpm lint` 0 error 0 warning（禁 `any`/未用变量、JSX 内不直接 `Date.now()`/`Math.random()`/`"` 等）。改动代码后保持 `pnpm lint` / `pnpm ts-check` / `pnpm lint:style` 全绿，勿回退。
- **规则配置页（RuleConfigurator）顶栏**：左侧 = 返回 + 标题输入 + 标题右侧的规则分组下拉（读 `state.ruleGroups`，改 `rule.groupId`，`''`=未分组）；右侧 `ml-auto` 右对齐 = 「流程搭建步骤条（STEPS）」+「保存草稿 / 激活规则」。分组下拉支持**新建**（＋→inline 命名回车，`addRuleGroup` 返回建好 id 的对象并立即选中）与**删除当前分组**（Trash 按钮，`removeRuleGroup` 同时把引用该分组的规则 `groupId` 清空归入未分组，走 `confirm` 二次确认）。新建规则引导 NewRuleGate 同样支持选/新建分组（ADD_RULE_GROUP reducer + StoreApi.addRuleGroup）。新建/删除分组均经 state 变化自动防抖同步到 `/api/state`（`syncRuleGroups`）。
- **左侧节点面板（FlowCanvas PalettePanel）**：节点按功能分 4 组渲染——「数据与窗口」「筛选与排名」「计算与统计」「条件与输出」，定义在 `NODE_GROUPS`（kinds 引用平铺 `flowItems`）+ `NODE_ICON`（每 kind 一个 lucide 图标，无图标时回退 dot）。已删除原操作提示框、顶部「拖拽构建规则」、数据表说明等引导文本（冒心的功能性空态如"暂无数据表"保留）。改节点分组/图标只需改这两个常量。
- **判断（condition）节点命名**：`ConditionNodeData.resultLabel`（types.ts，可空）。UI 面板顶部有「命名」输入框（`update({resultLabel})`，placeholder "如：本月未开单判断"）；`nodeTitle` 对该节点也渲染 `判断（命名）`，使画布上多个判断节点可区分。命名仅用于展示区分，不参与 evaluate 计算。
- **规则已 active 但预警列表为空（排查实证）**：若规则 `status=active` 已入库、`alert_tasks` 却查无该规则预警，成因多半是激活保存时预警生成/落库被中断（如激活时 `state.tables` 尚未就绪、或某次同步 POST 失败），并非 `buildAlertsForRule`/`syncAlerts` 有 bug。经端到端实证（esbuild 打包 `buildAlertsForRule` + POST `/api/state` 全量）确认：evaluate 各 action 命中正常（`preview.rows` 有数据）、POST 后可落库。**补救**：用 `buildAlertsForRule(rule, tables)` 重建该规则预警，合并进现有 alerts（按 `ruleId` 去重保留），直接 POST `/api/state` 恢复；`isBlankAlert` 只拦 title/ruleName 双空的碎片，不影响本次恢复。排查时先 `SELECT ... FROM alert_tasks WHERE rule_id=...` 确认是否真的缺记录。

## 数据库（Supabase）

- 凭证由平台注入：`COZE_SUPABASE_URL` / `COZE_SUPABASE_ANON_KEY` / `COZE_SUPABASE_SERVICE_ROLE_KEY`；`supabase-client.ts` 按 dotenv → `coze_workload_identity`（python3，向平台拉取项目环境变量）→ 抛错的顺序加载。
- **运行环境里 shell 不一定预置这些变量**，必须通过 `coze_workload_identity` 取；本地验证 node 侧读取用 `./node_modules/.bin/tsx` 跑 client。
- 业务表（`src/storage/database/shared/schema.ts` 定义）：`data_tables`、`alert_rules`、`alert_tasks`、`rule_groups`（`health_check` 为系统表勿动）。`rule_groups(id,name,created_at)` 存规则分组，`AlertRule.groupId` 引用其 id（`''`=未分组）；经 `/api/state` 的 `groups` 字段全量同步（`getAllRuleGroups`/`syncRuleGroups`，同样 upsert + stale 删除）。
- 表结构迁移/建表：schema 改动用 `coze-coding-ai db upgrade`，或直接对 develop 库 exec_sql；已在线上建好三业务表并 `ENABLE ROW LEVEL SECURITY`。
- RLS：项目无 Auth（场景 A），后端用 service_role_key 天然绕过 RLS，不建 policy（无 policy 时 anon 完全被阻断，更安全）。
- `src/app/api/state`：GET 全量读、POST 全量覆盖同步；字段名 snake_case 与数据库列一致。
- **filter 来源表应从「已有条件字段」反查，勿回退 tables[0]**：过滤节点（filter）若 `data.tableId`/`source` 缺失（用户未持久化来源表），旧逻辑 `resolveRowset` 回退 `tables[0]`、`inferNodeCols` 返回空，导致两个 bug：(1) 来源错取首表（若 tables[0] 是商品表，而条件字段是店仓表字段，则 filter 命中 0）；(2) 下游填 filljoin 全集节点后「全集返回列/匹配字段」无字段可选（用户报"过滤结果命名可用店仓，但全集返回列/匹配字段空"）。修复：evaluate.ts `resolveRowset` 增加按条件字段反查——当 `tableId` 解析不到表时，遍历条件字段用 `t.fields.some(f.key∈fields)` 找到含全部/最多条件字段的表（且返回 `resolvedTableId` 供 filljoin 匹配键拼 `tableId`）；无匹配则回退空（null 安全）。`inferNodeCols` 的 filter 分支同步：无 tableId/source 时用**同一套条件字段反查表**推断输出列，保证 UI 字段候选与 evaluate 一致。⚠️ 维护两个实现时必须保持反查规则一致（evaluate 与 nodes.tsx），否则"有结果但选不到字段"会在 UI 复现。
- **filljoin 缺配事实时，时间窗列仍填当前周期值（勿被 fillValue 覆盖为 0）**：left filljoin 对无单据店仓（事实侧无记录）补缺时，若把「开始日期/结束日期/已过天数/本周天数/本月天数/本年天数」等时间窗列也用 `fillValue` 填成 0/空，会得到"有店仓却无本月起止/已过天数"的错误。这些列是**全局周期常量**（与是否匹配事实无关）。修复：filljoin 补缺分支内，若某行未命中且列名 ∈ `WINDOW_COLS = {开始日期,结束日期,已过天数,本周天数,本季天数,本月天数,本年天数,本日天数,当前日期,周几,第几周,剩余天数}`，改用事实节点 rows[0] 的对应周期值填充（groupby 各组同窗口，取首行安全），其余事实列仍按 `fillValue` 填 0。⚠️ 配套的 inferNodeCols(filljoin) 需保证这些列仍在候选字段里。
