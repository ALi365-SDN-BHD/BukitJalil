# BukitJalil 开发方案与实施计划

> 版本：v1.3（2026-11-09，已按评审和两轮审计修改） · 分支：`pi-harness-ui` · 状态：待确认
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
| 新建网站（基于从 Bukit 源码复制的 starter 主题）、导入已有 Bukit 网站 | 克隆其他网站、HTML 导入（Bukit 也未支持） |
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
| `simple-git` | 4.0.2 | 调用系统 git：仓库、工作树、差异、提交 |
| `yaml` | 2.9.1 | 解析 `site.yaml`、`theme.yaml`，保留注释和格式 |
| `node:sqlite` | Node 内置 | 系统数据库 |
| `tsx` | 4.23.15 | 开发时直接运行 TypeScript |

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
  ├─ changes/        改动集：工作树、差异、应用、拒绝、历史、恢复
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

- 开发：`pnpm dev` 同时启动 server（tsx watch）和 web（Vite，代理 `/api` 到 server）
- 生产：`pnpm build` 后 server 直接托管 web 的静态文件，一个进程一个端口，`pnpm start` 启动并打开浏览器
- 默认端口：管理界面和 API 用 47880，预览用 47881（和管理界面隔离，见 8.4）；被占用时报错并提示 `--port` / `--preview-port`

---

## 4. 数据与存储

### 4.1 目录布局

```text
~/.bukitjalil/                      # 应用数据目录（可用 BUKITJALIL_HOME 覆盖）
├── app.db                          # SQLite：网站列表、会话索引、改动集、构建记录、设置
├── bin/bukit-2.0.8/bukit           # 应用管理的 Bukit 程序
├── pi/                             # 给 Pi 用的独立目录（agentDir），不读用户 ~/.pi
│   ├── auth.json                   # 模型 API Key / OAuth（权限 600）
│   └── models.json
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
- BukitJalil 在网站的 `.git` 里会留下两类记录：工作副本登记（`.git/worktrees/ai`、`.git/worktrees/main`）和排除规则（`.git/info/exclude`）。它们不影响网站内容，也不会被提交
- 会话、工作副本、构建输出都放在应用数据目录，删除应用数据不会损坏网站内容；但网站 `.git` 里会留下失效的工作副本登记，执行 `git worktree prune` 即可清理。BukitJalil 提供"从 BukitJalil 移除网站"操作，会先删除工作副本并清理这些登记

### 4.2 SQLite 表

| 表 | 主要字段 | 说明 |
| --- | --- | --- |
| `sites` | `id`, `name`, `path`, `default_branch`, `created_at`, `last_opened_at`, `archived` | 网站列表；`path` 是网站目录绝对路径；`default_branch` 是网站的正式分支（新建为 `main`，导入时读取当前默认分支） |
| `sessions` | `id`, `site_id`, `pi_session_file`, `title`, `created_at`, `updated_at`, `status` | 会话索引；正文在 Pi 的 JSONL 里 |
| `change_sets` | `id`, `site_id`, `session_id`, `base_commit`, `branch`, `status`, `summary`, `created_at`, `resolved_at`, `result_commit` | 改动集，状态：`open` / `applied` / `rejected` / `stale` |
| `builds` | `id`, `site_id`, `change_set_id`, `commit`, `kind`, `status`, `exit_code`, `output_dir`, `report_json`, `started_at`, `finished_at` | 构建记录；`kind`：`check` / `doctor` / `build` |
| `settings` | `key`, `value_json` | 全局设置：默认模型、思考级别、Bukit 路径 |
| `schema_migrations` | `version`, `applied_at` | 数据库迁移 |

迁移脚本放在 `packages/server/src/store/migrations/NNN_name.sql`，启动时按顺序执行。

---

## 5. 网站项目模型

### 5.1 网站是什么

一个目录满足以下条件就是一个 BukitJalil 网站：

1. 根目录有 `site.yaml`，且 `bukit config check` 通过（导入时允许失败，但要标记"配置有误"）
2. 是一个 git 仓库（导入时如果不是，征得用户同意后 `git init` 并做首次提交）；导入时记录当前默认分支，不假设叫 `main`，工作区有未提交改动时要求用户先处理
3. 已登记在 `sites` 表里

### 5.2 新建网站

1. 用户在界面填写：网站名、目录位置、主语言、可选的一句话描述
2. 服务端把 `templates/starter/` 复制到目标目录（包含 `site.yaml`、`content/`、`themes/starter/`）。Bukit 没有"生成初始网站"的命令，官方 starter 主题只以资源文件形式嵌在 CLI 源码里（`src/Bukit-Core/Bukit.Cli/Resources/StarterTheme/`，MIT 协议）。BukitJalil 从 v2.0.8 复制这些模板，补上 `theme.yaml` 和最小内容，作为自己维护的模板，并记录来源 commit
3. 用表单值替换 `site.name`、`site.title`、`site.language`
4. `git init`、首次提交 "Initial site from BukitJalil starter"
5. 执行 `bukit config check` 和 `bukit build`，确认可以构建
6. 如果填写了描述，自动打开第一个会话，把描述作为第一条消息发给 AI

### 5.3 面板数据来源

| 面板 | 数据来源 | 实现 |
| --- | --- | --- |
| 文件 | 网站目录（或当前改动集的工作副本） | 目录树接口 + 文件内容接口；忽略 `.git`、`dist`、`.bukit` |
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
- 每个会话一个 `AgentSession`，`cwd` 固定为该网站的 AI 工作副本 `~/.bukitjalil/worktrees/<siteId>/ai/`；路径永远不变，所以同一个会话跨多个改动集也能继续使用
- 同一个网站**同一时间只有一个会话在运行**：另一个会话在运行时，新消息进入排队，界面显示"另一个对话正在修改这个网站"，可以选择等待或停止对方
- AI 只能用白名单里的工具；写入路径由权限闸门再检查一遍

### 6.2 会话生命周期

```text
创建会话 ──► 记录 sessions 行，生成 Pi 会话文件路径（还不创建 AgentSession）
发送消息 ──► 网站已有其他会话在运行：排队，等它结束
          ──► 若没有 open 的改动集：把工作副本重置到默认分支最新提交，开一个新改动集（见 7.2）
          ──► createAgentSession({ cwd: worktree, tools, customTools, resourceLoader, sessionManager, settingsManager, modelRuntime, model })
          ──► session.subscribe(事件 → SSE)
          ──► session.prompt(text)（正在运行时用 steer / followUp）
运行结束 ──► agent_settled：统计工作副本的改动；有改动就把改动集标记为待审核，推送 change_set.ready
空闲 10 分钟 ──► session.dispose() 释放内存；会话文件保留，下次发消息时重建
停止 ──► session.abort()
分叉 ──► SessionManager 的 fork 能力，新会话从指定消息开始
```

### 6.3 工具设计

**内置工具（白名单）**：`read`、`grep`、`find`、`ls`、`edit`、`write`。不开放 `bash`。

**自定义工具**（通过 `customTools` / 内联扩展注册）：

| 工具 | 作用 | 返回 |
| --- | --- | --- |
| `site_info` | 读取并解析 `site.yaml`，给出站点、语言、集合、内容源、主题摘要 | 结构化 JSON |
| `bukit_check` | 在工作副本里执行 `bukit config check` 和 `bukit doctor` | 退出码、问题列表 |
| `bukit_build` | 在工作副本里构建到临时输出目录 | 是否成功、页面数、错误、SEO/GEO 报告摘要 |
| `bukit_schema` | 返回 `bukit config schema` 输出的 JSON Schema（缓存） | JSON Schema |
| `list_content` | 按集合列出内容文件和 frontmatter 摘要 | 列表 |
| `summarize_changes` | AI 在完成一轮修改后调用，提交给用户审核的说明 | 写入改动集 `summary`；AI 没调用时，服务端按差异自动生成一行摘要（如"修改 3 个文件：site.yaml、content/faq.md…"） |

**权限闸门**（内联扩展的 `tool_call` 处理器，失败即阻止）：

- **所有带路径参数的工具**（`read`、`grep`、`find`、`ls`、`edit`、`write`）的路径都必须解析到工作副本内；不传路径时默认就是工作副本根目录。读也要限制：否则 AI 可以读到 `~/.bukitjalil/pi/auth.json`（模型密钥）、`~/.ssh` 等，再借提示词注入写进网站文件带出去
- 路径解析：相对路径以工作副本为基准；已存在的路径取 `realpath`；不存在的路径（新建文件）逐级找到最近的已存在上级目录取 `realpath`，再拼回剩余部分；最终结果必须以工作副本的 `realpath` 加路径分隔符开头（防符号链接和 `..` 逃逸）
- 禁止读写：`.git` 和 `.git/**`（工作副本里的 `.git` 是指向网站仓库的文件）
- 禁止写：`dist/**`、`.bukit/**`、`.cache/**`、`.bukitjalil-build/**`、`node_modules/**`、任何以 `.env` 开头的文件
- 禁止写插件相关文件：`plugins/**` 以及任何 `plugin.yaml` / `plugin.json`（Bukit 示例清单位于 `plugins/<name>/plugin.yaml`，M1 根据源码确认完整约定）；`site.yaml` 的插件配置在构建前另行检查（见 8.5）
- 除路径参数外，`grep` / `find` 的 glob、include 等模式参数同样校验：不能是绝对路径、不能含 `..`
- 自定义工具只接受集合名、语言代码等受限参数，不接受任意路径；有路径参数的（如以后的素材工具）走同一个解析函数
- 单个文件写入上限 1 MB；二进制文件不允许 AI 写入（图片等素材走后续的"上传素材"功能）
- 闸门本身有完整单元测试：绝对路径、`..`、符号链接（指向外部的文件和目录）、大小写变体、`.git` 文件、新建深层目录

### 6.4 技能与提示

- **Bukit 官方技能**：Bukit 仓库 `guide/skills/` 下已有 14 个面向 AI 的技能（`using-bukit`、`bukit-config`、`bukit-content`、`bukit-theme`、`bukit-templating`、`bukit-i18n`、`bukit-seo`、`bukit-geo` 等）。按 Bukit 2.0.8 对应的版本复制到 `skills/bukit/`，记录来源 commit，升级 Bukit 时同步
- **BukitJalil 技能**（`skills/bukitjalil/`）：
  - `site-editing`：工作规则——只改网站文件；改完先 `bukit_check`，再 `bukit_build`；最后调用 `summarize_changes`。**同时说明命令和工具的对应关系**：Bukit 官方技能里写的是 `bukit config check`、`bukit doctor`、`bukit build` 等命令，而 AI 没有执行命令的工具，要改用 `bukit_check`、`bukit_build`、`bukit_schema`；官方技能里涉及 `dev`、`preview`、`deploy`、插件和 Labs 的部分由 BukitJalil 处理，AI 不要尝试
  - 复制官方技能时去掉 Labs 相关内容，并在每个技能开头加一行说明上述对应关系
  - `content-writing`：公司介绍、服务页、首屏文案、FAQ、SEO 标题描述、按主题写文章的写法和 frontmatter 约定
  - `multilingual`：按 `site.languages` 生成和对齐多语言内容
- **系统提示**：自定义 `getSystemPrompt()`，说明身份（BukitJalil 建站助手）、当前网站名和路径、可用工具、"不要执行命令、不要改网站目录以外的东西"、回答用用户的语言
- 不加载 `AGENTS.md` / `CLAUDE.md` 等上下文文件

### 6.5 模型与密钥

- `ModelRuntime.create({ authPath: ~/.bukitjalil/pi/auth.json, modelsPath: ~/.bukitjalil/pi/models.json })`
- 设置面板支持：选择提供商和模型、填写 API Key（写入 `auth.json`，界面只显示末四位）、思考级别、"测试连接"
- 密钥永远不通过 API 返回给浏览器

### 6.6 待验证（M1 技术验证）

- [ ] `customTools` 和内联扩展的 `tool_call` 阻止在 SDK 1.5.0 里的确切写法
- [ ] 自定义 `ResourceLoader` 加载目录形式的技能
- [x] 会话文件放在自定义目录：已核对 1.5.0 类型定义，`SessionManager.create(cwd, sessionDir)`、`SessionManager.open(path, sessionDir, cwdOverride)`、`SessionManager.forkFrom(sourcePath, targetCwd, sessionDir)` 都支持；实际行为在 M1 跑通
- [ ] 工作副本切到新分支后，同一个会话文件继续使用是否正常（cwd 不变，但文件内容变了）；必要时用 `open()` 的 `cwdOverride` 固定工作目录
- [ ] `agent_settled`、`tool_execution_*` 事件字段，用于界面显示工具调用

---

## 7. 改动审核与版本

### 7.1 原则

网站目录的默认分支（`sites.default_branch`，下文简称 `main`）就是"正式版本"。AI 永远不直接改网站目录，只改工作副本；用户确认后才合入。

### 7.2 改动集流程

AI 工作副本在第一次需要时创建（`git worktree add ~/.bukitjalil/worktrees/<siteId>/ai --detach main`），之后一直复用。正式版本另有一个检出 `worktrees/<siteId>/main/`（`--detach`，每次构建前更新到 `main` 最新提交），两者互不干扰。

```text
           用户发消息（且没有 open 改动集）
                       │
                       ▼
   在工作副本里：git switch -f -C bj/change/<changeId> main && git clean -fd（不加 -x，保留被排除的缓存目录）
                       │
                       ▼
        AI 在工作副本里修改（可以多轮对话持续修改同一个改动集）
                       │
                       ▼
              每轮结束：计算 git diff <base>...工作副本
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
     应用            拒绝           继续对话
        │              │              │
  在工作副本提交      丢弃改动并 detach  回到 AI 修改
  main 快进合并      删除分支
  （main 已前进则     状态 rejected
   先 rebase，有冲突
   标记 stale）
  工作副本 git switch --detach
  （分支正被检出时 git 不允许删除）
  再删除分支，工作副本留着复用
  状态 applied
```

- 一个网站同一时间最多一个 `open` 改动集，多个会话共享它；配合"同一时间只有一个会话在运行"（6.1），不会出现两个 AI 同时改文件（M4 之后视情况放开）
- **排除规则**：创建工作副本时，在网站仓库的 `.git/info/exclude` 写入 `dist/`、`.bukit/`、`.cache/`、`.bukitjalil-build/`，保证 Bukit 的构建产物和缓存不会出现在差异里，也不需要改用户的 `.gitignore`
- **提交身份**：提交信息为 `summarize_changes` 的说明 + 会话 ID；作者固定为 `BukitJalil AI <ai@bukitjalil.local>`；提交者用网站仓库或全局的 git 身份，没有配置时使用设置页里填写的身份，首次启动引导里会要求填写（只写入 BukitJalil 设置，通过 `-c user.name/-c user.email` 传给 git，不改用户的 git 配置）
- 应用前自动跑一次 `bukit_check`；失败时允许用户坚持应用，但要明确提示
- **合入方式**：在网站目录里执行 `git merge --ff-only bj/change/<changeId>`。合入前检查两件事，任一不满足就拒绝并提示用户先处理，不覆盖任何东西：
  - 网站目录当前检出的分支就是 `sites.default_branch`（用户可能在 BukitJalil 外切到了别的分支，直接 merge 会合进错误的分支）
  - 网站目录没有未提交的改动（比如用户在 BukitJalil 外手动改过）

### 7.3 版本历史与恢复

- 历史 = `main` 的提交列表，每条显示说明、时间、改动文件数、关联会话
- 查看任意版本的差异
- 恢复 = 新建一个"恢复到 <版本>"的提交（`git revert` 或基于目标树的新提交），不改写历史

---

## 8. Bukit 集成

### 8.1 获取 Bukit

- 首次启动检查：设置里的自定义路径 → `~/.bukitjalil/bin/bukit-2.0.8/` → 系统 `PATH` 里的 `bukit`
- 都没有时，界面提示从 Bukit GitHub Release v2.0.8 下载对应平台的包（需用户确认），解压到 `~/.bukitjalil/bin/`
- 完整性校验：v2.0.8 的 Release 附带 `checksums.txt` 和 `checksums.json`（已核对）。BukitJalil 在代码里固定三个平台安装包的 SHA-256（开发时从 `checksums.txt` 核对后写入），下载后比对，不在运行时信任下载来的校验文件
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
- 退出码映射（已核对 Bukit CLI 文档）：0 成功、1 运行失败、2 参数/配置/内容错误、3 渲染错误
- `--log-format`：M1 技术验证时确认是否有 JSON 日志格式，有就用于结构化错误

### 8.3 使用的命令

| 场景 | 命令 |
| --- | --- |
| 配置检查 | `bukit config check --config site.yaml` |
| 诊断 | `bukit doctor --config site.yaml` |
| 配置结构 | `bukit config schema --output <tmp>.json` |
| 构建预览 | `bukit build --config site.yaml --output .bukitjalil-build/<buildId> --base-url /preview/<siteId>/<buildId>/ --no-clean`（只在 `worktrees/<siteId>/ai/` 或 `worktrees/<siteId>/main/` 里执行，不在用户的网站目录里执行） |
| SEO / GEO / 发布审计 | `bukit seo audit --dir <out>`、`bukit geo audit --dir <out>`、`bukit publish audit --dir <out>`（M4 以后） |
| 发布 | `bukit deploy`（M6） |

### 8.4 预览

- **输出目录的约束**（已核对 Bukit CLI 文档）：Bukit 的清理逻辑拒绝清理"当前项目以外的路径"和非空且没有输出标记的目录，构建时的清理也走同一套规则。所以不能直接把 `--output` 指向 `~/.bukitjalil/previews/` 并加 `--clean`
- **做法**：每次构建输出到项目内一个全新的空目录 `.bukitjalil-build/<buildId>/`（已在排除规则里），使用 `--no-clean`；构建成功后把目录整体移动到 `~/.bukitjalil/previews/<siteId>/<buildId>/`；失败也删除临时目录
- 改动集预览在 `worktrees/<siteId>/ai/` 里构建，正式版本预览在 `worktrees/<siteId>/main/` 里构建，都不在用户的网站目录里产生任何文件
- 由 BukitJalil 服务端在预览端口托管构建输出：`GET http://127.0.0.1:47881/preview/:siteId/:buildId/*`（同一个 Node 进程的第二个监听端口），不启动 `bukit preview` / `bukit dev`
- 构建时用 `--base-url` 设成预览路径，保证页面里的链接和资源路径正确（待验证：Bukit 生成的 URL 是否完全遵守 `--base-url`）
- 界面用 iframe 显示，可以切换"正式版本"和"当前改动集"两份预览
- 每个网站保留最近 10 次构建输出，旧的自动清理
- **预览与管理界面隔离**：预览页面的内容来自 AI 生成的网站，必须当作不可信内容。只限制 Cookie 的 `Path` 挡不住它——Cookie 是否携带看请求地址，同源页面里的脚本照样能带着 Cookie 调用 `/api`。所以：
  - 预览由服务端在**另一个端口**（默认 47881，只监听 127.0.0.1）提供，和管理界面不同源，浏览器的同源策略阻止它读写 `/api`
  - 预览的每个响应都带 `Content-Security-Policy: sandbox allow-scripts allow-popups`（**不给 `allow-forms`**），即使用户在新标签页直接打开，页面也运行在不透明来源里
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
- **SCSS 等编译选项**：M1 确认 `theme.scss` 是否调用外部程序；如果会，强制关闭或拒绝
- **环境变量**：默认只传最小环境（`PATH`、`HOME`、`LANG`）。`NOTION_TOKEN` 等密钥**只在用户手动构建正式版本或发布时**传入；改动集预览（还没审核的 AI 内容）不论谁触发都不传密钥

检查逻辑放在 `packages/server/src/bukit/guard.ts`，配一套单元测试（每个路径字段的越界用例、插件、网络开关）。

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
| GET | `/api/sites/:siteId/tree?ref=main\|change` | 目录树 |
| GET | `/api/sites/:siteId/file?path=&ref=` | 文件内容（文本 / 二进制流） |
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
| POST | `/api/changes/:changeId/apply` | 应用 |
| POST | `/api/changes/:changeId/reject` | 拒绝 |
| GET | `/api/sites/:siteId/history` | 版本历史 |
| GET | `/api/sites/:siteId/history/:commit/diff` | 某个版本的差异 |
| POST | `/api/sites/:siteId/history/:commit/restore` | 恢复到某个版本 |
| POST | `/api/sites/:siteId/builds` | 触发构建（`ref`: `main` / `change`） |
| GET | `/api/sites/:siteId/builds` | 构建记录 |
| GET | `/api/settings` / PUT `/api/settings` | 全局设置 |
| GET | `/api/models` | 可用模型 |
| PUT | `/api/providers/:provider/key` | 保存 API Key |
| POST | `/api/providers/:provider/test` | 测试连接 |
| GET | `/api/health` | 健康检查：Bukit、git、Pi 是否可用 |

### 9.2 SSE 事件

`GET /api/sites/:siteId/events` 每个打开的网站一条连接，事件格式 `{ type, sessionId?, changeId?, data }`：

| 事件 | 来源 | 界面用途 |
| --- | --- | --- |
| `session.status` | 会话启动、运行、空闲、出错 | 侧栏状态点 |
| `message.delta` | Pi `message_update`（text_delta） | 流式文字 |
| `message.end` | Pi `message_end` | 落定消息 |
| `tool.start` / `tool.update` / `tool.end` | Pi `tool_execution_*` | 工具调用卡片 |
| `run.settled` | Pi `agent_settled` | 结束加载状态 |
| `change.updated` | 改动集文件变化 | 刷新改动面板和文件树 |
| `change.ready` | 一轮结束且有改动 | 显示审核卡片 |
| `change.resolved` | 应用 / 拒绝 | 关闭审核卡片，刷新历史 |
| `build.start` / `build.end` | Bukit 构建 | 预览面板状态 |

断线重连：带 `Last-Event-ID`，服务端为每个网站保留最近 500 条事件。

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
| 密钥泄露 | 密钥只存在 `~/.bukitjalil/pi/auth.json`（600 权限），不进数据库、不进日志、不返回浏览器；Notion Token 只通过环境变量传给 Bukit |
| 预览页面脚本（AI 写的 JS） | 预览在另一个端口提供（不同源）+ 响应头 `CSP: sandbox`（不含 `allow-forms`）+ iframe `sandbox`（见 8.4） |
| 跨站请求（预览页或其他网页向 API 发表单、图片请求等） | Cookie 不按端口隔离，所以 API 自己防护：① 所有非 GET 请求的 `Origin` 必须**完全等于**管理界面地址（`http://127.0.0.1:47880`），缺失或为 `null` 一律拒绝；② 非 GET 请求必须是 `Content-Type: application/json` 并带自定义请求头 `X-BukitJalil: 1`（普通表单发不出这种请求，跨源时会触发预检，而服务端不允许任何跨源预检）；③ 所有 GET 接口都没有副作用；④ 服务端不返回任何 `Access-Control-Allow-*` 头 |
| AI 读取密钥或系统文件 | 读类工具同样受路径闸门限制，只能访问工作副本（见 6.3） |
| AI 借 Bukit 插件 / 编译选项间接执行代码 | 所有构建前检查插件和编译选项，AI 不能写 `plugins/**`（见 6.3、8.5） |
| AI 借 `site.yaml` 路径字段或远程素材读取工作副本外的文件、访问内网 | 所有构建前校验路径字段必须在检出目录内，强制 `blockPrivateNetworks: true`（见 8.5） |
| 密钥进入未审核内容的构建 | 只有用户手动构建正式版本或发布时才传密钥（见 8.5） |
| 提示词注入（网站内容里夹带指令） | AI 能力本身受限；所有改动必须人工审核 |

---

## 12. 测试策略

| 层级 | 工具 | 覆盖 |
| --- | --- | --- |
| 单元 | Vitest | `shared` 的 schema；`server` 的路径闸门（读写工具、glob 参数）、构建前安全检查 `bukit/guard.ts`（插件、每个路径字段、网络开关、环境变量）、防跨站请求中间件、`site.yaml` 解析、差异解析、Bukit 退出码映射 |
| 服务端集成 | Vitest + 临时目录 | 真实 git：创建网站、工作树、应用 / 拒绝 / 恢复；Bukit 用假程序（脚本模拟输出和退出码） |
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
- **CI**（GitHub Actions）：`pnpm install --frozen-lockfile` → `biome check` → `tsc --noEmit` → `vitest run` → `playwright test`；macOS 和 Linux 各跑一遍
- **日志**：服务端结构化日志（JSON 行），写到 `~/.bukitjalil/logs/`，不记录消息正文和密钥
- **文档**：每个里程碑更新 README 的状态说明；重要设计变更在 `docs/decisions/` 记录

---

## 14. 实施计划

估算按一名开发者（配合 AI 编程）计，单位为工作日，含测试。总计约 **28–36 个工作日**完成 MVP（M0–M5），不含 M6、M7。两轮评审新增的安全工作（防跨站请求、预览隔离、构建前检查、路径校验）已计入 M0–M3。

### M0 工程骨架（3–4 天）

| 任务 | 产出 |
| --- | --- |
| pnpm workspace、三个包、tsconfig、Biome | 能 `pnpm install`、`pnpm check` |
| server：Hono 启动、`/api/health`、静态托管 web | `pnpm dev` 打开页面 |
| web：Vite + React + Tailwind + shadcn 初始化，三栏空布局 | 可拖动三栏 |
| 安全基础：127.0.0.1、Host 校验、token Cookie、防跨站请求（Origin 完全匹配、JSON + 自定义头、无 CORS，见 11 节）、预览端口骨架（CSP sandbox） | 外部来源和跨端口表单请求被拒 |
| SQLite 与迁移机制 | `app.db` 自动创建 |
| 确认 TypeScript 7.0.2 与 Vite、Vitest、Biome、shadcn 兼容 | 不兼容则退回 TypeScript 6 并更新本文 |
| CI 工作流 | PR 自动检查 |

**验收**：`pnpm dev` 打开三栏空界面；`/api/health` 报告 git 可用；CI 通过。

### M1 技术验证（3–4 天）

在 `packages/server/spikes/` 写最小验证脚本，逐项确认 6.6 和 8.2、8.4 的待验证项：

- Pi SDK：自定义 agentDir、ResourceLoader 加载技能、自定义工具、`tool_call` 阻止、会话文件路径、分叉、事件字段、假模型提供商
- Bukit：在 macOS 上运行 2.0.8；`--output` 指向项目内新空目录 + `--no-clean` 能正常构建；`--base-url` 预览路径；`--log-format` 选项；`config schema` 输出；用 `checksums.txt` 核对三个平台安装包
- Bukit 安全面（8.5）：Core 内置插件清单；是否加载项目内的外部插件、插件清单的文件名约定、插件能否启动进程；`site.yaml` 每个路径字段对绝对路径、`..`、符号链接的处理（从 `bukit config schema` 整理完整字段清单）；`theme.scss` 是否调用外部程序；`content.media` 的联网行为和 `blockPrivateNetworks`
- 预览隔离与防跨站：第二端口 + `CSP: sandbox`（无 `allow-forms`）下，预览页的脚本、表单、图片请求都无法让管理端 API 产生副作用（写恶意测试页验证）
- git：同一仓库两个固定工作树（`ai/`、`main/`）的创建、重置、复用；`.git/info/exclude` 对工作树生效

**验收**：每一项都有可运行的脚本和结论，更新本文档"待验证"清单；如有不可行项，在进入 M2 前调整设计。

### M2 网站项目与只读面板（6–8 天）

| 任务 | 产出 |
| --- | --- |
| Bukit 程序检测、下载（需确认）、版本检查 | 设置页显示 Bukit 状态 |
| starter 模板：从 Bukit 源码复制 StarterTheme，补 `theme.yaml`、最小 `site.yaml` 和示例内容，用真实 Bukit 构建通过 | `templates/starter/` |
| 构建前安全检查 `bukit/guard.ts`（插件、路径字段、网络、环境变量，见 8.5）+ 单元测试 | 检查模块 |
| 新建网站、导入网站、网站列表、归档 | 侧栏网站列表 |
| 文件树和文件预览（Shiki、Markdown、图片、PDF） | 文件面板 |
| 配置面板（结构化 + 原文） | 配置面板 |
| 主题面板、数据面板（Markdown 集合、data 源、Notion 源只显示配置） | 主题、数据面板 |
| 构建（main）与预览托管（独立预览端口 + CSP sandbox） | 预览面板 |

**验收**：能新建一个网站并构建预览；能导入一个已有 Bukit 网站；六个面板中除"改动"外都能正常显示；全程没有编辑入口。

### M3 AI 会话（7–9 天）

| 任务 | 产出 |
| --- | --- |
| agent 模块：会话管理、ResourceLoader、系统提示、模型运行时 | 能创建 AgentSession |
| 建站工具：`site_info`、`bukit_check`、`bukit_build`、`bukit_schema`、`list_content`、`summarize_changes` | 自定义工具 |
| 权限闸门 + 单元测试（读写工具都覆盖；含绝对路径、符号链接、`..`、`.git`、新建深层目录等用例） | 闸门测试全过 |
| `bukit_check` / `bukit_build` 接入 M2 的构建前检查，改动集构建不传密钥（见 8.5） | AI 构建受检查 |
| 技能打包：同步 Bukit 官方技能，编写 BukitJalil 技能 | `skills/` |
| SSE 事件流、断线重连 | 事件接口 |
| 界面：会话列表、消息流、流式输出、工具卡片、停止、steer / followUp | 对话界面 |
| 会话恢复、重命名、删除、分叉 | 会话管理 |
| 设置：模型选择、API Key、测试连接 | 设置页 |

**验收**：用真实模型说"把首页标题改成 X，并加一个 FAQ 页面"，AI 只在工作副本里修改并通过检查；尝试让 AI 读或改工作副本以外的文件（包括 `~/.bukitjalil/pi/auth.json`）会被阻止；在 `site.yaml` 里加入非内置插件后 AI 的构建会被拒绝；刷新页面后会话可以恢复。

### M4 改动审核与版本（5–6 天）

| 任务 | 产出 |
| --- | --- |
| 改动集：工作树创建、差异计算、状态管理 | changes 模块 |
| 审核卡片、改动面板（文件列表 + 差异视图） | 审核界面 |
| 应用（含检查、rebase、冲突处理）、拒绝 | 应用 / 拒绝 |
| 改动集预览构建，预览面板切换"正式 / 改动中" | 双预览 |
| 版本历史、版本差异、恢复 | 历史面板 |
| SEO / GEO 审计结果显示在构建记录里 | 构建详情 |

**验收**：完整走通"对话 → 审核 → 应用 → 正式预览更新"；拒绝后网站目录不变；恢复到旧版本后预览回到旧内容；`main` 历史清晰可读。

### M5 打磨与 MVP 发布（4–5 天）

- 端到端测试全流程（假模型）、真实 Bukit 构建测试
- 错误处理：Bukit 失败、模型报错、网络中断、磁盘写入失败的界面提示
- 首次启动引导：检测 Bukit → 配置模型 → 新建第一个网站
- 暗色模式、窄屏、键盘操作（发送、停止、切换面板）
- 文档：README 状态更新、用户使用说明 `docs/user-guide.md`
- 真实模型验收：从零做一个"专业服务公司双语官网"

**验收**：新机器上按 README 安装后 10 分钟内完成第一个网站并预览；CI 全绿；真实模型验收记录归档到 `docs/acceptance/`。

### M6 发布到 GitHub Pages（3–4 天，MVP 之后）

- 部署设置：仓库、分支（写入 `site.yaml` 的 `deploy`，通过 AI 或设置向导生成改动集，同样走审核）
- 发布前检查：`config check`、`doctor`、`build --clean`、`publish audit`
- 调用 `bukit deploy`，显示进度和结果；发布记录

### M7 桌面版（4–5 天，MVP 之后）

- Electron 45 壳：主进程启动 server，窗口加载本地页面
- 应用数据目录、Bukit 程序随包或首启下载
- macOS 签名与公证、自动更新（视需要）

### 里程碑总览

```text
M0 骨架 ─► M1 技术验证 ─► M2 网站与面板 ─► M3 AI 会话 ─► M4 审核与版本 ─► M5 MVP
 3–4d        3–4d           6–8d            7–9d          5–6d            4–5d
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
| `--base-url` 预览路径不完全生效 | 预览里资源 404 | M1 验证；不行就退回为每次预览启动 `bukit preview` 端口 |
| TypeScript 7 与工具链不兼容 | 类型检查或编辑器支持出问题 | M0 验证；退回 TypeScript 6 |
| 同一网站多个会话争用工作副本 | 改动互相覆盖 | 同一网站同一时间只运行一个会话，其他排队（6.1） |
| AI 改动质量不稳定 | 用户频繁拒绝 | 技能里要求先检查再构建；审核卡片显示检查结果；支持继续对话修正同一个改动集 |
| 模型费用 | 成本不可控 | 显示每个会话的 token 和费用（Pi 事件里有用量）；可选较便宜的模型 |
| 工作树与 `main` 分叉冲突 | 应用失败 | 同一网站只允许一个 open 改动集；冲突时标记 stale，让 AI 基于新版本重做 |

---

## 16. 待定问题

1. **网站默认存放位置**：`~/BukitJalil Sites/` 还是让用户每次选？（当前设计：默认目录 + 可改）
2. **素材上传**：图片等二进制文件 AI 不能写，用户怎么加素材？建议 M5 加"上传到 `content/media`"的受控入口——这是唯一的用户直接写入，需要确认是否接受
3. **Notion 数据源**：MVP 只显示配置；是否需要在 BukitJalil 里管理 Notion Token 并预览 Notion 数据？
4. **多会话并发改同一网站**：MVP 限制一个 open 改动集，是否够用？
5. **界面语言**：MVP 只做中文，还是中英双语？
6. **starter 主题来源**：直接用 Bukit 仓库里的 starter 主题，还是 BukitJalil 自己维护一套更好看的默认主题？
