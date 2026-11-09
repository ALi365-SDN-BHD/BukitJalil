# BukitJalil 开发方案与实施计划

> 版本：v2.0（2026-11-09，已按评审、七轮审计和一次最高强度代码审查修改） · 分支：`pi-harness-ui` · 状态：待确认
>
> 本文是 BukitJalil 新实现的设计依据。产品定位见 [README](../README.md)。文中"已核对"的内容来自 Pi 文档（本机 1.4.0）和 Pi SDK 1.5.0 的类型定义与更新日志、npm 仓库、Bukit 仓库 v2.0.8 的文档、源码目录和发布页；"待验证"的内容需要在对应里程碑的技术验证里确认。

## 目录

1. [目标与范围](#1-目标与范围)
2. [固定技术栈](#2-固定技术栈)
3. [总体架构](#3-总体架构)
4. [数据与存储](#4-数据与存储)
5. [网站项目模型](#5-网站项目模型)
6. [Pi 集成设计](#6-pi-集成设计)
7. [改动审核与版本](#7-改动审核与版本)
8. [Bukit 集成](#8-bukit-集成)
9. [服务端 API 与事件](#9-服务端-api-与事件)
10. [界面设计](#10-界面设计)
11. [安全](#11-安全)
12. [测试策略](#12-测试策略)
13. [工程规范](#13-工程规范)
14. [实施计划](#14-实施计划)
15. [风险与对策](#15-风险与对策)
16. [待定问题](#16-待定问题)

---

## 1. 目标与范围

### 1.1 产品目标

把每个网站当作一个**项目**来管理：配置、主题、文件、数据集中在一个工作区里；建站和修改都通过和 AI 对话完成，用户不直接编辑文件；所有 AI 改动先审核再生效；由 Bukit 构建、预览、发布。

### 1.2 第一版范围（MVP，M0–M5）

| 包含 | 不包含 |
| --- | --- |
| 本地单用户 Web 应用（只监听 127.0.0.1） | 多用户、远程访问、账号体系 |
| 平台：macOS（Apple Silicon）和 Linux x64，CI 覆盖这两个平台 | Windows（M7 桌面版再验证；设计上已避免依赖 `/dev/null` 等 Unix 专属路径） |
| 新建网站（基于从 Bukit 源码复制的 starter 主题）、导入已有 Bukit 网站 | 克隆其他网站、HTML 导入（Bukit 也未支持）；Bukit 外部插件（用了它们的网站只能只读导入，见 5.1） |
| 每个网站多个 AI 会话：对话、流式输出、恢复、分叉 | 子代理、计划模式 |
| 只读面板：文件、配置、主题、数据、改动、预览 | 可视化编辑器、直接改文件 |
| 改动审核：差异、应用、拒绝、版本历史、恢复 | 按代码块部分应用（放到后续版本） |
| Bukit 构建、检查、预览 | 自建主题市场、远程主题 |
| 模型和 API Key 设置 | 计费、用量统计面板 |

### 1.3 后续版本

- **M6 发布**：GitHub Pages（Bukit 原生支持 `bukit deploy`）
- **M7 桌面版**：Electron 壳
- 之后：Notion 数据源管理、按代码块部分应用、SEO/GEO 报告面板、Cloudflare Pages 和自有服务器发布

---

## 2. 固定技术栈

版本为 2026-11-09 在 npm 仓库查到的最新稳定版。`package.json` 一律写精确版本（不带 `^`），配合锁文件；升级走单独的提交。

### 2.1 运行环境

| 项 | 固定版本 | 说明 |
| --- | --- | --- |
| Node.js | **24 LTS**（`engines: ">=22.19.0"`） | Pi SDK 要求 ≥ 22.19。开发统一用 24 LTS；Node 22 在 2027-04-30 停止维护，本机现在是 22.22.3，可以运行但建议升级 |
| pnpm | **12.18.0** | 写进根 `package.json` 的 `packageManager` 字段，由 corepack 自动使用（本机是 10.5.0，执行 `corepack enable` 即可） |
| TypeScript | **7.0.2** | 只用来做类型检查（`tsc --noEmit`），打包和运行由 Vite / tsx 负责。TypeScript 7 是 Go 重写的版本，部分旧 tsconfig 选项已移除；M0 确认与 Vite、Vitest、Biome、shadcn 配合正常，不行就退回 TypeScript 6 最新版 |
| Bukit | **2.0.8** | .NET Native AOT 单文件程序，官方提供 osx-arm64、linux-x64、win-x64（没有 Intel Mac 版，见 8.1） |

### 2.2 服务端（`packages/server`）

| 包 | 版本 | 用途 |
| --- | --- | --- |
| `@earendil-works/pi-coding-agent` | 1.5.0 | Pi SDK：会话、工具、技能、模型 |
| `@earendil-works/pi-ai` | 1.5.0 | 模型目录与提供商（随 SDK） |
| `@earendil-works/pi-agent-core` | 1.5.0 | Agent 核心（随 SDK） |
| `hono` | 4.13.17 | HTTP 路由、SSE |
| `@hono/node-server` | 2.1.6 | Node 运行 Hono、静态文件 |
| `zod` | 4.6.7 | 请求、配置、事件的校验和类型 |
| `yaml` | 2.9.1 | 解析 `site.yaml`、`theme.yaml`，保留注释和格式 |
| `node:sqlite` | Node 内置 | 系统数据库 |
| `tsx` | 4.23.15 | 开发时直接运行 TypeScript |

不使用 `simple-git` 等 git 封装库：已核对 `simple-git` 4.0.2 源码，它默认把 `-c core.fsmonitor`、`-c core.hooksPath`、`-c protocol.allow`、环境变量 `GIT_CONFIG_GLOBAL` 都当作危险配置直接报错，还会改写子进程环境变量（没传 env 时继承整个 `process.env`）。7.3 的加固要求每个参数和环境变量都由我们精确控制，所以 git 调用由 `git/run.ts` 直接用 Node 内置的 `child_process.spawn`（参数数组、不经过 shell、显式 env、流式读取输出，见 7.3）实现，输出自己解析（`--porcelain=v2 -z`、`--name-status -z` 等机器可读格式）。

### 2.3 界面（`packages/web`）

| 包 | 版本 | 用途 |
| --- | --- | --- |
| `react` / `react-dom` | 19.3.1 | 界面框架 |
| `vite` | 8.3.6 | 开发服务器与打包 |
| `@vitejs/plugin-react` | 6.3.0 | React 支持 |
| `tailwindcss` / `@tailwindcss/vite` | 4.3.5 | 样式 |
| `shadcn`（CLI） | 4.23.0 | 生成 UI 组件源码（Radix 基础） |
| `lucide-react` | 1.70.0 | 图标 |
| `@tanstack/react-query` | 5.107.1 | 服务端数据获取和缓存 |
| `zustand` | 5.1.0 | 界面本地状态（选中网站、面板、会话流） |
| `react-router` | 8.5.1 | 路由：`/sites/:siteId/sessions/:sessionId` |
| `react-resizable-panels` | 4.21.0 | 三栏可拖动布局 |
| `shiki` | 4.6.0 | 只读代码高亮 |
| `react-markdown` | 10.1.0 | Markdown 预览、AI 消息渲染 |
| `react-diff-view` + `diff` | 3.3.3 + 9.0.0 | 改动差异显示 |

### 2.4 工具链

| 包 | 版本 | 用途 |
| --- | --- | --- |
| `vitest` | 5.1.0 | 单元测试、服务端集成测试 |
| `@playwright/test` | 1.65.0 | 端到端测试 |
| `@biomejs/biome` | 2.6.6 | 代码格式化和检查（替代 ESLint + Prettier） |
| `@types/node` | 24.19.2 | Node 类型，与 Node 24 对齐 |
| `electron` | 45.2.3 | M7 桌面版才引入 |

---

## 3. 总体架构

### 3.1 进程与模块

```text
浏览器（packages/web）
  │  REST（JSON）  +  SSE（会话事件、构建事件）
  ▼
本地服务（packages/server，Hono；管理界面与 API 127.0.0.1:47880，预览 127.0.0.1:47881）
  ├─ api/            路由、请求校验、SSE
  ├─ sites/          网站项目：创建、导入、读取配置/主题/文件/数据
  ├─ agent/          Pi SDK：会话管理、建站工具、权限闸门、技能加载
  ├─ changes/        改动集：工作树、差异、审核指纹、应用、拒绝、历史、恢复
  ├─ git/            唯一的 git 调用入口：固定加固参数、最小环境变量、仓库配置检查（7.3）
  ├─ bukit/          Bukit 程序管理与调用：check、doctor、build、报告解析
  ├─ preview/        构建结果的静态托管（独立端口 47881，CSP sandbox）
  ├─ store/          SQLite（系统数据）
  └─ settings/       模型、密钥、Bukit 路径
  │
  ├──► Pi SDK（同进程）
  ├──► git（子进程）
  └──► bukit（子进程）
```

### 3.2 包结构与依赖方向

```text
BukitJalil/
├── package.json            # packageManager: pnpm@12.18.0；根脚本
├── pnpm-workspace.yaml
├── biome.json
├── tsconfig.base.json
├── packages/
│   ├── shared/             # 只放类型、zod schema、事件定义、API 约定；不依赖 Node 或 DOM
│   ├── server/             # 依赖 shared；唯一引用 Pi SDK、git、bukit 的地方
│   └── web/                # 依赖 shared；只通过 HTTP/SSE 访问 server
├── skills/                 # 随应用发布的建站技能（见 6.4）
├── templates/              # 新建网站用的初始模板
├── scripts/                # 下载 Bukit、开发辅助脚本
├── e2e/                    # Playwright 测试
└── docs/
```

规则：`web` 不能 import `server`；`shared` 不能 import 任何运行时专属模块。用 Biome 的 `noRestrictedImports` 规则强制。

### 3.3 运行方式

- 开发：`pnpm dev` 同时启动 server（tsx watch）和 web（Vite，代理 `/api` 到 server）；开发脚本启动 Vite 时去掉 `BUKITJALIL_*_TOKEN` 和模型密钥环境变量，Vite 进程拿不到密钥
  - Vite 固定监听 `127.0.0.1:47890`（`strictPort: true`，端口被占用直接报错，不会悄悄换端口）
  - 浏览器里的页面来自 Vite，代理转发的请求 `Origin` 是 `http://127.0.0.1:47890`。所以 server 以 `--dev-origin http://127.0.0.1:47890` 启动时（只有 `pnpm dev` 会传，`pnpm start` 不接受这个参数），防跨站校验允许的 Origin 换成这个地址，`Host` 校验同时接受 Vite 转发的 `127.0.0.1:47880`
  - token 打开流程同样走 Vite：打印 `http://127.0.0.1:47890/?token=…`，Vite 开发配置把带 `token` 参数的首页请求代理给 server，和生产一样校验后设置 Cookie 并重定向；Cookie 按主机 `127.0.0.1` 生效、不区分端口，之后经 Vite 代理的 `/api` 请求都会带上它
- 生产：`pnpm build` 后 server 直接托管 web 的静态文件，一个 Node 进程监听两个端口（管理界面和 API 47880、预览 47881），`pnpm start` 启动并打开浏览器
- 默认端口：管理界面和 API 用 47880，预览用 47881（和管理界面隔离，见 8.4）；被占用时报错并提示 `--port` / `--preview-port`

---

## 4. 数据与存储

### 4.1 目录布局

```text
~/.bukitjalil/                      # 应用数据目录（可用 BUKITJALIL_HOME 覆盖）
├── app.db                          # SQLite：网站列表、会话索引、改动集、构建记录、设置（不含密钥）
├── secrets.json                    # Notion / GitHub token（权限 600；设置了对应环境变量时不使用，见 6.5）
├── bin/bukit-2.0.8/bukit           # 应用管理的 Bukit 程序
├── empty-gitconfig                 # 空文件，git 调用的全局配置和属性文件都指向它（见 7.3）
├── pi/                             # 给 Pi 用的独立目录（agentDir + PI_CODING_AGENT_DIR），不读用户 ~/.pi
│   ├── auth.json                   # 模型 API Key / OAuth（权限 600）
│   ├── models.json
│   └── bin/                        # BukitJalil 安装的固定版本 rg（见 6.3）
├── sessions/<siteId>/*.jsonl       # Pi 会话文件
├── worktrees/<siteId>/
│   ├── ai/                         # AI 工作副本（git worktree），路径固定、反复复用
│   └── main/                       # 正式版本的只读检出，只用于构建正式预览
└── previews/<siteId>/<buildId>/    # 构建输出（从工作副本内的临时输出目录搬过来，见 8.4）

<用户选择的位置>/<网站目录>/          # 网站项目本身（默认 ~/BukitJalil Sites/<slug>/）
├── .git/                           # BukitJalil 初始化和管理
├── site.yaml
├── content/
├── themes/<name>/
└── .gitignore                      # 忽略 dist/、.bukit/
```

要点：

- 网站目录的**工作区**保持"纯 Bukit 项目"，不放 BukitJalil 私有文件，离开 BukitJalil 也能用 `bukit build` 构建
- BukitJalil 在网站的 `.git` 里会留下三类记录：工作副本登记（`.git/worktrees/ai`、`.git/worktrees/main`）、改动集引用（`refs/bukitjalil/changes/<changeId>`，不在 `refs/heads/` 下，`git branch` 看不到，`git push --all` 也不会推送）和排除规则（`.git/info/exclude` 里一段带 `# BukitJalil begin/end` 标记的内容）。它们不会被提交；排除规则在共享的 git 目录里，也会让用户自己的检出忽略这几个构建目录，所以移除网站时会删掉这段内容
- 会话、工作副本、构建输出都放在应用数据目录，删除应用数据不会损坏网站内容；但网站 `.git` 里会留下失效的工作副本登记，执行 `git worktree prune` 即可清理。BukitJalil 提供"从 BukitJalil 移除网站"操作，会删除工作副本、`refs/bukitjalil/` 下的引用和排除规则里自己写的那段，再 `git worktree prune`

### 4.2 SQLite 表

| 表 | 主要字段 | 说明 |
| --- | --- | --- |
| `sites` | `id`, `name`, `path`, `default_branch`, `created_at`, `last_opened_at`, `archived` | 网站列表；`path` 是网站目录绝对路径；`default_branch` 是网站的正式分支（新建为 `main`，导入时读取当前默认分支） |
| `sessions` | `id`, `site_id`, `pi_session_file`, `title`, `created_at`, `updated_at`, `status` | 会话索引；正文在 Pi 的 JSONL 里 |
| `change_sets` | `id`, `site_id`, `created_by_session_id`, `base_commit`, `snapshot_commit`, `status`, `summary`, `created_at`, `resolved_at`, `result_commit` | 改动集，状态：`open` / `applied` / `rejected` / `stale`；`base_commit` 是当前基于的正式版本，main 前进并重新合并后会更新；`snapshot_commit` 是最近一次快照（见 7.2）；"待审核"不单独存，由"open + 没有会话在运行 + 快照树 ≠ base 树"推出 |
| `change_set_sessions` | `change_set_id`, `session_id`, `first_turn_at` | 参与过这个改动集的所有会话（多个会话可以共用一个改动集） |
| `builds` | `id`, `site_id`, `change_set_id`, `commit`, `kind`, `status`, `exit_code`, `output_dir`, `report_json`, `started_at`, `finished_at` | 构建记录；`kind`：`check` / `doctor` / `build` |
| `settings` | `key`, `value_json` | 全局设置：默认模型、思考级别、Bukit 路径 |
| `schema_migrations` | `version`, `applied_at` | 数据库迁移 |

迁移脚本放在 `packages/server/src/store/migrations/NNN_name.sql`，启动时按顺序执行。

---

## 5. 网站项目模型

### 5.1 网站是什么

一个目录满足以下条件就是一个 BukitJalil 网站：

1. 根目录有 `site.yaml`
2. 是一个 git 仓库；导入时记录当前分支（`git symbolic-ref --short HEAD`），不假设叫 `main`，分支名必须通过 `git check-ref-format --branch` 且不以 `-` 开头，否则拒绝导入；工作区有未提交改动时要求用户先处理
   - 导入的目录不是 git 仓库时，征得用户同意后执行 `git init -b main`，**先**写入排除规则（7.2，额外排除 `.env*`、`node_modules/`），把将要提交的文件列表给用户确认，再做首次提交。避免把 `dist/`、`.bukit/` 缓存和 `.env` 里的密钥提交进历史（被跟踪之后排除规则就不再起作用，AI 也能读到）
3. 已登记在 `sites` 表里

**导入流程**（导入的网站可能来自外部，当作不可信内容处理）：

1. 只读检查目录：有 `site.yaml`、是否 git 仓库、当前分支、是否有未提交改动；这一步不调用 Bukit，所有 git 调用都按 7.3 加固，并先检查仓库配置和钩子（不通过则只读导入）
2. 登记网站，对默认分支的提交跑构建前安全检查（8.5，直接读 git 对象，不需要检出）
3. 检查通过后才创建 `worktrees/<siteId>/main/` 检出。不通过时网站仍可导入，标记为"**只读：不满足安全规则**"，界面列出原因（例如使用了外部插件、路径越界、包含符号链接）；这类网站可以浏览文件、配置，但不能构建、不能开 AI 会话，也不会创建任何检出
4. 然后在 `main/` 检出里执行 `bukit config check`；失败标记"配置有误"，仍可以开 AI 会话让 AI 修复

> 限制：Bukit 的外部插件（如官方的 IndexNow、WechatSync、Import）在 BukitJalil 里不被支持，使用了它们的网站只能以只读方式导入。
>
> 限制：使用 Notion 数据源的网站，Bukit 的 `config check`、`doctor`、`build` 在没有 `NOTION_TOKEN` 时直接报错（已核对 2.0.8 源码 `ProviderValidators.cs`、`DoctorCommand.cs`），而未审核内容的构建按 8.5 不传密钥。所以这类网站的 AI 检查、AI 构建和改动集预览在 MVP 里不可用：`bukit_check` / `bukit_build` 直接返回"此网站使用 Notion 数据源，AI 构建不可用"，不调用 Bukit，避免 AI 反复处理它修不了的错误；正式版本由用户手动构建（传 token）。M1 确认 Notion 源的缓存模式能否在没有 token 时构建，能的话再放开。

### 5.2 新建网站

1. 用户在界面填写：网站名、目录位置、主语言、可选的一句话描述
2. 服务端把 `templates/starter/` 复制到目标目录（包含 `site.yaml`、`content/`、`themes/starter/`）。Bukit 没有"生成初始网站"的命令，官方 starter 主题只以资源文件形式嵌在 CLI 源码里（`src/Bukit-Core/Bukit.Cli/Resources/StarterTheme/`，MIT 协议）。BukitJalil 从 v2.0.8 复制这些模板，补上 `theme.yaml` 和最小内容，作为自己维护的模板，并记录来源 commit
3. 用表单值替换 `site.name`、`site.title`、`site.language`
4. `git init -b main`（git 不读全局配置后，`init.defaultBranch` 不生效，不写 `-b` 会得到 `master`）、写入排除规则、首次提交 "Initial site from BukitJalil starter"；提交需要设置页里的身份（7.2），没有填写时先引导填写
5. 对首次提交跑构建前安全检查（8.5），再创建 `worktrees/<siteId>/main/` 检出并执行 `bukit config check` 和预览构建（8.3），确认可以构建；不在用户的网站目录里调用 Bukit，网站目录不会出现 `dist/`
6. 如果填写了描述，自动打开第一个会话，把描述作为第一条消息发给 AI

### 5.3 面板数据来源

| 面板 | 数据来源 | 实现 |
| --- | --- | --- |
| 文件 | 正式版本的提交，或当前改动集的快照（都从 git 对象读取） | 目录树接口（按目录懒加载）+ 文件内容接口；从 git 对象读取，网站目录里未跟踪或被忽略的文件（如 `.env`）不会出现；文件内容的返回方式见 9.1 |
| 配置 | `site.yaml` | `yaml` 解析成结构化视图（站点信息、语言、集合、内容源、构建、主题、部署），同时提供原文 |
| 主题 | `themes/<theme.name>/theme.yaml` 和目录 | 主题清单、布局文件列表、assets、params |
| 数据 | `site.yaml` 的 `content.sources[]` | 每个源一张卡片：Markdown 集合（文件数、frontmatter 字段汇总）、`mode: data` 源（按 `dataIndex` 的 scope/key/value 显示成表格）、Notion 源（只显示配置，MVP 不连 Notion） |
| 改动 | `change_sets` + git | 见第 7 节 |
| 预览 | 最新一次成功构建 | 见第 8.4 节 |

> 关于"数据库"：Bukit Core 2.0 没有数据库概念，数据来自 Markdown、Notion 和 `mode: data` 数据源。"数据"面板管理的就是这些内容源；如果以后需要真正的数据库，再作为 Bukit 的新数据源设计。

---

## 6. Pi 集成设计

### 6.1 原则

- 只在 `packages/server/src/agent/` 引用 Pi SDK
- 不读取用户本机的 Pi 配置：独立的 `agentDir`（`~/.bukitjalil/pi`）、自定义 `ResourceLoader`、内存或应用专属的 `SettingsManager`
- **Pi 的全局目录和联网下载**：已核对 SDK 1.5.0 源码（`dist/utils/tools-manager.js`、`dist/config.js`），Pi 的工具目录由环境变量 `PI_CODING_AGENT_DIR` 决定（默认 `~/.pi/agent`），**不看传给 SDK 的 `agentDir`**，而且在模块加载时就确定。所以服务进程在**加载 Pi 之前**（入口文件第一件事，Pi 只能在之后动态 `import()`）设置 `PI_CODING_AGENT_DIR=~/.bukitjalil/pi` 和 `PI_OFFLINE=1`，并在 `agent/` 模块的单元测试里断言这两个变量已生效
- 每个会话一个 `AgentSession`，`cwd` 固定为该网站的 AI 工作副本 `~/.bukitjalil/worktrees/<siteId>/ai/`；路径永远不变，所以同一个会话跨多个改动集也能继续使用
- 同一个网站**同一时间只有一个会话在运行**：另一个会话在运行时，新消息进入排队，界面显示"另一个对话正在修改这个网站"，可以选择等待或停止对方
- AI 只能用白名单里的工具；读写路径都由权限闸门在文件操作这一层检查（6.3）
- 同一个网站的会话运行、改动集重置、快照、应用、拒绝、恢复、`ai/` 或 `main/` 里的任何构建和检查，都要先拿到这个网站的**操作锁**（7.2），同一时间只做一件

### 6.2 会话生命周期

```text
创建会话 ──► 记录 sessions 行，生成 Pi 会话文件路径（还不创建 AgentSession）
发送消息 ──► 网站已有其他会话在运行：排队，等它结束
          ──► 若没有 open 的改动集：把工作副本重置到默认分支最新提交，开一个新改动集（见 7.2）
          ──► createAgentSession({ cwd: worktree, tools: [6 个内置工具名 + 6 个自定义工具名], customTools, resourceLoader, sessionManager, settingsManager, modelRuntime, model })
          ──► session.subscribe(事件 → SSE)
          ──► session.prompt(text)（正在运行时用 steer / followUp）
运行结束 ──► agent_settled：做一次快照（7.2）；快照树和 base 不同就推送 change 事件（状态"待审核"，带差异摘要和指纹，见 9.2）
空闲 10 分钟 ──► session.dispose() 释放内存；会话文件保留，下次发消息时重建
停止 ──► session.abort()
分叉 ──► SessionManager.open(源文件, sessionDir).createBranchedSession(entryId)：新会话只包含从开头到指定消息的路径（forkFrom 会复制整个会话，不能用）
```

### 6.3 工具设计

**内置工具（白名单）**：`read`、`grep`、`find`、`ls`、`edit`、`write`。不开放 `bash`。

**工具白名单的写法**：已核对 SDK 1.5.0 源码（`sdk.js`、`agent-session.js` 的 `_isAllowedTool`），`createAgentSession` 的 `tools` 会变成允许的工具名列表，**`customTools` 也要经过它过滤**。所以 `tools` 必须同时列出 6 个内置工具名和 6 个自定义工具名，只列内置工具会让所有建站工具都注册不上。

**并行执行**：Pi 1.5.0 默认并行执行同一条消息里的多个工具调用（`pi-agent-core` 的 `toolExecution` 默认 `"parallel"`）。`bukit_check`、`bukit_build` 设置 `executionMode: "sequential"`，包含它们的那批调用整体顺序执行，避免一边构建一边改 `site.yaml`；它们执行时还要拿网站操作锁（7.2）。

**`grep` / `find` 依赖的程序**：已核对 SDK 1.5.0 源码，这两个工具分别调用 `rg`（ripgrep）和 `fd`。Pi 的 `getToolPath` 先找 `<PI_CODING_AGENT_DIR>/bin/`，**找不到就直接用系统 `PATH` 里的同名程序**（`fd` 还会找 `fdfind`），这一步在 `PI_OFFLINE` 检查之前；都找不到时才从 GitHub 下载最新版本，不做校验。Pi 启动它们时继承服务进程的全部环境变量。所以：

- `find` 不用 `fd`：传入自定义的 `FindOperations.glob`（Node 实现，Pi 已带 `minimatch`、`ignore`），根目录同样经过闸门
- `grep` 继续用 `rg`：BukitJalil 固定 rg 版本，代码里写死各平台安装包的 SHA-256（M1 定版本），复用 Bukit 的安装模块（8.1，同样需要用户确认、同样检查压缩包条目）安装到 `~/.bukitjalil/pi/bin/`；`PI_OFFLINE=1` 保证 Pi 不再下载
- 因为 Pi 会退回系统 `PATH`，`tool_call` 处理器在 `~/.bukitjalil/pi/bin/rg` 不存在或校验不通过时**直接阻止 `grep`**，返回"搜索工具未安装"，不让 Pi 去用系统里的 rg

**自定义工具**（通过 `customTools` / 内联扩展注册）：

| 工具 | 作用 | 返回 |
| --- | --- | --- |
| `site_info` | 读取并解析 `site.yaml`，给出站点、语言、集合、内容源、主题摘要 | 结构化 JSON |
| `bukit_check` | 在工作副本里执行 `bukit config check` 和 `bukit doctor` | 退出码、问题列表 |
| `bukit_build` | 在工作副本里构建到临时输出目录 | 是否成功、页面数、错误、SEO/GEO 报告摘要 |
| `bukit_schema` | 返回 `bukit config schema` 输出的 JSON Schema（缓存） | JSON Schema |
| `list_content` | 按集合列出内容文件和 frontmatter 摘要 | 列表 |
| `summarize_changes` | AI 在完成一轮修改后调用，提交给用户审核的说明 | 写入改动集 `summary`；AI 没调用时，服务端按差异自动生成一行摘要（如"修改 3 个文件：site.yaml、content/faq.md…"） |

**权限闸门**放在**文件操作这一层**，不在工具参数这一层：

- **为什么不能只看参数**：已核对 SDK 1.5.0 源码（`dist/utils/paths.js` 的 `normalizePath`），Pi 的工具在 `tool_call` 之后还会改写路径：去掉开头的 `@`、把 `~` / `~/` 展开成用户主目录、把 `file://` 地址转成路径、把几种 Unicode 空格换成普通空格；`read` 找不到文件时还会再试 NFD、弯引号等变体。所以 `~/.bukitjalil/pi/auth.json`、`@/etc/passwd`、`file:///etc/passwd` 按"相对工作副本"解析会被判定在工作副本内，Pi 实际打开的却是外面的文件
- **做法**：用 Pi 的 `createReadToolDefinition` / `createWriteToolDefinition` / `createEditToolDefinition` / `createLsToolDefinition` / `createGrepToolDefinition` / `createFindToolDefinition` 生成同名工具，传入自己的 `operations`（`readFile`、`writeFile`、`mkdir`、`access`、`stat`、`exists`、`isDirectory`、`glob` 等），通过 `customTools` 注册（同名会替换内置工具）。Pi 调用 `operations` 时传的是**最终的绝对路径**，`edit` / `write` 传的是**最终写入的内容**，闸门在这里检查，不需要复刻 Pi 的路径改写和 `edit` 的匹配逻辑
- `tool_call` 处理器只做第一层快速拒绝：路径以 `@`、`~`、`file:` 开头，或含 Unicode 空格，直接阻止并告诉 AI 用相对路径
- **所有带路径的操作**都必须落在工作副本内；读也要限制：否则 AI 可以读到 `~/.bukitjalil/pi/auth.json`（模型密钥）、`~/.ssh` 等，再借提示词注入写进网站文件带出去
- **唯一的例外：技能文件只读**。Pi 只在系统提示里给出技能文件的绝对路径，让模型用 `read` 去加载（已核对 `dist/core/skills.js`），所以 `readFile` / `access` 允许读取应用自带的 `skills/` 目录（取 `realpath` 后比较），不允许写，也不允许 `ls` / `grep` / `find` 它之外的目录
- 路径检查：对已存在的路径取 `realpath.native`（macOS 上会返回磁盘上的真实大小写）；不存在的路径（新建文件）逐级找到最近的已存在上级目录取 `realpath.native`，再拼回剩余部分；最终结果必须以工作副本的 `realpath` 加路径分隔符开头（防符号链接和 `..` 逃逸）
- 禁止读写：路径中**任何一级**名为 `.git`（不区分大小写），包括嵌套目录里的 `.git`：工作副本根目录的 `.git` 是指向网站仓库的文件，被改写就能把 git 指到 AI 准备的目录；嵌套的 `.git` 会让 `git add -A` 失败或把内容变成看不见的子模块
- 禁止写：`dist/**`、`.bukit/**`、`.cache/**`、`.bukitjalil-build/**`、`node_modules/**`、任何以 `.env` 开头的文件
- 禁止写插件相关文件：`plugins/**` 以及任何 `plugin.yaml` / `plugin.json`（Bukit 示例清单位于 `plugins/<name>/plugin.yaml`，M1 根据源码确认完整约定）；`site.yaml` 的插件配置在构建前另行检查（见 8.5）
- `grep` / `find` 的 glob 只在根目录下匹配；根目录在 `operations.isDirectory` / `glob` 里检查
- 自定义工具只接受集合名、语言代码等受限参数，不接受任意路径；有路径参数的（如以后的素材工具）走同一个解析函数
- 单个文件写入上限 1 MB（在 `writeFile` 里按最终内容检查）；二进制文件不允许 AI 写入（图片等素材走后续的"上传素材"功能）
- 闸门本身有完整单元测试：绝对路径、`..`、`~`、`~/…`、`@…`、`file://…`、含 Unicode 空格的路径、符号链接（指向外部的文件和目录）、大小写变体（`.GIT`）、根目录和嵌套的 `.git`、新建深层目录、技能目录只读

### 6.4 技能与提示

- **Bukit 官方技能**：Bukit 仓库 `guide/skills/` 下已有 14 个面向 AI 的技能（`using-bukit`、`bukit-config`、`bukit-content`、`bukit-theme`、`bukit-templating`、`bukit-i18n`、`bukit-seo`、`bukit-geo` 等）。按 Bukit 2.0.8 对应的版本复制到 `skills/bukit/`，记录来源 commit，升级 Bukit 时同步
- **BukitJalil 技能**（`skills/bukitjalil/`）：
  - `site-editing`：工作规则——只改网站文件；改完先 `bukit_check`，再 `bukit_build`；最后调用 `summarize_changes`。**同时说明命令和工具的对应关系**：Bukit 官方技能里写的是 `bukit config check`、`bukit doctor`、`bukit build` 等命令，而 AI 没有执行命令的工具，要改用 `bukit_check`、`bukit_build`、`bukit_schema`；官方技能里涉及 `dev`、`preview`、`deploy`、插件和 Labs 的部分由 BukitJalil 处理，AI 不要尝试
  - 复制官方技能时去掉 Labs 相关内容，并在每个技能开头加一行说明上述对应关系
  - `content-writing`：公司介绍、服务页、首屏文案、FAQ、SEO 标题描述、按主题写文章的写法和 frontmatter 约定
  - `multilingual`：按 `site.languages` 生成和对齐多语言内容
- **系统提示**：自定义 `getSystemPrompt()`，说明身份（BukitJalil 建站助手）、当前网站名和路径、可用工具、"不要执行命令、不要改网站目录以外的东西"、回答用用户的语言
- 不加载 `AGENTS.md` / `CLAUDE.md` 等上下文文件
- 技能文件在工作副本外，靠 6.3 的"技能目录只读"例外让 AI 读到；M1 验证 AI 确实会 `read` 这些路径并成功

### 6.5 模型与密钥

- `ModelRuntime.create({ authPath: ~/.bukitjalil/pi/auth.json, modelsPath: ~/.bukitjalil/pi/models.json })`
- 模型密钥有两个来源：设置页填写（写入 `auth.json`）和环境变量（Pi 会读取 `ANTHROPIC_API_KEY`、`OPENAI_API_KEY` 等提供商环境变量，已核对 Pi 文档）。设置页对每个提供商显示密钥来源；来自环境变量的不能在界面里修改
- Pi 在请求时可能才读取环境变量，所以模型密钥变量**不从进程环境删除**；改为保证 BukitJalil 自己启动的子进程（git、Bukit）都只拿到显式构造的最小环境（7.3、8.5），不会继承它们。例外是 Pi 内部启动的 `rg`：它会继承全部环境变量，但只会是 BukitJalil 安装、校验过的固定版本（没装好时 `grep` 被阻止，见 6.3），不执行网站内容，可以接受
- 设置面板支持：选择提供商和模型、填写 API Key（界面只显示末四位）、思考级别、"测试连接"
- 密钥永远不通过 API 返回给浏览器

**其他密钥（Notion token、GitHub token）的来源**，由 `packages/server/src/settings/secrets.ts` 统一处理：

1. **环境变量优先**：启动时读取 `BUKITJALIL_NOTION_TOKEN`、`BUKITJALIL_GITHUB_TOKEN`。设置了就使用，设置页显示"来自环境变量"，不能在界面里修改或删除。适合 CI、无界面服务器、不想把 token 写到磁盘的用户
2. **否则用设置页填写的值**：保存在 `~/.bukitjalil/secrets.json`（权限 600，写入时先写临时文件再原子替换）
3. **读完立即从进程环境里删除**：服务启动读取后，马上从 `process.env` 中删除这两个变量，只保存在内存里，避免被 git、Bukit 等子进程继承
4. **传给 Bukit 的规则不变**：每次调用 Bukit 都显式构造环境变量（8.5），只在需要时放入对应 token——Notion token 只在用户手动构建正式版本或发布时传，GitHub token 只在发布时传

不只用环境变量的原因：从 Finder / Dock 启动的桌面版（M7）读不到 shell 里设置的环境变量；界面里没法修改；而且放在进程环境里的密钥默认会被所有子进程继承。在防 AI 这一点上两者等价：AI 没有执行命令的工具，读写又限制在工作副本内，读不到环境变量，也读不到 `secrets.json`。

系统钥匙串（macOS Keychain / Windows 凭据管理器）作为 M7 桌面版的可选改进，MVP 不做（Node 常用的钥匙串库已停止维护，会增加原生依赖和打包成本）。

### 6.6 待验证（M1 技术验证）

- [ ] 用 `create*ToolDefinition(worktree, { operations })` 生成同名工具并通过 `customTools` 替换内置工具；`tools` 同时列出内置和自定义工具名；`tool_call` 阻止的确切写法
- [ ] 自定义 `ResourceLoader` 加载目录形式的技能
- [x] 会话文件放在自定义目录：已核对 1.5.0 类型定义，`SessionManager.create(cwd, sessionDir)`、`SessionManager.open(path, sessionDir, cwdOverride)` 都支持；从指定消息分叉用 `createBranchedSession(entryId)`（`forkFrom` 会复制整个会话）；实际行为在 M1 跑通
- [ ] 工作副本切到新分支后，同一个会话文件继续使用是否正常（cwd 不变，但文件内容变了）；必要时用 `open()` 的 `cwdOverride` 固定工作目录
- [ ] `agent_settled`、`tool_execution_*` 事件字段，用于界面显示工具调用
- [ ] `PI_CODING_AGENT_DIR` + `PI_OFFLINE=1` 下不联网、不读 `~/.pi`；`grep` 在 `bin/rg` 缺失时被 `tool_call` 阻止；`find` 用自定义 `glob` 后不再调用 `fd`
- [ ] `bukit_check` / `bukit_build` 设 `executionMode: "sequential"` 后，同一批调用确实顺序执行
- [ ] 系统提示里的技能路径能被 AI 通过 `read` 读到（技能目录只读例外）

---

## 7. 改动审核与版本

### 7.1 原则

网站目录的默认分支（`sites.default_branch`，下文简称 `main`）就是"正式版本"。AI 永远不直接改网站目录，只改工作副本；用户确认后才合入。

### 7.2 改动集流程

AI 工作副本在第一次需要时创建（`git worktree add --detach ~/.bukitjalil/worktrees/<siteId>/ai <main 的提交 OID>`），之后一直复用，HEAD 始终是分离状态，不建分支。正式版本另有一个检出 `worktrees/<siteId>/main/`，只在正式构建时按需创建和重置；AI 不能访问 `main/` 检出。

**网站操作锁**：每个网站一把锁（进程内互斥，按 siteId）。会话的一轮运行、开新改动集、快照、应用、拒绝、恢复、`ai/` 或 `main/` 里的任何 Bukit 调用，都必须先拿到锁；锁被占用时，会话消息排队，其他接口返回 409 并说明正在进行的操作。这把锁取代零散的"先检查有没有会话在运行"：检查和执行在同一把锁里完成，中间不会插入别的操作（例如应用期间跑 `bukit_check` 的 60 秒里不会有新消息开始修改工作副本）。

```text
           用户发消息（且没有 open 改动集）
                       │
                       ▼
   在工作副本里：git reset --hard <main 的 OID> && git clean -fdx -e .bukit -e .cache
   记录 base_commit = main 的 OID；写 refs/bukitjalil/changes/<changeId>
                       │
                       ▼
        AI 在工作副本里修改（可以多轮对话持续修改同一个改动集）
                       │
                       ▼
     每轮结束、每次构建前：快照（见下方）
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
     应用            拒绝           继续对话
        │              │              │
  拿锁、校验指纹      状态 rejected    回到 AI 修改
  main 已前进则       删除引用        （审核卡片失效）
  合并并重新审核      （工作副本下次
  commit-tree        开新改动集时重置）
  site 目录快进合并
  状态 applied，删除引用
```

- **快照**（已用本地 git 实验确认）：`git add -A` → `git write-tree` 得到树 T → `git commit-tree T -p <上一个快照或 base>` → `git update-ref HEAD <新提交>`，同时更新 `refs/bukitjalil/changes/<changeId>`（防止被 gc）。快照之后工作区是干净的，HEAD 的树就是暂存内容。这样做有两个原因：
  - `git diff <base>...` 不显示还没被跟踪的新文件，用暂存内容才能保证**审核看到的 = 将要提交的**
  - Bukit 2.0.8 构建两种以上语言的网站时，要求工作区没有任何暂存、未暂存或未跟踪的改动，并从 HEAD 的提交构建（已核对源码 `BuildCommand.cs`、`WorktreeBuildRepository.cs`，没有参数可以关掉）。不先快照，多语言网站在 `ai/` 里的构建一定失败
- **差异**：`git diff --no-ext-diff --no-textconv <base_commit> <快照>`，按文件分页返回；单个文件的差异按需读取
- **审核指纹** = 快照的树哈希 T，和差异一起发给界面：
  - 点"应用"时请求必须带上指纹；服务端拿到网站操作锁后再做一次快照，树必须和指纹完全一致，否则拒绝并刷新审核卡片
  - 会话开始运行时当前审核卡片立即失效，界面禁用"应用"，等这一轮结束、新的快照生成后再启用
- **正式版本已前进时**：应用前发现 `main` 不再等于 `base_commit`（用户在 BukitJalil 外提交过，或做过恢复），用 `git merge-tree --write-tree <main 的 OID> <快照>`（git ≥ 2.38，只读，不碰索引和工作区）计算合并结果：
  - 成功：得到新树 T'，`git commit-tree T' -p <main>` 作为新快照，在工作副本里 `git reset --hard` 到它，`base_commit` 更新为 main；**不自动合入**，重新生成差异和指纹，用户再确认一次
  - 有冲突：标记 `stale`，让 AI 基于新版本重做；没有任何进行到一半的 git 操作需要清理（不用 `git rebase`：冲突时它会把工作副本留在 rebase 状态，之后所有 `git switch` 都失败）
- **应用**：拿锁 → 校验指纹 → main 已前进时按上一条处理 → 自动跑一次 `bukit_check`（失败时允许用户坚持应用，但要明确提示）→ `git commit-tree <指纹> -p <main>` 生成结果提交 → 在网站目录里 `git merge --ff-only --no-overwrite-ignore <结果提交 OID>` → 状态 `applied`、记录 `result_commit`、删除引用。合入前检查，任一不满足就拒绝并提示用户先处理：
  - 网站目录当前检出的分支就是 `sites.default_branch`（用户可能在 BukitJalil 外切到了别的分支）
  - 网站目录没有未提交的改动
  - `--no-overwrite-ignore`：改动里如果有网站目录中被忽略的同名本地文件，合并中止而不是悄悄覆盖（已实验确认不加这个参数会直接覆盖）
- **拒绝**：只改状态、删除引用；工作副本在下次开新改动集时统一 `reset --hard` + `clean`
- **清理被忽略的文件**：AI 可以改 `.gitignore`，把文件藏起来——被忽略的文件不出现在差异里、不会被提交，但会留在工作副本里影响之后的预览构建。所以开新改动集时用 `git clean -fdx`，只用 `-e` 保留 `.bukit/`、`.cache/` 两个缓存目录
- 一个网站同一时间最多一个 `open` 改动集，多个会话共享它；配合网站操作锁，不会出现两个 AI 同时改文件
- **排除规则**：创建网站检出时，在网站仓库的 `.git/info/exclude` 写入一段带 `# BukitJalil begin/end` 标记的内容：`dist/`、`.bukit/`、`.cache/`、`.bukitjalil-build/`。必须写在这里而不是只用 `-c core.excludesFile`：Bukit 自己调用的 `git status` 也要把这些目录当作被忽略，否则多语言构建会因为"有未跟踪文件"拒绝。移除网站时删掉这一段
- **提交身份**：提交信息为 `summarize_changes` 的说明 + 会话 ID。作者固定为 `BukitJalil AI <ai@bukitjalil.local>`，提交者是设置页里填写的身份。`git commit-tree` 没有 `--author` 参数，所以用 `-c author.name=… -c author.email=… -c committer.name=… -c committer.email=…`（git ≥ 2.22，已实验确认能分开设置）
- **身份的默认值**：git 子进程不读全局配置（7.3），所以 `git/run.ts` 提供一个单独的 `readGlobalIdentity()`：只执行 `git config --global --get user.name` 和 `user.email`，这一次不覆盖 `GIT_CONFIG_GLOBAL`（`config --get` 只读值，不执行任何程序），结果只作为设置页的默认值。新建网站、导入非 git 目录都需要提交，所以首次启动引导**先**填身份，再新建网站

### 7.3 git 调用加固

网站仓库（尤其是导入的）可能自带会执行命令的 git 配置和钩子。已用本机 git 2.39.5 实验确认：仓库 `.git/config` 里的 `core.fsmonitor = <命令>` 会在执行 `git status` 时直接运行；`.git/hooks/pre-commit` 会在提交时运行；用户全局配置里定义的过滤器（例如 git-lfs 的 `filter.lfs.*`）会被仓库里的 `.gitattributes` 触发；仓库配置里的 `gpg.program` 配合 `commit.gpgSign=true` 会在 `git commit` / `git rebase` 时运行，配合 `log.showSignature=true` 会在 `git log` 时运行。所以 BukitJalil 的所有 git 调用都统一由 `packages/server/src/git/run.ts` 发起（不用 git 封装库，见 2.2），不允许其他模块直接调用 git：

- **调用方式**：用 `child_process.spawn`（参数数组、不经过 shell、显式 env），流式读取输出，不用 `execFile`（它默认最多读 1 MiB 输出，超过就杀掉 git 进程，大的差异会失败）；需要一次性拿到的输出设置明确的大小上限，超限时报错而不是截断。`git` 程序的绝对路径在启动时解析一次，之后都用绝对路径
- **最低版本**：git ≥ 2.38（`merge-tree --write-tree`），启动时检查，`/api/health` 报告
- **固定参数**：每次调用都带 `-c core.fsmonitor=false -c core.hooksPath=<应用自带的空目录> -c core.untrackedCache=false -c core.attributesFile=<空文件> -c core.excludesFile=<空文件> -c protocol.allow=never -c commit.gpgSign=false -c tag.gpgSign=false -c log.showSignature=false`；`diff` / `log -p` / `show` 一律加 `--no-ext-diff --no-textconv`
- **参数注入**：外部来的值不会被当成 git 的选项：
  - 提交只接受完整的十六进制 OID（40 或 64 位），接口参数用 zod 校验
  - 分支只用 `refs/heads/<name>` 的完整形式，`<name>` 必须通过 `git check-ref-format --branch` 且不以 `-` 开头；能先解析成 OID 的就先解析
  - 版本参数前加 `--end-of-options`，路径前加 `--`
- **不读系统和全局配置**：git 子进程只传 `PATH`、`HOME`、`LANG`，外加 `GIT_CONFIG_NOSYSTEM=1`、`GIT_CONFIG_GLOBAL=<空文件>`、`GIT_TERMINAL_PROMPT=0`；不继承服务进程的其他环境变量（包括模型密钥）。`core.excludesFile` 默认会读 `~/.config/git/ignore`，不受 `GIT_CONFIG_GLOBAL` 影响，所以也在固定参数里指向空文件（否则用户自己的忽略规则会让 AI 写的文件不出现在差异里）。`<空文件>` 是 `~/.bukitjalil/empty-gitconfig`，启动时确认存在且为空；不用 `/dev/null`，因为 Git for Windows 不保证能识别它
- **`safe.directory`**：不读全局配置后，用户在全局配置里加的 `safe.directory` 也不生效。网站目录属于别的用户时 git 会拒绝（dubious ownership），这时把网站标为只读并说明原因，不自动加 `safe.directory=*`
- **检查仓库配置（白名单）**：不再列举危险的配置项（列不全：上面的 `gpg.program` 就是漏掉的一个），改为只允许已知无害的配置：
  - 用 `git config --list --show-scope --includes`（同样加固）列出**仓库级和 worktree 级**的全部配置（`--local` 看不到 `extensions.worktreeConfig` 打开后的 `config.worktree`）
  - 允许的只有：`core.repositoryformatversion`、`core.filemode`、`core.bare`、`core.logallrefupdates`、`core.ignorecase`、`core.precomposeunicode`、`core.symlinks`、`core.autocrlf`、`core.eol`、`remote.*.url`、`remote.*.pushurl`、`remote.*.fetch`、`branch.*.remote`、`branch.*.merge`、`branch.*.rebase`、`user.name`、`user.email`（M1 用真实仓库核对后定稿；`extensions.worktreeConfig` 不在白名单里）
  - 出现其他任何配置、`.git/hooks/` 里有非 `.sample` 的可执行文件、`.git/info/attributes` 里有 `filter=` 属性，就把网站标为"只读：不满足安全规则"并列出原因，当前操作一并拒绝
  - **在 `git/run.ts` 里每次调用前执行**，按 `.git/config`、`config.worktree`、`hooks/`、`info/attributes` 的修改时间和大小缓存结果。不再维护"哪些操作之前要检查"的清单：每轮快照里的 `git add -A`、开新改动集的 `reset --hard` 也会运行过滤器，同样要被覆盖
- **`.gitattributes`**：配置白名单不允许任何 `filter.*` / `diff.*` / `merge.*` 定义，全局配置又被隔离，属性里引用的驱动没有任何来源，所以不再逐个扫描 `.gitattributes` 的内容（`diff=markdown`、`merge=union` 这类 git 内置驱动是无害的，不应该因此拒绝）
- **Git LFS 不支持**：隔离全局配置后 LFS 过滤器不再运行，LFS 仓库里只能看到指针文件。导入时如果被跟踪的 `.gitattributes` 里有 `filter=` 属性，网站标为"只读：不满足安全规则"，原因写明 MVP 不支持 Git LFS
- **Bukit 自己调用的 git**：Bukit 2.0.8 构建多语言网站和发布时会自己启动 `git`，不带上面的 `-c` 参数（已核对源码）。所以调用 Bukit 时用环境变量把同样的加固传给它：`GIT_CONFIG_NOSYSTEM=1`、`GIT_CONFIG_GLOBAL=<空文件>`、`GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n`（与固定参数相同的配置），以及 `GIT_TERMINAL_PROMPT=0`；仓库配置检查在调用 Bukit 前同样执行
- 加固函数有单元测试：带 `core.fsmonitor`、钩子、仓库 `filter`、`gpg.program` + `commit.gpgSign` / `log.showSignature`、`config.worktree` 里的配置、全局配置定义过滤器（临时 `HOME`）、用户全局忽略文件、以 `-` 开头的提交或分支名、超过 1 MiB 的差异，验证都不会执行命令、不会被当成选项、不会截断

### 7.4 版本历史与恢复

- 历史 = `main` 的提交列表，每条显示说明、时间、改动文件数、关联会话
- 查看任意版本的差异（提交参数按 7.3 校验为完整 OID）
- **恢复复用应用的流程**：恢复到版本 V = 生成一个由系统发起的改动集，快照树是 `V^{tree}`，base 是当前 main，用户在审核卡片里看到"恢复到 V"的差异和预览，确认后走 7.2 的"应用"（`commit-tree V^{tree} -p <main>` + 网站目录 `merge --ff-only --no-overwrite-ignore`）。不用 `git read-tree`：不加 `-u` 时它只改索引，网站目录里的文件不变，恢复后网站目录反而变成"有未提交改动"（已实验确认）
- 有 `open` 改动集时，恢复需要用户先应用或拒绝它（同一时间只有一个 open 改动集）；恢复应用之后，下一个改动集基于新的 main
- 恢复前对 `V` 的提交跑构建前安全检查（8.5，直接读 git 对象），不通过时提示原因（旧版本可能用了现在不允许的配置）；用户确认后仍可恢复，但正式预览构建会被拒绝
- 恢复提交由用户发起，作者和提交者都是设置页里填写的用户身份

---

## 8. Bukit 集成

### 8.1 获取 Bukit

- 首次启动检查：设置里的自定义路径 → `~/.bukitjalil/bin/bukit-2.0.8/` → 系统 `PATH` 里的 `bukit`
- 都没有时，界面提示从 Bukit GitHub Release v2.0.8 下载对应平台的包（需用户确认），解压到 `~/.bukitjalil/bin/`
- 完整性校验：v2.0.8 的 Release 附带 `checksums.txt` 和 `checksums.json`（已核对）。BukitJalil 在代码里固定三个平台安装包的 SHA-256（开发时从 `checksums.txt` 核对后写入），下载后比对，不在运行时信任下载来的校验文件
- 解压安全：先解压到临时目录，逐个检查压缩包条目，拒绝绝对路径、含 `..` 的路径和符号链接（防止解压到目标目录外），检查通过后再整体移动到 `~/.bukitjalil/bin/bukit-2.0.8/`，并确认可执行文件存在、`bukit version` 输出 2.0.8
- 平台：官方只提供 osx-arm64、linux-x64、win-x64，**没有 Intel Mac（osx-x64）和 Linux ARM 版本**。这些平台的用户需要自己编译 Bukit 并在设置里指定路径，界面要给出明确提示
- 启动时执行 `bukit version`，版本不是 2.0.x 时警告

> Bukit 官方说明常规公开二进制发布已暂停，2.0.8 是当前最新的公开版本。因此固定 2.0.8，同时支持用户指定自己编译的 Bukit 路径。

### 8.2 调用封装

```ts
// packages/server/src/bukit/runner.ts（示意）
runBukit(args: string[], opts: { cwd: string; env?: Record<string, string>; timeoutMs?: number; signal?: AbortSignal })
  : Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }>
```

- 只用参数数组调用，不经过 shell
- 默认超时：check / doctor 60 秒，build 5 分钟
- 调用 Bukit 前先拿网站操作锁（7.2），在 `ai/` 里构建前先做快照，保证工作区干净（多语言网站的构建要求，见 7.2）
- 环境变量里带上 7.3 的 git 加固（`GIT_CONFIG_NOSYSTEM`、`GIT_CONFIG_GLOBAL`、`GIT_CONFIG_COUNT` 等），因为 Bukit 会自己启动 git
- 退出码**按命令分别解释**，不用一张通用表：Bukit 2.0.8 源码里 `config check` 和 `doctor` 遇到配置错误返回 1（不是 2），`build` 的 2 / 3 分别表示内容错误和渲染错误。M1 逐个命令跑一遍成功、配置错误、内容错误、渲染错误的用例，把实际退出码写进 `runner.ts` 的映射和测试；对 check / doctor，非 0 一律当作"检查不通过"，把输出交给界面和 AI
- `--log-format`：M1 技术验证时确认是否有 JSON 日志格式，有就用于结构化错误

### 8.3 使用的命令

| 场景 | 命令 |
| --- | --- |
| 配置检查 | `bukit config check --config site.yaml` |
| 诊断 | `bukit doctor --config site.yaml` |
| 配置结构 | `bukit config schema --output <tmp>.json` |
| 构建预览 | `bukit build --config site.yaml --output .bukitjalil-build/<buildId> --base-url /preview/<siteId>/<buildId>/ --no-clean`（只在 `worktrees/<siteId>/ai/` 或 `worktrees/<siteId>/main/` 里执行，不在用户的网站目录里执行） |
| SEO / GEO / 发布审计 | `bukit seo audit --dir <out>`、`bukit geo audit --dir <out>`、`bukit publish audit --dir <out>`（M4 以后） |
| 发布 | `bukit deploy --skip-build --output <已审核的构建目录>`（M6，见 14 节 M6） |

### 8.4 预览

- **输出目录的约束**（已核对 Bukit CLI 文档）：Bukit 的清理逻辑拒绝清理"当前项目以外的路径"和非空且没有输出标记的目录，构建时的清理也走同一套规则。所以不能直接把 `--output` 指向 `~/.bukitjalil/previews/` 并加 `--clean`
- **做法**：每次构建输出到项目内一个全新的空目录 `.bukitjalil-build/<buildId>/`（已在排除规则里），使用 `--no-clean`；构建成功后把目录整体移动到 `~/.bukitjalil/previews/<siteId>/<buildId>/`；失败也删除临时目录
- 改动集预览在 `worktrees/<siteId>/ai/` 里构建，正式版本预览在 `worktrees/<siteId>/main/` 里构建，都不在用户的网站目录里产生任何文件
- 由 BukitJalil 服务端在预览端口托管构建输出：`GET http://127.0.0.1:47881/preview/:siteId/:buildId/*`（同一个 Node 进程的第二个监听端口），不启动 `bukit preview` / `bukit dev`
- 构建时用 `--base-url` 设成预览路径，保证页面里的链接和资源路径正确（待验证：Bukit 生成的 URL 是否完全遵守 `--base-url`）
- 界面用 iframe 显示，可以切换"正式版本"和"当前改动集"两份预览
- 每个网站保留最近 10 次构建输出，旧的自动清理；清理时始终保留最新的一次正式版本构建和最新的一次改动集构建（界面上两个预览切换按钮对应的就是它们）
- 预览端口校验 `Host` 头：只接受 `127.0.0.1:47881` 和 `localhost:47881`，其他一律 421。防止 DNS 重绑定：外部网页把自己的域名解析到 127.0.0.1 后，就能以同源身份读取预览内容（预览里可能有用户还没发布的内容）
- 预览服务对每个请求的文件先 `lstat`：路径上任何一级是符号链接就返回 404，`realpath` 必须在该次构建的输出目录内；构建输出搬到 `previews/` 之前也先扫描一遍，发现符号链接就判定构建失败
- **预览与管理界面隔离**：预览页面的内容来自 AI 生成的网站，必须当作不可信内容。只限制 Cookie 的 `Path` 挡不住它——Cookie 是否携带看请求地址，同源页面里的脚本照样能带着 Cookie 调用 `/api`。所以：
  - 预览由服务端在**另一个端口**（默认 47881，只监听 127.0.0.1）提供，和管理界面不同源，浏览器的同源策略阻止它读写 `/api`
  - 预览的每个响应都带 `Content-Security-Policy: sandbox allow-scripts allow-popups; connect-src 'none'; form-action 'none'`（**不给 `allow-forms`**），即使用户在新标签页直接打开，页面也运行在不透明来源里，脚本也不能用 `fetch` / `XMLHttpRequest` 向任何地址（包括管理端口）发请求
  - iframe 同样加 `sandbox="allow-scripts"`（不给 `allow-same-origin`、`allow-forms`）
  - **端口不同不等于跨站**：浏览器判断 Cookie 是否同站时不看端口，`127.0.0.1:47881` 发往 `:47880` 的请求照样带 `SameSite=Strict` 的 Cookie。所以光靠换端口挡不住表单提交、`<img>` 之类的跨端口请求，管理端 API 必须自己防跨站请求（见 11 节"跨站请求"）

### 8.5 构建前的安全检查

网站的 `site.yaml`、主题和内容都可能由 AI 写成：改动集里的是还没审核的 AI 内容，正式版本里的也是 AI 写、用户审核通过的内容（审核时可能漏看一行配置）。所以**不论谁触发、构建哪个版本，所有 Bukit 调用（check、doctor、build、审计、发布）之前都先做同一套检查**，不通过就拒绝并说明原因（AI 触发时原因返回给 AI）：

- **插件**：Bukit Core 有插件宿主，能按清单启动外部进程（源码里有 `Bukit.PluginHost`、`IPluginProcessInvoker`；示例清单位于 `plugins/<name>/plugin.yaml`）。因此：
  - `site.plugins` 只允许 Bukit Core 内置插件（白名单 M1 根据 2.0.8 源码确定，例如 `analytics`）
  - 项目里存在 `plugins/` 目录或任何插件清单文件时拒绝构建
  - AI 不能写 `plugins/**`（见 6.3）
- **路径字段**：`site.yaml` 里所有表示路径的字段都必须解析到当前检出目录内，不能是绝对路径、不能含 `..`、不能经由符号链接指向外部。至少包括 `content.sources[].markdown.dir`、`content.sources[].notion.cacheDir`、`content.media.downloadDir`、`build.output`、`theme.name`（对应 `themes/<name>`）、`theme.layouts`、`theme.assets`、`theme.static`、`theme.staticTemplate`、`theme.components.*.template`、`theme.scss.entryPoint`、`theme.scss.outputDir`；完整清单 M1 从 `bukit config schema` 输出里逐个字段整理（Bukit 文档只对 `content.media.downloadDir` 明确说会拒绝越界路径，其他字段不能依赖 Bukit 自己检查）
- **网络**：`content.media.blockPrivateNetworks` 必须为 `true`（防止构建时访问本机和内网服务）；M1 确认是否需要进一步关闭 `downloadToLocal`
- **检查的对象是提交，不是工作区**：检查读取要构建的那个提交（改动集的快照、`main` 的提交、要恢复的版本）的 git 对象：`git ls-tree -r -z --full-tree <提交>` 列出全部条目，`git cat-file blob` 读取 `site.yaml` 等需要解析的文件。这样新建、导入时可以在创建任何检出之前就完成检查，检查结果和随后构建的内容完全一致
- **符号链接**：被跟踪的文件里不能有符号链接（`ls-tree` 里 mode 为 `120000` 的条目）。导入的仓库或恢复的旧版本里可能有 `content/x.md -> ~/.bukitjalil/secrets.json` 这样的链接，git 检出时会原样建出来，Bukit 构建时如果跟着读，外部文件就会进入预览甚至被发布。AI 的写工具建不了符号链接，所以直接全部拒绝，不去判断指向哪里；M1 实测 Bukit 遇到符号链接的行为
- **Notion 源**：没有 token 时 Bukit 2.0.8 的 check / doctor / build 都会因 Notion 源失败（已核对源码）。改动集预览不传密钥，所以有 Notion 源的网站在 `ai/` 里不调用 Bukit，检查和构建直接返回明确的原因（见 5.1）；M1 确认 Bukit 是否有只用本地缓存、不联网的模式，有就在改动集预览里使用
- **SCSS 等编译选项**：M1 确认 `theme.scss` 是否调用外部程序；如果会，强制关闭或拒绝
- **环境变量**：默认只传最小环境（`PATH`、`HOME`、`LANG`）。Notion token（以 Bukit 读取的 `NOTION_TOKEN` 传入）等密钥**只在用户手动构建正式版本或发布时**传入，token 的来源见 6.5；改动集预览（还没审核的 AI 内容）不论谁触发都不传密钥

检查逻辑放在 `packages/server/src/bukit/guard.ts`，配一套单元测试（每个路径字段的越界用例、插件、网络开关、符号链接条目、直接读 git 对象而不读工作区）。

---

## 9. 服务端 API 与事件

所有接口在 `/api` 下，请求和响应用 `shared` 里的 zod schema 校验。

### 9.1 REST 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/sites` | 网站列表 |
| POST | `/api/sites` | 新建网站 |
| POST | `/api/sites/import` | 导入已有目录 |
| GET | `/api/sites/:siteId` | 网站详情（含配置摘要、状态） |
| PATCH | `/api/sites/:siteId` | 改显示名、归档 |
| DELETE | `/api/sites/:siteId` | 从 BukitJalil 移除网站：删除工作副本、`refs/bukitjalil/*` 引用和 `.git/info/exclude` 里的 BukitJalil 段落，`git worktree prune`，删除会话和构建记录；**不删除网站目录** |
| GET | `/api/sites/:siteId/tree?ref=main\|change&path=` | 目录树，按目录懒加载（只返回 `path` 下一层），直接读 git 对象 |
| GET | `/api/sites/:siteId/file?path=&ref=` | 文件内容：文本以 JSON 返回；安全的位图图片（PNG、JPEG、GIF、WebP）带 `X-Content-Type-Options: nosniff` 和 `Content-Security-Policy: sandbox` 返回；SVG、HTML、PDF 等能执行脚本的类型**不在管理端口直接打开**，只以 `Content-Disposition: attachment` 下载，或通过预览端口查看 |
| GET | `/api/sites/:siteId/config` | `site.yaml` 结构化视图 + 原文 |
| GET | `/api/sites/:siteId/theme` | 主题信息 |
| GET | `/api/sites/:siteId/data` | 内容源与数据 |
| GET | `/api/sites/:siteId/sessions` | 会话列表 |
| POST | `/api/sites/:siteId/sessions` | 新建会话 |
| GET | `/api/sessions/:sessionId` | 会话消息（从 Pi 会话文件还原） |
| PATCH | `/api/sessions/:sessionId` | 重命名 |
| DELETE | `/api/sessions/:sessionId` | 删除会话 |
| POST | `/api/sessions/:sessionId/messages` | 发消息（`mode`: `prompt` / `steer` / `followUp`） |
| POST | `/api/sessions/:sessionId/abort` | 停止 |
| POST | `/api/sessions/:sessionId/fork` | 从某条消息分叉 |
| GET | `/api/sites/:siteId/changes/current` | 当前改动集与差异 |
| POST | `/api/changes/:changeId/apply` | 应用；请求体必须带审核指纹 `treeHash`，指纹不符、网站操作锁被占用（会话在运行、构建中等）时返回 409 |
| POST | `/api/changes/:changeId/reject` | 拒绝 |
| GET | `/api/sites/:siteId/history` | 版本历史 |
| GET | `/api/sites/:siteId/history/:commit/diff` | 某个版本的差异；`:commit` 用 zod 校验为完整的十六进制 OID（40 或 64 位），见 7.3 |
| POST | `/api/sites/:siteId/history/:commit/restore` | 恢复到某个版本：生成一个恢复改动集供审核（7.4）；`:commit` 校验同上 |
| POST | `/api/sites/:siteId/builds` | 触发构建（`ref`: `main` / `change`） |
| GET | `/api/sites/:siteId/builds` | 构建记录 |
| GET | `/api/settings` / PUT `/api/settings` | 全局设置 |
| GET | `/api/models` | 可用模型 |
| PUT | `/api/providers/:provider/key` | 保存 API Key |
| POST | `/api/providers/:provider/test` | 测试连接 |
| GET | `/api/bukit` | Bukit 状态：路径、版本、来源（自定义 / 应用管理 / PATH）、当前平台是否有官方安装包 |
| POST | `/api/bukit/install` | 下载并安装 Bukit 2.0.8（界面确认后调用），进度通过 SSE 推送 |
| GET | `/api/health` | 健康检查：Bukit、git（版本 ≥ 2.38）、Pi 是否可用 |

### 9.2 SSE 事件

`GET /api/events` 每个浏览器标签页**只开一条**连接，所有网站的事件都走这一条（浏览器对同一主机最多 6 条 HTTP/1.1 连接，SSE 会一直占着；每个网站一条的话打开几个网站后普通请求就会卡住）。事件格式 `{ type, siteId, sessionId?, changeId?, data }`，界面按 `siteId` 分发：

| 事件 | 来源 | 界面用途 |
| --- | --- | --- |
| `session.status` | 会话启动、运行、空闲、出错 | 侧栏状态点 |
| `message.delta` | Pi `message_update`（text_delta） | 流式文字 |
| `message.end` | Pi `message_end` | 落定消息 |
| `tool.start` / `tool.update` / `tool.end` | Pi `tool_execution_*` | 工具调用卡片 |
| `run.settled` | Pi `agent_settled` | 结束加载状态 |
| `change` | 改动集的完整状态快照：状态、快照树（审核指纹）、差异摘要、是否可应用 | 改动面板、文件树、审核卡片都按最新快照渲染 |
| `build.start` / `build.end` | Bukit 构建 | 预览面板状态 |

- 改动集只用一个 `change` 事件推送完整状态，不再分 `updated` / `ready` / `invalidated` / `resolved` 四种：界面不需要按顺序拼状态，丢一条也不会错，下一条就是完整的
- 断线重连：带 `Last-Event-ID`。服务端保留一个重放缓冲：`message.delta` 合并成每条消息的最新累计文本，`change` 每个网站只留最后一条，总大小上限 1 MB；超过上限或 `Last-Event-ID` 已不在缓冲里时，发一个 `resync` 事件，界面重新拉取会话消息和当前改动集

---

## 10. 界面设计

### 10.1 布局

```text
┌ 顶栏：BukitJalil · 当前网站名 · 构建状态 · 设置 ─────────────────────────────┐
├──────────────┬──────────────────────────────┬────────────────────────────┤
│ 网站列表      │ 对话                          │ 面板标签：                   │
│ ＋ 新建网站    │  消息流（Markdown、工具调用卡片） │ 文件｜配置｜主题｜数据｜改动｜预览 │
│ ▾ 网站 A      │                              │                            │
│   ● 会话 1    │  ┌ 审核卡片 ──────────────┐   │  只读内容                    │
│   ○ 会话 2    │  │ 改了 3 个文件 · 查看差异  │   │                            │
│   ＋ 新会话    │  │ [应用]  [拒绝]          │   │                            │
│ ▸ 网站 B      │  └──────────────────────┘   │                            │
│              │  输入框（停止 / 发送）          │                            │
└──────────────┴──────────────────────────────┴────────────────────────────┘
```

- 三栏宽度可拖动，记住在本地存储
- 窄屏（< 1024px）时右侧面板变成抽屉
- 支持亮色 / 暗色，跟随系统
- 界面文字：中文为主，结构上预留多语言（文案集中在 `web/src/i18n/`）

### 10.2 关键交互

- **网站首页**（未选会话时）：网站概况、最近构建、最近改动、"开始一个新对话"
- **工具调用卡片**：折叠显示工具名和目标文件，展开看参数和结果；`edit` / `write` 显示该文件的小差异
- **审核卡片**：改动说明、文件列表（新增 / 修改 / 删除）、检查结果；点"查看差异"跳到右侧"改动"面板
- **文件面板**：顶部切换"正式版本 / 改动中"；改动中的文件标记颜色
- **只读**：任何面板都没有编辑入口；在文件上提供"让 AI 修改这个文件"快捷动作，把文件路径带入输入框

### 10.3 前端结构

```text
packages/web/src/
├── app/            # 路由、布局、Provider
├── features/
│   ├── sites/      # 网站列表、新建、导入、首页
│   ├── chat/       # 消息流、输入框、工具卡片、审核卡片
│   ├── panels/     # files / config / theme / data / changes / preview
│   └── settings/
├── components/ui/  # shadcn 生成的组件
├── lib/            # api 客户端、SSE 客户端、query keys
├── stores/         # zustand
└── i18n/
```

---

## 11. 安全

| 风险 | 措施 |
| --- | --- |
| 本机其他网页调用本地服务 | 只监听 127.0.0.1；校验 `Host`（防 DNS 重绑定）和 `Origin`；启动时生成随机 token，用 `http://127.0.0.1:47880/?token=…` 打开浏览器，服务端校验后设置 `HttpOnly; SameSite=Strict; Path=/api` 的 Cookie，并重定向到不带 token 的地址；所有 `/api` 请求必须带这个 Cookie。重启服务会换 token，终端里打印新的打开地址 |
| AI 越权写文件 | 工具白名单 + 路径闸门（6.3）+ 只改工作副本 + 人工审核 |
| AI 执行命令 | 不开放 `bash`；Bukit 只通过固定参数的自定义工具调用；所有构建前检查插件和编译选项（8.5） |
| 路径穿越（文件接口） | 所有路径参数 `realpath` 后必须在网站目录或工作副本内 |
| 密钥泄露 | 模型密钥来自 `~/.bukitjalil/pi/auth.json` 或提供商环境变量（6.5），Notion / GitHub token 来自环境变量 `BUKITJALIL_NOTION_TOKEN` / `BUKITJALIL_GITHUB_TOKEN`（优先）或 `~/.bukitjalil/secrets.json`（600 权限）；Notion / GitHub 环境变量读取后立即从进程环境删除；所有子进程（git、Bukit）都只拿到显式构造的最小环境（7.3、8.5）；都在 AI 工作副本之外，不进数据库、不进日志、不返回浏览器；只按 8.5 和 M6 的规则显式传给 Bukit（见 6.5） |
| 预览页面脚本（AI 写的 JS） | 预览在另一个端口提供（不同源）+ 响应头 `CSP: sandbox allow-scripts allow-popups; connect-src 'none'; form-action 'none'` + iframe `sandbox`（见 8.4） |
| DNS 重绑定读取预览内容 | 预览端口同样校验 `Host`，只接受 `127.0.0.1:47881` / `localhost:47881`（见 8.4） |
| 管理端口上的 XSS（AI 写的 SVG / HTML 文件、对话里的 Markdown） | 管理界面响应头 `CSP: default-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src http://127.0.0.1:47881`；文件接口不在管理端口直接打开 SVG / HTML / PDF，位图带 `nosniff` + `CSP: sandbox`（见 9.1）；对话 Markdown 不渲染原始 HTML，不加载远程图片 |
| 绕过路径闸门（`@`、`~`、`file://`、Unicode 空格经 Pi 归一化后变成别的路径） | 闸门放在工具的 `operations` 里，检查的是 Pi 归一化之后真正要读写的绝对路径；`tool_call` 再快速拒绝这些前缀（见 6.3） |
| 跨站请求（预览页或其他网页向 API 发表单、图片请求等） | Cookie 不按端口隔离，所以 API 自己防护：① 所有非 GET 请求的 `Origin` 必须**完全等于**管理界面地址（`http://127.0.0.1:47880`；开发模式下是 Vite 地址，见 3.3），缺失或为 `null` 一律拒绝；② 非 GET 请求必须是 `Content-Type: application/json` 并带自定义请求头 `X-BukitJalil: 1`（普通表单发不出这种请求，跨源时会触发预检，而服务端不允许任何跨源预检）；③ 所有 GET 接口都没有副作用；④ 服务端不返回任何 `Access-Control-Allow-*` 头 |
| AI 读取密钥或系统文件 | 读类工具同样受路径闸门限制，只能访问工作副本（见 6.3） |
| 仓库里的符号链接让构建或预览读到外部文件 | 构建前检查拒绝所有被跟踪的符号链接；预览服务 `lstat` 拒绝符号链接（见 8.4、8.5） |
| Pi 自动下载未校验的 `rg` / `fd`，或使用用户本机的 Pi 目录 | 加载 Pi 前设置 `PI_CODING_AGENT_DIR`、`PI_OFFLINE=1`；BukitJalil 自己安装固定版本的 `rg` 并校验 SHA-256，`bin/rg` 缺失时阻止 `grep`；`find` 用 Node 实现，不调用 `fd`（见 6.1、6.3） |
| AI 借 Bukit 插件 / 编译选项间接执行代码 | 所有构建前检查插件和编译选项，AI 不能写 `plugins/**`（见 6.3、8.5） |
| AI 借 `site.yaml` 路径字段或远程素材读取工作副本外的文件、访问内网 | 所有构建前校验路径字段必须在检出目录内，强制 `blockPrivateNetworks: true`（见 8.5） |
| 密钥进入未审核内容的构建 | 只有用户手动构建正式版本或发布时才传密钥（见 8.5） |
| 导入仓库借 git 配置或钩子执行命令（`core.fsmonitor`、hooks、filter、`gpg.program` + 签名、`config.worktree` 等） | 所有 git 调用统一加固（关闭 fsmonitor、钩子、签名、外部差异和文本转换，不读系统和全局配置，最小环境变量）；仓库和 worktree 级配置按**白名单**检查，在 `git/run.ts` 里每次调用前执行，不满足就只读并拒绝操作（见 7.3） |
| AI 写 `.gitattributes` 触发全局配置里的过滤器（如 git-lfs） | `GIT_CONFIG_GLOBAL`、`core.attributesFile`、`core.excludesFile` 都指向应用自带的空文件；仓库配置白名单不允许任何驱动定义，属性引用的驱动没有来源；不支持 Git LFS（见 7.3） |
| git 参数注入（以 `-` 开头的提交、分支名，例如 `--output=…`） | 提交只接受校验过的完整 OID，分支只用校验过的 `refs/heads/<name>`，版本参数前加 `--end-of-options`、路径前加 `--`（见 7.3） |
| Bukit 自己调用的 git 不带加固参数 | 调用 Bukit 时用 `GIT_CONFIG_NOSYSTEM`、`GIT_CONFIG_GLOBAL`、`GIT_CONFIG_COUNT` 等环境变量传入同样的加固（见 7.3、8.2） |
| 应用时覆盖网站目录里被忽略的本地文件（如 `.env`） | `git merge --ff-only --no-overwrite-ignore`，冲突时中止并提示（见 7.2） |
| 审核后内容被改动（AI 仍在运行、排队消息、正式版本已前进） | 网站操作锁 + 审核卡片绑定快照树指纹；指纹一致才允许应用；正式版本前进后用 `merge-tree` 合并并重新审核（见 7.2） |
| 提示词注入（网站内容里夹带指令） | AI 能力本身受限；所有改动必须人工审核，且应用时校验审核指纹 |

---

## 12. 测试策略

| 层级 | 工具 | 覆盖 |
| --- | --- | --- |
| 单元 | Vitest | `shared` 的 schema；`server` 的路径闸门（读写工具、glob 参数）、构建前安全检查 `bukit/guard.ts`（插件、每个路径字段、网络开关、环境变量、符号链接、读 git 对象而不读工作区）、闸门在 `operations` 里检查归一化后的路径（`@`、`~`、`file://`、Unicode 空格）、预览服务拒绝符号链接和错误的 `Host`、文件接口对 SVG / HTML 的处理、git 参数校验（OID、分支名）、Pi 环境变量（`PI_CODING_AGENT_DIR`、`PI_OFFLINE`）在加载 Pi 前生效、防跨站请求中间件、密钥来源（环境变量优先、读取后从进程环境删除、子进程环境里不含密钥）、`site.yaml` 解析、差异解析、Bukit 按命令的退出码映射 |
| 服务端集成 | Vitest + 临时目录 | 真实 git（≥ 2.38）：创建网站（`init -b main`）、分离 HEAD 的工作副本、快照、应用 / 拒绝 / 恢复；git 加固（带 `core.fsmonitor`、钩子、`filter`、`gpg.program` + 签名配置、`config.worktree` 的测试仓库，临时 `HOME` 里全局配置定义过滤器、用户全局忽略文件，都不执行任何命令、不影响差异）；正式版本前进时 `merge-tree` 成功（重新审核）和冲突（stale，工作副本没有残留状态）；`--no-overwrite-ignore` 遇到被忽略的同名文件时中止；网站操作锁（应用期间新消息排队）；超过 1 MiB 的差异；多语言 starter 网站在 `ai/` 里快照后构建成功；Bukit 用假程序（脚本模拟输出和退出码），并确认它启动的 git 拿到加固环境变量 |
| Pi 集成 | Vitest + 假模型 | 用 Pi 的自定义提供商注册一个脚本化的假模型，按剧本返回工具调用，验证工具和闸门，不花钱、结果稳定 |
| 真实 Bukit | Vitest（标记 `@bukit`，CI 可选） | 用真实 Bukit 2.0.8 构建 starter 模板 |
| 端到端 | Playwright | 新建网站 → 对话（假模型）→ 审核 → 应用 → 构建 → 预览；拒绝流程；恢复流程；**安全用例**：预览页里的恶意脚本 / 自动提交表单 / 图片请求无法调用管理端 API，新标签页直接打开预览同样无效 |
| 真实模型验收 | 手动脚本（`scripts/accept-real-model.ts`） | 每个里程碑结束跑一次，用真实模型完成一个建站任务 |

覆盖率目标：`server` 核心模块（agent 闸门、changes、bukit）行覆盖 ≥ 80%。

---

## 13. 工程规范

- **提交**：Conventional Commits（`feat:`、`fix:`、`docs:`、`chore:`、`test:`）
- **分支**：功能在 `pi-harness-ui` 上推进；每个里程碑一个 PR 合入 `main`
- **代码风格**：Biome 统一格式和检查；TypeScript `strict: true`、`noUncheckedIndexedAccess: true`
- **CI**（GitHub Actions）：`pnpm install --frozen-lockfile` → `biome check` → `tsc --noEmit` → `vitest run` → `playwright test`；macOS 和 Linux 各跑一遍（MVP 支持的平台，见 1.2）
- **日志**：服务端结构化日志（JSON 行），写到 `~/.bukitjalil/logs/`，不记录消息正文和密钥
- **文档**：每个里程碑更新 README 的状态说明；重要设计变更在 `docs/decisions/` 记录

---

## 14. 实施计划

估算按一名开发者（配合 AI 编程）计，单位为工作日，含测试。总计约 **31–40 个工作日**完成 MVP（M0–M5），不含 M6、M7。评审、七轮审计和一次代码审查新增的安全工作（防跨站请求、预览隔离、构建前检查、路径与符号链接校验、git 加固与配置白名单、自己实现的 git 调用、固定版本的 rg、快照式改动集与网站操作锁）已计入 M0–M4。

### M0 工程骨架（3–4 天）

| 任务 | 产出 |
| --- | --- |
| pnpm workspace、三个包、tsconfig、Biome | 能 `pnpm install`、`pnpm check` |
| server：Hono 启动、`/api/health`、静态托管 web | `pnpm dev` 打开页面 |
| web：Vite + React + Tailwind + shadcn 初始化，三栏空布局 | 可拖动三栏 |
| 安全基础：127.0.0.1、两个端口都做 Host 校验、token Cookie、防跨站请求（Origin 完全匹配、JSON + 自定义头、无 CORS，见 11 节）、管理界面 CSP、预览端口骨架（CSP sandbox + `connect-src 'none'`） | 外部来源和跨端口表单请求被拒 |
| SQLite 与迁移机制 | `app.db` 自动创建 |
| 确认 TypeScript 7.0.2 与 Vite、Vitest、Biome、shadcn 兼容 | 不兼容则退回 TypeScript 6 并更新本文 |
| CI 工作流 | PR 自动检查 |

**验收**：`pnpm dev` 打开三栏空界面；`/api/health` 报告 git 可用且版本 ≥ 2.38；不带 Cookie、`Origin` 不符或为 `null`、缺少 `X-BukitJalil` 头、非 JSON 的非 GET 请求都被拒绝（有自动化测试）；预览端口的响应带 `CSP: sandbox`；CI 通过。

### M1 技术验证（3–4 天）

在 `packages/server/spikes/` 写最小验证脚本，逐项确认 6.6、8.2、8.4、8.5 的待验证项：

- Pi SDK：自定义 agentDir、`PI_CODING_AGENT_DIR` / `PI_OFFLINE` 下 rg 的查找顺序（定 rg 版本并核对 SHA-256）、`find` 用 `FindOperations.glob` 不需要 fd、用 `create*ToolDefinition` + `operations` 实现闸门、`tools` 白名单包含自定义工具名、`executionMode: "sequential"`、ResourceLoader 加载技能（技能目录只读例外）、会话文件路径、`createBranchedSession` 分叉、事件字段、假模型提供商
- Bukit：在 macOS 上运行 2.0.8；`--output` 指向项目内新空目录 + `--no-clean` 能正常构建；`--base-url` 预览路径；`--log-format` 选项；`config schema` 输出；用 `checksums.txt` 核对三个平台安装包；每个命令在成功和各类错误下的实际退出码；多语言网站在分离 HEAD + 快照后的工作副本里能构建；Bukit 启动的 git 是否遵守 `GIT_CONFIG_*` 环境变量；Notion 源有没有只用本地缓存的模式
- Bukit 安全面（8.5）：Core 内置插件清单；是否加载项目内的外部插件、插件清单的文件名约定、插件能否启动进程；`site.yaml` 每个路径字段对绝对路径、`..`、符号链接的处理（从 `bukit config schema` 整理完整字段清单）；`theme.scss` 是否调用外部程序；`content.media` 的联网行为和 `blockPrivateNetworks`；内容、主题、静态文件里的符号链接是否会被跟随读取
- 预览隔离与防跨站：第二端口 + `CSP: sandbox`（无 `allow-forms`）下，预览页的脚本、表单、图片请求都无法让管理端 API 产生副作用（写恶意测试页验证）
- git：同一仓库两个固定工作树（`ai/` 分离 HEAD、`main/`）的创建、重置、复用；`.git/info/exclude` 里的标记段落对工作树和 Bukit 的 git 都生效；仓库配置白名单在常见真实仓库（GitHub 克隆、带 LFS、带 `includeIf`）上的结果

**验收**：每一项都有可运行的脚本和结论，更新本文档"待验证"清单；如有不可行项，在进入 M2 前调整设计。

### M2 网站项目与只读面板（7–9 天）

| 任务 | 产出 |
| --- | --- |
| Bukit 程序检测、下载（需确认）、版本检查 | 设置页显示 Bukit 状态 |
| starter 模板：从 Bukit 源码复制 StarterTheme，补 `theme.yaml`、最小 `site.yaml` 和示例内容，用真实 Bukit 构建通过 | `templates/starter/` |
| 构建前安全检查 `bukit/guard.ts`（插件、路径字段、网络、环境变量，见 8.5）+ 单元测试 | 检查模块 |
| 新建网站、导入网站（含不满足安全规则时的"只读"状态，见 5.1；先检查 git 对象再创建检出）、`git/run.ts`（`spawn` 流式读取 + 加固参数 + 参数校验 + 机器可读输出解析）与配置白名单检查（7.3）、`readGlobalIdentity()`、网站列表、归档、移除（删除引用和排除规则段落） | 侧栏网站列表 |
| 文件树（按目录懒加载，读 git 对象）和文件预览（Shiki、Markdown、位图；SVG / HTML / PDF 通过预览端口或下载，见 9.1） | 文件面板 |
| 配置面板（结构化 + 原文） | 配置面板 |
| 主题面板、数据面板（Markdown 集合、data 源、Notion 源只显示配置） | 主题、数据面板 |
| 构建（main）与预览托管（独立预览端口 + CSP sandbox） | 预览面板 |

**验收**：能新建一个网站并构建预览；能导入一个已有 Bukit 网站；六个面板中除"改动"外都能正常显示；全程没有编辑入口。

### M3 AI 会话（8–10 天）

| 任务 | 产出 |
| --- | --- |
| agent 模块：会话管理、ResourceLoader、系统提示、模型运行时；加载 Pi 前设置 `PI_CODING_AGENT_DIR` / `PI_OFFLINE`（6.1） | 能创建 AgentSession |
| rg 安装：固定版本、校验 SHA-256、安全解压到 `~/.bukitjalil/pi/bin/`（复用 Bukit 的安装逻辑），设置页显示状态；`find` 用 Node 的 glob 实现（6.3） | `grep` / `find` 可用且不联网 |
| 建站工具：`site_info`、`bukit_check`、`bukit_build`、`bukit_schema`、`list_content`、`summarize_changes` | 自定义工具 |
| 权限闸门（在工具 `operations` 里实现）+ 单元测试（读写工具都覆盖；含绝对路径、符号链接、`..`、任意层级的 `.git`、`@` / `~` / `file://` / Unicode 空格、新建深层目录等用例） | 闸门测试全过 |
| `bukit_check` / `bukit_build` 接入 M2 的构建前检查，改动集构建不传密钥（见 8.5） | AI 构建受检查 |
| 技能打包：同步 Bukit 官方技能，编写 BukitJalil 技能 | `skills/` |
| SSE 事件流（每个标签页一条连接、按 `siteId` 分发）、断线重连与 `resync` | 事件接口 |
| 界面：会话列表、消息流、流式输出、工具卡片、停止、steer / followUp | 对话界面 |
| 会话恢复、重命名、删除、分叉 | 会话管理 |
| 设置：模型选择、API Key、测试连接 | 设置页 |

**验收**：用真实模型说"把首页标题改成 X，并加一个 FAQ 页面"，AI 只在工作副本里修改并通过检查；尝试让 AI 读或改工作副本以外的文件（包括 `~/.bukitjalil/pi/auth.json`）会被阻止；在 `site.yaml` 里加入非内置插件后 AI 的构建会被拒绝；刷新页面后会话可以恢复。

### M4 改动审核与版本（6–8 天）

| 任务 | 产出 |
| --- | --- |
| 改动集：分离 HEAD 的工作副本、网站操作锁、快照（`add -A` → `write-tree` → `commit-tree` → 更新 HEAD 和 `refs/bukitjalil/changes/*`）、差异计算（base 对快照，含新文件）、`git clean -fdx` 清理、审核指纹（快照树）、会话运行时审核卡片失效、正式版本前进后 `merge-tree` 合并并重新审核、状态管理 | changes 模块 |
| 审核卡片、改动面板（文件列表 + 差异视图） | 审核界面 |
| 应用（含检查、`merge-tree`、`commit-tree` 分开设置作者和提交者、`merge --ff-only --no-overwrite-ignore`）、拒绝 | 应用 / 拒绝 |
| 改动集预览构建，预览面板切换"正式 / 改动中" | 双预览 |
| 版本历史、版本差异、恢复（生成恢复改动集，复用应用流程） | 历史面板 |
| SEO / GEO 审计结果显示在构建记录里 | 构建详情 |

**验收**：完整走通"对话 → 审核 → 应用 → 正式预览更新"（包括多语言网站）；拒绝后网站目录不变；网站目录里被忽略的本地文件不会被应用覆盖；恢复到旧版本后预览回到旧内容；`main` 历史清晰可读。

### M5 打磨与 MVP 发布（4–5 天）

- 端到端测试全流程（假模型）、真实 Bukit 构建测试
- 错误处理：Bukit 失败、模型报错、网络中断、磁盘写入失败的界面提示
- 首次启动引导：检测 Bukit 和 git → 填写提交身份（默认值来自 `readGlobalIdentity()`）→ 配置模型 → 新建第一个网站
- 暗色模式、窄屏、键盘操作（发送、停止、切换面板）
- 文档：README 状态更新、用户使用说明 `docs/user-guide.md`
- 真实模型验收：从零做一个"专业服务公司双语官网"

**验收**：新机器上按 README 安装后 10 分钟内完成第一个网站并预览；CI 全绿；真实模型验收记录归档到 `docs/acceptance/`。

### M6 发布到 GitHub Pages（3–4 天，MVP 之后）

- 部署设置：仓库、分支（写入 `site.yaml` 的 `deploy`，通过 AI 或设置向导生成改动集，同样走审核）
- 发布前检查（都在 `main/` 检出里执行，先过 8.5 的构建前安全检查）：`config check`、`doctor`、构建到新的空目录、`publish audit`；发布的就是这次审计过的输出目录
- GitHub token：来源按 6.5（环境变量 `BUKITJALIL_GITHUB_TOKEN` 优先，否则设置页填写、存于 `secrets.json`）；只在用户点击发布时，放进 Bukit 子进程的环境变量 `GITHUB_TOKEN`（Bukit 2.0.8 的 `deploy` 没有 `--token-env` 参数，固定读 `GITHUB_TOKEN`，已核对源码），任何其他构建都不传
- 调用 `bukit deploy --skip-build --output <审计过的输出目录>`：不加 `--skip-build` 时 `deploy` 会自己重新构建，发布的就不是刚审计过的内容
- **先验证 `bukit deploy` 怎么调用 git**：在哪个目录执行、是否读网站仓库或用户全局的 git 配置、token 怎么传给 git。它内部的 git 调用不经过 7.3 的加固，所以根据结果决定隔离方式（例如只给它一个临时 `HOME`，里面只有发布需要的最小 git 配置），并且只在通过 8.5 检查的 `main/` 检出里执行
- 调用 `bukit deploy`，显示进度和结果；发布记录

### M7 桌面版（4–5 天，MVP 之后）

- Electron 45 壳：主进程启动 server，窗口加载本地页面
- 应用数据目录、Bukit 程序随包或首启下载
- macOS 签名与公证、自动更新（视需要）

### 里程碑总览

```text
M0 骨架 ─► M1 技术验证 ─► M2 网站与面板 ─► M3 AI 会话 ─► M4 审核与版本 ─► M5 MVP
 3–4d        3–4d           7–9d            8–10d         6–8d            4–5d
                                                                            │
                                                     M6 GitHub Pages ◄──────┤
                                                     M7 桌面版      ◄───────┘
```

---

## 15. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| Pi SDK 版本迭代快（1.4 → 1.5 已有接口变化） | 升级时接口不兼容 | 锁定精确版本；所有 Pi 调用集中在 `agent/` 一个模块，加适配层；升级前跑全套测试 |
| Bukit 公开二进制发布已暂停 | 新平台或新版本拿不到 | 固定 2.0.8；支持自定义 Bukit 路径（自己编译）；Bukit 调用集中在 `bukit/` 模块 |
| Bukit 拒绝项目外的输出目录 | 预览构建失败 | 已改为输出到项目内的新空目录再搬走（8.4）；M1 验证 |
| `--base-url` 预览路径不完全生效 | 预览里资源 404 | M1 验证；不行就让每次构建用独立的子域名，例如 `http://b-<buildId>.localhost:47881/`，构建时 `--base-url /`。浏览器把 `*.localhost` 直接解析到本机，仍由我们的预览服务提供（CSP sandbox、拒绝符号链接都保留），不改用 `bukit preview`（它不加这些响应头，端口也不受我们控制） |
| TypeScript 7 与工具链不兼容 | 类型检查或编辑器支持出问题 | M0 验证；退回 TypeScript 6 |
| 同一网站多个会话或操作争用工作副本 | 改动互相覆盖、应用时内容被改 | 网站操作锁：会话运行、快照、应用、恢复、构建互斥，其他排队或返回 409（6.1、7.2） |
| AI 改动质量不稳定 | 用户频繁拒绝 | 技能里要求先检查再构建；审核卡片显示检查结果；支持继续对话修正同一个改动集 |
| 模型费用 | 成本不可控 | 显示每个会话的 token 和费用（Pi 事件里有用量）；可选较便宜的模型 |
| 工作树与 `main` 分叉冲突 | 应用失败 | 同一网站只允许一个 open 改动集；`merge-tree` 冲突时标记 stale，让 AI 基于新版本重做 |
| 系统 git 版本过旧（< 2.38，没有 `merge-tree --write-tree`） | 正式版本前进后无法合并 | 启动时检查，`/api/health` 和首次启动引导提示升级 |
| 仓库配置白名单误伤常见仓库 | 正常网站被标为只读 | M1 用常见真实仓库核对白名单；只读原因逐项列出，方便用户自行清理 |
| Bukit 内部 git 调用的行为（多语言构建、发布）与预期不同 | 构建失败或加固失效 | M1 验证 `GIT_CONFIG_*` 环境变量对 Bukit 启动的 git 生效；不生效则改为给 Bukit 一个临时 `HOME` 并拒绝多语言网站在 `ai/` 里构建，界面说明 |

---

## 16. 待定问题

1. **网站默认存放位置**：`~/BukitJalil Sites/` 还是让用户每次选？（当前设计：默认目录 + 可改）
2. **素材上传**：图片等二进制文件 AI 不能写，用户怎么加素材？建议加"上传到 `content/media`"的受控入口——这是唯一的用户直接写入，需要确认是否接受。**目前没有排进 M0–M5**；确认接受后作为 M5 的新增任务（约 1–2 天，上传同样生成改动集、走审核），MVP 估算相应增加
3. **Notion 数据源**：MVP 只显示配置；是否需要在 BukitJalil 里管理 Notion Token 并预览 Notion 数据？
4. **多会话并发改同一网站**：MVP 限制一个 open 改动集，是否够用？
5. **界面语言**：MVP 只做中文，还是中英双语？
6. **默认主题的外观**：MVP 已确定从 Bukit 源码复制 StarterTheme 作为起点（5.2、M2）；是否在此基础上做一套更好看的默认主题，可以放到 MVP 之后决定
