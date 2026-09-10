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
- 节点类型：`base/topn/groupby/filter/diff/lookup/filljoin/condition/compute/elapsed/action/logic/trigger`，类型定义在 `src/lib/types.ts`，节点编辑 UI 在 `src/components/flow/nodes.tsx`。
- **左关联补全 filljoin**：`universe`（全集=每行都保留的骨架）左关联 `fact`（要补充带回的指标），缺失补 `fillValue`。
  - 全集来源 `universeSource: 'table'|'node'`（node 时用 `universeNodeId` 指向上游节点，如前一补全结果）；`universeField`+`extraKeys` 为复合匹配键；`universeReturnField` 把全集自身非键列（如销量）随行带回。
  - 事实来源 `factSource: 'table'|'node'`（node 时用 `factNode`）；`factKeyField`+`extraKeys.factField` 为事实侧匹配键；`factReturnField` 指定只带回某一列指标（如「库存」），不填则带回所有非键列。
  - 关联诊断：`evaluate.ts` 可用 esbuild 打包后 node 运行，脚本 fetch `/api/state` 取真实数据复现（见 /tmp/diag 系列脚本思路）。
- 诊断脚本可用 `npx esbuild /tmp/x.ts --bundle --platform=node --format=esm --outfile=/tmp/x.mjs` 打包后 `node /tmp/x.mjs` 运行。

## 运行与预览

- 预览链路（承自根 `.coze [dev]`）：`bash projects/scripts/prepare.sh`（装依赖）→ `bash projects/scripts/dev.sh`（`tsx watch src/server.ts`，dev server，端口取 `.preview` 的 5000）。
- 部署链路（根 `.coze [deploy]`）：`bash projects/scripts/build.sh`（`pnpm next build` + `tsup src/server.ts` → `dist/server.js`）→ `bash projects/scripts/start.sh`（`PORT=5000 node dist/server.js`）。
- **前后端同进程**：前端调后端一律用相对路径 `/api/...`，不硬编码域名/IP/localhost。
- 服务端入口 `src/server.ts`：按 `COZE_PROJECT_ENV=PROD` 区分 dev/prod，`HOSTNAME`/`PORT` 默认 localhost/5000。
- web 项目验收用 `test_run`（静态检查 + 服务探活 + 接口冒烟），不用 shell 绕跑。

## 数据库（Supabase）

- 凭证由平台注入：`COZE_SUPABASE_URL` / `COZE_SUPABASE_ANON_KEY` / `COZE_SUPABASE_SERVICE_ROLE_KEY`；`supabase-client.ts` 按 dotenv → `coze_workload_identity`（python3，向平台拉取项目环境变量）→ 抛错的顺序加载。
- **运行环境里 shell 不一定预置这些变量**，必须通过 `coze_workload_identity` 取；本地验证 node 侧读取用 `./node_modules/.bin/tsx` 跑 client。
- 业务表（`src/storage/database/shared/schema.ts` 定义）：`data_tables`、`alert_rules`、`alert_tasks`（`health_check` 为系统表勿动）。
- 表结构迁移/建表：schema 改动用 `coze-coding-ai db upgrade`，或直接对 develop 库 exec_sql；已在线上建好三业务表并 `ENABLE ROW LEVEL SECURITY`。
- RLS：项目无 Auth（场景 A），后端用 service_role_key 天然绕过 RLS，不建 policy（无 policy 时 anon 完全被阻断，更安全）。
- `src/app/api/state`：GET 全量读、POST 全量覆盖同步；字段名 snake_case 与数据库列一致。
