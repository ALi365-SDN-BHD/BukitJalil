# BukitJalil 开发方案与实施计划

> 版本：v2.37（2026-11-13，新增 10.4 SEO / GEO 报告面板：右侧单独的标签页，完整问题清单、按页面筛选、和上一次构建对比，"让 AI 修"开一个新对话；v2.36：2026-11-13，新增 7.5 部分应用的设计：没选中的部分留在改动集里，按文件和代码块选；v2.35：2026-11-13，Bukit 行为测试：`test/bukit-behavior.test.ts` 每次推送用内置版本跑，`bukit-latest.yml` 每天用最新正式版跑；v2.34：2026-11-13，补上"工作副本已重置"说明和按差异生成的提交说明；v2.33：2026-11-13，预览改用网站真实的 baseUrl：构建传校验过的 `--base-url`，预览服务挂在这个前缀下；v2.32：2026-11-13，定下待定问题 7、8、10：Bukit 继续装最新版，加最低版本和 CI 行为测试；部署设置继续直接提交，预览改用网站真实的 baseUrl；两项未实现的功能补上；v2.31：2026-11-13，Notion 网站可以发布；绑定了数据源的 Notion 网站带 token 跑 `config check`，新建后自动构建；应用 Notion 网站的改动不再要求强制；源名称改用下划线；v2.30：2026-11-13，Notion token 只来自网站绑定的数据源，去掉"只有一个数据源就自动用"的兜底，数据面板可以绑定和解绑；v2.29：2026-11-12，按代码全面审计后修订：token 改为发布账号和数据源保存、Bukit 2.0.15 和最新版安装、部署设置直接提交、接口表和 SSE 事件补全、数据库表和目录布局补全、技能清单、设置页和 OAuth、构建前检查和安全头的实际规则、M7 之后的安装包；新增待定问题 7–11；v2.28：M7 设计和拆层；v2.27：M6 拆层并写入 Bukit 2.0.12 发布实测；v2.26：写入 M0–M5 收尾审计；v2.25：写入 M5 第 6 层实现说明和 M5 结果：真实模型验收；v2.24：写入 M4 第 7 层实现说明：SEO / GEO 审计结果；v2.23：Bukit 升到 2.0.12；v2.22：写入 M5 第 5 层实现说明：使用说明和安装步骤核对；v2.21：写入 M5 第 4 层实现说明：CI 用真实 Bukit；v2.20：写入 M5 第 1–3 层实现说明；v2.19：M5 拆层；v2.18：写入 M4 第 8 层和 M4 结果；v2.17：写入 M4 第 6 层实现说明：版本历史与恢复；v2.16：写入 M4 第 1–5 层实现说明；v2.13：M4 拆层；v2.12：写入 M3 第 8 层和 M3 结果；v2.11：写入 M3 第 7 层实现说明：模型设置；v2.10：写入 M3 第 6 层实现说明：对话界面；v2.9：写入 M3 第 5 层实现说明：会话 API 和 SSE 事件流；v2.8：写入 M3 第 4 层实现说明：建站工具和技能打包；v2.7：写入 M3 第 3 层实现说明：rg 安装和校验；v2.6：写入 M3 第 2 层实现说明：权限闸门和 6 个内置工具；v2.5：Pi SDK 升到 1.5.1 并写入核对结果，M3 拆层，写入 M3 第 1 层实现说明；v2.4：M2 完成并写入结果；v2.3 起：2026-11-09，已按评审、八轮审计和一次最高强度代码审查修改，写入第一批 M1 验证结果，Bukit 升级到 2.0.11，写入第二批 M1 验证结果，定 rg 版本，核对 deploy 的 git 调用、三个平台的 Bukit 安装包，三种浏览器里验证预览隔离；确认界面多语言、网站位置由用户选择） · 分支：`pi-harness-ui` · 状态：已确认（2026-11-09）
>
> 本文是 BukitJalil 新实现的设计依据。产品定位见 [README](../README.md)。文中"已核对"的内容来自 Pi 文档（本机 1.4.0）和 Pi SDK 1.5.0 的类型定义与更新日志、npm 仓库、Bukit 仓库 v2.0.11（部分结论最初核对于 v2.0.8，两版之间相关代码的差异已逐项核对，见 8.1）的文档、源码目录和发布页；"待验证"的内容需要在对应里程碑的技术验证里确认。代码现在用 Pi SDK 1.5.2、Bukit 2.0.15，从 1.5.1 和 2.0.12 升级时的核对结论本文没有记录。

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
| 平台：macOS（Apple Silicon）和 Linux x64，CI 覆盖这两个平台 | Windows（M7 之后补了 NSIS 安装包和 CI 里不阻塞的打包冒烟测试，仍是预览状态，见 M7；设计上已避免依赖 `/dev/null` 等 Unix 专属路径） |
| 新建网站（基于从 Bukit 源码复制的 starter 主题）、导入已有 Bukit 网站 | 克隆其他网站、HTML 导入（Bukit 也未支持）；Bukit 外部插件（用了它们的网站只能只读导入，见 5.1） |
| 每个网站多个 AI 会话：对话、流式输出、恢复、分叉 | 子代理、计划模式 |
| 只读面板：文件、配置、主题、数据、改动、预览 | 可视化编辑器、直接改文件 |
| 改动审核：差异、应用、拒绝、版本历史、恢复 | 按代码块部分应用（放到后续版本） |
| Bukit 构建、检查、预览 | 自建主题市场、远程主题 |
| 模型和 API Key 设置 | 计费、用量统计面板 |

### 1.3 后续版本

- **M6 发布**（已完成）：GitHub Pages（Bukit 原生支持 `bukit deploy`）；之后改为"发布账号"管理 token（见 6.5、M6）
- **M7 桌面版**（已完成）：Electron 壳；之后补了 Windows / Linux 安装包和自定义图标（见 M7）
- M7 之后已做：Notion 数据源管理（按数据源保存 token，见 6.5）、OAuth 模型登录、自定义模型、设置页（替代设置对话框）
- 待做（见 AGENTS.md）：按代码块部分应用、SEO/GEO 报告面板、Cloudflare Pages 和自有服务器发布、素材上传（设计见 [plans/2026-11-12-media-upload-design.md](plans/2026-11-12-media-upload-design.md)）

---

## 2. 固定技术栈

版本为 2026-11-09 在 npm 仓库查到的最新稳定版。`package.json` 一律写精确版本（不带 `^`），配合锁文件；升级走单独的提交。

### 2.1 运行环境

| 项 | 固定版本 | 说明 |
| --- | --- | --- |
| Node.js | **24 LTS**（`engines: ">=22.19.0"`） | Pi SDK 要求 ≥ 22.19。开发统一用 24 LTS；Node 22 在 2027-04-30 停止维护，本机现在是 22.22.3，可以运行但建议升级 |
| pnpm | **12.18.0** | 写进根 `package.json` 的 `packageManager` 字段，由 corepack 自动使用（本机是 10.5.0，执行 `corepack enable` 即可） |
| TypeScript | **7.0.2** | 只用来做类型检查（`tsc --noEmit`），打包和运行由 Vite / tsx 负责。TypeScript 7 是 Go 重写的版本，部分旧 tsconfig 选项已移除。**M0 已确认**与 Vite 8、Vitest 5、Biome、shadcn 配合正常；唯一要改的是 `baseUrl` 已被移除，路径别名直接写 `paths` |
| Bukit | **2.0.15**（内置兜底版本；安装时取 GitHub 上的最新正式版，最低 2.0.11，见 8.1） | .NET Native AOT 单文件程序，官方提供 osx-arm64、linux-x64、win-x64（没有 Intel Mac 版，见 8.1） |

### 2.2 服务端（`packages/server`）

| 包 | 版本 | 用途 |
| --- | --- | --- |
| `@earendil-works/pi-coding-agent` | 1.5.2 | Pi SDK：会话、工具、技能、模型（M3 开始时从 1.5.0 升到 1.5.1，差异见 6.1 末尾；之后升到 1.5.2） |
| `@earendil-works/pi-ai` | 1.5.2 | 模型目录与提供商（随 SDK） |
| `@earendil-works/pi-agent-core` | 1.5.2 | Agent 核心（随 SDK，不直接依赖） |
| `fflate` | 0.8.3 | 解压 Windows 版 Bukit 的 zip 安装包（`bukit/install.ts`）。注意：`package.json` 现在写的是 `^0.8.3`，不符合本节"精确版本"的规定，应改成 `0.8.3` |
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
| `react-router` | 8.5.1 | 路由：`/sites/:siteId/sessions/:sessionId` |
| `react-resizable-panels` | 4.21.0 | 三栏可拖动布局 |
| `shiki` | 4.6.0 | 只读代码高亮 |
| `react-markdown` / `remark-gfm` | 10.1.0 / 4.0.1 | Markdown 预览、AI 消息渲染（表格、删除线等 GFM 语法） |
| `get-nonce` | 1.0.1 | 把 CSP nonce 交给 Radix 运行时插入的样式（见 11） |
| `@types/react` / `@types/react-dom` | 19.3.0 | React 类型 |
| `radix-ui` / `class-variance-authority` / `cn` / `tw-animate-css` | 1.8.1 / 0.7.1 / 0.5.2 / 1.4.0 | shadcn 初始化时加入的组件依赖（M0）；`cn` 是 shadcn 官方维护的类名合并包，替代 clsx + tailwind-merge |

### 2.4 工具链

| 包 | 版本 | 用途 |
| --- | --- | --- |
| `vitest` | 5.1.0 | 单元测试、服务端集成测试 |
| `@playwright/test` | 1.65.0 | 端到端测试 |
| `@biomejs/biome` | 2.6.6 | 代码格式化和检查（替代 ESLint + Prettier） |
| `@types/node` | 24.19.2 | Node 类型，与 Node 24 对齐 |
| `electron` | 45.2.3 | M7 桌面版（`packages/desktop`） |
| `esbuild` | 0.28.2 | 桌面版打包时把 server 和桌面壳打成单个模块 |
| `@electron/packager` / `electron-builder` | 20.3.0 / 26.18.1 | 桌面版应用打包和安装包（dmg、zip、NSIS、AppImage、deb） |

> 改动差异由界面自己的 `FileDiffView` 渲染统一差异文本，没有引入 `react-diff-view` / `diff`；界面本地状态用 React 状态和 TanStack Query，没有引入 `zustand`。这两项早期计划里列过，实际没用。

---

## 3. 总体架构

### 3.1 进程与模块

```text
浏览器（packages/web）
  │  REST（JSON）  +  SSE（会话事件、构建事件）
  ▼
本地服务（packages/server，Hono；管理界面与 API 127.0.0.1:47880，预览 127.0.0.1:47881 起的端口池）
  ├─ api/            路由、请求校验、SSE
  ├─ security/       管理端口的 token Cookie、防跨站校验、安全响应头（11）
  ├─ sites/          网站项目：创建、导入、网站锁、排除规则
  ├─ panels/         只读面板：文件、配置、主题、数据
  ├─ agent/          Pi SDK：会话管理、建站工具、权限闸门、技能加载、模型和自定义模型
  ├─ changes/        改动集：工作树、差异、审核指纹、应用、拒绝、历史、恢复
  ├─ git/            唯一的 git 调用入口：固定加固参数、最小环境变量、仓库配置检查（7.3）；全局身份读取（identity.ts）
  ├─ bukit/          Bukit 程序安装、查找与调用，构建前安全检查（8.5）
  ├─ builds/         构建记录、构建与 SEO/GEO 审计
  ├─ preview/        构建结果的静态托管（每份预览一个独立端口，CSP sandbox）
  ├─ deploys/        发布到 GitHub Pages（M6）
  ├─ publish/        发布账号和它们的 GitHub token（6.5）
  ├─ data-sources/   Notion 数据源和它们的 token（6.5）
  ├─ events/         SSE 事件总线
  └─ store/          SQLite（系统数据）、设置
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
│   ├── web/                # 依赖 shared；只通过 HTTP/SSE 访问 server
│   └── desktop/            # M7 Electron 壳：启动 server 子进程、加载 web；不 import server 或 web 的源码
├── skills/                 # 随应用发布的建站技能（见 6.4）
├── templates/              # 新建网站用的初始模板
├── scripts/                # 下载 Bukit、开发辅助脚本
├── e2e/                    # Playwright 测试
└── docs/
```

规则：`web` 不能 import `server`；`shared` 不能 import 任何运行时专属模块。用 Biome 的 `noRestrictedImports` 规则强制。

### 3.3 运行方式

- 开发：`pnpm dev` 同时启动 server（tsx watch）和 web（Vite，代理 `/api` 到 server）；开发脚本启动 Vite 时只传白名单里的环境变量，Vite 进程拿不到模型密钥等任何密钥
  - Vite 固定监听 `127.0.0.1:47890`（`strictPort: true`，端口被占用直接报错，不会悄悄换端口）
  - 浏览器里的页面来自 Vite，代理转发的请求 `Origin` 是 `http://127.0.0.1:47890`。所以 server 以 `--dev-origin http://127.0.0.1:47890` 启动时（只有 `pnpm dev` 会传，`pnpm start` 不接受这个参数），防跨站校验允许的 Origin 换成这个地址，`Host` 校验同时接受 Vite 转发的 `127.0.0.1:47880`
  - token 打开流程同样走 Vite：打印 `http://127.0.0.1:47890/?token=…`，Vite 开发配置把带 `token` 参数的首页请求代理给 server，和生产一样校验后设置 Cookie 并重定向；Cookie 按主机 `127.0.0.1` 生效、不区分端口，之后经 Vite 代理的 `/api` 请求都会带上它。开发时在终端按回车，tsx watch 会重启 server 并打印新的登录地址（重启后旧会话失效）
  - Vite 开发服务器和管理端口遵守同样的规则：关闭 Vite 自带的 CORS（`server.cors: false`，跨源预检转给 server，由 server 拒绝），响应带 `X-Frame-Options: DENY` 和 `frame-ancestors 'none'`，预览页不能嵌入开发界面；Vite 进程只拿到白名单里的环境变量（`PATH`、`HOME`、`LANG` 等，名字像密钥的一律去掉）
- 生产：`pnpm build` 后 server 直接托管 web 的静态文件，一个 Node 进程监听管理端口 47880，预览端口按需从 47881 起分配（见 8.4），`pnpm start` 启动并打开浏览器
- 默认端口：管理界面和 API 用 47880，被占用时报错并提示 `--port`；预览端口池从 47881 开始（和管理界面隔离，见 8.4），起点可用 `--preview-port-base` 改，池里的端口被占用时跳到下一个可用端口，不报错

---

## 4. 数据与存储

### 4.1 目录布局

```text
~/.bukitjalil/                      # 应用数据目录（可用 BUKITJALIL_HOME 覆盖）
├── app.db                          # SQLite：网站列表、会话索引、改动集、构建记录、设置（不含密钥）
├── publish-account-tokens.json     # 每个发布账号的 GitHub token（0600，见 6.5）
├── data-source-tokens.json         # 每个 Notion 数据源的 token（0600，见 6.5）
├── server.lock                     # 同一数据目录只允许一个 server 运行
├── logs/server.log                 # 服务端日志（不含密钥）
├── tmp/                            # 临时文件；tmp/bukit/ 是 Bukit 子进程的 TMPDIR
├── bin/bukit-<版本>/               # 应用管理的 Bukit：bukit 和 libSkiaSharp.dylib 等随包文件（见 8.1）
├── empty-gitconfig                 # 空文件，git 调用的全局配置和属性文件都指向它（见 7.3）
├── empty-hooks/                    # 空目录，git 的 core.hooksPath 指向它（见 7.3）
├── pi/                             # 给 Pi 用的独立目录（agentDir + PI_CODING_AGENT_DIR），不读用户 ~/.pi
│   ├── auth.json                   # 模型 API Key / OAuth（权限 600）
│   ├── models.json
│   ├── custom-models.json          # 用户添加的自定义模型和它们的密钥（0600）
│   └── bin/                        # BukitJalil 安装的固定版本 rg（见 6.3）
├── sessions/<siteId>/*.jsonl       # Pi 会话文件
├── worktrees/<siteId>/
│   ├── ai/                         # AI 工作副本（git worktree），路径固定、反复复用
│   └── main/                       # 正式版本的只读检出，只用于构建正式预览
└── previews/<siteId>/<buildId>/    # 构建输出（从工作副本内的临时输出目录搬过来，见 8.4）

<用户选择的位置>/<网站目录>/          # 网站项目本身，位置每次由用户选择（见 5.2），没有默认目录
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
| `sites` | `id`, `name`, `path`, `default_branch`, `created_at`, `last_opened_at`, `archived`；`read_only_reasons`, `checked_commit`, `config_check`（002）；`notion_data_source_id`（006）；`publish_account_id`（007） | 网站列表；`path` 是网站目录绝对路径；`default_branch` 是网站的正式分支（新建为 `main`，导入时读取当前默认分支）；后加的列记录安全检查结果、选用的 Notion 数据源和发布账号 |
| `sessions` | `id`, `site_id`, `pi_session_file`, `title`, `created_at`, `updated_at`, `status` | 会话索引；正文在 Pi 的 JSONL 里 |
| `change_sets` | `id`, `site_id`, `created_by_session_id`, `base_commit`, `snapshot_commit`, `status`, `summary`, `created_at`, `resolved_at`, `result_commit`；`restore_commit`（003）；`ai_joined`（005） | 改动集；`restore_commit` 标出恢复类改动集（7.4），`ai_joined` 表示有会话参与过，决定提交作者（7.2），状态：`open` / `applied` / `rejected` / `stale`；`base_commit` 是当前基于的正式版本，main 前进并重新合并后会更新；`snapshot_commit` 是最近一次快照（见 7.2）；"待审核"不单独存，由"open + 没有会话在运行 + 快照树 ≠ base 树"推出 |
| `change_set_sessions` | `change_set_id`, `session_id`, `first_turn_at` | 参与过这个改动集的所有会话（多个会话可以共用一个改动集） |
| `builds` | `id`, `site_id`, `change_set_id`, `commit`, `kind`, `status`, `exit_code`, `output_dir`, `report_json`, `started_at`, `finished_at` | 构建记录；`kind`：`check` / `doctor` / `build` |
| `deploys` | `id`, `site_id`, `commit`, `repo`, `branch`, `url`, `status`, `step`, `outcome`, `report_json`, `started_at`, `finished_at` | 发布记录（004，M6） |
| `data_sources` | `id`, `name`, `platform`, `config_json`, `created_at` | 保存的 Notion 数据源（006；008 删掉了非 Notion 的行）；token 不在表里，在 `data-source-tokens.json` |
| `publish_accounts` | `id`, `name`, `platform`, `created_at` | 发布账号（007，目前只有 `github`）；token 在 `publish-account-tokens.json` |
| `settings` | `key`, `value_json` | 全局设置：默认模型、思考级别、提交身份 `commitName` / `commitEmail`、上次选择的父目录、关闭的技能 `disabledSkills` 等（不含密钥） |
| `schema_migrations` | `version`, `applied_at` | 数据库迁移；009 曾建过旧 token 迁移表，迁移删除后只剩 `DROP TABLE IF EXISTS`，占住编号避免新迁移被跳过 |

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
> 限制：使用 Notion 数据源的网站，Bukit 的 `config check`、`doctor`、`build` 在没有 `NOTION_TOKEN` 时直接报错（已核对 2.0.8 和 2.0.11 源码 `ProviderValidators.cs`、`DoctorCommand.cs`），而未审核内容的构建按 8.5 不传密钥。所以这类网站的 AI 检查、AI 构建和改动集预览在 MVP 里不可用：`bukit_check` / `bukit_build` 直接返回"此网站使用 Notion 数据源，AI 构建不可用"，不调用 Bukit，避免 AI 反复处理它修不了的错误；正式版本的构建传 token。（M7 之后：token 按 Notion 数据源保存，网站在 `sites.notion_data_source_id` 里选用一个数据源；正式版本的每次构建都会传这个 token，包括用户点"应用"后的自动重建——应用本身是用户操作。见 6.5。）M1 已确认不行：Notion 源有 `cacheMode: readonly`，但 Bukit 在读取缓存模式之前就要求 token（源码 `ContentProviderFactory.cs`），2.0.8 和 2.0.11 实测 `cacheMode: readonly` 且没有 token 时 check / doctor / build 仍分别返回 1 / 1 / 2。

### 5.2 新建网站

1. 用户在界面填写：网站名、目录位置、主语言；可选：选一个已保存的 Notion 数据源（`dataSourceIds`，最多 1 个）和 Notion 数据库 ID（`notionDatabaseId`），用于从 Notion 读取内容
   - **目录位置每次由用户选择**，没有默认目录。浏览器拿不到本机文件夹的绝对路径（File System Access API 只给句柄），所以用服务端提供的目录选择器：`GET /api/fs/dirs?path=` 只返回某个目录下一层的子目录名（不返回文件，不跟随符号链接，隐藏目录默认不显示），从主目录开始逐级打开；也可以直接粘贴绝对路径。上次选择的父目录记在设置里，作为下次的起点
   - 新网站的目标目录必须不存在或为空；不能位于 `~/.bukitjalil/` 内、不能是主目录或根目录本身，也不能在另一个已登记网站的目录里。导入网站用同一个选择器
   - M7 桌面版改用系统原生的文件夹选择对话框
2. 服务端把 `templates/starter/` 复制到目标目录（包含 `site.yaml`、`content/`、`themes/starter/`）。Bukit 没有"生成初始网站"的命令，官方 starter 主题只以资源文件形式嵌在 CLI 源码里（`src/Bukit-Core/Bukit.Cli/Resources/StarterTheme/`，MIT 协议）。BukitJalil 从 v2.0.11 复制这些模板，补上 `theme.yaml` 和最小内容，作为自己维护的模板，并记录来源 commit。M1 的 `make-starter.sh` 是这一步的草稿，已用真实 Bukit 构建通过。注意：模板里的占位符是 `{{-- bukit:name --}}`；不能照搬 Bukit Labs 的博客模板——它和 Core 2.0.11 有出入（`archive` 必须是布尔值，发布时间读 `publishAt` 而不是 `date`）；starter 的标签索引页用了 `{{ term.url }}` 这类手写根路径，配合 8.4 的 `--base-url /` 才正确。M2 已实现：`scripts/make-starter.sh` 生成 `templates/starter/`，来源记录在 `templates/starter.source.json`；草稿里文章和页面共用一个数据源，源级别的 `collection: post` 会把页面也当成文章，正式模板拆成 `content/posts`、`content/pages` 两个源；分享图改为 1200×630 的 PNG；页头的站名占位符留空（草稿填了固定的 "starter"），主题里输出站名、标题的地方由脚本加上 `html.escape`；示例文章用相对链接，部署到 GitHub Pages 项目地址也能用；模板不写 `site.url`，避免每个网站都把 canonical、站点地图指向占位域名——Bukit 会提示"需要 site.url"，由用户在设置或发布前填写。`starter.source.json` 记录每个文件的 SHA-256，测试发现手改模板就失败。真实 Bukit 2.0.11 下 check、doctor、build 都通过
3. 用表单值替换 `site.name`、`site.title`、`site.language`
4. `git init -b main`（git 不读全局配置后，`init.defaultBranch` 不生效，不写 `-b` 会得到 `master`）、写入排除规则、首次提交 "Initial site from BukitJalil starter"；提交需要设置页里的身份（7.2），没有填写时先引导填写
5. 对首次提交跑构建前安全检查（8.5），再创建 `worktrees/<siteId>/main/` 检出并执行 `bukit config check` 和预览构建（8.3），确认可以构建；不在用户的网站目录里调用 Bukit，网站目录不会出现 `dist/`。M2 第 4 层实现了 `config check`，第 6 层接上了预览构建：新建或导入的网站可用且 `config check` 通过时，接口返回前就启动第一次正式版本构建，构建在后台进行；结果存在 `sites` 表（迁移 002：`read_only_reasons`、`checked_commit`、`config_check`，后者为 `ok` / `failed` / `not_run`（找不到可用的 Bukit）/ `notion`（使用 Notion 源但没有绑定数据源））。使用 Notion 源、已绑定数据源的网站，`config check` 带这个数据源的 token 在 `main/` 检出里跑（Bukit 只检查 token 是否存在，不联网）；绑定或解绑数据源时在网站锁里重新检查。token 文件读不出来时 `config_check` 记为 `failed`，网站不变只读。新建和导入失败时撤销已做的步骤（删除复制的文件或新建的 `.git`）。提交身份存在设置的 `commitName` / `commitEmail`，界面可用 `GET /api/git/identity` 读到的全局 git 身份预填
6. 创建完成后由用户从网站主页开始第一个会话；创建接口不接受首条消息

### 5.3 面板数据来源

| 面板 | 数据来源 | 实现 |
| --- | --- | --- |
| 文件 | 正式版本的提交，或当前改动集的快照（都从 git 对象读取） | 目录树接口（按目录懒加载）+ 文件内容接口；从 git 对象读取，网站目录里未跟踪或被忽略的文件（如 `.env`）不会出现；文件内容的返回方式见 9.1 |
| 配置 | `site.yaml` | `yaml` 解析成结构化视图（站点信息、语言、集合、内容源、构建、主题、部署），同时提供原文 |
| 主题 | `themes/<theme.name>/theme.yaml` 和目录 | 主题清单、布局文件列表、assets、params |
| 数据 | `site.yaml` 的 `content.sources[]` | 每个源一张卡片：Markdown 集合（文件数、frontmatter 字段汇总）、`mode: data` 源（按 `dataIndex` 的 scope/key/value 显示成表格）、Notion 源（只显示配置；面板不连 Notion，连接 Notion 的是数据源设置和正式版本构建） |
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

> **Pi SDK 1.5.1 核对结果**（M3 开始时升级。6.6 里不联网、工具白名单、系统提示和会话文件的结论已在 1.5.1 上重跑通过；闸门和工具相关的结论在 M3 第 2 层实现时重跑。下面列出有变化或新发现的地方）：
> - **项目信任**：`SettingsManager.inMemory()` 默认把项目当作受信任。受信任的项目会加载网站里的 `.pi/extensions`（会执行代码）、`.pi/SYSTEM.md`、`.pi/APPEND_SYSTEM.md`、`.pi/skills`、`.agents/skills` 和 `.pi/settings.json`。所以必须传 `{ projectTrusted: false }`；`DefaultResourceLoader` 另外传 `noExtensions`、`noSkills`、`noContextFiles`、`noPromptTemplates`、`noThemes`，用户主目录的 `~/.agents/skills` 也不会被读。单元测试在网站里提交这些文件，确认都没有生效
> - **内置扩展**：1.5.1 新增内置扩展（如 `mcp`），只有调用方通过 `extensionFactories` 传入时才会加载，BukitJalil 不传
> - **`cacheWarming` 默认 `"idle"`**：会在两次运行之间向模型发请求（产生费用），设为 `"off"`；`enableInstallTelemetry` 默认 `true`，设为 `false`。另外设置环境变量 `PI_TELEMETRY=0`、`PI_SKIP_VERSION_CHECK=1`
> - **`models-store.json`**：`ModelRuntime` 会在 `models.json` 旁边写一个模型列表缓存，也在 `~/.bukitjalil/pi/` 里
> - **codemode**：`codemode.mode` 只能是 `"on"` 或 `"only"`，但传了 `tools` 白名单时 codemode 工具不会出现，不需要额外处理
> - **留给后续层核对**：`ReadOperations` 新增可选的 `createReadStream`，闸门实现时要确认它不会绕过检查（不提供时 Pi 的回退路径也要核对）；`grep` 的上下文行改由 rg 输出，不再调用 `GrepOperations.readFile`，所以过滤 `.git` 时上下文行也要处理

### 6.2 会话生命周期

```text
创建会话 ──► 记录 sessions 行，生成 Pi 会话文件路径（还不创建 AgentSession）
发送消息 ──► 网站已有其他会话在运行：排队，等它结束
          ──► 若没有 open 的改动集：把工作副本重置到默认分支最新提交，开一个新改动集（见 7.2）；如果这个会话之前参与过别的改动集，在用户消息前给模型发一条说明（Pi 的 `sendCustomMessage`，`customType: "bukitjalil.worktree_reset"`，`display: false`）："工作副本已重置到最新正式版本（恢复时是"用户正在恢复的旧版本"），你上一个改动集已应用 / 未应用就关闭 / 因与正式版本的新改动冲突而关闭，修改前请重新读取文件"（实施于 2026-11-13，16 第 10 条）。规则：
          - 状态取这个会话参与过的、除当前改动集外最新的一个（`change_set_sessions` 按首次参与时间）；措辞不写"被用户拒绝"，因为关闭也可能来自恢复、删除网站等操作
          - 每个改动集只发一次：说明带 `details.changeSetId`，发之前查会话当前分支里有没有同一改动集的说明。所以一次在发送前就结束的运行（例如打开会话失败）不会让说明丢掉，下一次运行照样发
          - 只给模型看：Pi 转成用户角色的消息放进上下文；对话记录只列 `message` 类条目，SSE 桥接丢掉 `custom` 角色的 `message_end`，不显示在对话里，也不进会话标题
          - 分叉出来的新会话没有参与记录，不发说明（它复制的分支里可能已有说明）
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
- `grep` 继续用 `rg`：BukitJalil 固定 rg 版本，代码里写死各平台安装包的 SHA-256。M1 定为 **ripgrep 15.2.0**（2026-07-15 发布；Pi 1.5.0 本身不固定版本，每次取 GitHub 上的 latest）。下面的值来自 GitHub 发布记录，并和 ripgrep 项目自己发布的 `.sha256` 文件逐个核对一致：

  | 安装包 | SHA-256 |
  | --- | --- |
  | `ripgrep-15.2.0-aarch64-apple-darwin.tar.gz` | `3750b2e93f37e0c692657da574d7019a101c0084da05a790c83fd335bad973e4` |
  | `ripgrep-15.2.0-x86_64-apple-darwin.tar.gz` | `af7825fcc69a2afc7a7aea55fc9af90e26421d8f20fe59df32e233c0b8a231c1` |
  | `ripgrep-15.2.0-x86_64-unknown-linux-musl.tar.gz` | `33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c` |
  | `ripgrep-15.2.0-aarch64-unknown-linux-musl.tar.gz` | `800b1e7206afe799dfb5a6901f23147cfaabe0e52210538100f61e86e1740915` |
  | `ripgrep-15.2.0-x86_64-pc-windows-msvc.zip` | `71b2fef860abe467217a538ff31de02f5258807c0129f771846f87bd029aafc5` |
  | `ripgrep-15.2.0-aarch64-pc-windows-msvc.zip` | `e4abca10c3a64ebea742667dd7009449d49403db5460dd6873e389fa2945360f` |

  安装包本身在 M3 实现安装时下载、解压后再核对一次（M3 第 3 层已核对：4 个 macOS / Linux 安装包的摘要一致，压缩包结构相同，另外写死了每个包里 `rg` 程序本身的 SHA-256，见 M3 第 3 层实现说明）。Windows 安装包不装：Windows 不是 MVP 平台，`grep` 在 Windows 上不可用。安装复用 Bukit 的安装模块（8.1，同样需要用户确认、同样检查压缩包条目）安装到 `~/.bukitjalil/pi/bin/`；`PI_OFFLINE=1` 保证 Pi 不再下载
- 因为 Pi 会退回系统 `PATH`，`grep` 工具（M3 第 2 层起由 BukitJalil 包装的 `execute`，见下）在 `~/.bukitjalil/pi/bin/rg` 不存在或校验不通过时**直接阻止 `grep`**，返回"搜索工具未安装"，不让 Pi 去用系统里的 rg
- **`grep` 结果过滤 `.git`**（M1 实测）：Pi 调用 rg 时固定带 `--hidden`，会搜索工作副本根目录的 `.git` 文件（内容是 `gitdir: <网站仓库>/.git/worktrees/ai`）和任何嵌套的 `.git` 目录，参数由 Pi 写死，`operations` 管不到 rg 本身。所以 `grep` 工具定义再包一层：执行后丢掉路径里含 `.git` 段（不分大小写）的匹配行。实际实现另外给 rg 加了排除 glob `!**/{.[gG][iI][tT],.[eE][nN][vV]*}`，输出过滤同时丢掉 `.env*` 的行（`agent/tools.ts`）。rg 默认不跟随符号链接，搜索根目录又先经过闸门（`isDirectory`），工作副本外的文件读不到（已实测）

**自定义工具**（通过 `customTools` / 内联扩展注册）：

| 工具 | 作用 | 返回 |
| --- | --- | --- |
| `site_info` | 读取并解析 `site.yaml`，给出站点、语言、集合、内容源、主题摘要 | 结构化 JSON |
| `bukit_check` | 在工作副本里执行 `bukit config check` 和 `bukit doctor` | 退出码、问题列表 |
| `bukit_build` | 在工作副本里构建到临时输出目录 | 是否成功、页面数、错误、SEO/GEO 报告摘要 |
| `bukit_schema` | 返回 `bukit config schema` 输出的 JSON Schema（缓存） | JSON Schema |
| `list_content` | 按集合列出内容文件和 frontmatter 摘要 | 列表 |
| `summarize_changes` | AI 在完成一轮修改后调用，提交给用户审核的说明 | 写入改动集 `summary`；AI 没调用时，提交信息按差异生成一行（`changes/service.ts` 的 `diffSummary`，2026-11-13 实施）：例如 `Update 3 files, add 1 file: content/pages/about.md, site.yaml, themes/x/a.css, ...`，按修改 / 新增 / 删除计数，文件名最多 3 个，超过 72 个字符时从后往前去掉文件名，计数总会保留；没有改动或文件列表被截断时用固定文本 `Changes made with BukitJalil AI`（`DEFAULT_MESSAGE`） |

**权限闸门**放在**文件操作这一层**，不在工具参数这一层：

- **为什么不能只看参数**：已核对 SDK 1.5.0 源码（`dist/utils/paths.js` 的 `normalizePath`），Pi 的工具在 `tool_call` 之后还会改写路径：去掉开头的 `@`、把 `~` / `~/` 展开成用户主目录、把 `file://` 地址转成路径、把几种 Unicode 空格换成普通空格；`read` 找不到文件时还会再试 NFD、弯引号等变体。所以 `~/.bukitjalil/pi/auth.json`、`@/etc/passwd`、`file:///etc/passwd` 按"相对工作副本"解析会被判定在工作副本内，Pi 实际打开的却是外面的文件
- **做法**：用 Pi 的 `createReadToolDefinition` / `createWriteToolDefinition` / `createEditToolDefinition` / `createLsToolDefinition` / `createGrepToolDefinition` / `createFindToolDefinition` 生成同名工具，传入自己的 `operations`（`readFile`、`writeFile`、`mkdir`、`access`、`stat`、`exists`、`isDirectory`、`glob` 等），通过 `customTools` 注册（同名会替换内置工具）。Pi 调用 `operations` 时传的是**最终的绝对路径**，`edit` / `write` 传的是**最终写入的内容**，闸门在这里检查，不需要复刻 Pi 的路径改写和 `edit` 的匹配逻辑
- 第一层快速拒绝（M1 原型放在 `tool_call` 处理器里，M3 第 2 层改为包装每个工具定义的 `execute`：工具定义本来就由 BukitJalil 生成，不需要再加扩展）：路径以 `@`、`~`、`file:` 开头，或含 Unicode 空格，直接阻止并告诉 AI 用相对路径
- **所有带路径的操作**都必须落在工作副本内；读也要限制：否则 AI 可以读到 `~/.bukitjalil/pi/auth.json`（模型密钥）、`~/.ssh` 等，再借提示词注入写进网站文件带出去
- **唯一的例外：技能文件只读**。Pi 只在系统提示里给出技能文件的绝对路径，让模型用 `read` 去加载（已核对 `dist/core/skills.js`），所以 `readFile` / `access` 允许读取应用自带 `skills/` 下**已启用技能**的目录（取 `realpath` 后比较；真实路径不在 `skills/` 里的技能目录，例如符号链接出去的，直接跳过；用户在设置里关闭的技能 `disabledSkills` 不加载也不可读），不允许写，也不允许 `ls` / `grep` / `find` 它之外的目录
- 路径检查：对已存在的路径取 `realpath.native`（macOS 上会返回磁盘上的真实大小写）；不存在的路径（新建文件）逐级找到最近的已存在上级目录取 `realpath.native`，再拼回剩余部分；最终结果必须以工作副本的 `realpath` 加路径分隔符开头（防符号链接和 `..` 逃逸）
- 禁止读写：路径中**任何一级**名为 `.git`（不区分大小写），包括嵌套目录里的 `.git`：工作副本根目录的 `.git` 是指向网站仓库的文件，被改写就能把 git 指到 AI 准备的目录；嵌套的 `.git` 会让 `git add -A` 失败或把内容变成看不见的子模块
- 禁止写：构建目录 `dist/**`、`.bukit/**`、`.cache/**`、`.bukitjalil-build/**`、`.bukitjalil-deploy/**`（代码里统一用 `sites/exclude.ts` 的 `BUILD_DIRS`）、`node_modules/**`、任何以 `.env` 开头的文件
- 禁止读和列出：路径中任何一级以 `.env` 开头（导入的仓库可能跟踪了 `.env`，读到就会把密钥发给模型提供商；`grep` 也排除它们，见上）
- 禁止写插件相关文件：`plugins/**` 以及任何 `plugin.yaml` / `plugin.json`（插件按 `plugins/<id>/plugin.yaml` 启动；外部插件配置在 `.bukit/plugins.yaml`，已在上一条的 `.bukit/**` 里禁止；M1 已核对源码，见 8.5）；`site.yaml` 的插件配置在构建前另行检查（见 8.5）
- `grep` / `find` 的 glob 只在根目录下匹配；根目录在 `operations.isDirectory` / `glob` 里检查
- 自定义工具只接受集合名、语言代码等受限参数，不接受任意路径；有路径参数的（如以后的素材工具）走同一个解析函数
- 单个文件写入上限 1 MB（在 `writeFile` 里按最终内容检查）；二进制文件不允许 AI 写入（图片等素材走"上传素材"功能，见 [plans/2026-11-12-media-upload-design.md](plans/2026-11-12-media-upload-design.md)）
- 闸门本身有完整单元测试：绝对路径、`..`、`~`、`~/…`、`@…`、`file://…`、含 Unicode 空格的路径、符号链接（指向外部的文件和目录）、大小写变体（`.GIT`）、根目录和嵌套的 `.git`、新建深层目录、技能目录只读

### 6.4 技能与提示

- **Bukit 官方技能**：Bukit 仓库 `guide/skills/` 下当时有 14 个面向 AI 的技能（v2.0.15 时 18 个，见下面的现状）（`using-bukit`、`bukit-config`、`bukit-content`、`bukit-theme`、`bukit-templating`、`bukit-i18n`、`bukit-seo`、`bukit-geo` 等）。按对应的 Bukit 版本复制到 `skills/bukit/`，记录来源 commit，升级 Bukit 时同步，来源和改动记在 `skills/sources.yaml`。M3 第 4 层按 2.0.11 复制了其中 11 个，当时 `bukit-dev`、`bukit-preview`、`bukit-deploy` 讲的是 AI 不能做的事，不复制。**现状**：已同步到 Bukit v2.0.15（commit `83ba56a6`），共 18 个，包括 `bukit-local-server`、`bukit-publish-deploy`、`bukit-troubleshooting`（`bukit-debug` 已被上游改名移除）。这两个讲本地服务器和发布的技能也复制了，因为它们解释了"链接为什么和线上不同""发布配置怎么写"等 AI 回答问题时需要的背景；每个技能开头的说明仍然告诉 AI 预览、开发服务器、发布由 BukitJalil 处理，不要尝试
- **BukitJalil 技能**（`skills/bukitjalil/`）：
  - `site-editing`：工作规则——只改网站文件；改完先 `bukit_check`，再 `bukit_build`；最后调用 `summarize_changes`。**同时说明命令和工具的对应关系**：Bukit 官方技能里写的是 `bukit config check`、`bukit doctor`、`bukit build` 等命令，而 AI 没有执行命令的工具，要改用 `bukit_check`、`bukit_build`、`bukit_schema`；官方技能里涉及 `dev`、`preview`、`deploy`、插件和 Labs 的部分由 BukitJalil 处理，AI 不要尝试
  - 复制官方技能时去掉 Labs 相关内容，并在每个技能开头加一行说明上述对应关系
  - `content-writing`：公司介绍、服务页、首屏文案、FAQ、SEO 标题描述、按主题写文章的写法和 frontmatter 约定
  - `multilingual`：按 `site.languages` 生成和对齐多语言内容
  - `publishing`（M6 之后加入）：说明 AI 不能发布，发布由用户在发布面板完成；解释 `site.yaml` 的 `deploy` 段（仓库、分支、自定义域名）
  - 可选技能可以在设置里关闭（`disabledSkills`）
- **系统提示**：自定义 `getSystemPrompt()`，说明身份（BukitJalil 建站助手）、当前网站名和路径、可用工具、"不要执行命令、不要改网站目录以外的东西"、回答用用户的语言
- 不加载 `AGENTS.md` / `CLAUDE.md` 等上下文文件
- 技能文件在工作副本外，靠 6.3 的"技能目录只读"例外让 AI 读到；M1 验证 AI 确实会 `read` 这些路径并成功

### 6.5 模型与密钥

- `ModelRuntime.create({ authPath: ~/.bukitjalil/pi/auth.json, modelsPath: ~/.bukitjalil/pi/models.json })`
- 模型密钥有两个来源：设置页填写（写入 `auth.json`）和环境变量（Pi 会读取 `ANTHROPIC_API_KEY`、`OPENAI_API_KEY` 等提供商环境变量，已核对 Pi 文档）。设置页对每个提供商显示密钥来源；来自环境变量的不能在界面里修改
- Pi 在请求时可能才读取环境变量，所以模型密钥变量**不从进程环境删除**；改为保证 BukitJalil 自己启动的子进程（git、Bukit）都只拿到显式构造的最小环境（7.3、8.5），不会继承它们。例外是 Pi 内部启动的 `rg`：它会继承全部环境变量，但只会是 BukitJalil 安装、校验过的固定版本（没装好时 `grep` 被阻止，见 6.3），不执行网站内容，可以接受
- 设置面板支持：选择提供商和模型、填写 API Key（界面只显示末四位）、思考级别、"测试连接"
- 密钥永远不通过 API 返回给浏览器

- **OAuth 登录**（M7 之后）：支持 OAuth 的提供商（如 OpenAI Codex）即使还没有模型也会列出，设置页可以发起 OAuth 登录、回答提供商的提问、取消或登出（`/api/providers/:provider/oauth…`，见 9.1）；凭据由 Pi 写入 `auth.json`
- **自定义模型**（M7 之后）：用户可以添加兼容 OpenAI / Anthropic 接口的自定义模型，配置和密钥存在 `~/.bukitjalil/pi/custom-models.json`（0600），启动时注册到 `ModelRuntime`

**其他密钥（Notion token、GitHub token）**，现行设计（2026-11-12）：

1. **GitHub token 按发布账号保存**：设置页的"发布账号"里添加账号和 token，存在 `~/.bukitjalil/publish-account-tokens.json`（`publish/accounts.ts`）；网站在 `sites.publish_account_id` 里选用一个账号
2. **Notion token 按数据源保存**：设置页的"数据源"里添加，存在 `~/.bukitjalil/data-source-tokens.json`（`data-sources/service.ts`）；网站在 `sites.notion_data_source_id` 里选用一个数据源：新建网站时选的数据源自动绑定，其他情况（包括导入的网站）由用户在数据面板里显式绑定或解绑（`PUT /api/sites/:siteId/notion-source`）。没有绑定就不给 token，正式构建结果为 `notion`；不会因为只保存了一个 Notion 数据源就自动使用它，否则导入的网站可以在 `site.yaml` 里指向这个 integration 能读的任何数据库，构建后再发布出去
3. **不读环境变量和旧文件**：`BUKITJALIL_GITHUB_TOKEN`、`BUKITJALIL_NOTION_TOKEN` 和旧的 `secrets.json` 都不再读取，也不做迁移（没有需要升级的存量用户）；token 只能在设置页添加
4. **token 的用途**：每次调用 Bukit 都显式构造环境变量（8.5），只在需要时放入对应 token——Notion token 只给默认分支上审核过的内容：网站检查的 `config check`、正式版本构建、发布时的 `config check` / `doctor` / `build`（`publish audit` 和 `deploy --skip-build` 不传；Bukit 的 `deploy --skip-build` 不校验数据源密钥）；不传给 AI 工作副本和改动集的构建；没有绑定数据源时这些步骤的结果为 `notion`，GitHub token 在发布时传；另外 GitHub token 会用来调用 GitHub API 检查账号对目标仓库的权限（保存部署设置时和每次发布前，见 M6）；数据源设置会用 Notion token 调用 Notion API 列出数据库

早期设计（M6 时）是"环境变量优先，否则 `secrets.json`，由 `settings/secrets.ts` 统一处理"，这些文件和接口（`/api/secrets`）都已删除。不只用环境变量的原因仍然成立：从 Finder / Dock 启动的桌面版（M7）读不到 shell 里设置的环境变量；界面里没法修改；而且放在进程环境里的密钥默认会被所有子进程继承。AI 没有执行命令的工具，读写又限制在工作副本内，读不到这些文件。

系统钥匙串（macOS Keychain / Windows 凭据管理器）仍未采用（Node 常用的钥匙串库已停止维护，会增加原生依赖和打包成本）。

> **存储细节（2026-11-12）**：`auth.json`、`publish-account-tokens.json`、`data-source-tokens.json` 和 `custom-models.json` 都是 0600 明文，应用目录 0700。这套存储防的是其他系统用户和 AI 越权读取，不防同一用户下的 malware、管理员/root、备份/云同步，也不防没有全盘加密的磁盘；Windows 上 `chmod(0600)` 只影响只读属性，不是完整的 NTFS ACL。JSON 写入使用临时文件、fsync、rename 和目录 fsync；启动时清理无主 token 和残留临时文件。`lstat` 到读取之间的 TOCTOU 在当前威胁模型下接受：能改应用目录的同一用户本来就能直接读这些文件。

### 6.6 待验证（M1 技术验证）

已验证的项写明脚本（都在 `packages/server/spikes/`），可以重复运行。

- [x] **闸门写在 `operations` 里**（`pi-gate.mjs`，35 项全部通过）：`create*ToolDefinition(worktree, { operations })` 生成的工具通过 `customTools` 传入后，会话里实际生效的就是带闸门的版本。`~/…`、`@~/…`、`@/绝对路径`、`file://`、`../`、绝对路径、Unicode 空格、指向外部的符号链接文件和目录、任意层级的 `.git`（含 `.GIT`）都被拒绝；工作副本内正常读写、`@index.md`、新建深层目录、技能目录只读都正常；写入超过 1 MB 被拒绝。`ls` / `find` / `grep` 的根目录都经过闸门
- [x] **`tools` 白名单**（同上）：只列内置工具名时自定义工具确实被丢掉；同时列出自定义工具名后正常注册，且没有 `bash`
- [x] **`tool_call` 快速拒绝**（`pi-session.mjs`；这是 M1 原型，M3 第 2 层起改为包装工具定义的 `execute`，并传 `noExtensions: true`，见 6.3）：内联扩展 `{ name, factory: (api) => api.on("tool_call", e => ({ block: true, reason })) }` 通过 `DefaultResourceLoader` 的 `extensionFactories` 传入；`~/secret.txt` 和 `bin/rg` 缺失时的 `grep` 都被拦下，`reason` 作为工具错误结果返回给模型，秘密内容没有出现在任何事件里
- [x] **技能**（同上）：`additionalSkillPaths` 指向技能目录后，`session.systemPrompt` 里列出技能名、描述和 `SKILL.md` 的绝对路径；模型按这个路径 `read` 能拿到正文。是否"真的会去读"取决于真实模型，M3 用真实模型再观察
- [x] 会话文件放在自定义目录：已核对 1.5.0 类型定义，`SessionManager.create(cwd, sessionDir)`、`SessionManager.open(path, sessionDir, cwdOverride)` 都支持；从指定消息分叉用 `createBranchedSession(entryId)`（`forkFrom` 会复制整个会话）；实际行为已跑通（`pi-session.mjs`）：会话文件写在指定目录，`SessionManager.open` 重新打开后条目数一致，`createBranchedSession(第一条用户消息)` 生成新的、更短的会话文件
- [x] **reset 后续用会话**（`pi-session-reset.mjs`，7 项通过）：Pi 的读写工具不记录文件状态，`edit` 每次重新读文件按原文匹配。模型按记忆里的旧内容 `edit` 时返回工具错误（"Could not find the exact text"），文件不被改动；模型重新 `read` 后能改到重置后的内容。同一个会话对象继续用、或从会话文件重新打开后继续用，模型都拿到完整历史，新消息追加在同一个文件里。旧上下文只会让模型多走一步，不会写坏文件；原计划开新改动集时附一段说明（第 6 节会话流程）减少这一步，但没有实现（见 6.2）
- [x] **事件字段**（同上）：`tool_execution_start` 有 `toolCallId`、`toolName`、`args`；`tool_execution_end` 有 `toolCallId`、`toolName`、`result`、`isError`；`message_update` 有 `message`、`assistantMessageEvent`；`agent_settled` 有 `aborted`，在一轮结束时只发一次且是最后一个事件
- [x] **不联网**（同上）：用 Pi 自带的 faux 假模型（`fauxProvider` + `ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false })` + `registerNativeProvider`）跑完 4 步会话，`fetch` 调用 0 次，`$HOME/.pi` 没有被创建
- [x] **顺序执行**（同上）：同一批里两个普通自定义工具并行执行（对照组）；`bukit_build` 设 `executionMode: "sequential"` 后，同批的 `write` 在它结束之后才开始

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
  - Bukit 2.0.11（2.0.8 相同）构建两种以上语言的网站时，要求工作区没有任何暂存、未暂存或未跟踪的改动，并从 HEAD 的提交构建（已核对源码 `BuildCommand.cs`、`WorktreeBuildRepository.cs`，没有参数可以关掉）。不先快照，多语言网站在 `ai/` 里的构建一定失败
- **差异**：`git diff --no-ext-diff --no-textconv <base_commit> <快照>`，按文件分页返回；单个文件的差异按需读取
- **审核指纹** = 快照的树哈希 T，和差异一起发给界面：
  - 点"应用"时请求必须带上指纹；服务端拿到网站操作锁后再做一次快照，树必须和指纹完全一致，否则拒绝并刷新审核卡片
  - 会话开始运行时当前审核卡片立即失效，界面禁用"应用"，等这一轮结束、新的快照生成后再启用
- **正式版本已前进时**：应用前发现 `main` 不再等于 `base_commit`（用户在 BukitJalil 外提交过，或做过恢复），用 `git merge-tree --write-tree <main 的 OID> <快照>`（git ≥ 2.38，只读，不碰索引和工作区）计算合并结果：
  - 成功：得到新树 T'，`git commit-tree T' -p <main>` 作为新快照，在工作副本里 `git reset --hard` 到它，`base_commit` 更新为 main；**不自动合入**，重新生成差异和指纹，用户再确认一次
  - 有冲突，或合并结果和 main 的树相同（main 已经包含全部改动）：标记 `stale`，让 AI 基于新版本重做；没有任何进行到一半的 git 操作需要清理（不用 `git rebase`：冲突时它会把工作副本留在 rebase 状态，之后所有 `git switch` 都失败）
- **应用**：拿锁 → 校验指纹 → main 已前进时按上一条处理 → 自动跑一次 `bukit_check`（失败时允许用户坚持应用，但要明确提示）→ `git commit-tree <指纹> -p <main>` 生成结果提交 → 在网站目录里 `git merge --ff-only --no-overwrite-ignore <结果提交 OID>` → 状态 `applied`、记录 `result_commit`、删除引用。合入前检查，任一不满足就拒绝并提示用户先处理：
  - 网站目录当前检出的分支就是 `sites.default_branch`（用户可能在 BukitJalil 外切到了别的分支）
  - 网站目录没有未提交的改动
  - `--no-overwrite-ignore`：改动里如果有网站目录中被忽略的同名本地文件，合并中止而不是悄悄覆盖（已实验确认不加这个参数会直接覆盖）
- **拒绝**：只改状态、删除引用；工作副本在下次开新改动集时统一 `reset --hard` + `clean`
- **清理被忽略的文件**：AI 可以改 `.gitignore`，把文件藏起来——被忽略的文件不出现在差异里、不会被提交，但会留在工作副本里。M1 实测（`git-worktrees.sh` 和单语言 starter 网站）：AI 在 `.gitignore` 里加上 `content/posts/hidden.md` 后，这篇文章不在快照里，但单语言网站在 `ai/` 里的构建照样把它渲染进预览（多语言网站从 HEAD 的提交构建，不受影响）。所以：
  - **每次快照时**，在 `git add -A` **之前**用 `git ls-files -z --others --ignored --exclude-standard --directory` 列出被忽略的文件，除构建目录（`BUILD_DIRS`）和 `node_modules` 外全部删除，让工作区和快照完全一致，再进行任何构建；`git add -A` 另外用 `:(exclude,icase,glob)` 路径规则把这些顶层目录排除在外，即使 `.gitignore` 取消了对它们的忽略也不会进入快照（`changes/snapshot.ts`，M3 第 1 层实现说明里写的就是这个做法）。被删掉的文件名写进快照结果返回给 AI（"以下文件被 .gitignore 忽略，已删除，不会进入审核"），避免 AI 以为文件还在。（原计划是快照之后执行 `git clean -fdx -e …`。）
  - 开新改动集时 `git reset --hard` 后执行 `git clean -fdx -e .bukit -e .cache`（`sites/service.ts`）
  - 已实测 `-x` 配合 `-e` 会保留这两个缓存目录、删除其他所有未跟踪和被忽略的文件
- 一个网站同一时间最多一个 `open` 改动集，多个会话共享它；配合网站操作锁，不会出现两个 AI 同时改文件
- **排除规则**：创建网站检出时，在网站仓库的 `.git/info/exclude` 写入一段带 `# BukitJalil begin/end` 标记的内容：`BUILD_DIRS` 里的 `dist/`、`.bukit/`、`.cache/`、`.bukitjalil-build/`、`.bukitjalil-deploy/`（后者 M6 加入）。必须写在这里而不是只用 `-c core.excludesFile`：Bukit 自己调用的 `git status` 也要把这些目录当作被忽略，否则多语言构建会因为"有未跟踪文件"拒绝。移除网站时删掉这一段
- **提交身份**：提交信息的第一行和正文来自 `summarize_changes` 的说明（没有时按差异生成一行，见 6.3），末尾加 trailer：`BukitJalil-Sessions: <会话 ID…>`（有会话参与时）和 `BukitJalil-Restore: <版本>`（恢复时）。提交者是设置页里填写的身份；作者分三种情况：有会话参与过（`ai_joined`）的改动集是 `BukitJalil AI <ai@bukitjalil.local>`；没有会话参与的恢复，以及没有任何会话的改动集（例如设置里的插件开关，见 10.2），作者是用户自己。注意第二种看的是会话列表，对话被删除后关联行跟着删除（`ON DELETE CASCADE`），AI 参与过的改动集会被记成用户作者。素材上传实施时会把规则统一改成"`ai_joined` 为假即用户"，同时修掉这个问题，并给只有上传的改动集加 `BukitJalil-Uploads: <文件数>` 尾注（[素材上传设计](plans/2026-11-12-media-upload-design.md) 5.5）。`git commit-tree` 没有 `--author` 参数，所以用 `-c author.name=… -c author.email=… -c committer.name=… -c committer.email=…`（git ≥ 2.22，已实验确认能分开设置）
- **身份的默认值**：git 子进程不读全局配置（7.3），所以 `git/identity.ts` 提供一个单独的 `readGlobalIdentity()`：只执行 `git config --global --get user.name` 和 `user.email`，这一次用真实的 `HOME`、不设置 `GIT_CONFIG_GLOBAL`、只设 `GIT_CONFIG_NOSYSTEM=1`（`config --get` 只读值，不执行任何程序），结果只作为设置页的默认值。新建网站、导入非 git 目录都需要提交，所以首次启动引导**先**填身份，再新建网站

### 7.3 git 调用加固

网站仓库（尤其是导入的）可能自带会执行命令的 git 配置和钩子。已用本机 git 2.39.5 实验确认：仓库 `.git/config` 里的 `core.fsmonitor = <命令>` 会在执行 `git status` 时直接运行；`.git/hooks/pre-commit` 会在提交时运行；用户全局配置里定义的过滤器（例如 git-lfs 的 `filter.lfs.*`）会被仓库里的 `.gitattributes` 触发；仓库配置里的 `gpg.program` 配合 `commit.gpgSign=true` 会在 `git commit` / `git rebase` 时运行，配合 `log.showSignature=true` 会在 `git log` 时运行。所以 BukitJalil 的所有 git 调用都统一由 `packages/server/src/git/run.ts` 发起（不用 git 封装库，见 2.2），不允许其他模块直接调用 git：

- **调用方式**：用 `child_process.spawn`（参数数组、不经过 shell、显式 env），流式读取输出，不用 `execFile`（它默认最多读 1 MiB 输出，超过就杀掉 git 进程，大的差异会失败）；需要一次性拿到的输出设置明确的大小上限，超限时报错而不是截断。`git` 程序的绝对路径在启动时解析一次，之后都用绝对路径
- **最低版本**：git ≥ 2.38（`merge-tree --write-tree`），启动时检查，`/api/health` 报告
- **固定参数**：每次调用都带 `-c core.fsmonitor=false -c core.hooksPath=<应用自带的空目录> -c core.untrackedCache=false -c core.attributesFile=<空文件> -c core.excludesFile=<空文件> -c protocol.allow=never -c commit.gpgSign=false -c tag.gpgSign=false -c log.showSignature=false`；`diff` / `log -p` / `show` 一律加 `--no-ext-diff --no-textconv`
- **参数注入**：外部来的值不会被当成 git 的选项：
  - 提交只接受完整的十六进制 OID（40 或 64 位），接口参数用 zod 校验
  - 分支只用 `refs/heads/<name>` 的完整形式，`<name>` 必须通过 `git check-ref-format --branch` 且不以 `-` 开头；能先解析成 OID 的就先解析
  - 版本参数前加 `--end-of-options`，路径前加 `--`
- **不读系统和全局配置**：git 子进程只拿到这些环境变量（`git/run.ts` 的 `env()`）：`PATH`（只有 git 所在目录加 `/usr/bin:/bin`）、`HOME`（设为应用数据目录，不是用户主目录）、`LANG=C`、`LC_ALL=C`、`GIT_CONFIG_NOSYSTEM=1`、`GIT_CONFIG_GLOBAL=<空文件>`、`GIT_TERMINAL_PROMPT=0`，以及 `GIT_CEILING_DIRECTORIES`（应用数据目录和工作目录的上一级，git 只认工作目录本身的仓库，不会向上找到外层仓库）；不继承服务进程的其他环境变量（包括模型密钥）。`core.excludesFile` 默认会读 `~/.config/git/ignore`，不受 `GIT_CONFIG_GLOBAL` 影响，所以也在固定参数里指向空文件（否则用户自己的忽略规则会让 AI 写的文件不出现在差异里）。`<空文件>` 是 `~/.bukitjalil/empty-gitconfig`，启动时确认存在且为空；不用 `/dev/null`，因为 Git for Windows 不保证能识别它
- **`safe.directory`**：不读全局配置后，用户在全局配置里加的 `safe.directory` 也不生效。网站目录属于别的用户时 git 会拒绝（dubious ownership），这时把网站标为只读并说明原因，不自动加 `safe.directory=*`
- **检查仓库配置（白名单）**：不再列举危险的配置项（列不全：上面的 `gpg.program` 就是漏掉的一个），改为只允许已知无害的配置：
  - 用 `git config --list --show-scope --includes`（同样加固）列出**仓库级和 worktree 级**的全部配置（`--local` 看不到 `extensions.worktreeConfig` 打开后的 `config.worktree`）
  - 允许的只有：`core.repositoryformatversion`、`core.filemode`、`core.bare`、`core.logallrefupdates`、`core.ignorecase`、`core.precomposeunicode`、`core.symlinks`、`core.autocrlf`、`core.eol`、`remote.*.url`、`remote.*.pushurl`、`remote.*.fetch`、`branch.*.remote`、`branch.*.merge`、`branch.*.rebase`、`user.name`、`user.email`，以及 M1 在本机 71 个真实仓库上统计后补充的：`branch.*.vscode-merge-base`（VS Code 写入，79 处）、`submodule.active`（66 个仓库）、`lfs.repositoryformatversion`（63 个，装过 git-lfs 就会写，不代表仓库用了 LFS）、`lfs.<url>.access`、`extensions.worktreeConfig`（8 个；worktree 级配置本身由 `--show-scope` 列出、同样按白名单检查，已实测），后来又加了 `extensions.objectFormat`（SHA-256 仓库，`git/repo-check.ts`）。按原先的白名单，这 71 个仓库几乎全部会被标为只读。`include.*` / `includeIf.*` 仍然拒绝（71 个仓库里没有一个用到）
  - 出现其他任何配置、`.git/info/attributes` 里有 `filter=` 属性，就把网站标为"只读：不满足安全规则"并列出原因，当前操作一并拒绝
  - **钩子不再作为只读条件**：BukitJalil 的 git 调用用空的 `core.hooksPath`；Bukit 构建多语言网站时的 git 通过 `GIT_CONFIG_*` 拿到同样的设置（M1 已实测钩子不再运行）。例外是 `bukit deploy`：它会删掉 `GIT_CONFIG_*`（见 M6），但它在网站目录里只执行 `git config --get`，不触发钩子，其余操作都在新建的临时仓库里。所以钩子文件存在与否不影响安全；如果以后 Bukit 的 deploy 在网站目录里执行会触发钩子的命令（升级 Bukit 时用 M6 的包装脚本复查），需要恢复这条规则或改在空钩子的副本里执行。本机 71 个仓库里有 2 个带 git-lfs 安装的钩子，按原规则会被误标为只读
  - **在 `git/run.ts` 里每次调用前执行**，按 `.git/config`、`config.worktree`、`info/attributes` 的修改时间和大小缓存结果。不再维护"哪些操作之前要检查"的清单：每轮快照里的 `git add -A`、开新改动集的 `reset --hard` 也会运行过滤器，同样要被覆盖
- **`.gitattributes`**：配置白名单不允许任何 `filter.*` / `diff.*` / `merge.*` 定义，全局配置又被隔离，属性里引用的驱动没有任何来源，所以不再逐个扫描 `.gitattributes` 的内容（`diff=markdown`、`merge=union` 这类 git 内置驱动是无害的，不应该因此拒绝）
- **Git LFS 不支持**：隔离全局配置后 LFS 过滤器不再运行，LFS 仓库里只能看到指针文件。导入时如果被跟踪的 `.gitattributes` 里有 `filter=` 属性，网站标为"只读：不满足安全规则"，原因写明 MVP 不支持 Git LFS
- **Bukit 自己调用的 git**：Bukit 2.0.11 构建多语言网站和发布时会自己启动 `git`，不带上面的 `-c` 参数（已核对源码）。所以调用 Bukit 时用环境变量把同样的加固传给它：`GIT_CONFIG_NOSYSTEM=1`、`GIT_CONFIG_GLOBAL=<空文件>`、`GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n`（与固定参数相同的配置），以及 `GIT_TERMINAL_PROMPT=0`；仓库配置检查在调用 Bukit 前同样执行。**M1 已实测**（`bukit-git.sh`，2.0.8 和 2.0.11 结果相同）：不加这些环境变量时，Bukit 构建多语言网站会运行仓库里的 `core.fsmonitor` 程序和 `post-checkout` 等钩子；加上之后都不再运行，构建照常成功
- 加固函数有单元测试：带 `core.fsmonitor`、钩子、仓库 `filter`、`gpg.program` + `commit.gpgSign` / `log.showSignature`、`config.worktree` 里的配置、全局配置定义过滤器（临时 `HOME`）、用户全局忽略文件、以 `-` 开头的提交或分支名、超过 1 MiB 的差异，验证都不会执行命令、不会被当成选项、不会截断

### 7.4 版本历史与恢复

- 历史 = `main` 的提交列表，每条显示说明、时间、改动文件数、关联会话
- 查看任意版本的差异（提交参数按 7.3 校验为完整 OID）
- **恢复复用应用的流程**：恢复到版本 V = 生成一个由系统发起的改动集，快照树是 `V^{tree}`，base 是当前 main，用户在审核卡片里看到"恢复到 V"的差异和预览，确认后走 7.2 的"应用"（`commit-tree V^{tree} -p <main>` + 网站目录 `merge --ff-only --no-overwrite-ignore`）。不用 `git read-tree`：不加 `-u` 时它只改索引，网站目录里的文件不变，恢复后网站目录反而变成"有未提交改动"（已实验确认）
- 有 `open` 改动集且它有改动时，恢复需要用户先应用或拒绝它（`change.open_exists`，同一时间只有一个 open 改动集）；open 改动集没有任何改动时，恢复直接把它关掉（记为 `rejected`）；V 的树和当前 main 相同时拒绝（`change.same_version`）。恢复应用之后，下一个改动集基于新的 main
- 恢复前对 `V` 的提交跑构建前安全检查（8.5，直接读 git 对象），不通过时提示原因（旧版本可能用了现在不允许的配置）；用户确认后仍可恢复，但正式预览构建会被拒绝
- 恢复提交由用户发起，作者和提交者都是设置页里填写的用户身份；但如果在恢复改动集上又开了会话让 AI 修改（`ai_joined`），作者改为 BukitJalil AI（见 7.2）

### 7.5 部分应用（2026-11-13 设计）

审核时可以按文件、按代码块挑一部分应用（AGENTS.md 待开发任务 1）。2026-11-13 定下：**没选中的改动留在改动集里**，第一版**就做到按代码块**。

**请求**：`POST /api/changes/:changeId/apply` 的请求体加可选的 `selection`：`[{ path, hunks? }]`。列出的文件被应用，没列出的留着；`hunks` 是这个文件差异里代码块的序号（从 0 开始），省略表示整个文件。没有 `selection` 时和现在一样整份应用。

**规则**：

- **路径和代码块都对着审核时看到的差异**：请求照旧带快照的树指纹 `treeHash`，带 `selection` 时还必须带审核时的 `baseCommit`（缺了是 400，对不上是 409 `change.fingerprint_mismatch`）。原因是部分应用之后，剩下的改动集树不变、base 变了，代码块序号对着的是新的差异；只核对树的话，旧页面发来的"第 1 块"会变成另一块。服务端核对两者，再从"base → 快照"的差异里按 `selection` 算出选中后的树 S，"审核时看到的 = 应用的"仍然成立。代码块序号超出范围也按指纹不符处理（409）。代码块的划分要稳定：差异固定用 `--unified=3 --diff-algorithm=myers --indent-heuristic`，不受仓库配置影响，审核视图和应用用同一个函数（`changes/diff.ts`）。
- **文件和同名文件夹互换**：`--no-renames` 把它列成"删除 a"和"新增 a/b"两条，索引写入其中一条时会自动带上另一条。所以建树后再比一次 base 和 S，只允许选中的路径不同，否则返回 400（`change.partial_unsupported`），这种改动要两条一起选。
- **检查没通过时清掉缓存**：检查在 `main/` 检出里跑，那里的 `.bukit`、`.cache` 在重置时会保留，检查没通过、也没强制时把这两个目录删掉，没应用的内容不会留在下一次正式构建的缓存里。
- **只能整文件选的情况**：二进制文件、差异太大不显示的文件、新增 / 删除 / 类型变化的文件、权限位变了的文件、子模块、超过 16 MB 的文件、"全部代码块"算不回快照文件的文件。对这些文件传 `hunks` 返回 400（`change.partial_unsupported`）。由服务端判断：改动集的单文件差异（`GET /api/changes/:id/diff`）多返回 `splittable`，界面只给它为真的文件显示代码块勾选框；恢复改动集一律为假。
- **算出代码块后的内容**：不解析 `+`/`-` 行，只用每个代码块头 `@@ -a,b +c,d @@` 的行号范围，在字节层面把 base 文件里选中代码块的那几行换成快照文件里对应的行（按 `\n` 切行，保留行尾，所以没有换行结尾、非 UTF-8 的文件也不会变形）。先用"全部代码块"算一遍，结果必须和快照文件逐字节相同，否则这个文件只能整文件选。
- **建树**：`git diff --raw -z --no-renames --no-abbrev base 快照` 列出每个改动路径的旧 / 新模式和对象，用临时索引文件（`GIT_INDEX_FILE`，放在应用的临时目录）从 base 的树开始，`update-index --index-info` 写入选中的条目（整文件用快照的条目，删除用 0 模式，部分文件用新写入的 blob），`write-tree` 得到 S。
- **S 等于快照的树**（实际上全选了）：走原来的整份应用。**S 等于 base 的树**（什么都没选上）：400 `change.nothing_selected`。
- **正式版本已经前进**：和现在一样先变基，返回 `rebased`，要求重新审核，这次的选择作废。
- **检查对着 S 跑**：先用 S 生成结果提交（父提交是 main），在 `main/` 检出这个提交，对它跑构建前检查和 `config check` / `doctor`。不能在 AI 工作副本里跑，因为检查前会给工作副本拍快照，会把改动集挪走。强制、Notion 网站免检的规则和整份应用相同。
- **提交说明**：第一行按选中的差异生成（`diffSummary`），AI 写了说明时正文加 `Part of: <说明>`；作者、提交者和会话尾注的规则不变。
- **恢复改动集只能整份应用**：恢复提交带 `BukitJalil-Restore` 尾注，表示"把内容恢复成版本 V"，只恢复一部分会让历史里的说明不对。对恢复改动集传 `selection` 返回 400（`change.partial_restore`）。
- **剩下的部分**：快进合并成功后，改动集不关闭，变基到刚应用的结果：新的快照提交 = 原快照的树、父提交是结果提交，`base_commit` 改成结果提交，再更新 `refs/bukitjalil/changes/<id>`、AI 工作副本 `reset --soft` 到它（树相同，文件和索引都不用动）。剩下部分的提交在快进之前就生成好，快进之后只剩记录，ref 和检出更新失败只记日志（树没变，下一次快照会把它们挪过去）。AI 的说明改成 `Rest of: <说明>`，以后整份应用剩下的部分时，提交说明不会把已经应用的部分也算进去。审核卡上的差异就只剩没选的部分，AI 可以接着改。返回新的结果 `partial`，和 `applied` 一样会重新构建正式版本的预览。改动集 ID 不变，所以 AI 不会收到"工作副本已重置"的说明（6.2）。
- **界面**：差异视图里每个文件和每个代码块前有勾选框，默认全选；有没选中的部分时，"应用"按钮变成"应用所选"，全部取消时按钮不可用。只能整文件选的文件只有文件勾选框。选择记在前端，按"改动集 ID + base + 树指纹"区分，审核卡和改动面板共用；应用后（整份或部分）选择清空，剩下的部分重新从全选开始。改动集在审核期间有了新快照时，之前的选择作废并提示"已重新全部选中"，避免用户以为还只应用一部分。AI 正在运行、恢复改动集、文件列表被截断（超过 2000 个文件）时不显示勾选框，只能整份应用。审核卡没有勾选框，有选择时在按钮上方说明"只会应用改动面板里勾选的部分"。检查没通过后，"仍然应用"只对同一份选择有效。

**实施分层**：

1. 服务端按文件部分应用：`selection` 只带路径、临时索引建树、对 S 跑检查、剩下的部分变基、`partial` 结果
2. 服务端按代码块：固定差异参数、代码块行号替换、"全选必须等于快照"的校验、只能整文件选的规则
3. 界面：文件和代码块勾选、"应用所选"、e2e

---

## 8. Bukit 集成

### 8.1 获取 Bukit

> **现行设计（2026-11-12 核对代码，`bukit/install.ts`、`bukit/locate.ts`）**，取代下面 M1–M6 时的写法：
> - **只用应用自己装的 Bukit**：按"最新正式版 → 内置版本 2.0.15 → 以前应用装的 2.0.12、2.0.11"的顺序找 `~/.bukitjalil/bin/bukit-<版本>/`。**不再支持设置里的自定义路径，也不找系统 `PATH`**（`bukitPath` 设置已删除）
> - **安装最新正式版**：设置页打开时向 GitHub API 查 `releases/latest`（结果缓存 10 分钟，`BUKITJALIL_OFFLINE=1` 时不查），接受任何 `x.y.z` 版本，安装包的 SHA-256 **采用 GitHub API 返回的资源 `digest`**；查不到或没有可用的安装包时，用代码里固定的 2.0.15 安装包和 SHA-256 兜底。安装需要用户点击确认；安装成功并确认 `bukit version` 输出对应版本后，删除其他所有 `bukit-*` 目录
> - **信任模型的变化**：M1–M6 的规则是"代码里固定 SHA-256，不在运行时信任下载来的校验值"。现在对最新版信任的是 GitHub API 报告的摘要：能保证下载内容和 GitHub 上的资源一致，但不能防止 Bukit 发布账号被盗后上传的恶意版本，也意味着一个没有经过 BukitJalil 核对的 Bukit 版本可能被装上。是否保留这个做法见 16
> - 平台没有官方安装包时，安装接口返回 400 `bukit.unsupported_platform`
>
> 内置兜底版本 2.0.15 的安装包：
>
> | 安装包 | SHA-256 |
> | --- | --- |
> | `bukit-2.0.15-osx-arm64.tar.gz` | `c1bf7fd8573f7fbfcc5cb755e01646f010f4b6beef92509a29b1b3429618df99` |
> | `bukit-2.0.15-linux-x64.tar.gz` | `41fce998b56cdddeb42c143580733470128b2dc06898b955d79a91068f22ca7d` |
> | `bukit-2.0.15-win-x64.zip` | `a76489043d56093d4995c3390a2930f071a6dc8cfd158d5ca83a0d19afe1d2e0` |
>
> 从 2.0.12 升到 2.0.15 的源码差异核对本文没有记录，应补上（参照下面 2.0.11 → 2.0.12 的写法）。

以下是 M1–M6 时的设计，保留作为记录：

- 首次启动检查：设置里的自定义路径 → `~/.bukitjalil/bin/bukit-2.0.12/` → 以前应用装的 `~/.bukitjalil/bin/bukit-2.0.11/` → 系统 `PATH` 里的 `bukit`
- 都没有时，界面提示从 Bukit GitHub Release v2.0.12 下载对应平台的包（需用户确认），解压到 `~/.bukitjalil/bin/`
- 完整性校验：v2.0.12 的 Release 附带 `checksums.txt`、`checksums.json` 和 `release-manifest.json`（已核对）。BukitJalil 在代码里固定三个平台安装包的 SHA-256，下载后比对，不在运行时信任下载来的校验文件：

  | 安装包 | SHA-256 |
  | --- | --- |
  | `bukit-2.0.12-osx-arm64.tar.gz` | `0be48b9da79569988257650028517833a73907e1cd49c76d60fbcb243621c33a` |
  | `bukit-2.0.12-linux-x64.tar.gz` | `1dbb37c0227570c25e71fd1ff9574c95f9217ded6c681add31f19e8653479823` |
  | `bukit-2.0.12-win-x64.zip` | `5ccaac503af7c417f1e457ee4cb8631dd276644df84b88e792d4c8fc0378d0b6` |

  上表和 GitHub 发布页给出的摘要、`checksums.txt` 一致；osx-arm64 包已下载核对（2.0.11 的三个包 M1 都下载核对过）

- 解压安全（现在仍然适用）：先解压到临时目录，逐个检查压缩包条目，拒绝绝对路径、含 `..` 的路径和符号链接（防止解压到目标目录外），检查通过后再整体移动到 `~/.bukitjalil/bin/bukit-<版本>/`，并确认可执行文件存在、`bukit version` 输出对应版本；安装成功后删除以前应用装的版本。每个包都只有两个文件，没有子目录：`bukit` + `libSkiaSharp.dylib`（macOS）、`bukit` + `libSkiaSharp.so`（Linux）、`bukit.exe` + `libSkiaSharp.dll`（Windows）。SkiaSharp 是图片处理用的原生库，必须和 `bukit` 放在同一目录，不能只拷可执行文件。tar 包的条目名带 `./` 前缀（`./bukit`），条目检查要先规范化再比较；Linux 版是动态链接 glibc 的，Alpine 等 musl 系统跑不了
- 平台：官方只提供 osx-arm64、linux-x64、win-x64，**没有 Intel Mac（osx-x64）和 Linux ARM 版本**。原计划让这些平台的用户自己编译 Bukit 并在设置里指定路径；自定义路径删除后，这些平台目前无法使用 BukitJalil 构建网站（打包脚本本来也只支持 macOS arm64、Windows x64、Linux x64，见 M7）
- 启动时执行 `bukit version`，版本不是 2.0.x 时警告；低于 2.0.11 时提示升级（`deploy --token-env` 等行为依赖 2.0.11，见 M6）；2.0.11 仍算可用，但应用装的或 PATH 里的版本低于 2.0.12 时，设置里提供升级安装（更新的版本不会被"升级"回 2.0.12）（自定义路径的 Bukit 不提示）

> Bukit 官方说明常规公开二进制发布已暂停，例外发布需要管理批准；2.0.12（2026-11-09）是当前最新的公开版本。因此固定 2.0.12，同时支持用户指定自己编译的 Bukit 路径。
>
> **从 2.0.11 升到 2.0.12 的影响**（核对了两版的源码差异 `v2.0.11..v2.0.12`，3 个提交、11 个文件）：只改了路由，内容里已经百分号编码的 `url` / `aliases` 字段（例如 `/%e8%81%94/`）先解码一层再生成目录，并输出 `event=route.url.decoded` / `route.alias.decoded` 警告；含 `/`、`\`、`.`、`%`、控制字符或不可见字符的编码保持不动，路径安全检查照旧在解码之后执行。配置结构、命令参数、退出码、SEO / GEO 报告格式、starter 主题资源和 `guide/skills` 都没有变化（starter 用 `make-starter.sh` 从 v2.0.12 重新生成，文件逐字节相同，只更新来源记录；`skills/sources.yaml` 同样只改标签和提交）。用官方 osx-arm64 包重跑了全部单元测试和端到端测试
>
> **从 2.0.8 升到 2.0.11 的影响**（逐项核对了两版的源码差异，并用官方 2.0.11 安装包重跑了 M1 脚本）：多语言 worktree 隔离、Notion token 要求、插件宿主、各命令退出码都没有变化；`deploy` 新增了 `--token-env`（默认 `GITHUB_TOKEN`）和 `--repo`；`content.media` 新增 `downloadHosts`、`skipHosts`、`onFailure`（不是路径字段，`blockPrivateNetworks` 仍默认为 `true`）；`build` 收到 Ctrl+C（SIGINT）时会取消并回滚，而不是直接退出（见 8.2）

### 8.2 调用封装

```ts
// packages/server/src/bukit/runner.ts（示意）
runBukit(args: string[], opts: { cwd: string; env?: Record<string, string>; timeoutMs?: number; signal?: AbortSignal })
  : Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }>
```

- 只用参数数组调用，不经过 shell
- 默认超时：check / doctor 60 秒，build 5 分钟。超时或用户停止时先发 SIGINT（2.0.11 起 `build` 会取消并回滚构建、保留内容源缓存），10 秒内没退出再强制结束
- 调用 Bukit 前先拿网站操作锁（7.2），在 `ai/` 里构建前先做快照，保证工作区干净（多语言网站的构建要求，见 7.2）
- 环境变量里带上 7.3 的 git 加固（`GIT_CONFIG_NOSYSTEM`、`GIT_CONFIG_GLOBAL`、`GIT_CONFIG_COUNT` 等），因为 Bukit 会自己启动 git。例外：`deploy` 会自己删掉 `GIT_CONFIG_COUNT` 一组变量，所以 `bukit/runner.ts` 给 deploy 不传这一组，靠 deploy 在新建的临时仓库里操作来保证安全（见 7.3 和 M6）
- **`TMPDIR` 指向应用自己的目录** `~/.bukitjalil/tmp/bukit/`（M1 实测）：Bukit 把多语言构建用的临时 worktree（`bukit-i18n-worktrees/`）、构建租约和锁文件（`bukit-build-leases-v1/`）放在系统临时目录，发布也在那里建临时目录。最小环境里没有 `TMPDIR` 时会退回 `/tmp`，多个用户共用、权限不可控（沙箱环境里直接被拒绝）。Bukit 用完会删掉临时 worktree，网站仓库里不留登记
- 退出码**按命令分别解释**，不用一张通用表。M1 实测（`bukit-exit-codes.sh`，单语言网站，2.0.8 和 2.0.11 结果相同）：

  | 情况 | `config check` | `doctor` | `build` |
  | --- | --- | --- | --- |
  | 正常 | 0 | 0 | 0 |
  | 未知配置字段、YAML 语法错误 | 1 | 2 | 2 |
  | 缺少 `NOTION_TOKEN` | 1 | 1 | 2 |
  | frontmatter 格式错误 | 0（不检查内容） | 1 | 2 |
  | 用到的模板语法错误或缺失 | 0 | 1 | 3 |
  | 没用到的模板语法错误 | 0 | 1 | 0 |

  所以：`config check` 只能发现配置问题，`bukit_check` 必须同时跑 `doctor`；check / doctor 非 0 一律当作"检查不通过"，把输出交给界面和 AI；`build` 用 0 / 2 / 3 区分成功、配置或内容错误、渲染错误，其他非 0 当作运行失败
- **`PATH` 固定为 `<私有 bin 目录>:/usr/bin:/bin`**，不继承服务进程的 `PATH`。私有 bin 目录里只有一个指向 git 的符号链接（`bukit/runner.ts` 的 `ensureBinDir`）；不直接加 git 所在目录，因为那里（如 Homebrew 的 bin）可能也有 `sass` 或 `magick`。M1 实测（`bukit-safety.py`）：Bukit 按名字从 `PATH` 里找 `sass` / `dart-sass`（`theme.scss`）和 `magick` / `convert`（图片处理），用户用 Homebrew 装了这些程序时就会被 AI 写的网站触发；sass 还能 `@import` 绝对路径，把站点外的样式文件编进输出。固定 `PATH` 后这些功能只给出警告并跳过
- `--log-format json`（M1 实测）：`build` 输出 JSON 行（`ts`、`level`、`msg`，`msg` 里是 `event=… key=value`），失败时输出一个结构化错误文档（`cli-error.v1`，含 `exitCode`）；`doctor` 不支持这个参数，仍输出文本。`runner.ts` 对 build 用 JSON 解析，对 check / doctor 按文本处理

### 8.3 使用的命令

| 场景 | 命令 |
| --- | --- |
| 配置检查 | `bukit config check --config site.yaml` |
| 诊断 | `bukit doctor --config site.yaml` |
| 配置结构 | `bukit config schema --output <tmp>.json` |
| 构建预览 | `bukit build --config site.yaml --output .bukitjalil-build/<buildId> --base-url <basePath> --no-clean --log-format json`，`basePath` 是这次检出的 `site.baseUrl` 经 `previewBasePath` 校验后的值（`/` 或 `/a/b/`，见 8.4；不合规时不构建，结果为 `base_url`）（只在 `worktrees/<siteId>/ai/` 或 `worktrees/<siteId>/main/` 里执行，不在用户的网站目录里执行） |
| SEO / GEO / 发布审计 | `bukit seo audit --dir <out>`、`bukit geo audit --dir <out>`、`bukit publish audit --dir <out>`（M4 以后） |
| 发布 | 依次执行 `config check`、`doctor`、`build --output <相对目录> --log-format json`（不加 `--base-url`，由 Bukit 读网站自己的 `site.baseUrl`；预览传的是同一个值）、`publish audit --dir <相对目录>`，加上根目录跳转页后执行 `bukit deploy --config site.yaml --skip-build --output <相对目录> --repo <仓库> --branch <分支> --token-env BUKIT_DEPLOY_TOKEN`（M6，`deploys/service.ts`，见 14 节 M6） |

### 8.4 预览

- **输出目录的约束**（已核对 Bukit CLI 文档）：Bukit 的清理逻辑拒绝清理"当前项目以外的路径"和非空且没有输出标记的目录，构建时的清理也走同一套规则。所以不能直接把 `--output` 指向 `~/.bukitjalil/previews/` 并加 `--clean`
- **做法**：每次构建输出到项目内一个全新的空目录 `.bukitjalil-build/<buildId>/`（已在排除规则里），使用 `--no-clean`；构建成功后把目录整体移动到 `~/.bukitjalil/previews/<siteId>/<buildId>/`；失败也删除临时目录
- 改动集预览在 `worktrees/<siteId>/ai/` 里构建，正式版本预览在 `worktrees/<siteId>/main/` 里构建，都不在用户的网站目录里产生任何文件
- **每份预览一个端口，挂在网站的 baseUrl 下**（2026-11-13 起，16 第 8 条；之前固定用 `--base-url /` 挂在根路径）：由 BukitJalil 服务端（同一个 Node 进程）托管构建输出，不启动 `bukit preview` / `bukit dev`。每个网站的"正式版本"和"当前改动集"预览各占一个端口，打开预览时从 47881 起按需分配，网站关闭或空闲 30 分钟后释放；端口上的 `basePath`（构建记录的 `report.basePath`，没有就是 `/`）指向该预览当前显示的那次构建，换构建时原子切换；`basePath` 不是 `/` 时，访问 `/` 和不带结尾斜杠的前缀跳转到前缀，前缀之外一律 404，多语言网站的入口跳转也带前缀（`preview/pool.ts`）。`basePath` 只允许由 `[A-Za-z0-9._~-]` 组成的路径段（`preview/base-path.ts`），因为它来自 AI 能改的 `site.yaml`，又会进入 Bukit 的参数和预览服务的路由；比 Bukit 自己的规则（只要求以 `/` 开头）严，不合规的网站仍能发布，只是不能预览。AI 的 `bukit_build` 用同样的值。同一个端口会先后托管不同构建、甚至不同网站，所以预览端口的所有响应都带 `Cache-Control: no-store`，避免浏览器显示上一次构建的缓存页面，让用户审核的内容和实际构建不一致
- **当初为什么不用路径前缀**（M1 实测，`make-starter.sh` + `check-base-url.py`；2026-11-13 改为挂在网站真实的 baseUrl 下，原因见本段末）：用 `--base-url /preview/<siteId>/<buildId>/` 构建 starter 网站时，Bukit 自己生成的链接都遵守前缀，但模板和内容里手写的根路径不会被改写：starter 主题的标签索引页用 `{{ term.url }}`、内容里的 `![](/assets/x.png)`、RSS 里的图片都指向 `/…`，在预览里 404。主题模板靠手动拼 `base_url`，AI 写的模板很容易漏掉。用 `--base-url /` 加独立端口，所有根路径都天然正确。这里的前缀是 BukitJalil 为预览加的、发布时并不存在的路径，所以当时不用前缀是对的；但网站自己的 `baseUrl`（GitHub Pages 项目站点的 `/<仓库名>/`）发布时真实存在，同样的手写根路径发布后也会 404。预览改用网站真实的 baseUrl 后，这类链接在审核预览里就会坏掉，而不是发布后才坏；`baseUrl` 是 `/` 的网站不受影响。starter 模板在子路径下是否全部正确（Bukit 2.0.15 的标签链接已带 baseUrl），由 Bukit 行为测试覆盖（16 第 7 条）
- 也不用每次构建一个 `*.localhost` 子域名：Chrome、Firefox 自己解析 `*.localhost`，但 macOS 系统解析器不解析（M1 实测 `b-123.localhost` 返回 ENOTFOUND），Safari 等走系统解析的浏览器打不开
- 界面用 iframe 显示，可以切换"正式版本"和"当前改动集"两份预览
- 每个网站保留最近 10 次构建输出，旧的自动清理；清理时始终保留最新的一次正式版本构建和最新的一次改动集构建（界面上两个预览切换按钮对应的就是它们）
- 每个预览端口校验 `Host` 头：只接受 `127.0.0.1:<该端口>` 和 `localhost:<该端口>`，其他一律 421（M1 已用测试服务器验证）。防止 DNS 重绑定：外部网页把自己的域名解析到 127.0.0.1 后，就能以同源身份读取预览内容（预览里可能有用户还没发布的内容）
- 预览服务对每个请求的文件先 `lstat`：路径上任何一级是符号链接就返回 404，`realpath` 必须在该次构建的输出目录内；构建输出搬到 `previews/` 之前也先扫描一遍，发现符号链接就判定构建失败
- **预览与管理界面隔离**：预览页面的内容来自 AI 生成的网站，必须当作不可信内容。只限制 Cookie 的 `Path` 挡不住它——Cookie 是否携带看请求地址，同源页面里的脚本照样能带着 Cookie 调用 `/api`。所以：
  - 预览由服务端在**另外的端口**（47881 起，只监听 127.0.0.1）提供，和管理界面不同源，浏览器的同源策略阻止它读写 `/api`
  - 预览的每个响应都带 `Content-Security-Policy: sandbox allow-scripts allow-popups; connect-src 'none'; form-action 'none'`（**不给 `allow-forms`**），即使用户在新标签页直接打开，页面也运行在不透明来源里，脚本也不能用 `fetch` / `XMLHttpRequest` 向任何地址（包括管理端口）发请求
  - iframe 同样加 `sandbox="allow-scripts"`（不给 `allow-same-origin`、`allow-forms`）
  - **端口不同不等于跨站**：浏览器判断 Cookie 是否同站时不看端口，`127.0.0.1:47881` 发往 `:47880` 的请求照样带 `SameSite=Strict` 的 Cookie。所以光靠换端口挡不住表单提交、`<img>` 之类的跨端口请求，管理端 API 必须自己防跨站请求（见 11 节"跨站请求"）
  - **M1 实测**（`preview-isolation.mjs`，内置浏览器 Chromium 内核，在新标签页直接打开恶意预览页）：页面脚本看到的来源是 `null`；`fetch`（带 JSON 和自定义头、`no-cors`、读取 GET 接口）和 `sendBeacon` 都被 `connect-src 'none'` 拦下；表单提交被沙箱拦下（没有 `allow-forms`）；`document.cookie`、`localStorage` 抛出 `SecurityError`；管理端没有收到任何请求。curl 验证了管理端的规则：`Origin` 是预览端口、`null`、`Content-Type` 不是 JSON 时都返回 403，Host 不对返回 421。内置浏览器会自己拦截跨端口的子资源请求，所以又用 Playwright 1.65.0 在 Chromium 158、Firefox 159、WebKit 27.2 里跑了一遍（`preview-isolation-browsers.mjs`，18 项通过），包括预览嵌在管理界面 iframe 里和直接打开两种情况：
    - 三种浏览器里 `fetch`、`sendBeacon`、表单提交都没有到达管理端，没有任何操作被执行；脚本看到的来源都是 `null`，`document.cookie`、`localStorage` 都抛 `SecurityError`
    - `<img>` 跨端口 GET 都会发出（`Sec-Fetch-Site: cross-site`）。Chromium、Firefox 不带 `SameSite=Strict` 的 Cookie；**WebKit 在预览嵌在管理界面里时会带上**（直接打开预览时不带）。图片请求读不到响应内容，所以这只要求"GET 没有副作用"（11 节），不会泄露数据
    - **预览页能把管理界面嵌进自己的 iframe**：没有防护头时三种浏览器都正常渲染，可以用来诱导点击。所以管理端口所有响应加 `frame-ancestors 'none'` 和 `X-Frame-Options: DENY`，加上后三种浏览器都拒绝渲染（11 节"点击劫持"）
  - `allow-popups` 让预览页能用 `window.open` 打开管理端的 GET 地址（实测会打开新页面显示 JSON）。这是用户可见的顶层页面，预览脚本读不到内容，配合"GET 没有副作用"不构成风险；保留它是为了预览里 `target="_blank"` 的链接能用

### 8.5 构建前的安全检查

网站的 `site.yaml`、主题和内容都可能由 AI 写成：改动集里的是还没审核的 AI 内容，正式版本里的也是 AI 写、用户审核通过的内容（审核时可能漏看一行配置）。所以**不论谁触发、构建哪个版本，所有 Bukit 调用（check、doctor、build、审计、发布）之前都先做同一套检查**，不通过就拒绝并说明原因（AI 触发时原因返回给 AI）：

- **插件**（M1 已核对源码并实测，`bukit-safety.py`）：Bukit 的外部插件只在命令行遇到**不是内置命令**的子命令时才加载（`Program.cs`），配置在 `.bukit/plugins.yaml`，插件按 `plugins/<id>/plugin.yaml` 启动外部进程；`build`、`config`、`doctor`、`deploy` 等内置命令不读这个文件（实测放了恶意配置也不加载）。构建流程里的 `site.plugins` 只是内置插件的开关（`alias`、`analytics`、`archive`、`data-files`、`feed`、`image-processing`、`responsive-images`、`llms-txt`、`menu`、`pages-index`、`pagination`、`related-content`、`search-index`、`sitemap`、`taxonomy`），不启动进程。BukitJalil 只调用内置命令，所以外部插件不会运行；仍保留以下检查作为纵深防御：
  - `site.plugins` 里只允许上面这些内置名字
  - 被跟踪的文件里有 `.bukit/plugins.yaml`、`plugins/` 目录或任何 `plugin.yaml` 时拒绝构建
  - AI 不能写 `plugins/**`、`.bukit/**`（见 6.3）
- **路径字段**：`site.yaml` 里所有表示路径的字段都必须解析到当前检出目录内，不能是绝对路径、不能含 `..`、不能经由符号链接指向外部。至少包括 `content.sources[].markdown.dir`、`content.sources[].notion.cacheDir`、`content.media.downloadDir`、`build.output`、`theme.name`（对应 `themes/<name>`）、`theme.layouts`、`theme.assets`、`theme.static`、`theme.staticTemplate`、`theme.components.*.template`、`theme.scss.entryPoint`、`theme.scss.outputDir`；完整清单 M2 从 `bukit config schema` 输出里逐个字段整理（M1 已确认 `config schema` 可用）。M1 实测：`content.sources[].markdown.dir`、`theme.layouts`、`theme.static`、`theme.assets`、`theme.name`、`build.output`（含 `--output`）、`content.media.downloadDir` 设成绝对路径或含 `..` 时，Bukit 2.0.11 自己就以退出码 2 拒绝（`must be a relative path` / `must not contain '..'`），`theme.scss.entryPoint` 源码里也限制在主题资源目录内。BukitJalil 的检查保留为纵深防御，并让 AI 拿到更早、更明确的原因
- **网络**：`content.media.blockPrivateNetworks` 不能设为 `false`（防止构建时访问本机和内网服务）。M1 实测：默认（不写）时，`downloadToLocal: true` 下内容里指向 `127.0.0.1` 的图片不会被请求；显式设为 `false` 时会被请求。所以检查只拒绝显式的 `false`，不需要关闭 `downloadToLocal`；2.0.11 新增的 `downloadHosts` / `skipHosts` 不需要限制
- **检查的对象是提交，不是工作区**：检查读取要构建的那个提交（改动集的快照、`main` 的提交、要恢复的版本）的 git 对象：`git ls-tree -r -z --full-tree <提交>` 列出全部条目，`git cat-file blob` 读取 `site.yaml` 等需要解析的文件。这样新建、导入时可以在创建任何检出之前就完成检查，检查结果和随后构建的内容完全一致
- **符号链接**：被跟踪的文件里不能有符号链接（`ls-tree` 里 mode 为 `120000` 的条目）。导入的仓库或恢复的旧版本里可能有 `content/x.md -> ~/.bukitjalil/secrets.json` 这样的链接，git 检出时会原样建出来，Bukit 构建时如果跟着读，外部文件就会进入预览甚至被发布。AI 的写工具建不了符号链接，所以直接全部拒绝，不去判断指向哪里。M1 实测：内容文件、内容目录、静态文件是指向站外的符号链接时，Bukit 2.0.11 都不读取、不复制，外部内容没有进入输出；检查仍保留，因为预览和发布还经过 BukitJalil 自己的文件处理
- **Notion 源**：没有 token 时 Bukit 2.0.11 的 check / doctor / build 都会因 Notion 源失败（已核对源码）。改动集预览不传密钥，所以有 Notion 源的网站在 `ai/` 里不调用 Bukit，检查和构建直接返回明确的原因（见 5.1）；Bukit 没有不需要 token 的纯缓存模式（M1 已确认，见 5.1）
- **SCSS、图片处理调用的外部程序**：M1 已确认 Bukit 会按名字从 `PATH` 调用 `sass` / `dart-sass` / `magick` / `convert`，配置不能指定程序路径。处理方式是固定 Bukit 的 `PATH`（8.2），不需要拒绝 `theme.scss` 配置；固定后这些功能跳过并给出警告
- **环境变量**：默认只传最小环境（`PATH`、`HOME`、`LANG`）。Notion token（以 Bukit 读取的 `NOTION_TOKEN` 传入）等密钥**只在构建正式版本或发布时**传入（包括应用改动集后自动触发的正式版本重建），token 来自网站选用的 Notion 数据源（6.5）；改动集预览（还没审核的 AI 内容）不论谁触发都不传密钥
- **实现里另外检查的项**（`bukit/guard.ts`，比上面列的更多）：`site.yaml` 缺失或解析失败（用 failsafe 模式解析，带引号的 `"false"` 也能识别）；输出路由字段（`unsafe_route`）；更多路径字段（`includePaths[]`、`includeGlobs[]`、`theme.shortcodes.*`、集合和分类的模板）；`.gitattributes` 里的 `filter=` / LFS（`lfs`）；只差大小写的同名文件（`case_collision`）

检查逻辑放在 `packages/server/src/bukit/guard.ts`，配一套单元测试（每个路径字段的越界用例、插件、网络开关、符号链接条目、直接读 git 对象而不读工作区）。`bukit-safety.py` 保留为真实 Bukit 的集成测试，升级 Bukit 时重跑。

---

## 9. 服务端 API 与事件

所有接口在 `/api` 下，请求和响应用 `shared` 里的 zod schema 校验。

### 9.1 REST 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/sites` | 网站列表 |
| POST | `/api/sites` | 新建网站 |
| POST | `/api/sites/import/inspect` | 导入前检查目录，不做任何修改：是 git 仓库时返回当前分支和只读原因；不是时返回首次提交会包含的文件清单（按排除规则过滤 `.env*`、`node_modules/`、`dist/` 等），含嵌套仓库时拒绝 |
| POST | `/api/sites/import` | 导入已有目录；不是 git 仓库时需带上 `initGit.files`，必须与用户确认过的清单一致，否则撤销 `git init` 并返回 `site.file_list_changed` |
| POST | `/api/sites/:siteId/recheck` | 重新执行安全检查（配置白名单、构建前检查、`config check`），用于用户修好只读原因之后 |
| POST | `/api/sites/:siteId/open` | 记录最近打开时间，返回 204 |
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
| GET | `/api/sites/:siteId/changes/current` | 当前改动集与文件列表（单个文件的差异另取） |
| GET | `/api/changes/:changeId/diff` | 改动集里单个文件的差异 |
| POST | `/api/changes/:changeId/apply` | 应用；请求体必须带审核指纹 `treeHash`，指纹不符、网站操作锁被占用（会话在运行、构建中等）时返回 409 |
| POST | `/api/changes/:changeId/reject` | 拒绝 |
| GET | `/api/sites/:siteId/history` | 版本历史 |
| GET | `/api/sites/:siteId/history/:commit/diff` | 某个版本的差异；`:commit` 用 zod 校验为完整的十六进制 OID（40 或 64 位），见 7.3 |
| POST | `/api/sites/:siteId/history/:commit/restore` | 恢复到某个版本：生成一个恢复改动集供审核（7.4）；`:commit` 校验同上 |
| POST | `/api/sites/:siteId/builds` | 触发构建（`ref`: `main` / `change`） |
| GET | `/api/sites/:siteId/builds` | 构建记录（最近 50 条，不含报告） |
| GET | `/api/sites/:siteId/builds/:buildId` | 单次构建，含报告 |
| GET | `/api/sites/:siteId/audit` | SEO / GEO 报告（`ref`: `main` / `change`，默认 `main`）：最新一次成功构建的完整问题清单和对比，见 10.4；还没有带报告的成功构建时返回 404 `audit.not_built`；`ref=change` 而没有 open 改动集时返回 404 `change.not_found` |
| POST | `/api/sites/:siteId/preview` | 打开预览（`ref`: `main` / `change`）：把该网站的预览端口指向最新一次保留了输出的构建，返回 `url`、`port`、`buildId`、`commit`；还没有成功的构建时返回 404 `preview.not_built`。会占用端口，所以用 POST |
| GET | `/api/settings` / PUT `/api/settings` | 全局设置（含界面语言、上次选择的目录） |
| GET | `/api/fs/dirs?path=` | 目录选择器：列出 `path` 下一层的子目录名（只有目录，不跟随符号链接），`path` 缺省为主目录；用于新建和导入网站（5.2） |
| GET | `/api/git/identity` | 全局 git 的 `user.name` / `user.email`，只用来预填设置里的提交身份 |
| PUT | `/api/sites/:siteId/plugins/:pluginId` | 开关一个内置插件：生成一个改写 `site.plugins` 的改动集，照常审核（10.2） |
| GET / PUT | `/api/sites/:siteId/deploy` | 发布状态 / 保存部署设置（发布账号、仓库、分支、自定义域名）；保存会直接提交到默认分支，见 M6 |
| POST / GET | `/api/sites/:siteId/deploys` | 开始发布 / 发布记录 |
| GET | `/api/sites/:siteId/deploys/:deployId` | 单次发布，含报告 |
| POST | `/api/sites/:siteId/deploys/:deployId/stop` | 停止发布 |
| GET / POST | `/api/publish-accounts` | 发布账号列表 / 添加（token 只写不读，界面显示末四位） |
| PUT / DELETE | `/api/publish-accounts/:accountId` | 修改 / 删除发布账号 |
| GET / POST | `/api/data-sources` | Notion 数据源列表 / 添加 |
| PUT / DELETE | `/api/data-sources/:dataSourceId` | 修改 / 删除数据源 |
| GET | `/api/data-sources/:dataSourceId/notion/databases` | 用该数据源的 token 列出 Notion 数据库 |
| GET | `/api/models` | 可用模型 |
| PUT | `/api/providers/:provider/key` | 保存 API Key |
| DELETE | `/api/providers/:provider/key` | 删除设置页保存的 API Key（来自环境变量的返回 409） |
| POST | `/api/providers/:provider/test` | 测试连接 |
| POST | `/api/providers/:provider/oauth` | 开始 OAuth 登录（不支持的提供商返回 `model.oauth_not_supported`） |
| GET / DELETE | `/api/providers/:provider/oauth/:id` | OAuth 登录进度 / 取消 |
| POST | `/api/providers/:provider/oauth/:id/answer` | 回答提供商在登录过程中的提问 |
| DELETE | `/api/providers/:provider/oauth` | 登出（删除 OAuth 凭据） |
| GET / POST | `/api/custom-models` | 自定义模型列表 / 添加（6.5） |
| PUT / DELETE | `/api/custom-models/:id` | 修改 / 删除自定义模型 |
| GET | `/api/skills` | 技能列表和是否启用（6.4） |
| GET | `/api/pi` | Pi SDK 版本和 npm 上的最新版本（`?refresh=1` 重新查询；`BUKITJALIL_OFFLINE=1` 时不查） |
| GET | `/api/git` | git 状态（路径、版本、是否满足最低版本） |
| POST | `/api/git/install` | 通过 Homebrew 安装或更新 git（`git/brew.ts`），返回 202；不可用时 400 `git.install_unavailable`，已在安装时 409 `git.install_running` |
| GET | `/api/bukit` | Bukit 状态：路径、版本、最新正式版本、是否可升级、当前平台是否有官方安装包、安装进度（8.1） |
| POST | `/api/bukit/install` | 下载并安装最新正式版 Bukit（界面确认后调用，查不到时装内置的 2.0.15），返回 202；进度由界面轮询 `GET /api/bukit` 的 `install` 字段（只有一个下载，不值得为它单开 SSE）；当前平台没有官方安装包返回 400 `bukit.unsupported_platform`，已在安装时返回 409 |
| GET | `/api/rg` | rg 状态（`ok` / `missing` / `mismatch`）、固定版本、当前平台是否有安装包、安装进度（6.3） |
| POST | `/api/rg/install` | 下载并安装 ripgrep 15.2.0（界面确认后调用），返回 202；当前平台没有安装包返回 400 `rg.unsupported_platform`，已在安装时返回 409 `rg.install_running` |
| GET | `/api/health` | 健康检查：返回 `ok`、应用版本和 git 状态（版本 ≥ 2.38）；Bukit 和 Pi 的状态分别见 `/api/bukit`、`/api/pi` |
| GET | `/api/events` | SSE 事件流（9.2） |

> M2 第 5 层实现说明（面板接口）：
> - `ref` 现在只支持 `main`（默认分支的最新提交）；`ref=change` 返回 404 `change.not_found`，改动集快照随 M4 接入。`path` 必须是仓库内的相对路径，不能有空段、`.`、`..` 或 NUL，否则返回 400 `request.invalid_query`。
> - 文件接口用 `as` 参数区分三种返回：
>   - `json`（默认）：返回文件说明，`kind` 为 `text`、`image`、`binary`、`too_large`、`symlink` 或 `submodule`。内联上限 1 MB。超过时只读文件头几个字节：是图片（不超过 16 MB）时 `kind` 为 `image`，否则为 `too_large`。
>   - `raw`：只返回按文件头字节识别出的 PNG、JPEG、GIF、WebP，上限 16 MB，响应头带 `nosniff`，CSP 末尾追加 `sandbox`。其他类型返回 400 `panel.not_file`。
>   - `download`：以 `application/octet-stream` 和 `Content-Disposition: attachment` 下载，上限 64 MB。
> - 配置、主题、数据面板都从提交里的 `site.yaml` 读取，YAML 的重复键和别名炸弹都按错误处理。
>   - 主题目录取 `themes/<theme.name>`，`theme.layouts`、`theme.assets`、`theme.static` 按相对主题目录的路径列文件，每类最多 2000 个。
>   - 数据面板按 `markdown.dir` 列 `.md` 文件，统计 front matter 字段，`mode: data` 源再给出第一个文件的 front matter 作为示例，更多文件时 `itemsTruncated` 为 true。每次请求最多读 2000 个文件、共 32 MB，单个文件上限 256 KB，超出时 `truncated` 为 true。目录写成 `content/posts/`、`./data` 或 `.` 都按同一个目录处理。`includePaths` 和 `includeGlobs` 暂未处理。
> - 仓库配置不安全时，返回 409 `site.repo_unsafe`；网站文件夹已不是 git 仓库时，返回 409 `site.not_repo`；默认分支不存在时，返回 409 `site.branch_missing`。`panel.too_large` 的 `max` 是实际碰到的上限。

> M2 第 6 层实现说明（构建与预览托管）：
> - `POST /builds` 先检查网站可用（否则 409 `site.read_only`）、能找到受支持的 Bukit（否则 409 `build.bukit_missing`），再拿网站操作锁（构建中其他操作返回 409 `site.busy`），记下默认分支的提交后返回 202 和 `running` 状态的记录。构建在后台进行，界面轮询 `GET /builds`（列表不含报告，报告用 `GET /builds/:buildId` 取）；服务正在关闭时返回 503 `server.shutting_down`；`build.start` / `build.end` 事件随 SSE 一起接入。`ref=change` 返回 404 `change.not_found`，随 M4 接入。
> - 构建步骤：对该提交跑构建前检查（不通过时结果为 `refused`，带原因，网站同时变成只读）；使用 Notion 源而没有绑定数据源时结果为 `notion`，网站的 `config_check` 同时记为 `notion`；绑定了数据源就带它的 token 构建。新建或导入后的第一次构建由 `SiteService` 在网站加入后触发，不论从哪里加入，它构建的正是刚检查过的提交，所以不重复检查；只有绑定了 Notion 数据源的网站（新建时选了 Notion）会再跑一次构建前检查，因为是否传 token 由这次检查决定；在 `worktrees/<siteId>/main/` 检出该提交，执行 8.3 的构建命令；成功且输出里没有符号链接时，把输出搬到 `previews/<siteId>/<buildId>/`。
> - 结果字段 `outcome`：`ok`、`config_or_content_error`、`render_error`、`stopped`、`failed` 来自 Bukit 的退出码；另有 `refused`、`notion`、`symlink`、`interrupted`（服务重启时还在运行的构建）、`error`（BukitJalil 自己出错）。报告里有 JSON 日志中的警告和错误，以及 stderr 的末尾。
> - 已打开的预览在新构建成功后立即切换过去；打开预览期间刚好有构建完成时，打开后再切到最新的一次。最新的输出被外部删掉时，退回到更早一份还在的输出。每个网站保留最近 10 份构建输出，最新的正式版本和改动集构建、以及预览正在显示的那份始终保留；构建记录最多保留 50 条。预览端口空闲 30 分钟后释放（只有被接受的请求才算使用，Host 不对的请求不算），移除网站时一并释放。服务关闭时，正在运行的构建会收到 SIGINT。

### 9.2 SSE 事件

`GET /api/events` 每个浏览器标签页**只开一条**连接，所有网站的事件都走这一条（浏览器对同一主机最多 6 条 HTTP/1.1 连接，SSE 会一直占着；每个网站一条的话打开几个网站后普通请求就会卡住）。事件格式 `{ id, type, siteId, sessionId?, data }`（`id` 用于 `Last-Event-ID`；会话事件带 `sessionId`；`resync` 没有 `siteId`；没有事件带 `changeId`，类型见 `shared/src/sessions.ts` 的 `ServerEvent`），界面按 `siteId` 分发：

| 事件 | 来源 | 界面用途 |
| --- | --- | --- |
| `session.status` | 会话启动、运行、空闲、出错 | 侧栏状态点 |
| `message.delta` | Pi `message_update`（text_delta） | 流式文字 |
| `message.end` | Pi `message_end` | 落定消息 |
| `tool.start` / `tool.update` / `tool.end` | Pi `tool_execution_*` | 工具调用卡片 |
| `run.settled` | Pi `agent_settled` | 结束加载状态 |
| `change` | 改动集的完整状态快照：状态、快照树（审核指纹）、差异摘要、是否可应用 | 改动面板、文件树、审核卡片都按最新快照渲染 |
| `build.start` / `build.end` | Bukit 构建 | 预览面板状态 |
| `deploy` | 发布开始、进入下一步、结束（M6），带完整的发布记录 | 发布面板状态 |
| `session.summary` | AI 调用 `summarize_changes` | 改动说明（M4 存进改动集） |
| `session.updated` / `session.deleted` | 新建、重命名、分叉、删除会话 | 各标签页的会话列表 |
| `resync` | 重连时缺了事件 | 重新拉取会话、消息和改动集 |

- 改动集只用一个 `change` 事件推送完整状态，不再分 `updated` / `ready` / `invalidated` / `resolved` 四种：界面不需要按顺序拼状态，丢一条也不会错，下一条就是完整的
- 断线重连：带 `Last-Event-ID`。服务端保留一个重放缓冲：`message.delta` 合并成每条消息的最新累计文本，`change` 每个网站只留最后一条，总大小上限 1 MB；超过上限或 `Last-Event-ID` 已不在缓冲里时，发一个 `resync` 事件，界面重新拉取会话消息和当前改动集

---

## 10. 界面设计

### 10.1 布局

```text
┌ 顶栏：BukitJalil · 当前网站名 · 构建状态 · 设置 ─────────────────────────────┐
├──────────────┬──────────────────────────────┬────────────────────────────┤
│ 网站列表      │ 对话                          │ 面板标签：                   │
│ ＋ 新建网站    │  消息流（Markdown、工具调用卡片） │ 预览｜改动｜文件｜配置｜主题｜数据 │
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
- **界面多语言**：MVP 提供简体中文和英文，首次打开跟随浏览器语言（`navigator.languages`，不匹配时用中文），设置页可切换，选择保存在设置里
  - 不引入 i18n 库：文案按语言放在 `web/src/i18n/<locale>.ts`，以中文文件为基准定义类型，其他语言缺少键时 `tsc` 报错；插值用简单的 `{name}` 占位；日期、数字、相对时间用 `Intl`
  - 服务端返回给界面的错误和状态不写死某种语言：响应里是 `code` + `params`（如 `{ code: "site.dir_not_empty", params: { path } }`），由界面翻译；服务端日志统一用英文
  - Bukit、git 的原始输出和 AI 的回复按原样显示，不翻译；返回给 AI 的工具结果（如"搜索工具未安装"）也不属于界面文案
  - 开发规范：新增界面文字必须同时提供中英文，CI 里的 `tsc` 保证不漏

### 10.2 关键交互

- **网站首页**（未选会话时）：网站概况、最近构建、最近改动、"开始一个新对话"
- **工具调用卡片**：折叠显示工具名和目标文件，展开看参数和结果；`edit` / `write` 显示该文件的小差异
- **审核卡片**：改动说明、文件列表（新增 / 修改 / 删除）、检查结果；点"查看差异"跳到右侧"改动"面板
- **文件面板**：顶部切换"正式版本 / 改动中"；改动中的文件标记颜色
- **只读**：面板不直接改文件；在文件上提供"让 AI 修改这个文件"快捷动作，把文件路径带入输入框。唯一的例外是配置面板里的内置插件开关：它不直接写文件，而是生成一个改写 `site.plugins` 的改动集，照常审核（`PUT /api/sites/:siteId/plugins/:pluginId`）
- **设置页**（M7 之后取代设置对话框，设计见 [plans/2026-11-11-settings-page-design.md](plans/2026-11-11-settings-page-design.md)）：带路由的独立页面，按分区（环境、模型、发布、数据源等）组织；提交身份放在"发布"分区

### 10.3 前端结构

```text
packages/web/src/
├── App.tsx / main.tsx  # 路由、布局、Provider（`app/` 目录目前是空的）
├── features/
│   ├── sites/      # 网站列表、新建、导入、首页
│   ├── chat/       # 消息流、输入框、工具卡片、实时会话状态（store.ts）
│   ├── changes/    # 审核卡片、改动面板、差异、版本历史
│   ├── panels/     # 右侧面板：files / config / theme / data / preview
│   ├── builds/     # 构建记录和报告
│   ├── deploys/    # 发布面板、部署设置
│   └── settings/   # 设置页和各分区
├── components/ui/  # shadcn 生成的组件
├── lib/            # api.ts、events.tsx（SSE）、format、highlight、keyboard、theme、desktop、utils
└── i18n/           # zh-CN.ts、en.ts、index.tsx
```

界面状态用 React 状态、TanStack Query，加上 `features/chat/store.ts` 里自写的外部 store（`useSyncExternalStore`，保存实时会话状态）；没有引入状态库（早期计划的 `stores/` 和 zustand 没有采用）。

### 10.4 SEO / GEO 报告面板（2026-11-13 设计）

构建详情里只有审计摘要（每种问题最多列 5 个页面，最多 40 种）。报告面板是右侧单独的标签页"SEO"，放在"数据"后面（Alt+7），用来看完整的问题清单。

- **看哪次构建**：面板顶部切换"正式版本 / 改动中"。正式版本看默认分支最新一次成功、带审计报告的构建；改动中看当前改动集最新一次成功的构建。都没有时显示"还没有构建"，可以直接点构建。
- **接口**：`GET /api/sites/:siteId/audit?ref=main|change`，返回：
  - `build`：构建 id、提交、结束时间。
  - `summary`：这次构建保存的 `BuildAudit`（构建详情用的同一份）。
  - `issues`：从这次构建保留的输出里重新读 `.bukit/seo-report.json` 得到的完整问题列表（严重程度、代码、页面、说明），按严重程度、代码、页面排序，最多 `AUDIT_MAX_ISSUES`（5000）条，超过时 `issuesTruncated`。和摘要一样：没有 `site.url` 时，只因为它才有的警告不逐条列出，只计数。输出已经被清理（只有最新的才一定保留）或读不出时为 `null`，界面退回显示摘要里的分组。
  - `stale`：同一版本有更新的构建没有成功（没有报告），显示的报告可能已经过时，界面提示。
  - `previous`：对比的那次构建和它保存的摘要。正式版本和上一次成功、带报告的正式构建比；改动中和正式版本最新一次的报告比（看这次改动让问题变多还是变少）。没有可比的构建时为 `null`。
  - `compare`：按"严重程度 + 代码"分组比较数量，每组是 `new` / `fixed` / `more` / `fewer` / `same`；外加错误数、警告数、GEO 分数的变化。上一次的摘要最多只存了 40 种问题，被截掉时 `previousTruncated`，没列出的种类记为 `unknown`，不说成"新增"（当前的清单被截断而只能用摘要时同理，不说成"已修复"）。两次构建之间设置或去掉了 `site.url` 时，一边把只因它才有的警告折叠了、另一边逐条列出，这些种类也记为 `unknown`。任一边没有 SEO 报告时错误数、警告数的变化为 `null`。
  - 找构建按版本分别查最近 50 次结束的构建，很多次改动集构建不会挤掉正式构建。完整清单按输出目录缓存（输出构建后不再变），最多 4 份。
- **只读与安全**：报告来自 AI 可能写过的内容，读文件沿用 `readJson`（大小上限、不跟随符号链接、宽松 schema），所有文字截断（代码 100 字符、页面和说明 300 字符）。接口只读，不调用 Bukit，不给 AI 工具。
- **界面**：
  - 顶部：页数、错误 / 警告 / 提示数、GEO 分数和 llms.txt，各自带和上一次相比的增减；没有 `site.url` 时显示和构建详情相同的提示。
  - 页面筛选：下拉列出有问题的页面（"整个网站"代表 route 为空的问题），选中后清单只显示这个页面的问题。
  - 问题清单：按严重程度分组，每条显示代码、说明和页面；对比结果用"新增 / 已修复 / 变多 / 变少"标记，已修复的种类单独列在最后。
  - 构建详情里的审计摘要保留，加一个"在 SEO 面板里查看"的链接。
- **让 AI 修**：按钮新建一个对话，把当前筛选下的问题（最多 30 条，每条代码、页面、说明，多出的写"另有 N 条"）连同"请修复这些 SEO / GEO 问题，改完后构建检查"写进输入框，用户可以改了再发，不自动发送。只读网站不显示这个按钮。

---

## 11. 安全

| 风险 | 措施 |
| --- | --- |
| 本机其他网页调用本地服务 | 只监听 127.0.0.1；校验 `Host`（防 DNS 重绑定）和 `Origin`；启动时生成随机 token，用 `http://127.0.0.1:47880/?token=…` 打开浏览器，服务端校验后设置 `HttpOnly; SameSite=Strict; Path=/api` 的 Cookie，并重定向到不带 token 的地址；所有 `/api` 请求必须带这个 Cookie。**token 只能用一次**：浏览器用过之后，终端记录、浏览器历史、其他用户 `ps` 里看到的浏览器启动参数都失效；在终端按回车打印新的一次性地址（之前没用过的地址同时作废）；用过或错误的 token 只重定向到首页、不设置 Cookie，界面提示去终端拿新地址。Cookie 名带管理端口（`bj_session_47880`），浏览器的 Cookie 不分端口，这样同一台机器上的两个实例不会互相顶掉登录。重启服务会换 token 和会话 |
| AI 越权写文件 | 工具白名单 + 路径闸门（6.3）+ 只改工作副本 + 人工审核 |
| AI 执行命令 | 不开放 `bash`；Bukit 只通过固定参数的自定义工具调用；所有构建前检查插件和编译选项（8.5） |
| 路径穿越（文件接口） | 所有路径参数 `realpath` 后必须在网站目录或工作副本内 |
| 密钥泄露 | 模型密钥来自 `~/.bukitjalil/pi/auth.json` 或提供商环境变量（6.5），自定义模型密钥在 `~/.bukitjalil/pi/custom-models.json`；GitHub token 按发布账号在 `~/.bukitjalil/publish-account-tokens.json`，Notion token 按数据源在 `~/.bukitjalil/data-source-tokens.json`（都是 0600 明文，应用目录 0700）。依赖操作系统账户隔离：不防同一用户 malware、管理员/root、备份/云同步和未加密磁盘；Windows 的 `chmod(0600)` 不是完整 ACL。启动时清理无主 token 和临时文件。所有 token 不进数据库、不进日志、不返回浏览器；子进程只拿到显式构造的最小环境（7.3、8.5），只按 8.5 和 M6 的规则显式传给 Bukit（见 6.5） |
| 预览页面脚本（AI 写的 JS） | 预览在另一个端口提供（不同源）+ 响应头 `CSP: sandbox allow-scripts allow-popups; connect-src 'none'; form-action 'none'` + iframe `sandbox`（见 8.4） |
| DNS 重绑定读取预览内容 | 每个预览端口同样校验 `Host`，只接受 `127.0.0.1:<端口>` / `localhost:<端口>`（见 8.4） |
| 管理端口上的 XSS（AI 写的 SVG / HTML 文件、对话里的 Markdown） | 管理界面响应头 `CSP: default-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src http://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`，另带 `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`Cross-Origin-Opener-Policy: same-origin`、`Cross-Origin-Resource-Policy: same-origin`（`security/headers.ts`），没有 `unsafe-inline` 和 `unsafe-eval`；HTML 页面每次响应生成一个 nonce，CSP 加 `style-src 'self' 'nonce-…'`，页面里的 `<meta property="csp-nonce">` 把它交给 Radix（shadcn 的对话框、下拉框运行时插入的滚动锁定样式），没有 nonce 的 `<style>` 照样被拦；zod 设为 `jitless`，不用 `new Function`；端到端测试断言界面运行时没有任何 CSP 违规；文件接口不在管理端口直接打开 SVG / HTML / PDF，位图带 `nosniff` + `CSP: sandbox`（见 9.1）；对话 Markdown 不渲染原始 HTML，不加载远程图片 |
| 绕过路径闸门（`@`、`~`、`file://`、Unicode 空格经 Pi 归一化后变成别的路径） | 闸门放在工具的 `operations` 里，检查的是 Pi 归一化之后真正要读写的绝对路径；`tool_call` 再快速拒绝这些前缀（见 6.3） |
| 跨站请求（预览页或其他网页向 API 发表单、图片请求等） | Cookie 不按端口隔离，所以 API 自己防护：① 所有非 GET 请求的 `Origin` 必须**完全等于**管理界面地址（`http://127.0.0.1:47880`；开发模式下是 Vite 地址，见 3.3），缺失或为 `null` 一律拒绝；② 非 GET 请求必须是 `Content-Type: application/json` 并带自定义请求头 `X-BukitJalil: 1`（普通表单发不出这种请求，跨源时会触发预检，而服务端不允许任何跨源预检）；③ 所有 GET 接口都没有副作用（M1 实测 WebKit 会给预览 iframe 里的 `<img>` 跨端口 GET 带上 `SameSite=Strict` 的 Cookie，见 8.4）；④ 服务端不返回任何 `Access-Control-Allow-*` 头 |
| 点击劫持（预览页把管理界面嵌进自己的 iframe，诱导用户点"应用"等按钮） | 管理端口的所有响应带 `CSP: frame-ancestors 'none'` 和 `X-Frame-Options: DENY`（M1 实测：不加时三种浏览器都会在预览页里渲染管理界面，且同站请求照样带 Cookie；加上后都拒绝渲染，见 8.4） |
| AI 读取密钥或系统文件 | 读类工具同样受路径闸门限制，只能访问工作副本（见 6.3） |
| 仓库里的符号链接让构建或预览读到外部文件 | 构建前检查拒绝所有被跟踪的符号链接；预览服务 `lstat` 拒绝符号链接（见 8.4、8.5） |
| Pi 自动下载未校验的 `rg` / `fd`，或使用用户本机的 Pi 目录 | 加载 Pi 前设置 `PI_CODING_AGENT_DIR`、`PI_OFFLINE=1`；BukitJalil 自己安装固定版本的 `rg` 并校验 SHA-256，`bin/rg` 缺失时阻止 `grep`；`find` 用 Node 实现，不调用 `fd`（见 6.1、6.3） |
| AI 借 Bukit 插件 / 编译选项间接执行代码 | 只调用 Bukit 内置命令（外部插件只在非内置命令时加载）；Bukit 的 `PATH` 固定为只含 git 链接的私有目录加 `/usr/bin:/bin`，找不到 `sass`、`magick` 等外部程序；构建前检查插件配置，AI 不能写 `plugins/**`、`.bukit/**`（见 6.3、8.2、8.5） |
| AI 借 `site.yaml` 路径字段或远程素材读取工作副本外的文件、访问内网 | 所有构建前校验路径字段必须在检出目录内，强制 `blockPrivateNetworks: true`（见 8.5） |
| 密钥进入未审核内容的构建 | 只有构建正式版本或发布时才传密钥，改动集和 AI 工作副本的构建从不传（见 8.5） |
| token 发往第三方服务 | GitHub token 只发给 `api.github.com`（检查仓库权限）和 `bukit deploy`；Notion token 只发给 `api.notion.com`（列出数据库）和默认分支上的 Bukit 调用（网站检查、正式版本构建、发布时的 check / doctor / build）；地址写死在代码里，不接受用户或网站配置指定（见 6.5、M6） |
| 安装被篡改的 Bukit | 下载后校验 SHA-256；最新版的摘要来自 GitHub API，内置兜底版本的摘要写死在代码里；解压检查条目（见 8.1，信任模型的取舍见 16） |
| AI 读到被跟踪的 `.env` | 闸门禁止读取和列出任何一级以 `.env` 开头的路径，`grep` 也排除（见 6.3） |
| 导入仓库借 git 配置或钩子执行命令（`core.fsmonitor`、hooks、filter、`gpg.program` + 签名、`config.worktree` 等） | 所有 git 调用统一加固（关闭 fsmonitor、钩子、签名、外部差异和文本转换，不读系统和全局配置，最小环境变量）；仓库和 worktree 级配置按**白名单**检查，在 `git/run.ts` 里每次调用前执行，不满足就只读并拒绝操作（见 7.3） |
| AI 写 `.gitattributes` 触发全局配置里的过滤器（如 git-lfs） | `GIT_CONFIG_GLOBAL`、`core.attributesFile`、`core.excludesFile` 都指向应用自带的空文件；仓库配置白名单不允许任何驱动定义，属性引用的驱动没有来源；不支持 Git LFS（见 7.3） |
| git 参数注入（以 `-` 开头的提交、分支名，例如 `--output=…`） | 提交只接受校验过的完整 OID，分支只用校验过的 `refs/heads/<name>`，版本参数前加 `--end-of-options`、路径前加 `--`（见 7.3） |
| Bukit 自己调用的 git 不带加固参数 | 调用 Bukit 时用 `GIT_CONFIG_NOSYSTEM`、`GIT_CONFIG_GLOBAL`、`GIT_CONFIG_COUNT` 等环境变量传入同样的加固（见 7.3、8.2）；`deploy` 会自己删掉 `GIT_CONFIG_COUNT` 一组，所以 `bukit/runner.ts` 给 deploy 不传这一组；deploy 在网站目录里只执行 `git config --get`，其余操作都在新建的临时仓库里 |
| 应用时覆盖网站目录里被忽略的本地文件（如 `.env`） | `git merge --ff-only --no-overwrite-ignore`，冲突时中止并提示（见 7.2） |
| 审核后内容被改动（AI 仍在运行、排队消息、正式版本已前进） | 网站操作锁 + 审核卡片绑定快照树指纹；指纹一致才允许应用；正式版本前进后用 `merge-tree` 合并并重新审核（见 7.2） |
| 提示词注入（网站内容里夹带指令） | AI 能力本身受限；所有改动必须人工审核，且应用时校验审核指纹 |

---

## 12. 测试策略

| 层级 | 工具 | 覆盖 |
| --- | --- | --- |
| 单元 | Vitest | `shared` 的 schema；`server` 的路径闸门（读写工具、glob 参数）、构建前安全检查 `bukit/guard.ts`（插件、每个路径字段、网络开关、环境变量、符号链接、读 git 对象而不读工作区）、闸门在 `operations` 里检查归一化后的路径（`@`、`~`、`file://`、Unicode 空格）、预览服务拒绝符号链接和错误的 `Host`、文件接口对 SVG / HTML 的处理、git 参数校验（OID、分支名）、Pi 环境变量（`PI_CODING_AGENT_DIR`、`PI_OFFLINE`）在加载 Pi 前生效、防跨站请求中间件、token 存储（发布账号 `publish-accounts.test.ts`、数据源 `data-sources.test.ts`：文件权限、原子写入）、`site.yaml` 解析、差异解析、Bukit 按命令的退出码映射 |
| 服务端集成 | Vitest + 临时目录 | 真实 git（≥ 2.38）：创建网站（`init -b main`）、分离 HEAD 的工作副本、快照、应用 / 拒绝 / 恢复；git 加固（带 `core.fsmonitor`、钩子、`filter`、`gpg.program` + 签名配置、`config.worktree` 的测试仓库，临时 `HOME` 里全局配置定义过滤器、用户全局忽略文件，都不执行任何命令、不影响差异）；正式版本前进时 `merge-tree` 成功（重新审核）和冲突（stale，工作副本没有残留状态）；`--no-overwrite-ignore` 遇到被忽略的同名文件时中止；网站操作锁（应用期间新消息排队）；超过 1 MiB 的差异；多语言 starter 网站在 `ai/` 里快照后构建成功；Bukit 用假程序（脚本模拟输出和退出码），并确认它启动的 git 拿到加固环境变量 |
| Pi 集成 | Vitest + 假模型 | 用 Pi 的自定义提供商注册一个脚本化的假模型，按剧本返回工具调用，验证工具和闸门，不花钱、结果稳定 |
| 真实 Bukit | Vitest 和 Playwright（设置 `BUKIT_BIN` / `BUKIT_TARBALL` 时运行，CI 的 Node 24 任务都设置，见 M5 第 4 层） | 用真实 Bukit（CI 固定 2.0.15，`ci.yml` 里检查版本）构建 starter 模板、安装官方包、走端到端流程 |
| 端到端 | Playwright | 新建网站 → 对话（假模型）→ 审核 → 应用 → 构建 → 预览；拒绝流程；恢复流程；**安全用例**：预览页里的恶意脚本 / 自动提交表单 / 图片请求无法调用管理端 API，新标签页直接打开预览同样无效 |
| 真实模型验收 | 手动脚本（`scripts/accept-real-model.ts`） | 每个里程碑结束跑一次，用真实模型完成一个建站任务 |

覆盖率目标：`server` 核心模块（agent 闸门、changes、bukit）行覆盖 ≥ 80%。

---

## 13. 工程规范

- **提交**：Conventional Commits（`feat:`、`fix:`、`docs:`、`chore:`、`test:`）
- **分支**：功能在 `pi-harness-ui` 上推进；每个里程碑一个 PR 合入 `main`
- **代码风格**：Biome 统一格式和检查；TypeScript `strict: true`、`noUncheckedIndexedAccess: true`
- **CI**（GitHub Actions）：`pnpm install --frozen-lockfile` → `biome check` → `tsc --noEmit` → `vitest run` → `playwright test`；macOS 和 Linux 各用 Node 24 跑一遍（MVP 支持的平台，见 1.2），Linux 上再用最低版本 Node 22.19.0 跑一遍（这一项用假 Bukit）；另有 `windows-latest` 上打包桌面版并跑 `packaged.spec.ts` 的任务，失败不阻塞（`continue-on-error`，见 M7）；`bukit-latest.yml` 每天（加上手动触发；GitHub 只从默认分支运行定时和手动任务，所以合入 `main` 后才生效）在 macOS 和 Linux 上用应用的安装代码下载最新的 Bukit 正式版（校验 GitHub 报告的 SHA-256），只跑 `test/bukit-behavior.test.ts`（16 第 7 条）
- **日志**：服务端结构化日志（JSON 行），写到 `~/.bukitjalil/logs/`，不记录消息正文和密钥
- **文档**：每个里程碑更新 README 的状态说明；较大的新功能先在 `docs/plans/` 写设计和实施计划，验收记录放 `docs/acceptance/`，结论同步回本文（原计划的 `docs/decisions/` 没有使用）

---

## 14. 实施计划

估算按一名开发者（配合 AI 编程）计，单位为工作日，含测试。总计约 **31–40 个工作日**完成 MVP（M0–M5），不含 M6、M7。评审、七轮审计和一次代码审查新增的安全工作（防跨站请求、预览隔离、构建前检查、路径与符号链接校验、git 加固与配置白名单、自己实现的 git 调用、固定版本的 rg、快照式改动集与网站操作锁）已计入 M0–M4。

### M0 工程骨架（3–4 天）

| 任务 | 产出 |
| --- | --- |
| pnpm workspace、三个包、tsconfig、Biome | 能 `pnpm install`、`pnpm check` |
| server：Hono 启动、`/api/health`、静态托管 web | `pnpm dev` 打开页面 |
| web：Vite + React + Tailwind + shadcn 初始化，三栏空布局 | 可拖动三栏 |
| 安全基础：127.0.0.1、管理端口和预览端口都做 Host 校验、token Cookie、防跨站请求（Origin 完全匹配、JSON + 自定义头、无 CORS，见 11 节）、管理界面 CSP、预览端口骨架（CSP sandbox + `connect-src 'none'`） | 外部来源和跨端口表单请求被拒 |
| SQLite 与迁移机制 | `app.db` 自动创建 |
| 界面多语言骨架：`web/src/i18n/zh-CN.ts`、`en.ts`，语言检测和切换，服务端错误 `code` + `params` 约定（10.1） | 三栏空界面能在中英文之间切换 |
| 确认 TypeScript 7.0.2 与 Vite、Vitest、Biome、shadcn 兼容 | 不兼容则退回 TypeScript 6 并更新本文 |
| CI 工作流 | PR 自动检查 |

**M0 结果（2026-11-10）**：全部完成。
- `pnpm check`（Biome + 四个类型检查）通过；`pnpm test` 51 项单元测试通过（安全规则、数据库迁移、静态文件、预览端口池、git 版本、多语言）；`pnpm e2e` 在 Chromium、Firefox、WebKit 里共 27 项通过，包括 M1 的预览隔离用例（`e2e/preview-isolation.spec.ts`，对真实服务端）
- `pnpm dev` 实测：打印 Vite 地址，token 登录经 Vite 代理设置 Cookie，接口只接受 Vite 的 Origin
- pnpm 12 默认不运行依赖的安装脚本，遇到未表态的包会报错：`pnpm-workspace.yaml` 的 `allowBuilds` 里把 esbuild 设为不运行（平台二进制已作为可选依赖安装）
- 管理端口额外加了 `Cross-Origin-Resource-Policy: same-origin`、`Cross-Origin-Opener-Policy: same-origin`、`Referrer-Policy: no-referrer`、`base-uri 'none'`、`form-action 'self'`；构建后的 `index.html` 没有内联脚本，符合 CSP
- 本机 Node 22.22 运行正常（`node:sqlite` 有实验性提示）；CI 用 Node 24，Linux 上加跑最低版本 22.19.0
- M0 深度审计后的修改：
  - 登录 token 改为一次性，终端按回车打印新地址；用过或错误的 token 只重定向到首页（不再返回固定语言的错误页）；Cookie 名带管理端口
  - 管理界面 CSP 给 HTML 页面加每次响应的 `style-src` nonce，否则 M2 用到 shadcn 对话框时 Radix 插入的样式会被拦；zod 设为 `jitless`，避免 `new Function` 探测触发 CSP 违规；端到端测试检查界面没有 CSP 违规
  - 构建产物里不存在的文件（如旧版本的 `/assets/*.js`）返回 404，只有页面路由回退到 `index.html`，不会把 HTML 当作 JS 缓存一年
  - 未处理的异常：`/api` 返回 `{code: "server.internal"}`，详情写进 JSON 日志；所有 `/api` 响应（包括 401 / 403）都带 `Cache-Control: no-store`
  - `~/.bukitjalil`、`logs/` 每次启动都收紧为 700，`app.db`（及 `-wal` / `-shm`）为 600
  - 预览遇到符号链接返回 404（和 8.4 一致），并加了 `realpath` 必须在构建目录内的检查；同一预览并发打开不再泄漏 HTTP 服务
  - Vite 关闭 CORS、加防嵌入头；开发脚本给 Vite 的环境变量改为白名单；Biome 的导入限制补上不带 `node:` 前缀的内置模块和子路径
  - 端到端测试的服务端改为每个浏览器项目一个（Playwright worker 固件），每个测试拿新的一次性登录地址
- CI 通过（GitHub Actions，Ubuntu + Node 24、macOS + Node 24、Ubuntu + Node 22.19.0 三组，包括三种浏览器的端到端测试）。调通过程中的两处修正：`actions/setup-node` 自带的 pnpm 缓存会在 corepack 装好 pnpm 之前找 pnpm，已关闭，依赖缓存由 `actions/cache` 负责；Node 22.19.0 自带的 corepack 装不了 pnpm 12，CI 统一先装 corepack 0.34.6（0.36 要求 Node ≥ 22.22.2）

**验收**：`pnpm dev` 打开三栏空界面，能在中英文之间切换；`/api/health` 报告 git 可用且版本 ≥ 2.38；不带 Cookie、`Origin` 不符或为 `null`、缺少 `X-BukitJalil` 头、非 JSON 的非 GET 请求都被拒绝（有自动化测试）；预览端口的响应带 `CSP: sandbox`；管理端口的响应带 `frame-ancestors 'none'` 和 `X-Frame-Options: DENY`；`preview-isolation-browsers.mjs` 的用例改写成 Playwright 测试并在三种浏览器里通过；CI 通过。

### M1 技术验证（3–4 天）

在 `packages/server/spikes/` 写最小验证脚本，逐项确认 6.6、8.2、8.4、8.5 的待验证项。

**第一批结果（2026-11-09，本机 macOS arm64、git 2.39.5、Node 22.22）**：Bukit 脚本先在 2.0.8 本地编译版（`3a87ab5`）上跑通，Bukit 2.0.11 发布后又用官方 osx-arm64 安装包（SHA-256 已核对）重跑，结果完全相同。

| 脚本 | 验证内容 | 结果 |
| --- | --- | --- |
| `bukit-git.sh` | `git init -b main`；分离 HEAD 的工作副本；快照（作者和提交者分开）；多语言网站不快照时被拒绝、快照后能构建且包含新文件；Bukit 启动的 git 是否遵守 `GIT_CONFIG_*` | 11 项通过；需要给 Bukit 设 `TMPDIR`（8.2） |
| `pi-gate.mjs` | 闸门写在 `operations` 里能挡住归一化前后的各种路径；`tools` 白名单与自定义工具 | 35 项通过；`grep` 会搜到 `.git` 文件，需要过滤结果（6.3） |
| `bukit-exit-codes.sh` | 各命令在各类错误下的实际退出码；Notion 无 token | 见 8.2 的表；Notion 没有不需要 token 的模式（5.1） |

**第二批结果（同一环境，Bukit 2.0.11 官方安装包）**：

| 脚本 | 验证内容 | 结果 |
| --- | --- | --- |
| `make-starter.sh` + `check-base-url.py` | 从 Bukit 内嵌的 StarterTheme 生成博客网站；`--base-url` 路径前缀是否覆盖所有链接 | 能构建；手写的根路径不受前缀影响，预览改为每份一个端口、`--base-url /`（8.4）；Bukit Labs 的模板和 Core 有出入（5.2） |
| `bukit-safety.py` | 外部插件、各路径字段的绝对路径和 `..`、符号链接、`sass` 等外部程序、内网图片下载 | 24 项通过；固定 Bukit 的 `PATH`（8.2）；8.5 的检查据此简化 |
| `pi-session.mjs` | 用 Pi 的 faux 假模型跑完整会话：不联网、技能进系统提示且能读、`tool_call` 阻止、`sequential` 顺序执行、事件字段、会话文件、`createBranchedSession` 分叉 | 15 项通过（6.6） |
| `git-worktrees.sh` | 两个分离 HEAD 的工作树创建、重置、清理、复用；排除规则；`--show-scope` / `--includes` 能看到 worktree 级和 include 进来的配置 | 12 项通过；快照后要清理被忽略的文件（7.2） |
| `pi-session-reset.mjs` | 工作副本重置后继续用同一个会话（内存中继续、从文件重新打开） | 7 项通过（6.6） |
| deploy 的 git 包装脚本实测 | `bukit deploy` 在哪里执行 git、哪些环境变量能传进去 | 加固变量被删，写操作都在临时仓库，仍然安全（M6） |
| ripgrep 发布记录 | 定 rg 版本和各平台 SHA-256 | 15.2.0，6 个安装包的摘要和官方 `.sha256` 一致（6.3） |
| 本机 71 个仓库的配置统计 | 仓库配置白名单会误伤多少真实仓库 | 原白名单几乎全部误伤，已补充（7.3） |
| `preview-isolation.mjs` | 恶意预览页能否调用管理端 API；Host 校验；防跨站规则 | 在 Chromium 内核里全部拦下（8.4） |
| `preview-isolation-browsers.mjs` | 同上，用 Playwright 在 Chromium、Firefox、WebKit 里跑，加上 iframe 嵌入、`<img>` 带 Cookie、预览嵌入管理界面 | 18 项通过；WebKit 会给 `<img>` 带 Cookie；管理端口要加防嵌入的响应头（8.4、11 节） |
| 三个平台的 Bukit 安装包 | 下载核对 SHA-256，检查压缩包条目 | 全部一致；每包两个文件，tar 条目带 `./` 前缀，Linux 版依赖 glibc（8.1） |

还没验证的项（不影响进入 M2 的设计）：

- 用真实模型观察开新改动集后 AI 是否先重新读文件（M3；机制已用假模型验证，见 6.6）

**验收**：每一项都有可运行的脚本和结论，更新本文档"待验证"清单；如有不可行项，在进入 M2 前调整设计。

### M2 网站项目与只读面板（7–9 天）

| 任务 | 产出 |
| --- | --- |
| Bukit 程序检测、下载（需确认）、版本检查 | 设置页显示 Bukit 状态 |
| starter 模板：从 Bukit 源码复制 StarterTheme，补 `theme.yaml`、最小 `site.yaml` 和示例内容，用真实 Bukit 构建通过 | `templates/starter/` |
| 构建前安全检查 `bukit/guard.ts`（插件、路径字段、网络、环境变量，见 8.5）+ 单元测试 | 检查模块 |
| 目录选择器（`/api/fs/dirs` + 界面组件，见 5.2）| 新建、导入时选择位置 |
| 新建网站、导入网站（含不满足安全规则时的"只读"状态，见 5.1；先检查 git 对象再创建检出）、`git/run.ts`（`spawn` 流式读取 + 加固参数 + 参数校验 + 机器可读输出解析）与配置白名单检查（7.3）、`readGlobalIdentity()`、网站列表、归档、移除（删除引用和排除规则段落）、网站操作锁（同一网站已有操作时返回 409 `site.busy`）。服务端已实现（第 4 层），界面已在第 7 层实现；移除时仓库配置不安全就跳过删除引用和 `worktree prune`，在返回的 `leftovers` 里列出 | 侧栏网站列表 |
| 文件树（按目录懒加载，读 git 对象）和文件预览（Shiki、Markdown、位图；SVG / HTML / PDF 通过预览端口或下载，见 9.1） | 文件面板 |
| 配置面板（结构化 + 原文）。目录树、文件、配置、主题、数据五个接口已在第 5 层实现（见 9.1 的说明），界面已在第 7 层实现 | 配置面板 |
| 主题面板、数据面板（Markdown 集合、data 源、Notion 源只显示配置） | 主题、数据面板 |
| 构建（main）与预览托管（独立预览端口 + CSP sandbox）。服务端已在第 6 层实现（见 9.1 的说明），界面已在第 7 层实现 | 预览面板 |

**验收**：能新建一个网站并构建预览；能导入一个已有 Bukit 网站；六个面板中除"改动"外都能正常显示；全程没有编辑入口。

> M2 第 7 层实现说明（界面）：
> - 路由：`/` 和 `/sites/:siteId`（react-router）；右栏当前标签和文件面板选中的文件放在地址参数 `panel`、`file` 里，刷新和复制链接都能保留。打开网站时调用 `POST /sites/:siteId/open`，侧栏按最近打开排序。
> - 侧栏：新建、导入两个对话框，只读网站带锁图标，归档的网站折叠在底部。目录选择器可以逐级点击，也可以直接输入绝对路径后按回车前往。没有提交身份时，新建和导入对话框里会出现身份字段，预填全局 git 身份。
> - 中栏在 M3 之前显示网站主页：位置、默认分支、状态和只读原因，构建、重新检查、归档、移除按钮，最近构建列表（点开看报告）。移除后回到首页，有残留时在首页提示。
> - 构建状态靠轮询：有构建在运行时每秒拉一次 `GET /builds`，结束后刷新网站和预览。顶栏显示网站名和最新构建的状态。
> - 文件面板：目录按层懒加载；文本用 Shiki 高亮（JavaScript 正则引擎，不用 WebAssembly；按 token 输出带颜色的 span，符合管理页 CSP），超过 20 万字符不高亮；Markdown 默认渲染（front matter 单独显示，图片只显示替代文字，站内相对链接不可点击），可切换到源码；位图通过 `as=raw` 显示；其他文件提供下载。"改动中"版本按钮先禁用，M4 接入。
> - 配置面板分摘要和原文；主题面板显示 `theme.yaml`、三类文件和 `site.yaml` 里的主题参数；数据面板每个内容源一张卡片，`mode: data` 源附前 8 个常用字段的表格。
> - 预览面板：iframe 带 `sandbox="allow-scripts"`，按构建编号换 key，新构建完成后自动加载；没有成功构建时显示构建按钮。
> - 设置对话框：提交身份、Bukit 状态与安装（先确认再下载，安装进度每秒轮询）、自定义 Bukit 路径。语言选择仍在顶栏。（后来：自定义 Bukit 路径已删除，见 8.1；设置对话框已改为设置页，见 10.2。）
> - 窄屏抽屉布局未做，留到 M7。

**M2 结果（2026-11-10）**：全部完成，验收的四项都由端到端测试覆盖。
- `pnpm check` 通过；`pnpm test` 204 项单元测试通过；`pnpm e2e` 在 Chromium、Firefox、WebKit 里共 45 项通过；新增的 `e2e/sites.spec.ts` 用 `--repeat-each=3` 连跑三遍（54 项）都通过。
- 第 8 层新增 `e2e/sites.spec.ts`，每个浏览器 6 项：
  - 新建网站：自动完成第一次构建，预览 iframe 带 `sandbox="allow-scripts"`、地址在预览端口、能显示构建结果；文件面板高亮 `site.yaml`、渲染 Markdown，文件路径写进地址；配置、主题、数据面板有内容；刷新后标签保持。
  - 构建失败：结果显示为"配置或内容错误"，报告里有 Bukit 的错误日志和 stderr。
  - 导入还不是 git 仓库的文件夹：先列出要提交的文件，勾选确认后才能导入；导入后网站可用、构建成功、文件夹里有了 `.git`。
  - 导入带 `plugins/` 的仓库：检查结果就显示原因；导入后为只读，构建按钮禁用，侧栏有锁图标，只读面板照常可用；在默认分支上删掉插件目录后"重新检查"，网站变为可用。
  - 归档、恢复、移除：移除后回到首页，网站从列表消失，文件夹保留。
  - 设置：显示 Bukit 版本、提交身份和自定义路径；新建网站对话框每次打开都是空的。（后来设置改为设置页、自定义路径已删除，测试改为经 `settings-nav-*` 导航，替身 Bukit 装进应用目录，见 `e2e/fixtures.ts`。）
- 断言同时接受中英文文案：整套运行时 `app.spec.ts` 最后把语言留在中文，`sites.spec.ts` 跟着在中文界面里跑；单独运行时是英文。
- 每个测试最长 120 秒（构建在慢的机器上要更久）；测试文件结束时清掉它写入的 Bukit 路径（当时）和提交身份，同一个服务端上后面的测试不受影响。
- 构建默认用一个替身 Bukit（shell 脚本，CI 里没有 Bukit）；设置 `BUKIT_BIN` 时改用真实 Bukit，本机用 Bukit 2.0.11 跑过：15 项通过，"构建失败"一项依赖替身而跳过。
- 界面在第 8 层给新建、导入、网站操作按钮加了 `data-testid`。
- 还没有在 CI 上跑过（本地提交未推送）。

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

M3 分层实施（每层做完先审计、修复，再提交）：

1. agent 核心：Pi 环境变量、延迟加载 Pi、模型运行时、内存设置、ResourceLoader、系统提示、会话记录、会话服务（排队、空闲释放、停止、删除），先不开放任何工具
2. 权限闸门 + 6 个内置工具（`find` 用 Node 实现），`tool_call` 快速拒绝
3. rg 安装（固定版本、校验、设置页显示状态）
4. 建站工具和技能打包；`bukit_check` / `bukit_build` 接入构建前检查和网站操作锁
5. 会话 API 和 SSE 事件流
6. 对话界面
7. 模型设置（提供商、模型、API Key、测试连接）
8. 端到端测试和文档

> M3 第 1 层实现说明（agent 核心）：
> - 只有 `src/agent/` 能引用 Pi（Biome 规则检查）。`src/agent/pi.ts` 用动态 `import()` 加载 Pi，加载前检查 `PI_CODING_AGENT_DIR`、`PI_OFFLINE`、`PI_TELEMETRY`、`PI_SKIP_VERSION_CHECK` 已设置；加载后不接受另一个目录。`main.ts` 在创建应用目录后立即设置这些变量
> - 新增应用目录 `~/.bukitjalil/pi/`（权限 700）和 `pi/bin/`
> - 会话记录在 `sessions` 表，会话文件固定为 `sessions/<siteId>/<sessionId>.jsonl`，创建会话时只写记录，第一条消息时才建 `AgentSession`；文件不存在时 `SessionManager.open` 会新建会话并保留这个路径
> - AI 工作副本 `worktrees/<siteId>/ai/` 在第一次运行时从默认分支最新提交检出；已有的工作副本不重置（重置属于 M4 的改动集）。只读网站不能创建会话
> - 同一网站同一时间只运行一个会话，其他会话的消息按顺序排队，排队中再发的消息合并成一次运行；正在运行的会话收到新消息时用 `steer`（或 `followUp`），会话还在打开、尚未开始输出时，消息在当前这次提问结束后接着发，不另排一次。停止会话会中断运行或取消排队；会话还在打开时停止，就不再向模型提问，也不写会话文件。空闲 10 分钟释放 `AgentSession`，下次发消息时从会话文件恢复。网站后来变成只读时，发消息直接返回 409 `site.read_only`
> - 事件：转发 Pi 的会话事件，另有状态事件 `queued` / `running` / `idle`（运行失败时带错误码）。SSE 在第 5 层接入
> - 还没有模型设置，发消息返回 409 `agent.no_model`；会话不存在返回 404 `session.not_found`
> - 第一次检出 `ai/` 时要拿网站操作锁（和构建、移除一样在网站仓库里执行 git）；拿不到时这次运行以 `site.busy` 结束。整次会话运行暂不拿锁：现在 AI 只动 `ai/`，而用到 `ai/` 的构建、重置、快照分别在第 4 层和 M4 加入，届时一起接入（操作锁现在是"忙就立即失败"，排队等待要在那时设计）
> - 删除会话、移除网站、关闭服务时，先停止相关运行（包括还在打开的），并等它结束，再删除文件或关闭数据库；被丢弃的排队会话收到 `idle` 状态
> - 单元测试用 Pi 的 faux 假模型：环境变量缺失时拒绝加载、会话在 `ai/` 里运行且没有工具、不联网、Pi 只写自己的目录、网站里的 Pi 和 agent 文件不生效、从文件恢复历史、排队顺序、打开中追加消息、打开中停止和删除、停止排队、无模型和只读时拒绝、拿不到锁、重命名和删除、移除网站和关闭服务时等待运行结束、只读网站不能建会话

> M3 第 2 层实现说明（权限闸门和 6 个内置工具）：
> - `src/agent/gate.ts` 的 `PathGate`：路径先取真实路径（已存在的部分用 `realpath.native`，不存在的部分拼回去；途中遇到悬空的符号链接直接拒绝，否则写入会跟着链接落到外面），再按三种用途检查。比较文件名时一律转小写，并去掉 NTFS 流后缀（`:…`）和末尾的点、空格（Windows 会把 `.git.` 存成 `.git`），各平台规则相同。`read` 必须在工作副本里，或在只读目录（技能，第 4 层接入）里；`list`（`ls` / `grep` / `find` 的目录）只能在工作副本里；`write` 在工作副本里，并且不在受保护的路径上。任何一级是 `.git`（不分大小写）都拒绝
> - 受保护、不能写的路径：顶层的 `dist`、`.bukit`、`.cache`、`.bukitjalil-build`、`plugins`，任何一级的 `node_modules`，任何位置名为 `plugin.yaml` / `plugin.json` 或以 `.env` 开头的文件，都不区分大小写；写入内容上限 1 MB，含 NUL 字节视为二进制并拒绝；写文件时带 `O_NOFOLLOW`（平台支持时），最后一级是符号链接就失败。构建目录清单和 `.git/info/exclude` 共用 `sites/exclude.ts` 的 `BUILD_DIRS`。`edit` 读文件也按 `write` 检查，受保护的文件一开始就改不了
> - `src/agent/tools.ts` 用 Pi 的 `create*ToolDefinition` 生成 6 个同名工具，传入带闸门的 `operations`，通过 `customTools` 注册，`tools` 白名单就是这 6 个名字，没有 `bash`
>   - `read` 不提供 `createReadStream` 和 `detectImageMimeType`：已核对 1.5.1 源码，传入 `operations` 后 Pi 只用传入的函数，没有回退到本地文件系统
>   - `ls` 隐藏 `.git`；指向工作副本外的符号链接在 `stat` 时被闸门拒绝，Pi 会跳过这一项
>   - `find` 用 Node 实现：从根目录逐级遍历，不进入 `.git`、`node_modules`、顶层的构建目录，不跟随符号链接，最多看 2 万项，停下时在结果末尾说明结果不完整；返回的路径以 Pi 解析出的搜索路径为前缀（应用目录路径里有符号链接时也能得到相对路径）；模式里有 `/` 时按相对路径匹配，否则按文件名匹配（和 fd 的 `--glob` 一致），用 `path.posix.matchesGlob`。不读 `.gitignore`；`*` 不匹配以点开头的文件
>   - `grep`：BukitJalil 的 `pi/bin/rg` 不存在或不是可执行文件时直接拒绝（校验 SHA-256 在第 3 层）；没有传 `glob` 时补上排除 glob（现为 `!**/{.[gG][iI][tT],.[eE][nN][vV]*}`，`.env*` 同样排除，见 6.3），让 rg 搜索时就跳过 `.git`，不占匹配数上限；结果里路径含 `.git` 段的匹配行和上下文行仍然去掉（AI 自带 `glob` 时靠这一步；1.5.1 的上下文行也由 rg 输出）。CI 安装 rg，真实 `grep` 的测试在 CI 里不会被跳过
> - 每个工具的 `execute` 先检查 `path` 参数：以 `@`、`~`、`file:` 开头或含 Unicode 空格时拒绝，提示用相对路径。被拒绝的操作以工具错误返回给模型，不中断运行
> - 测试：闸门单元测试（相对路径、绝对路径、`..`、指向外部的符号链接文件和目录、悬空的符号链接、Windows 的 `.git.` / `::$INDEX_ALLOCATION` 写法、任意层级和大小写的 `.git`、受保护路径、新建深层目录、技能只读、1 MB 和二进制）；6 个工具直接执行的测试（含 `~`、`@`、`file://`、Unicode 空格；本机有 rg 时还跑真实的 `grep`，确认 `.git` 里的内容搜不到）；会话测试里假模型调用 6 个工具和 `bash`，6 个工具按规则执行，`bash` 不存在，越界读取 `auth.json` 被拒绝。故意去掉闸门的 `.git` 检查或工作副本检查后，相应测试都会失败

> M3 第 3 层实现说明（rg 安装）：
> - `src/agent/rg.ts` 写死 ripgrep 15.2.0 的 4 个安装包（macOS arm64 / x64，Linux arm64 / x64 用 musl 版）：压缩包的 SHA-256，以及包里 `rg` 程序本身的 SHA-256。安装：下载 → 校验压缩包 → 严格解压（只接受发布包的固定结构：顶层目录 `ripgrep-15.2.0-<target>/` 和其中的 `complete/`、`doc/` 目录、13 个固定文件；链接、扩展头、多余或缺少的条目都失败）→ 校验 `rg` → 写到 `pi/bin/` 下的临时文件再改名为 `pi/bin/rg`（权限 755）（那里原来是目录时先删掉）→ 用最小环境运行 `rg --version`：输出别的版本就删掉；没能运行（超时、启动失败、非零退出）时保留已通过校验的文件，安装显示失败并说明 grep 可能用不了。压缩包里只取 `rg`，其他文件不写到磁盘。版本检查和 Bukit 共用 `src/probe.ts`
> - 状态：`pi/bin/rg` 不存在为 `missing`；不是普通文件、大小和写死的不一致、不可执行或 SHA-256 不对为 `mismatch`（先比大小，大小不对的文件不读）。计算结果按文件的 inode、大小、修改时间、权限缓存，文件一变就重新计算，所以 `grep` 每次执行前都能问一次：只有 `ok` 时才执行，`missing` / `mismatch` 都拒绝（取代第 2 层只看"是可执行文件"的检查）。Windows 没有安装包，状态固定为 `missing`、`installable: false`，设置页说明这个平台上不能用 grep
> - 安装模块复用 Bukit 的（8.1）：`download`、`verifySha256`、`readStrictTarGz`（新增可选的目录清单）；新增 `installFile`（单个文件先写临时文件再改名）和通用的安装任务 `InstallJob`（一次只装一个，进度轮询），Bukit 的安装也改用它。共享类型 `InstallProgress`（原 `BukitInstallProgress`）
> - API：`GET /api/rg`、`POST /api/rg/install`（见 9.1 接口表）。设置页新增"搜索工具（ripgrep）"一栏：状态、未安装时说明 AI 暂时只能用 `find` 和 `read`、安装按钮（先确认再下载）、安装进度；进度和确认的逻辑与 Bukit 一栏共用
> - 已在本机用 4 个真实安装包核对：结构检查和两层 SHA-256 都通过，macOS arm64 上完整安装后 `rg --version` 输出 `ripgrep 15.2.0 (rev e89fff89ac)`，状态为 `ok`；在设置页确认了未安装、已安装、文件被改动三种状态的显示
> - 测试：用手工生成的假安装包（真实目录结构，`rg` 换成输出版本号的脚本）测完整安装、压缩包摘要不对、压缩包对但 `rg` 摘要不对、多出文件 / 目录 / 链接 / `..` 条目、版本不对时删除、`rg --version` 运行失败时保留文件、原位置是目录、安装后改动文件（大小变和大小不变）/ 去掉执行权限 / 换成符号链接时状态变化、不支持的平台，以及两个接口（含 409 和 400）；会话测试里假模型调用 `grep`，确认每次都询问 rg 状态，未通过时拒绝、通过后放行；固定值测试检查 4 个平台都有完整的 64 位十六进制摘要。端到端测试检查设置页的 rg 状态和安装确认

> M3 第 4 层实现说明（建站工具和技能打包）：
> - `src/agent/site-tools.ts` 注册 6 个建站工具，`tools` 白名单 = 6 个内置工具 + 6 个建站工具。参数都是名字或短文本，不接受路径；读文件都经过闸门
>   - `site_info`：读工作副本里的 `site.yaml`（经过闸门，指向外面的符号链接被拒绝，上限 256 KB），返回和配置面板相同的摘要（共用 `summarizeConfig`）；解析失败时返回错误说明，不中断
>   - `list_content`：按 `content.sources` 里的 Markdown 源列出文件（可按集合过滤），给出 `title`、`slug`、`publishAt`（没有时用 `date`）、`draft` 和全部字段名；不跟随符号链接、不进 `.git`，最多 500 个文件，单个文件上限 256 KB；Notion 源只说明内容不在工作副本里
>   - `bukit_check`：`config check` 和 `doctor` 都跑，两个都是 0 才算通过，每步带退出码和输出末尾 6000 字
>   - `bukit_build`：构建到 `ai/` 里新的 `.bukitjalil-build/ai-<随机>/`（参数和正式构建共用 `buildArgs`），返回是否成功、页面数（输出里的 HTML 文件数）、警告和错误、输出末尾；输出用完即删，改动集预览在 M4 接入。SEO / GEO 审计摘要也在 M4（8.3）
>   - `bukit_schema`：`bukit config schema` 的结果，按 Bukit 可执行文件的路径和版本缓存；可以只取一个顶层段落，整体超过 6 万字时截断并列出段落名。它不读网站文件，不需要构建前检查
>   - `summarize_changes`：把 AI 写的说明作为 `summary` 事件发出（上限 2000 字），M4 存进改动集
> - `src/agent/ai-bukit.ts`：`bukit_check` / `bukit_build` 每次调用都按顺序做：拿网站操作锁（`ai_check` / `ai_build`；M4 第 1 层已取代：运行期间会话本身持有 `session` 锁，这两个锁名已不存在；拿不到立即告诉 AI 网站正忙，不排队；删除网站时先停止会话和运行、等它们结束，再拿锁，所以不会因为 AI 正在构建而返回“网站正忙”）→ 检查网站不是只读 → 快照 → 对快照提交做构建前检查（8.5）→ 有 Notion 源时拒绝（改动集不传密钥）→ 运行 Bukit，不传任何密钥。两个工具都设 `executionMode: "sequential"`
>   - 快照：`git add -A`（用 pathspec 排除顶层的构建目录和 `node_modules`，即使 `.gitignore` 用 `!dist/` 取消忽略也不会进提交）→ `write-tree` → 和 HEAD 的树相同就直接用 HEAD，否则 `commit-tree -p HEAD`（提交者固定为 `BukitJalil <ai@bukitjalil.invalid>`，只在 BukitJalil 内部使用）→ `update-ref HEAD`。之后工作区干净，多语言构建也能在 `ai/` 里跑（7.2）。M4 的快照在这个基础上加改动集引用
>   - 被 `.gitignore` 忽略的新文件不会进快照，构建前检查看不到，Bukit 却会读到（例如先删掉 `site.yaml`、快照、在 `.gitignore` 里忽略它、再写一个新的）。所以快照前用 `git ls-files --others --ignored --exclude-standard` 找出它们：除了构建目录和 `node_modules`，被忽略的文件直接删掉（它们本来就不会进入网站），并在工具结果里用 `removedIgnoredFiles` 告诉 AI。已跟踪的文件即使被 `.gitignore` 列出也照常进快照
>   - 整次会话运行仍不拿锁，和第 1 层说明一致：现在 `ai/` 只被 AI 自己和它的工具使用，重置、应用等操作在 M4 加入时再让运行拿锁
> - 技能：仓库根目录 `skills/`。`skills/bukit/` 是从本地 Bukit 仓库 `v2.0.11` 标签（`9006a2bd`）取出的 11 个官方技能（现已同步到 v2.0.15、18 个，`bukit-debug` 已被上游移除，见 6.4），每个在开头加一段命令和工具的对应说明；`using-bukit` 去掉 Labs 的说法，预览 / 开发服务器 / 部署的路由改为 `bukit-debug`；`bukit-debug` 里指向 Bukit 文档的链接（文档不随技能复制）换成一句说明。`skills/bukitjalil/` 是新写的 `site-editing`（工具对应表、能改什么、检查 → 构建 → 总结的步骤）、`content-writing`（先看现有文件的写法、starter 的 front matter 约定、不编造联系方式价格和评价）、`multilingual`。Pi 会把技能目录根下的 `.md` 也当成技能，所以来源记录用 `skills/sources.yaml`；Biome 不检查 `skills/`，保持上游原文
> - 会话：`DefaultResourceLoader` 仍设 `noSkills`，另传 `additionalSkillPaths: [skills/]`，Pi 只加载这里的技能；闸门的只读目录就是 `skills/`（现为已启用技能各自的目录，见 6.3；可以 `read`，不能写，不能 `ls` / `grep` / `find`）。系统提示补充了命令和工具的对应，以及先 `site_info` 再修改、改完 `bukit_check` → `bukit_build` → `summarize_changes`
> - 启动时检查 `skills/bukitjalil/site-editing/SKILL.md` 存在，缺少时直接退出并说明，不让每个会话都报内部错误
> - 测试：快照（新提交、HEAD 前进、工作区干净、没变化时不建提交、提交者）；被忽略的新文件被删除并列出而已跟踪的文件照常提交、删掉再写回的 `site.yaml` 被删除、`.gitignore` 取消忽略的构建目录不进提交，`bukit_check` 结果里有 `removedIgnoredFiles`；中止工具调用会停止构建并释放锁；AI 构建期间删除网站成功；Bukit 版本变化后重新取 schema；`bukit_check` 两步都在 `ai/` 里跑、`doctor` 失败；`bukit_build` 的参数、页面数、输出删除、失败结果；构建前检查不通过（`build.output: ../outside`）和 Notion 源时 Bukit 一次都没被调用；锁被占用时立即拒绝、运行期间别的操作拿不到锁、结束后释放；没有 Bukit；`bukit_schema` 只问 Bukit 一次、取段落、截断；`site_info`（含解析失败和指向外部的符号链接）、`list_content`（集合过滤、坏的 front matter、跳过符号链接）、`summarize_changes`。会话测试里假模型调用建站工具：系统提示列出的技能正好是 `skills/` 下的 14 个，技能文件能读、不能写也不能列目录，发出 `summary` 事件，没有 Bukit 时 `bukit_check` 以工具错误返回；去掉闸门的技能只读目录后测试失败。有 `BUKIT_BIN` 时再用真实 Bukit 检查和构建 starter 网站（本机没有 Bukit，未运行）

> M3 第 5 层实现说明（会话 API 和 SSE 事件流）：
> - `src/api/sessions.ts`：9.1 表里的 8 个会话接口。会话返回 `SessionInfo`（不含会话文件路径，带内存里的状态 `idle` / `queued` / `running`）
>   - `GET /api/sessions/:sessionId` 返回会话和当前分支的消息 `{entryId, message}`：会话在内存里时从 `AgentSession` 的会话管理器读（含正在运行的这次），否则从会话文件读（Pi 存下第一条用户消息时就写文件）；还没有文件时为空。文件不是有效的 Pi 会话时，查看、分叉和运行都返回 409 `session.unreadable`，文件保持原样。Pi 1.5.1 把系统提示也存成一条消息，接口和事件流都不返回 `system` 消息
>   - `POST .../messages`：`{text, mode}`，`text` 不能为空、最多 10 万字；`prompt` 和 `steer` 相同（运行中作为 steer，空闲时开始一次运行），`followUp` 在运行中排到这次运行结束后；返回 202
>   - `POST .../fork`：`{entryId}`。从会话文件读（Pi 在每条消息结束时就追加到文件，运行中也可以分叉），用 `createBranchedSession` 写出从开头到这条消息的路径，再改名为新会话自己的 `sessions/<siteId>/<新 id>.jsonl`；新会话沿用原标题。新建、重命名、分叉、删除会话都发 `session.updated`（带会话）或 `session.deleted`，各标签页据此更新列表。消息不存在或原会话还没有文件时返回 404 `session.entry_not_found`；网站只读时 409
>   - 重命名的标题去掉首尾空白，1–200 字，不能有控制字符；`null` 清除标题
> - `src/events/hub.ts` 的 `EventHub`：事件 id 为 `<启动时随机的 8 位十六进制>-<序号>`，服务重启后旧 id 一律视为未知。重放缓冲上限 1 MB：同一会话当前消息的 `message.delta` 合并成一条（重放时为 offset 0、到目前为止的全文，用最新的 id），文字按片段保存，接着上次结尾的增量只追加，不重新拼接和序列化；消息结束时删掉，因为 `message.end` 带完整消息；超过上限时从最旧的开始丢（文字也算在内）。重连时 `Last-Event-ID` 之后的事件有被丢掉的、id 属于别的启动、比最新的还大或格式不对，就只发一个 `resync`（id 为当前最新）。没有 `Last-Event-ID` 的新连接只收到正在生成的回复到目前为止的文字（这部分没有接口能取到），其余状态由界面自己拉取。`change` 每个网站只留最后一条随 M4 加入
> - `message.delta` 的数据是 `{offset, text}`：当前助手消息从 `offset` 开始的文字。界面用 `text.slice(0, offset) + 新文字` 拼接，所以合并后的重放（offset 0）直接替换。只转发 `text_delta`；`message.end` 不带会话条目 id（Pi 在发出事件之后才写入），界面要分叉时在运行结束后重新拉取会话
> - `src/events/bridge.ts` 把会话事件（状态、Pi 的消息和工具事件、`agent_settled`、`summary`）和构建服务新增的 `build.start` / `build.end`（带构建记录，结束时含报告）送进事件流；Pi 的轮次、排队、压缩、重试等事件不转发
> - `GET /api/events`（`src/api/events.ts`）：先发 `retry: 2000`，再发重放，之后按顺序发新事件，每 25 秒发一行注释保持连接。每条连接有自己的发送队列，积压超过 4 MB 就中止这条连接（Hono 的写入在客户端不读时会一直等，而且吞掉错误，所以要中止而不是等写完；浏览器重连后从缓冲补齐或收到 `resync`）。浏览器断开时取消订阅；服务关闭时中止所有事件流
> - 测试：事件流单元测试（id、重放、各种未知 id 时 `resync`、增量合并和消息结束时删除、新连接收到正在生成的文字、改写部分文字、长回复的文字超过上限后 `resync`、超过上限后的 `resync`、关闭）、事件转换（offset、过滤 `thinking_delta`、工具、`run.settled`、`session.summary`、会话列表事件、构建事件）；接口测试另有：会话列表事件、损坏的会话文件、运行中的 steer 和 followUp（steer 先于 followUp，都在同一次运行里）、空闲时的心跳、不读数据的客户端被断开且响应结束；接口测试用 Pi 的 faux 假模型（新建、列表、重命名、删除、404 和 400、没有模型、只读、发消息后事件流里的增量能拼出回复且每条事件都有 id、释放 `AgentSession` 后从文件读到相同的消息、断线重连的重放和 `resync`、停止、分叉后两个会话各自独立、浏览器断开和服务关闭时结束事件流、没有登录 cookie 时 401）；构建测试检查 `build.start` / `build.end`

> M3 第 6 层实现说明（对话界面）：
> - 路由 `/sites/:siteId/sessions/:sessionId` 显示对话；网站主页的"开始对话"新建会话并进入（网站只读时显示提示，不显示按钮）。侧栏在当前网站下列出它的会话（最近的在前），带状态点和"新建对话"
> - `src/lib/events.tsx`：每个标签页一个 `EventSource` 连 `/api/events`。断开后浏览器按 `retry` 自动重连；连接被关闭时显示"连接已断开"，5 秒后重新打开并按 `resync` 处理。事件分发：`session.status` 更新会话列表和会话详情的缓存，变为空闲时重新拉取（拿到条目 id 才能分叉）；`session.updated` / `session.deleted` 更新或移除列表项；构建事件让构建列表重新拉取；`resync` 清空正在生成的状态并让所有查询重新拉取
> - `features/chat/live.ts` 和 `store.ts`：每个会话正在生成的状态（当前消息的文字、本次运行里结束的消息、工具调用、错误、等待接收的消息）放在组件之外的存储里，用 `useSyncExternalStore` 订阅，切换会话不丢。增量按 `offset` 拼接，`offset` 大于已有文字长度的增量丢弃（等重放或 `resync`）；新一次运行开始时清掉上次的错误。消息按角色和时间戳去重，重新拉取到的消息和工具结果替换本次运行里收到的；运行结束时没有页面在看的会话只留下错误，其余等打开时再拉取。会话被删除（本页或别的标签页）后记下它的 id，正在看它的页面不再拉取，直接回到网站主页
> - `features/chat/model.ts`：把助手消息里的 `toolCall` 和对应的 `toolResult` 配成工具卡片，状态为运行中、成功、失败、未运行（运行已结束却没有结果）
> - 消息流：用户消息右对齐；助手消息用 Markdown 显示，`thinking` 折叠；正在生成的文字单独一块；工具卡片默认折叠，标题是工具名和目标（路径、命令等），`edit` 显示改动的差异，`write` 显示写入的内容（各最多 40 行），其余显示参数和结果文字。每条已存下的消息（用户和助手）都可以分叉成新会话；运行出错时显示错误（已知错误码按界面语言翻译）。摘要取最近一次运行（最后一条用户消息之后）里成功的 `summarize_changes` 调用的参数，所以刷新后还在，之后的运行没有摘要时不显示。消息组件做了记忆化，流式增量只重新渲染正在生成的那一块。在底部时新内容自动滚动到底部
> - 输入框：Enter 发送、Shift+Enter 换行，输入法组字时的 Enter 不发送。空闲时发送开始一次运行；运行中主按钮作为 steer 发送，另有"稍后发送"（followUp）；运行中和排队中都可以"停止"（排队时丢掉等待的消息）。发出的消息立即离开输入框，在对话里显示为"等待 AI 接收"，直到会话收到它（同样文字的用户消息结束）或会话变为空闲；发送失败时显示错误，文字回到输入框（输入框里已经有新内容时不覆盖）。标题栏可以重命名和删除会话（删除后回到网站主页）
> - 测试：单元测试（增量拼接和丢弃、运行开始清错误、消息去重、等待接收的消息、工具卡片配对和四种状态、摘要只取最近一次运行、`handleEvent` 对列表和详情缓存的更新、没有页面在看的会话结束后清理、删除标记、构建事件和 `resync`）；`e2e/chat.spec.ts`：开始对话、没有模型时发送失败且文字保留、重命名、两个标签页通过事件流同步新建和删除。本机没有 Playwright 浏览器，e2e 未在本机运行，由 CI 运行。流式输出要等第 7 层能设置模型后才能在浏览器里实际查看；已在浏览器里核对手写的会话文件（Markdown、思考、工具卡片和差异、分叉、重命名、删除、通过 API 改名后其他页面实时更新）

> M3 第 7 层实现说明（模型设置）：
> - 设置里的 `model`（`{provider, id}`，未选时为 `null`）和 `thinkingLevel`（默认 `medium`）用 `PUT /api/settings` 保存。每次运行前重新读取：没选返回 409 `agent.no_model`，选的模型不在 Pi 的模型列表里返回 409 `agent.model_not_found`，服务商没有密钥返回 409 `agent.no_api_key`；已经打开的会话在下一条消息时换成新的模型和思考程度（`setModel` / `setThinkingLevel`），刚打开的会话本来就用当前设置，不再重复设置
> - `src/agent/models.ts` 的 `ModelService`，和会话共用同一个 `ModelRuntime`：
>   - `GET /api/models`：Pi 内置的服务商（没有模型的不列出）和它们的模型（id、名称、是否支持思考、上下文长度），每个服务商的密钥状态 `{configured, source, last4, label}`：`stored` 为设置页保存的（只给末四位），`environment` 为环境变量（给出变量名，不能在界面里修改或删除），`other` 为不需要密钥的服务商；`envKey` 表示能否用环境变量提供密钥；另有当前选择和它是否还在列表里。各服务商的状态同时查询。接口从不返回密钥
>   - `PUT /api/providers/:provider/key`：通过 Pi 自己的 API Key 登录流程（`ModelRuntime.login(provider, "api_key")`）写入 `~/.bukitjalil/pi/auth.json`（权限 600），同时刷新 Pi 对这个服务商的状态。登录流程要的不只一个密钥（Bedrock、Vertex、两个 Cloudflare 服务商，或其他要求第二项输入的）时返回 400 `model.key_unsupported`，这些服务商只能用环境变量配置。`DELETE` 同一路径删除设置页保存的密钥
>   - `POST /api/providers/:provider/test`：用指定的模型（默认是当前选择的模型，否则这个服务商的第一个模型）发一次很短的请求（最多 64 个 token），30 秒没有回答就中止并直接返回（不等不理会中止的服务商）；返回 `{ok, model, latencyMs, timedOut, error}`：超时时 `timedOut` 为 true、没有错误文字，由界面按语言显示；其他错误信息里的密钥替换为 `***`
>   - Pi 的密钥状态来自后台刷新的快照，还没刷新到的服务商用 `checkAuth` 再问一次。`checkAuth` 可能执行 `models.json` 里配置的取密钥命令或刷新 OAuth 令牌，和发送消息前 Pi 自己做的一样，BukitJalil 不在 `models.json` 里写命令
> - 设置面板最上面是"AI 模型"：服务商（有密钥的排在前面；没有密钥、界面里不能填、也没有对应环境变量的只能登录的服务商，如 OpenAI Codex，不列出；后来 M7 之后支持了 OAuth 登录，这类服务商也会列出，见 6.5）、模型、思考程度（支持思考的模型才显示，界面提供关闭 / 低 / 中 / 高）、密钥状态和输入框（密码框，`autocomplete="one-time-code"` 避免浏览器提示保存密码，Enter 只保存密钥）、"使用这个模型"、"测试连接"（没有密钥时不能点）。这一块各自保存，不经过设置表单的"保存"
> - `BUKITJALIL_FAKE_MODEL=1` 启动时注册一个脚本化的假模型 `bukitjalil-fake`（`src/agent/fake-model.ts`，每次回答时把下一次回答排进队列，不用定时器）：先调用 `site_info`，再用 Markdown 回答并引用用户的话，以每秒 60 个 token 的速度流式输出，不联网。只用于端到端测试和本机预览，正常使用不设置
> - 端到端测试：Playwright 用自带的 Chromium、Firefox、WebKit（CI 安装），配置加了 `baseURL`；e2e 服务器带 `BUKITJALIL_FAKE_MODEL=1` 启动。`e2e/models.spec.ts`：为真实服务商保存一个编造的测试密钥（只显示末四位，页面上找不到完整密钥）并删除，选择假模型、测试连接、使用，开始对话后看到流式输出、`site_info` 工具卡片完成、回答引用了请求、刷新后会话恢复。`e2e/site-helpers.ts` 抽出了通过 API 导入网站的步骤。本机曾用已安装的 Chrome 和 Edge 跑通全部 34 个用例；之后改为在 Claude Code 内置浏览器里按同样步骤手动核对（保存和删除密钥、测试连接、选择模型、流式回复和工具卡片、结束后没有错误）
> - 测试：`test/models-api.test.ts`（当时 9 项）：模型列表和密钥状态、保存密钥写入 `auth.json` 且权限 600、列表里没有密钥、删除、多项配置的服务商和未知服务商、非法密钥、环境变量里的密钥不能改、连接测试成功和失败、超时、没有密钥、未知模型、错误信息去掉密钥；会话依次得到 `agent.no_model`、`agent.model_not_found`、`agent.no_api_key`，选好模型后运行，改设置后同一个会话的下一条回复用新模型

**M3 结果（2026-11-10）**：8 层全部完成。验收里的四项，除"用真实模型"之外都由端到端测试用假模型覆盖；真实模型的验收要用户用自己的 API Key 在设置里选好模型后手动跑一遍，还没有做。
- `pnpm check` 通过（2 个旧的警告）；`pnpm test` 318 项通过、8 项跳过；`pnpm build` 通过。
- 第 8 层：假模型（`src/agent/fake-model.ts`）按最近一条请求里的标签选脚本（用标签而不是普通的词，试用界面时不会意外改动网站），每一步一次工具调用，最后用 Markdown 回答：
  - `#faq`：`read` site.yaml → `edit` 改标题（请求里 "title" 后面引号里的文字，按 YAML 字符串加引号写入）→ `write` `content/pages/faq.md` → `bukit_check` → `summarize_changes`
  - `#auth`：`read` `../../../pi/auth.json`（从 `ai/` 工作副本指向应用目录里 Pi 的密钥文件）
  - `#plugin`：`edit` 在 site.yaml 里加一个非内置插件 → `bukit_build` → `edit` 再把插件去掉，之后的构建不受影响
  - 其他：`site_info`
- 新增 `e2e/agent.spec.ts`，每个浏览器 3 项：
  - AI 只改工作副本并通过检查：5 张工具卡片都成功，`bukit_check` 结果的整体 `passed` 为 true，显示摘要；网站自己的文件夹（默认分支）里 site.yaml 没变、没有 FAQ 页面；刷新后工具卡片和摘要都在
  - 读取 `auth.json` 被拒绝：`read` 卡片失败，被拒绝的路径就是应用目录里的 `pi/auth.json`，原因是在工作副本之外
  - 加了非内置插件后 AI 的构建被拒绝：`bukit_build` 卡片失败，原因写明 `site.plugins.fake-plugin`；两次 `edit` 都成功
  - 刷新后会话恢复另由 `e2e/models.spec.ts` 覆盖
- 替身 Bukit 移到 `e2e/fake-bukit.ts`，`sites.spec.ts` 和 `agent.spec.ts` 共用，并让 `doctor` 返回成功（`bukit_check` 依次运行 `config check` 和 `doctor`）；`bukitForTests` 返回 `BUKIT_BIN` 或写好的替身。`e2e/site-helpers.ts` 记下导入网站的文件夹（`siteFolder`），并提供 `putSettings`，各测试文件改设置都用它（请求失败时报错）。
- 本机没有 Playwright 自带的浏览器，用临时配置改用本机 Chrome 跑：整套 20 项通过，`agent.spec.ts` 用 `--repeat-each=3` 连跑三遍（9 项）都通过；审计修复后整套再跑一遍仍是 20 项通过。Chromium、Firefox、WebKit 由 CI 运行：第 7 层的提交在 CI 上通过，第 8 层推送后再看。

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

M4 分层实施（每层做完先审计、修复，再提交）：

1. 改动集核心：会话的一轮运行持有网站操作锁（锁被占用时消息排队，锁释放后再开始），AI 的 Bukit 工具在这把锁里执行；没有 open 改动集时开新的（重置工作副本、记录 base、写 `refs/bukitjalil/changes/<id>`），记录参与的会话；每轮结束和每次 Bukit 调用前快照并更新改动集；`summarize_changes` 的说明存进改动集；差异（文件列表和单个文件）和审核指纹
2. 应用与拒绝：校验指纹、正式版本前进时 `merge-tree` 并要求重新审核、冲突时标为 `stale`、应用前自动检查、`commit-tree` 分开设置作者和提交者、网站目录的前置检查和 `merge --ff-only --no-overwrite-ignore`
3. 改动集 API 与 `change` 事件（重放缓冲每个网站只留最后一条），文件树和文件内容支持 `ref=change`
4. 界面：审核卡片、"改动"面板（文件列表 + 差异）、文件面板"正式版本 / 改动中"切换
5. 改动集预览构建，预览面板"正式 / 改动中"切换
6. 版本历史、版本差异、恢复
7. SEO / GEO 审计结果显示在构建记录里（不依赖改动集；原计划另开会话，最后在主会话里做）
8. 端到端测试和文档

> M4 第 1 层实现说明（改动集核心）：
> - 网站操作锁：会话的一轮运行从开始到结束持有锁（操作名 `session`），包括结束后的快照；锁被构建、重新检查等占用时，消息留在队列里（状态 `queued`），`SiteLocks.waitFree` 在锁释放后再试。其他操作仍然是"忙就立即返回 409 `site.busy`"。AI 的 `bukit_check` / `bukit_build` 只在运行中调用，不再自己拿锁（以前拿不到锁时返回 `busy`，这个错误码去掉了）；运行结束时先等 `AiBukit.settled`：被停止的检查或构建要等 Bukit 进程真正退出（先 SIGINT，超时再强制结束），之后才快照、放锁，避免锁放开后 Bukit 还在工作副本里写；M3 第 1 层"整次会话运行暂不拿锁"的做法到此结束
> - `src/changes/`：`store.ts`（`change_sets`、`change_set_sessions` 两张表，M0 的迁移里已有）、`snapshot.ts`（快照，从 `ai-bukit.ts` 移过来，逻辑不变）、`diff.ts`、`service.ts`
> - 每轮运行在打开 AgentSession 之前调用 `ChangeService.begin`：网站有 `open` 改动集时加入它，工作副本保持上一轮留下的样子（不存在或损坏时在最近的快照上重新检出）；没有时开新的：`ai/` 检出到默认分支最新提交并 `clean -fdx -e .bukit -e .cache`，记 `base_commit`，写 `refs/bukitjalil/changes/<id>`。参与的会话记进 `change_set_sessions`（按第一次参与的时间排序）。`sites.aiCheckout` 改为不拿锁的 `aiWorktree(id, commit, {reset})`，由持锁的调用方使用
> - 快照：每轮结束后（运行失败或被停止也做）和每次 AI 的 Bukit 调用前，树有变化时更新改动集的 `snapshot_commit` 和引用。`summarize_changes` 的说明同时存进当前改动集的 `summary`
> - `ChangeService.current`：当前改动集、参与的会话、审核指纹（快照的树哈希）、文件列表（`git diff --no-ext-diff --no-textconv --no-renames` 的 `--name-status` 和 `--numstat`，状态为新增 / 修改 / 删除 / 类型改变，二进制文件没有行数，最多 2000 个文件，超过时标记；两份清单各只读前 4 MiB，其余丢弃，改动极大时也只是截断，不会失败），`reviewable` = 没有会话在运行且快照树 ≠ base 树。`diff(changeId, path)` 只对这一个路径（按 `:(literal)` 传给 git）求文件状态，确认它是改动里的文件（目录不算），超过 2000 个之后的文件也能看，二进制文件不给差异，超过 1 MiB 的差异标记为太大。改名按删除加新增显示
> - 改动集有变化时通知订阅者（第 3 层接到 `change` 事件上）；每轮运行结束后也通知一次（能否审核取决于有没有会话在运行，文件没变时也要更新）；新错误码 `change.file_not_found`
> - 测试：`test/changes.test.ts`（10 项）：运行结束后即使没改文件也发通知；超过 2000 个文件时截断，之后的文件仍能看差异，目录不算改动里的文件；开新改动集时重置工作副本、写引用、记录会话，第二个会话加入同一个改动集；工作副本丢失后在快照上恢复；只读网站拒绝；快照移动改动集和引用、没变化时不动；假模型的一轮运行写文件、改 `site.yaml`、写摘要，网站目录不变，文件列表和行数、指纹、运行中不可审核，另一个会话的下一轮接着同一个改动集；被停止的运行也快照；改动集结束后下一轮从默认分支重新开始；差异（中文和空格文件名、删除、二进制、太大、不在改动里的路径、`:(glob)` 写法、不存在的改动集）。`agent.test.ts` 改为：锁被占用时消息排队，释放后运行，运行期间其他操作拿不到锁；`site-tools.test.ts`：停止构建时 `settled` 一直等到 Bukit 结束

> M4 第 2 层实现说明（应用与拒绝）：
> - `ChangeService.apply(changeId, {treeHash, force?})`，整个过程持有网站操作锁（操作名 `apply`，会话运行中返回 409 `site.busy`）：
>   1. 改动集必须是 `open`（否则 409 `change.not_open`，带当前状态），网站不能只读，设置里要有提交身份（否则 400 `site.identity_required`）
>   2. 再快照一次工作副本，快照的树必须等于请求里的指纹，否则 409 `change.fingerprint_mismatch`；树和 base 一样时 409 `change.no_changes`
>   3. 网站目录必须在默认分支上（`symbolic-ref HEAD`，否则 409 `change.wrong_branch`），被跟踪的文件没有未提交的改动（`status --untracked-files=no`，否则 409 `change.site_dirty`）
>   4. 默认分支已经不是 base 时：`git merge-tree --write-tree <main> <快照>`。成功就把结果作为新快照（`commit-tree -p <main>`，工作副本 `reset --hard` 到它，base 改为 main，引用跟着移动），返回 `rebased`，用户要看过新的差异、带新指纹再应用一次；有冲突，或者合并结果和默认分支一样（改动已经在默认分支里了），就把改动集标为 `stale`，返回 `stale`，下一轮对话从新的默认分支开新改动集
>   5. 运行检查（`AiBukit.checkForApply`：和 `bukit_check` 一样快照、过构建前检查、跑 `config check` 和 `doctor`；没有 Bukit 或构建前检查拒绝时也算检查失败，`problemCode` 写明是哪一种（`bukit_missing` / `guard` / `notion` / `read_only`），`problem` 写明原因）。检查之后再核对一次指纹。失败且没有 `force` 时返回 `check_failed`，什么都不改。例外：`problemCode` 为 `notion`、网站绑定了 Notion 数据源、默认分支本身已经使用 Notion 时，不算检查失败，直接应用（界面提示没有检查、看正式构建的结果）；改动自己加进 Notion 源时仍要求强制，不能借这个例外跳过检查
>   6. `git commit-tree <指纹> -p <main>` 生成结果提交：作者固定为 `BukitJalil AI <ai@bukitjalil.local>`，提交者是设置里的身份（`-c author.* -c committer.*`）；提交信息是 AI 的改动说明（没有时用默认说明）加一行 `BukitJalil-Sessions: <会话 ID…>`
>   7. 在网站目录里 `git merge --ff-only --no-overwrite-ignore <结果提交>`；git 拒绝时（例如会覆盖网站目录里被忽略的本地文件）返回 409 `change.merge_failed`，带 git 的说明，改动集保持 `open`
>   8. 改动集标为 `applied`，记下 `result_commit`
> - 关闭的改动集：`applied` 保留 `refs/bukitjalil/changes/<id>`（结果提交已共享同一棵树）；`rejected` / `stale` 关闭时删除引用，让 git 可以回收，从 BukitJalil 移除网站时删除剩余引用
> - 返回 `{outcome, change, check}`，`outcome` 为 `applied` / `rebased` / `stale` / `check_failed`
> - `reject(changeId)`：同样持锁（操作名 `reject`），只改状态为 `rejected`；工作副本在下一轮开新改动集时重置
> - 应用后正式预览的重新构建在第 3 层的接口里触发
> - 新错误码：`change.not_open`、`change.fingerprint_mismatch`、`change.no_changes`、`change.wrong_branch`、`change.site_dirty`、`change.merge_failed`
> - 提交身份由 `SiteService.commitIdentity()` 统一读取
> - 测试：`test/changes.test.ts` 新增 10 项（替身 Bukit，`fake-doctor` 文件让 `doctor` 失败）：应用后默认分支多一个提交，树等于指纹，作者、提交者、提交信息正确，网站目录有新文件且干净，引用保留在快照上，下一个改动集从结果提交开始；指纹不对、审核后又改过、网站忙、没有提交身份、已拒绝、没有改动、网站只读时都拒绝，拒绝后 `gc` 仍能看差异；网站目录在别的分支或有未提交改动时拒绝；AI 取消忽略并写同名文件时不覆盖网站目录里被忽略的本地文件；检查失败时不应用，`force` 后应用；默认分支前进且不冲突时先合并、要求重新审核、旧指纹被拒、新指纹应用后两边的改动都在；冲突或默认分支已包含全部改动时标为 `stale`，下一轮从新的默认分支开始；构建前检查拒绝时 `check_failed` 带 `problemCode: guard`，`force` 后应用

> M4 第 3 层实现说明（改动集 API 与 `change` 事件）：
> - `src/api/changes.ts`：`GET /api/sites/:siteId/changes/current` 返回 `{change}`（open 改动集带文件列表，没有时为 null；网站有会话在运行或有排队消息时 `reviewable` 为 false）；`GET /api/changes/:changeId/diff?path=` 返回单个文件的差异（`path` 校验同文件面板，缺少或越界返回 400）；`POST /api/changes/:changeId/apply` 请求体 `{treeHash, force?}`（`treeHash` 必须是 40 或 64 位十六进制，多余字段返回 400）；`POST /api/changes/:changeId/reject`
> - 应用成功后接口触发一次正式版本构建（`builds.start(siteId, "main")`），正式预览随构建结束切换；没有 Bukit、网站正忙等无法开始时不影响应用结果，预览停在上一次构建
> - `change` 事件：`{type: "change", siteId, data: {change}}`，内容和 `changes/current` 相同。`ChangeService` 每次变化（开新改动集、快照、说明、应用、拒绝）和会话状态变化（影响 `reviewable`）都触发重新读取；每个网站同一时间只读一次，读的过程中又有变化就再读一次，事件不会乱序；和上一条完全相同的不再发。重放缓冲里每个网站只留最后一条 `change`，被取代的旧事件不算"错过"，不会触发 `resync`
> - 文件树、文件内容（以及配置、主题、数据面板）支持 `ref=change`，读 open 改动集的快照提交；没有 open 改动集时 404 `change.not_found`。构建和预览的 `ref=change` 在第 5 层接入，现在仍返回 404
> - 测试：`test/changes.test.ts` 新增 2 项（接口返回当前改动集、`ref=change` 的文件树和文件、差异和错误、事件流最后一条和接口一致；请求体校验、指纹不符、应用后触发正式版本构建、事件变为 null、拒绝和重复拒绝）；`test/events.test.ts` 新增 2 项（重放缓冲每个网站只留最后一条 `change` 且不触发 `resync`；读取不重叠、合并多次变化、相同状态不重发）

> M4 第 4 层实现说明（审核界面）：
> - 审核卡片（`features/changes/ReviewCard.tsx`）放在对话的消息列表和输入框之间。改动集属于网站，同一网站的每个会话显示同一张卡片：AI 的改动说明（没有时写明）、最多 8 个文件（状态字母、行数，点文件跳到"改动"面板的该文件）、"查看差异"、"应用"和"拒绝"。网站有会话在运行或排队时（`reviewable` 为 false）按钮禁用，写明"AI 还在工作"。拒绝要再确认一次
> - 应用结果用文字告诉用户：`applied`（已应用）、`rebased`（正式版本有新提交，已合并，请重新审核；卡片随 `change` 事件换成新指纹）、`stale`（冲突，改动集关闭）、`check_failed`（没有应用；按 `problemCode` 说明原因，附 Bukit 失败步骤的输出或原始原因，并出现"仍然应用"，只对当时检查的那个指纹有效）；接口错误按错误码翻译
> - "改动"面板（`ChangesPanel.tsx`）：顶部是说明、文件数、base 提交和同样的应用 / 拒绝按钮；左边文件列表，右边单个文件的差异（按 `+` / `-` / `@@` 着色，省略 git 的文件头；二进制和太大的差异写明原因）。选中的文件在 URL 的 `?diff=` 里；差异按快照树缓存，树不变就不重新请求
> - 文件、配置、主题、数据面板顶部的"正式版本 / 改动中"切换可用，选择存在 URL 的 `?ref=change`，所有面板一致；没有 open 改动集时"改动中"禁用，面板显示正式版本，并从 URL 去掉 `ref`，免得下一个改动集出现时面板自己切过去。文件树在"改动中"时按状态给改动的文件上色（新增绿、修改黄、类型变化蓝）
> - 界面收到 `change` 事件：写入 `["change", siteId]` 查询；快照提交变了就让 `ref=change` 的面板查询失效；改动集关闭时删除 `ref=change` 的查询（不再请求，避免一串 404），让正式版本的面板和网站信息重新获取
> - zod 的 jitless 设置改为在 `vite.config.ts` 里把 `zod` 指向 `src/zod-jitless.ts`（先 `config({ jitless: true })` 再导出）。原来在 `main.tsx` 第一行导入设置，新增的懒加载面板让打包器把 zod 和 shared 的 schema 拆进公共代码块，比设置先执行，浏览器报 `script-src eval` 违规
> - 测试：`chat.test.ts` 新增 `change` 事件对查询缓存的影响；e2e 的"改动"面板改为检查空状态；20 个 e2e 用例在本机 Chrome 通过。在 Claude Code 内置浏览器里用假模型走通：对话后出现审核卡片，查看差异，文件面板切到"改动中"并上色，应用后卡片消失、正式版本有新文件、触发一次正式版本构建；另一个网站上拒绝，`?ref=change` 被清除，没有多余请求

> M4 第 5 层实现说明（改动集预览）：
> - `POST /builds` 和 `POST /preview` 支持 `ref=change`。改动集构建在网站操作锁里：必须有 open 改动集（否则 404 `change.not_found`），在 `ai/` 工作副本（不存在时在快照上检出）里先快照，构建的就是这个快照提交；构建记录写上 `change_set_id`。每次都过构建前检查；不通过时结果为 `refused`，但**不把网站标为只读**（那是 AI 未审核的内容，原因在构建报告里）；有 Notion 源时为 `notion`。不传任何密钥。输出目录和正式构建一样搬到 `previews/<siteId>/<buildId>/`
> - 改动集预览只显示**当前 open 改动集**的构建：没有 open 改动集时 404 `change.not_found`，改动集还没构建过时 404 `preview.not_built`。新构建成功且改动集仍是 open 时，已打开的改动集预览立即切换；改动集关闭（应用、拒绝、stale）时释放改动集预览的端口
> - AI 的 `bukit_build` 仍然用完即删，不作为预览：用户在预览面板里手动构建改动集，避免 AI 每次构建都占用预览输出的配额
> - 界面：预览面板顶部加上和其他面板共用的"正式版本 / 改动中"切换（`?ref=change`）。改动集还没构建时显示说明和"构建改动"按钮；构建之后 AI 又改了（快照提交和构建的提交不同）时显示提示和"重新构建"。有会话在运行时按钮禁用。网站顶栏的构建状态只看正式版本的构建；构建列表里改动集构建带"改动预览"标记。改动集关闭时删除改动集预览的查询
> - 测试：`test/changes.test.ts` 新增 2 项（没有改动集时拒绝；在 `ai/` 里先快照再构建，记录的提交等于快照，网站目录不变、构建目录不留在工作副本里；改动集预览和正式预览用不同端口、内容不同；拒绝后端口释放，下一个改动集不显示旧构建；AI 加了 `plugins/` 时构建 `refused` 且网站仍可用）。内置浏览器里用假模型和真实 Bukit 走通：对话后在预览面板切到"改动中"、构建、预览显示 AI 改的标题和新的 FAQ 页面，切回正式版本，拒绝后改动集预览端口关闭、面板回到正式版本

> M4 第 6 层实现说明（版本历史与恢复）：
> - `GET /history?skip=` 列出默认分支的版本，只沿第一父提交，从新到旧，每页 50 条（`hasMore` 表示还有更早的）；先解析分支头，两次 `git log` 读同一个提交。每条有说明的标题和正文、作者、时间、改动文件数（相对第一父提交）、是否 AI 提交（作者邮箱是 `ai@bukitjalil.local`），并解析提交说明里的 `BukitJalil-Sessions:`（关联会话）和 `BukitJalil-Restore:`（恢复自哪个版本）两行，这两行不放进正文
> - `GET /history/:commit/diff[?path=]`：`:commit` 用 `ObjectId` 校验，不在默认分支历史上（不存在、不是提交、在别的分支）返回 404 `history.not_found`。不带 `path` 返回版本信息和改动文件列表，带 `path` 返回单个文件的差异；第一个提交和空树比较。差异的计算和上限与改动集相同
> - `POST /history/:commit/restore`，在网站操作锁里：只读网站 409；有会话在运行或排队 409 `site.busy`；有**带改动的** open 改动集 409 `change.open_exists`，空的 open 改动集（对话没有改任何文件）直接关闭让位，否则用户无从处理它；版本树和当前 main 相同 409 `change.same_version`。然后对版本 `V` 跑构建前检查，用 `commit-tree V^{tree} -p <main>` 生成快照，写 ref 和改动集记录（`restore_commit`，迁移 `003_restore.sql`；说明为 `Restore to <短 OID>: <标题>`），`ai/` 工作副本重置到快照，之后的对话从恢复后的内容继续。检查结果和改动集一起返回，不通过也不阻止恢复，但改动集预览会被拒绝
> - 恢复改动集和普通改动集一样审核、应用；应用时作者和提交者都是用户身份，提交说明只有 `BukitJalil-Restore: <V>`，没有会话行。恢复后又有对话加入这个改动集（AI 在恢复的内容上继续改）时，作者回到 BukitJalil AI，说明同时带会话行和恢复行
> - 界面：网站首页加"版本历史"，每条显示标题、短 OID、作者、时间、文件数，最新一条标"当前"，AI 提交和恢复提交各有标记，可加载更早的版本。点开一个版本在对话框里看文件列表和差异，底部"恢复到这个版本"；当前版本、只读网站、有待审核改动时按钮禁用并写明原因。恢复后打开"改动"面板；检查不通过时先在对话框里列出原因，再去审核。审核卡片和"改动"面板对恢复改动集显示"恢复到版本 …"。改动集关闭时让历史查询失效。单个文件差异的显示抽成 `FileDiffView`，"改动"面板和版本对话框共用
> - 测试：`test/changes.test.ts` 新增 6 项（历史条目、会话行、文件数、分页和参数校验；版本差异、第一个提交、单文件差异、不在分支上的提交和格式错误；空改动集让位、恢复后 `ai/` 和改动文件、重复恢复、应用后作者和说明、历史里的恢复标记、相同版本和不在分支上；只读网站、对话忙、网站锁被占用时拒绝恢复；对话加入恢复改动集后作者回到 AI；检查不通过时返回原因）。内置浏览器里走通：打开旧版本看差异，恢复，"改动"面板显示恢复标记和差异，应用后历史出现用户提交的恢复版本，并触发一次正式版本构建

> M4 第 7 层实现说明（SEO / GEO 审计结果，2026-11-10，在主会话里做，没有另开分支）：
> - 数据来源：Bukit 每次构建都在输出目录写 `.bukit/seo-report.json` 和 `.bukit/geo-report.json`；`bukit seo audit` / `bukit geo audit` 只是读回这两个文件并打印文字（没有 JSON 输出）。所以不另外运行审计命令，直接读报告（`src/builds/audit.ts`）。报告来自 AI 可能改过的网站内容，读取时限制大小（SEO 16 MB、GEO 1 MB），只读普通文件不跟随链接，按宽松的结构校验，任何异常都当作"没有报告"，不会让构建失败
> - 摘要（`BuildReport.audit`）：SEO 的页面数、错误数、警告数，问题按 `严重程度 + 代码` 分组（次数、Bukit 原文、最多 5 个页面），错误在前、次数多的在前，最多 40 种；GEO 的得分、llms.txt / llms-full.txt 是否生成、带 GEO 信息的页面数。正式构建和改动预览构建都有，只在构建成功时读取
> - 没有 `site.url` 时的处理：实测 starter（真实 Bukit 2.0.12，`--base-url /`）没有 `site.url` 时 81 个警告，填上 `https://example.com` 后只剩 2 个，规范链接也变成绝对地址。消失的 8 种代码（`seo.canonical_not_absolute`、`seo.og_image_not_absolute`、`seo.twitter_image_not_absolute`、`seo.schema_website_url_invalid`、`seo.schema_breadcrumb_item_url_not_absolute`、`seo.schema_itemlist_url_missing`、`publish.sitemap_missing_route`、`publish.rss_missing_route`）在没有 `site.url` 时合成一条提示"告诉 AI 网站的正式网址"，只计数不逐条列出；有 `site.url` 时照常列出，错误永远不合并
> - AI：`bukit_build` 的结果新增 `seoGeo`，几行文字：SEO 计数、缺 `site.url` 的说明（让 AI 只在用户给出网址时才填）、前 10 种问题、GEO 得分。`content-writing` 技能补充怎么用：只修自己造成的或用户关心的问题，不追每个警告；GEO 用页面 front matter 里的 `geo` 块（`schema_type`、`faq` 的 `question` / `answer`、`steps` 的 `name` / `text`，按 Bukit 2.0.12 源码 `SeoGeoMetaParser.cs` 核对）。实测给 starter 的 About 页加上这个块后 GEO 得分从 25 升到 50，页面输出 FAQPage 结构化数据，没有新警告
> - 界面：构建报告里新增"SEO / GEO"一节：计数、缺网址的提示、可展开的问题列表、GEO 得分和提示
> - 顺带发现并修复：Bukit 2.0.x 用 `--log-format json` 时**全部日志都写到 stderr**，stdout 是空的；原来只从 stdout 解析日志，所以真实 Bukit 构建的"警告和错误"一直是空的，所有日志行（包括 Info）都堆在"其他输出"里（测试用的替身 Bukit 写 stdout，掩盖了这个问题）。现在两路都解析，非日志的文字才进"其他输出"。另外 Bukit 会把每个 SEO 问题再打成一条警告日志（`seo.audit severity=…`、`publish.audit …`）、每种问题一条计数（`event=diagnostics.summary kind=seo.audit:…`）和一条 `seo.site_url_missing`，这些和审计摘要重复，不再列在"警告和错误"里，AI 拿到的消息也同样去掉
> - 测试：新增 `test/audit.test.ts`（8 项：合并缺网址的警告、排序和截断、过长文字、结构不对、GEO 得分、读取两种报告、不跟随链接、给 AI 的文字、两路日志解析和过滤）；`builds.test.ts` 新增替身模式 `audit`（日志写 stderr、写两个报告），真实 Bukit 用例检查摘要和日志解析；`site-tools.test.ts` 的真实 Bukit 用例检查 `seoGeo`；`e2e/sites.spec.ts` 新增"构建报告显示 SEO / GEO"，e2e 替身 Bukit 也写报告
> - 预览端口会原样提供输出里的 `.bukit/` 文件。只在本机访问、内容就是这次构建的路由信息，暂不处理；发布时是否带上这些文件在 M6 的发布审计里决定

**M4 结果（2026-11-10）**：全部完成（第 7 层 SEO / GEO 审计结果最后补上，见上）。验收里的各项，除"多语言网站"之外都由端到端测试覆盖；多语言网站需要真实 Bukit 和多语言配置，现在用中文网站代替，真实 Bukit 下的多语言验收还没有做。
- `pnpm check` 通过（2 个旧的警告）；`pnpm test` 350 项通过、8 项跳过；`pnpm build` 通过。
- 第 8 层新增 `e2e/review.spec.ts`，每个浏览器 3 项：
  - 对话 → 审核 → 改动预览 → 应用：审核卡片显示说明和两个文件，点文件打开"改动"面板的差异；预览面板切到"改动中"构建，显示 AI 改的标题，切回正式版本仍是旧标题，网站目录没变；应用后卡片消失，网站目录有 FAQ 页面、被忽略的本地文件 `dist/local.txt` 保留（AI 写到和被忽略文件同名的路径时拒绝应用、不覆盖，由单元测试 `never overwrites an ignored local file` 覆盖）、没有未提交改动，默认分支上多一个提交（作者 BukitJalil AI、提交者是用户、标题是 AI 的说明），正式预览自动更新到新标题
  - 拒绝：网站目录的提交、`site.yaml` 都不变，没有 FAQ 页面
  - 中文网站上恢复旧版本：应用 AI 的改动后，网站主页的历史有两个版本（最新的带 AI 标记），打开第一个版本看差异并恢复；"改动"面板显示恢复标记和要删除的 FAQ 页面，应用后默认分支的树等于旧版本，提交作者是用户、说明带 `BukitJalil-Restore`，历史变成三个版本，正式预览回到旧标题
- `e2e/site-helpers.ts` 的 `importSite` 可以指定网站语言。README 的状态和"现在能做什么"写到 M4。
- 本机用临时配置改用本机 Chrome 跑：整套 23 项通过，`review.spec.ts` 用 `--repeat-each=2` 连跑两遍（6 项）都通过。Chromium、Firefox、WebKit 由 CI 运行。

### M5 打磨与 MVP 发布（4–5 天）

- 端到端测试全流程（假模型）、真实 Bukit 构建测试
- 错误处理：Bukit 失败、模型报错、网络中断、磁盘写入失败的界面提示
- 首次启动引导：检测 Bukit 和 git → 填写提交身份（默认值来自 `readGlobalIdentity()`）→ 配置模型 → 新建第一个网站
- 暗色模式、窄屏、键盘操作（发送、停止、切换面板）
- 文档：README 状态更新、用户使用说明 `docs/user-guide.md`
- 真实模型验收：从零做一个"专业服务公司双语官网"

**验收**：新机器上按 README 安装后 10 分钟内完成第一个网站并预览；CI 全绿；真实模型验收记录归档到 `docs/acceptance/`。

M5 分层实施（每层做完先审计、修复，再提交）：

1. 首次启动引导：首页按顺序检查 git、Bukit、提交身份、模型、第一个网站，每一步写明状态并直接打开对应的设置或对话框；全部完成后引导收起
2. 错误提示：Bukit 缺失或异常退出、模型报错（密钥无效、额度或频率限制、网络不通）、和服务端的连接中断、磁盘写入失败（空间不足、只读、无权限）都有明确的错误码和界面文字
3. 外观与操作：暗色模式可在设置里选"跟随系统 / 浅色 / 深色"；窄屏时三栏改为切换显示；键盘操作（发送、停止、切换面板）并在界面里列出快捷键
4. 真实 Bukit 构建测试：CI 按固定版本和校验和下载 Bukit（当时 2.0.11，后来 2.0.12，现为 2.0.15），跑真实 Bukit 的单元测试和端到端测试
5. 文档：`docs/user-guide.md` 用户使用说明，README 安装步骤按新机器核对
6. 真实模型验收：从零做一个"专业服务公司双语官网"，记录归档到 `docs/acceptance/`；需要用户的 API Key，由用户确认后进行

> M5 第 1 层实现说明（首次启动引导）：
> - 首页（没有选网站时的中栏）在说明文字上方显示"开始使用"清单（`features/sites/SetupGuide.tsx`），按顺序五步：git 2.38 以上（`/api/health`）、Bukit 可用（`/api/bukit` 的状态为 `ok`）、提交身份（设置里姓名和邮箱都填了）、AI 模型（已选模型、仍在目录里、服务商的密钥已配置）、第一个网站（网站列表不为空）。每步标"已完成 / 待完成 / 需要处理"，只有第一个没完成的步骤显示说明和操作：Bukit、身份、模型打开设置对话框，网站步骤直接打开"新建网站"或"导入网站"对话框，新建或导入后跳到网站。git 缺失时只写明怎么安装（要重启应用）
> - 清单直接用这几个已有的查询，设置里保存后对应的查询更新，清单跟着变；所有检查都有结果之后才显示，五步都完成后不再显示。没有新增接口
> - 测试：新增 `e2e/setup.spec.ts`（清空身份和模型后两步为待完成，打开设置，填好后两步完成或清单消失）。内置浏览器里用全新的应用目录走通：git 已完成 → 填 Bukit 路径 → 在设置里选假模型、填身份，清单逐步更新 → 剩下"第一个网站"

> M5 第 2 层实现说明（错误提示）：
> - 模型报错：服务商的错误信息原样保存在回答里（`stopReason: "error"`），界面按状态码和常见说法分成密钥被拒（401、403、invalid / incorrect API key）、频率限制或额度（429、rate limit、quota）、服务过载（529、503、overloaded）、上下文太长、网络不通（fetch failed、ENOTFOUND、ECONNREFUSED、超时）五类，每类一句该怎么做，原文放在可展开的"详情"里；认不出的写"模型服务商返回了错误"。分类在 `features/chat/model.ts` 的 `modelErrorKind`
> - 假模型新增 `#fail-key`、`#fail-limit`、`#fail-network`，按真实服务商的写法返回这三种错误，方便试用和测试
> - 磁盘写入失败：新增 `src/storage-errors.ts`，从 Node 的 errno（含 `cause` 链）和 git 的 stderr 认出 `ENOSPC` / `EDQUOT`（磁盘已满）、`EROFS`（只读）、`EACCES` / `EPERM`（无权限）。接口的全局错误处理据此返回 `fs.disk_full`（507）、`fs.read_only`、`fs.permission_denied`（500），不再一律是 `server.internal`；AI 运行失败时同样给出这几个错误码。构建报告新增 `problem`：BukitJalil 自己出错时按 errno 判断，Bukit 失败时在它的输出里找 "no space left on device"、"read-only file system"，界面在报告顶部用一句话说明
> - Bukit 缺失本来就有 `build.bukit_missing`；Bukit 异常退出（结果为"Bukit 运行失败"、没有磁盘问题）时，构建报告加一句说明：看下面的输出后重试，反复出现就在设置里检查或重装 Bukit
> - 和服务端的连接中断（顶栏"连接已断开，正在重试"）和请求发不出去（"连不上 BukitJalil 服务"）在 M3 已有，这一层没有改
> - 修复 CI 上 Firefox 偶发失败：预览原来只在构建列表里看到"运行中 → 结束"时才重新获取，构建很快时列表可能从没看到运行中，预览就一直停在"还没构建"。现在收到 `build.end` 事件时也让这个网站的预览查询失效
> - `fs.permission_denied` 的文字从"没有权限打开这个文件夹"改为"没有权限读写这个位置"，因为它现在也用于写入失败
> - 测试：`test/storage-errors.test.ts`（2 项：errno、cause 链、git stderr、输出文字；接口遇到磁盘已满返回 507 `fs.disk_full`，其他错误仍是 500）；`builds.test.ts` 新增磁盘已满的构建报告带 `problem`（stderr 和 JSON 日志两种写法）；`chat.test.ts` 新增 `modelErrorKind` 和 `build.end` 让预览失效；`e2e/agent.spec.ts` 新增三种服务商错误的说明和原文

> M5 第 3 层实现说明（外观与操作）：
> - 暗色模式：设置新增 `appearance`（`system` / `light` / `dark`，默认跟随系统）。选择放在顶栏语言选择旁边，和语言一样一改就保存，不用打开设置对话框（计划原写"在设置里选"）；保存失败时颜色回到已保存的选择。`lib/theme.ts` 按选择给 `<html>` 加减 `dark` 类并设 `color-scheme`，跟随系统时监听 `prefers-color-scheme`；选择同时存在浏览器的 localStorage，下次打开时在设置读回来之前就是对的颜色（CSP 不允许内联脚本，所以在 `main.tsx` 启动时执行）
> - 设置读取改为逐项校验：某一项的值不合法（例如旧版本或手改留下的值）时只有这一项回到默认值，其他设置保留。原来整份设置会一起被重置
> - 窄屏（宽度小于 768px）：三栏改为一次显示一栏，底部三个标签切换"网站 / 对话 / 面板"；三栏都保持挂载和布局，只是不可见，切换时没发出的消息、已加载的预览和滚动位置都还在。打开网站或会话时切到对话栏，导航到带 `?panel=` 的地址（例如"查看改动"，面板已经是改动时也算）时切到面板栏。顶栏在窄屏上隐藏 git 状态和快捷键按钮，网站名过长时截断，两个选择框缩小
> - 键盘：Enter 发送、Shift+Enter 换行（原有）；Esc 在输入框里停止正在运行的会话（输入法组字时不算）；Alt+1…Alt+6 切换右栏面板（按键位判断，macOS 上 Alt+数字会打出别的字符；在文本框里和对话框打开时不生效，因为有些键盘布局用 Option+数字打 [ ] 等字符），面板标签的提示里写着对应按键；在文本框以外按 ? 打开快捷键列表，顶栏也有按钮打开
> - 测试：新增 `e2e/layout.spec.ts`（3 项：外观选择切换并在刷新后保留、跟随系统时随浏览器变化；Alt+数字切换面板、在输入框里不切换、? 打开快捷键列表；375px 宽时一次一栏、`?panel=` 切到面板栏、页面不横向溢出）；`store.test.ts` 新增 `appearance` 的默认值和保存，以及一项不合法时其他设置保留

> M5 第 4 层实现说明（CI 用真实 Bukit）：
> - 新增 `packages/server/scripts/fetch-bukit.ts`：直接调用应用自己的安装代码（`src/bukit/install.ts` 的下载、固定 SHA-256 校验、严格解包），把本平台的官方 2.0.11 安装包下载到指定目录，解压到 `bukit-2.0.11/`，安装包本身也留下，最后输出 `BUKIT_BIN=` 和 `BUKIT_TARBALL=` 两行。校验和只写在 `install.ts` 一处，CI 不另外维护一份
> - CI 的三个任务里，两个 Node 24 任务（Ubuntu、macOS arm64）先运行这个脚本，把输出写进 `$GITHUB_ENV`，再检查 `bukit version` 是 2.0.11（现为 2.0.15）；之后的单元测试和端到端测试就用真实 Bukit（原来跳过的 8 个真实 Bukit 单元测试全部运行，端到端测试的构建也是真实的）。Node 22.19.0 任务继续用替身 Bukit，因为"Bukit 构建失败"这类端到端测试要靠替身按脚本失败
> - 本机核对：用官方 osx-arm64 安装包（SHA-256 与固定值一致），单元测试 364 项全部通过、没有跳过；端到端测试 27 项通过，1 项（替身失败场景）按设计跳过。脚本用替换掉 `fetch` 的方式离线跑通，解出的 `bukit version` 为 `2.0.11+9006a2b`

> M5 第 5 层实现说明（文档）：
> - 新增 `docs/user-guide.md`，写给使用者：准备条件、安装和启动（登录地址、端口、应用目录）、首次启动清单、模型设置、新建和导入网站（只读的原因）、对话、审核、版本历史和恢复、右栏面板、外观和快捷键、常见问题（按界面上的错误文字）、目前的限制
> - README：状态改为 M5 进行中并指向使用说明；路线图给 M3、M4 打勾；设置一行改为实际内容（模型和 API Key、提交身份、Bukit 和 ripgrep），去掉没有做的"技能"；"现在能做什么"补上首次启动清单、错误提示、外观和快捷键
> - 安装步骤核对：从本仓库全新克隆 `pi-harness-ui` 到临时目录，`corepack enable`、`pnpm install --frozen-lockfile`、`pnpm build`、`pnpm start`，用全新的 `BUKITJALIL_HOME` 启动：应用目录按 4.1 建好，终端打印一次性登录地址，接口要求登录。核对中发现 `pnpm start -- --port 48000` 会把 `--` 原样传给服务端，`parseArgs` 报"不接受位置参数"后退出；`main.ts` 现在去掉开头的 `--`，`pnpm start --port …` 和 `pnpm start -- --port …` 两种写法都能启动。限制：没有另一台真正的新电脑，依赖来自本机 pnpm 缓存（`--offline`），git、Node、Bukit 的安装步骤按文档核对，没有在空系统上实际重装

> M5 第 6 层实现说明（真实模型验收，2026-11-10）：
> - 用户在设置里填好自己的 Anthropic Key、选 `claude-sonnet-5-5` 后，在界面里从零新建"恒信专业服务"，用两轮对话做成中英双语官网（中文默认），两次审核后应用，真实 Bukit 2.0.12。记录、数字和截图归档在 [`docs/acceptance/m5-real-model.md`](acceptance/m5-real-model.md)
> - 同时补上之前没做的两项：M3 验收的"用真实模型"（AI 只改工作副本、每轮检查和构建，越界的 `find` 被闸门拒绝）和 M4 验收的"多语言网站"（真实 Bukit 下对话 → 审核 → 应用 → 正式预览更新）
> - 验收中发现并修复：
>   - 多语言网站预览空白：Bukit 多语言构建只输出 `/<lang>/`，根目录没有 `index.html`。构建成功时 `previewEntry` 按 `site.defaultLanguage` → `site.language` → 第一个有首页的目录选入口，写进 `BuildReport.entry`；预览端口收到 `/` 时 302 过去（带同样的安全响应头），切到新构建时入口一起更新
>   - 提交标题是一整段话：`summarize_changes` 要求先写不超过 72 个字符的标题行；`commitText` 在第一行仍然过长时取第一句话（最多 72 个字符）作标题，完整说明放在正文
>   - `multilingual` 技能补充：语言切换链接用站内路径（`alternates` 在设置 `site.url` 后是绝对地址，会跳出预览），`<title>`、品牌、导航、页脚也要跟随页面语言
> - 记录不处理：多语言网站的 24 条 `publish.*_missing_route` 警告（`sitemapMode: split` 时每种语言各有 sitemap / RSS / 搜索索引，Bukit 的发布审计看根目录），留到 M6 发布审计时定；Claude 桌面应用内置浏览器拦截预览端口的样式表，本机 Chrome 正常
> - 测试：`preview-pool.test.ts` 新增根地址跳转到入口、切到普通构建后不再跳转；`audit.test.ts` 新增 `previewEntry`（默认语言、`site.language`、配置坏了取第一个、有根首页或没有首页时不设入口）；`changes.test.ts` 新增 `commitText`

**M5 结果（2026-11-10）**：6 层全部完成。验收三项：真实模型验收已归档；CI 每次推送都跑（不在本地轮询，以 GitHub 上的结果为准）；"新机器 10 分钟内完成第一个网站"按 README 在全新目录核对过安装和启动（第 5 层，没有另一台真正的新电脑），验收里从新建网站到第一轮改动应用约 5 分钟。MVP 完成，下一步是 M6 发布到 GitHub Pages。

> M0–M5 收尾审计（2026-11-10）：修复 5 项。Bukit 的 stdout / stderr 改为保留开头 1 MB 和结尾 3 MB（中间写明省略，结尾从整行开始），因为 2.0.x 全部日志都在 stderr，大网站的失败原因在最后；构建报告的消息（200 条）和 AI 拿到的消息（50 条）超出时优先保留错误、保持原顺序；应用改动在有会话运行或排队时返回 `site.busy`（原来只有界面拦着）；提交说明里去掉形如 `BukitJalil-…:` 的行，历史只从最后一段读这些说明，AI 不能伪造恢复标记；短标题后直接接正文时补一个空行，git 的标题就只有第一行。测试：新增 `output-limits.test.ts`，`changes.test.ts` 补应用时会话忙、伪造的说明行、标题空行。复审又修 3 处：没有省略任何内容时不再插入省略标记；开头部分最后半行移到结尾部分开头，日志行不再跨省略标记断开；结尾裁剪正好落在行首时不再多丢一整行。第二次代码审查修 3 处：同一问题的页面列满 5 个但再无其他页面时不再显示"…"（`AuditIssueGroup.moreRoutes`）；缺 `site.url` 时只把警告并进提示，info 留在列表里；没有 `entry` 的旧构建，预览入口按这次构建所在提交的 `site.yaml` 判断默认语言，而不是网站目录（正式分支）里的，输出根目录有首页时不读 git。第三次代码审查修 6 处：打开预览时查入口后再确认仍是最新构建才切换，旧构建不会盖过刚完成的新构建；查首页目录出错时不再让打开预览失败；更早保存的报告没有 `moreRoutes` 时界面按原规则显示"…"；旧构建的默认语言每个构建只读一次 git；入口判断合并为一处；`builds.test.ts` 补旧多语言构建按自身提交打开的测试

### M6 发布到 GitHub Pages（3–4 天，MVP 之后）

> **现行设计（2026-11-12 核对代码，取代本节下文里关于 token 来源、部署设置和第 1、2 层的写法）**：
> - **发布账号**：GitHub token 不再来自 `BUKITJALIL_GITHUB_TOKEN` / `secrets.json`，而是在设置页"发布账号"里按账号保存（`publish/accounts.ts`、`publish-account-tokens.json`，见 6.5）。网站在部署设置里选一个账号（`sites.publish_account_id`）。`SecretStore`、`/api/secrets`、`GitHubTokenSection.tsx`、`secrets.test.ts` 都已删除，对应的是 `PublishAccountsSection.tsx`、`PublishingSection.tsx`、`publish-accounts.test.ts` 和 `e2e/sites.spec.ts` 的 "publish accounts are saved, edited and removed"
> - **部署设置直接提交，不走审核**：网站首页"发布"一节是一张表单（发布账号、仓库、分支、自定义域名，`DeploySection.tsx`）。`PUT /api/sites/:siteId/deploy` 校验后，在 `main/` 检出里改 `site.yaml`：写 `deploy.provider/repo/branch/cname`，并按 GitHub Pages 地址设置 `site.url`、`site.baseUrl`；然后用 `commit-tree`（作者和提交者都是用户身份，提交信息 "Configure GitHub Pages deployment"）加网站目录的 `merge --ff-only --no-overwrite-ignore` **直接提交到默认分支**，持有网站锁 `deploy-config`。原计划"通过 AI 或设置向导生成改动集，同样走审核"和"让 AI 设置发布目标"按钮都没有保留，`publishing` 技能也改为告诉 AI 由用户在表单里设置。这样做的理由：写入的值全部来自用户在表单里填的内容，不是 AI 生成的内容；代价是这次提交绕过了"所有改动先审核"的原则。是否保留见 16
> - **和打开的改动集的关系**：配置提交让默认分支前进，打开的改动集在应用时按 7.2 的"正式版本已前进"处理（`merge-tree` 合并后重新审核，冲突时 `stale`）
> - **保存时的错误**：`site.read_only`、`site.busy`（网站锁被占）、`deploy.config_invalid`（字段不合法或 `site.yaml` 解析失败）、`deploy.config_dirty` / `deploy.config_wrong_branch`（网站目录有未提交改动或不在默认分支）、`deploy.config_failed`（快进合并失败）、`deploy.commit_changed`（期间默认分支变了）、`publish.not_found` / `publish.no_token`
> - **GitHub API 检查仓库权限**：保存部署设置时和每次发布前，用账号的 token 请求 `https://api.github.com/repos/<owner>/<repo>`（`Authorization: Bearer`），确认能推送；没有权限返回 409 `publish.repo_access`，GitHub 出错返回 503 `publish.github_failed`；`BUKITJALIL_OFFLINE=1` 时跳过。这是 token 在 `bukit deploy` 之外的第二个用途
> - **发布开始前的检查**（按代码顺序）：`site.read_only`、`site.identity_required`、`deploy.no_account`（网站没选账号）、`deploy.no_token`、`build.bukit_missing`；拿到网站锁后 `deploy.commit_changed`、`deploy.no_target`（带 `problem`）、`publish.repo_access` / `publish.github_failed`。使用 Notion 源而没有绑定数据源的网站在发布流程里以结果 `notion` 停止
> - **目标的问题**（`problem`）：`no_config`、`not_configured`、`bad_provider`、`bad_repo`、`bad_branch`、`bad_cname`，以及 `source_branch`（发布分支和网站的默认分支相同，会把构建输出推到源码分支上，拒绝）

以下是 M6 实施时的设计和记录：

- 部署设置：仓库、分支（写入 `site.yaml` 的 `deploy`，通过 AI 或设置向导生成改动集，同样走审核；**已改为表单直接提交，见上**）
- 发布前检查（都在 `main/` 检出里执行，先过 8.5 的构建前安全检查）：`config check`、`doctor`、构建到新的空目录、`publish audit`；发布的就是这次审计过的输出目录
- GitHub token：来源按 6.5（当时是环境变量 `BUKITJALIL_GITHUB_TOKEN` 优先，否则设置页填写、存于 `secrets.json`；现在来自发布账号，见上）；交给 Bukit 只在用户点击发布时（另外会用于 GitHub API 的权限检查，见上），放进 Bukit 子进程的环境变量 `BUKIT_DEPLOY_TOKEN`，并用 `--token-env BUKIT_DEPLOY_TOKEN` 告诉 Bukit 读取（2.0.11 新增这个参数，默认读 `GITHUB_TOKEN`；用专门的变量名，避免和用户环境里别的 `GITHUB_TOKEN` 混淆），任何其他构建都不传。Bukit 内部再通过 askpass 把 token 交给 git（源码 `GitHubPagesDeployProvider.Auth.cs`），不写进命令行参数
- 调用 `bukit deploy --skip-build --output <审计过的输出目录> --token-env BUKIT_DEPLOY_TOKEN`；目标仓库用 `site.yaml` 的 `deploy.repo` 或 `--repo owner/name`（2.0.11 新增），不依赖网站仓库的 `origin`：不加 `--skip-build` 时 `deploy` 会自己重新构建，发布的就不是刚审计过的内容
- **`bukit deploy` 的 git 调用**（M1 已核对 2.0.11 源码 `GitHubPagesDeployProvider*.cs`，并用记录参数和环境的 git 包装脚本实测）：
  - 在网站目录（这里是 `main/` 检出）里只执行 `git config --local/--worktree --get` 读 `remote.origin.url` 和 `extensions.worktreeConfig`，即使传了 `--repo` 也会读；读配置不触发钩子或 fsmonitor，配置本身已经过 7.3 的白名单检查
  - 其他操作（`init`、`remote add`、`ls-remote`、`fetch`、`checkout`、`add`、`commit`、`push`）都在 `$TMPDIR/bukit-deploy-<随机>/checkout` 里新建的仓库中执行，结束后删除
  - Bukit 启动 git 前会删掉 `GIT_CONFIG_COUNT`、`GIT_CONFIG_KEY_*`、`GIT_CONFIG_VALUE_*`、`GIT_CONFIG_PARAMETERS`、`GIT_DIR` 等变量，所以 7.3 通过 `GIT_CONFIG_*` 传入的 `core.hooksPath` 等加固**在 deploy 里不生效**（实测）；`GIT_CONFIG_GLOBAL`、`GIT_CONFIG_NOSYSTEM`、`GIT_TERMINAL_PROMPT` 和 `GIT_AUTHOR_*` / `GIT_COMMITTER_*` 会保留
  - 这样仍然安全：临时仓库是新 `git init` 的，没有可执行钩子，本地配置只有 Bukit 自己写的 remote；全局配置指向空文件、系统配置关闭，所以不会有 `init.templateDir`、`insteadOf`、过滤器驱动等；从 gh-pages 分支取回的 `.gitattributes` 引用的过滤器没有定义，不起作用
  - token 通过 Bukit 自己生成的 `GIT_ASKPASS` 脚本和 `BUKIT_GITHUB_TOKEN` 变量传给 `ls-remote` / `fetch` / `push`，不写进 URL 或配置
  - 提交身份：全局配置为空时 Bukit 写本地配置 `bukit <bukit@deploy.local>`；BukitJalil 传入 `GIT_AUTHOR_NAME/EMAIL`、`GIT_COMMITTER_NAME/EMAIL`（设置页的身份，7.2），实测会保留并优先于配置
  - 所以 deploy 的环境就是 7.3 的最小环境去掉 `GIT_CONFIG_COUNT` 一组，加上 `BUKIT_DEPLOY_TOKEN` 和提交身份，不需要另建临时 `HOME`；只在通过 8.5 检查的 `main/` 检出里执行，`TMPDIR` 指向 BukitJalil 自己的临时目录
  - 不加 `--skip-build` 时，deploy 会先在当前目录完整构建一次（实测在网站目录生成了 `dist/`）
- 调用 `bukit deploy`，显示进度和结果；发布记录

**2.0.12 发布实测（2026-11-11）**：用 starter 网站、`deploy.repo` 和一个把 `ls-remote` / `fetch` / `push` 的远程名换成本地裸仓库的 git 替身实测：
- `site.yaml` 的 `deploy` 是顶层段，字段 `provider`（只有 `github-pages`）、`branch`、`message`、`repo`（`owner/name`，有格式校验）、`cname`、`keepHistory`
- 构建输出已经带 `.bukit/publish-audit-report.json`（格式同 SEO 报告：`issues[]` 有 severity / code / route / message，另有 `summary`）；`bukit publish audit --dir <out>` 只读这份报告，找不到时提示先完整构建；`--output` 必须是相对路径
- `deploy --dry-run` 打印目标仓库及来源、分支、提交说明、token 变量名；真正发布时新建 gh-pages 分支、复制输出、提交、推送，推送的内容**不含 `.bukit/`**，提交身份用传入的 `GIT_AUTHOR_*` / `GIT_COMMITTER_*`
- Bukit 会核对临时远程的地址，`url.*.insteadOf` 或改过的地址都会让它拒绝发布，所以测试不能靠改地址，只能换网络命令里的远程名

M6 分层实施（每层做完先审计、修复，再提交）：

1. GitHub token（**已被发布账号取代**，见本节开头）：`settings/secrets.ts` 按 6.5 处理来源（`BUKITJALIL_GITHUB_TOKEN` 优先，否则 `secrets.json`，权限 600、原子写入；启动读取后从 `process.env` 删除 `BUKITJALIL_GITHUB_TOKEN` 和 `BUKITJALIL_NOTION_TOKEN`）；接口只返回来源和末四位；设置页填写、替换、删除，来自环境变量的只读。Notion token 只做来源读取和删除，界面和 Notion 构建留到之后
2. 发布目标：读正式版本 `site.yaml` 的 `deploy`（仓库、分支、cname），接口返回目标、token 是否就绪、能否发布；没有设置时界面提供"让 AI 设置"，把预填的说明放进对话输入框，改动照常走审核（**已改为表单直接提交**，见本节开头）；新技能 `publishing` 说明 `deploy` 段怎么写
3. 发布服务：`deploys` 表和 `POST /api/sites/:id/deploys`。按顺序：8.5 安全检查 → `config check` → `doctor` → 在 `main/` 检出里构建到新的空目录 → `publish audit`（有错误就停）→ `deploy --skip-build --output <这个目录> --repo <deploy.repo> --branch <分支> --token-env BUKIT_DEPLOY_TOKEN`。token 和提交身份只在最后一步传；必须有 `deploy.repo`，不让 Bukit 退回去用网站仓库的 origin；同一网站一次只发布一个，和构建共用网站锁；发布前另用 GitHub API 检查仓库权限（后加，见本节开头）；记录每一步的结果，可以停止
4. 发布界面：网站页的"发布"面板显示目标和 token 状态；确认对话框写明仓库、分支、要发布的版本；进度按步骤显示；发布记录带发布审计摘要和网站地址
5. 测试和文档：真实 Bukit 加 git 替身推到本地裸仓库的单元测试、假 Bukit 的端到端测试；`docs/user-guide.md` 和 README 补发布；多语言网站 `publish.*_missing_route` 警告的结论
6. 真实发布验收：发布到用户提供的 GitHub Pages 仓库 `3721-my/3721-my.github.io`。用户先在设置里填 token，确认后才推送；记录归档到 `docs/acceptance/`

> M6 第 1 层实现说明（GitHub token）（**历史记录**：下面的文件、接口和测试都已删除，被发布账号取代，见本节开头）：
> - `settings/secrets.ts` 的 `SecretStore` 在 `main.ts` 里紧跟 `ensureAppHome` 创建，早于任何子进程：读取 `BUKITJALIL_GITHUB_TOKEN`、`BUKITJALIL_NOTION_TOKEN`（去掉首尾空白，空值算没设）后立即从 `process.env` 删除。环境变量优先，界面里只读；否则用 `~/.bukitjalil/secrets.json`：先写同目录的临时文件（`wx`、600、fsync），再改名替换，启动时也收紧成 600；文件是符号链接、超过 64 KB、不是 JSON 都当作没有，保存时替换掉链接本身
> - 接口 `GET /api/secrets`、`PUT` / `DELETE /api/secrets/github`：只返回来源、环境变量名和末四位（不超过 8 个字符的 token 不显示末四位）；来自环境变量时修改返回 409 `secret.from_environment`，其他名字 404 `secret.not_found`；token 格式同模型 Key（不含空白和控制字符，最长 4096）
> - 设置对话框新增"GitHub token（发布用）"一节（`GitHubTokenSection.tsx`），交互同模型 Key；说明 token 只在点"发布"时交给 Bukit，需要目标仓库的 Contents 写权限
> - Notion token 只做读取和从环境删除，界面和 Notion 构建之后再做
> - 测试：新增 `secrets.test.ts`（环境变量优先并被删除、600 文件、链接 / 损坏 / 过大的文件、接口不返回 token、环境变量来源 409）；`e2e/sites.spec.ts` 补保存、显示末四位、删除

> M6 第 2 层实现说明（发布目标）：
> - `deploys/target.ts` 从正式版本的 `site.yaml`（复用配置面板读取正式分支的方法，不看网站目录里未提交的修改）取 `deploy`：`repo` 按 Bukit 2.0.12 schema 的格式校验，`branch` 默认 `gh-pages` 并校验成合法、不以 `-` 开头的分支名，`cname` 只接受主机名；问题分 `no_config`、`not_configured`、`bad_provider`、`bad_repo`、`bad_branch`。网站地址：有 `cname` 用它，仓库名是 `owner.github.io` 时是用户站点 `https://owner.github.io/`，否则是项目站点 `https://owner.github.io/name/`
> - 接口 `GET /api/sites/:id/deploy` 返回读取的提交、目标、token 是否设置、能否发布（目标有效、有 token、网站不是只读）
> - 网站首页新增"发布"一节（`features/deploys/DeploySection.tsx`）：显示仓库、分支、网站地址或问题说明，token 状态，没有 token 时可直接打开设置；没有设置目标时"让 AI 设置发布目标"新建对话，并把预填的说明（仓库、分支、域名待填）放进输入框，由用户补全后发送，改动照常审核。应用改动后、修改 token 后刷新
> - 新技能 `skills/bukitjalil/publishing`：`deploy` 是顶层段、`repo` 必须问用户、分支默认 `gh-pages` 并提醒用户在 GitHub 的 Pages 设置里选这个分支、`cname` 的写法、不在 `site.yaml` 里放 token；按仓库类型设置 `site.url` 和 `site.baseUrl`
> - 测试：新增 `deploys.test.ts`（目标解析和各种错误、用户 / 项目站点地址、接口只看正式分支）、`e2e/deploy.spec.ts`（当时：没有目标时让 AI 设置，输入框有预填说明；提交目标并设置 token 后显示目标。现在只有一项 "deploy settings save the account and repository…"）

> M6 第 3 层实现说明（发布服务）：
> - 新表 `deploys`（迁移 `004_deploys.sql`）：提交、仓库、分支、网站地址、状态（running / succeeded / failed / stopped）、当前或失败的步骤、结果、报告（各步结果、消息、发布审计摘要）；每个网站保留最近 50 条，服务重启时把还在运行的记成 `interrupted`
> - `POST /api/sites/:id/deploys` 带上用户确认的提交：在网站锁（和构建共用，`site.busy`）里核对它仍是默认分支的最新提交（否则 409 `deploy.commit_changed`，附上新提交），再从**这个提交**的 `site.yaml` 读发布目标（没有有效目标 409 `deploy.no_target`）；还要求有 token（`deploy.no_token`）、提交身份（`site.identity_required`）、可用的 Bukit、网站不是只读。返回 202，后台按步骤执行，每进入一步发一次 `deploy` 事件；`GET` 列表和单条、`POST .../stop` 停止（Bukit 收到 SIGINT）
> - 步骤：8.5 安全检查（拒绝时网站状态照常更新；Notion 网站读取绑定数据源的 token，只传给下面的 check、doctor、build，并从报告里抹掉）→ `config check` → `doctor` → 在 `main/` 检出里构建到新的空目录 `.bukitjalil-deploy/<id>`（用网站自己的 baseUrl，和预览一致）→ 不允许符号链接 → `publish audit --dir`（失败就停，摘要照样保存）→ `deploy --config site.yaml --skip-build --output <同一目录> --repo <deploy.repo> --branch <分支> --token-env BUKIT_DEPLOY_TOKEN`。任何一步失败都不再往下走，结束后删除输出目录
> - `BukitRunner` 新增 `publish`（60 秒）和 `deploy`（10 分钟）命令；只有 `deploy` 拿到 `BUKIT_DEPLOY_TOKEN` 和 `GIT_AUTHOR_*` / `GIT_COMMITTER_*`（设置里的身份），并去掉 `GIT_CONFIG_COUNT` 一组（Bukit 本来就会删）；其他步骤的环境不变
> - 测试：`deploys.test.ts` 补假 Bukit 的完整流程（参数、只在 deploy 传 token 和身份、发布的就是审计过的目录、事件顺序、输出目录删除）、每一步失败都停下、未确认的提交 / 没有 token / 没有身份 / 没有目标被拒、安全检查拒绝、发布中网站被锁住和停止；真实 Bukit 2.0.12 加 git 替身推到本地裸仓库（gh-pages 有 `index.html` 和 `.nojekyll`、没有 `.bukit/`，提交作者和提交者是设置里的身份，网站目录和检出都没有留下东西）

> M6 第 4 层实现说明（发布界面）：
> - "发布"一节在目标有效时显示"发布"按钮（目标有效、有 token、网站不是只读、没有正在进行的发布时可用）。确认对话框写明 `github.com/<仓库>`、分支、要发布的版本（正式分支最新提交的短哈希）和网站地址，并提醒推送会覆盖该分支、GitHub Pages 要设成从这个分支发布、新内容通常要等一两分钟；确认时把这个提交交给服务端，版本已经变了就提示并刷新
> - 发布中按六个步骤（安全检查、配置检查、诊断、构建、发布审计、推送）显示进度，可以停止；`deploy` 事件更新列表，正在发布时每 3 秒再取一次列表以防事件流断开
> - 最近 5 条发布记录：状态（失败时写明失败的步骤），打开后显示仓库 / 分支 / 版本、成功时的网站地址（说明 Bukit 不确认 GitHub Pages 已更新）、各步结果、发布审计摘要（与构建报告共用 `IssueGroups`）、消息和输出（共用 `ReportLog`）
> - e2e 用的假 Bukit 补 `publish-audit-report.json`、`publish`、`deploy`（等 1 秒后报告推送完成，不联网）；发布测试总是用假 Bukit，即使设置了 `BUKIT_BIN`
> - 测试：`e2e/deploy.spec.ts` 补确认对话框内容、进度、按钮在发布中不可用、记录里的网站地址、发布审计和推送输出

> M6 第 5 层实现说明（测试和文档）：
> - 真实 Bukit 的发布测试已在第 3 层加入（`deploys.test.ts`，读 `BUKIT_BIN`，CI 同样会跑）；端到端发布测试用假 Bukit
> - **多语言网站的 `publish.*_missing_route` 警告**（M5 验收记录）：用 M5 的双语网站和真实 Bukit 2.0.12 实测，默认 `sitemapMode: split` 时 sitemap / RSS / 搜索索引各 8 条；改成 `merged` 后根目录生成合并的 `sitemap.xml`，sitemap 的 8 条消失；`index` 模式没有变化。RSS 和搜索索引按语言输出在 `/<lang>/` 下，Bukit 的发布审计只看根目录，所以这 16 条仍在，网站本身没有问题。都是警告，不阻止发布。结论：`multilingual` 技能要求多语言网站设 `site.sitemapMode: merged`；RSS / 搜索的警告在使用说明里说明可以不处理
> - `docs/user-guide.md` 新增"发布到 GitHub Pages"一节（建仓库、fine-grained token 只给这个仓库的 Contents 读写、填 token、让 AI 设置目标（现已改为添加发布账号、填部署设置表单）、GitHub 的 Pages 设置、发布过程、发布审计警告），常见问题补发布失败；README 状态和"现在能做什么"补发布

> M6 审计修复：
> - 发布记录里的 token：Bukit 或它调用的 git 出错时可能把带 token 的远程地址打印出来。发布结束写入 `app.db` 前，报告的输出、消息和说明里出现的 token 都换成 `[token]`（8 个字符以下的 token 不查找）；测试用会打印 token 的假 Bukit 验证库里没有 token
> - `deploy.cname` 不是合法域名时（例如带 `https://`，或不是字符串），以前界面当作没有自定义域名，Bukit 却照原样写进 CNAME 文件。现在报"自定义域名不正确"，不能发布；`cname` 为空（YAML 里留空）仍当作没有自定义域名

> M6 第 6 层（真实发布验收）中的修复：
> - 多语言网站发布后网站地址 404：Bukit 2.0.12 多语言构建只输出 `/<lang>/`，根目录没有 `index.html`（M5 时预览已用 302 处理）。发布审计之后、推送之前，如果输出根目录没有首页，按和预览相同的规则（`previewEntry`：默认语言，否则第一个有首页的语言目录）写一个跳转页：`noindex`、`meta refresh` 到相对地址 `<lang>/`，项目站点 `/<repo>/` 下同样可用；Bukit 自己生成了根首页时不动
> - 设置弹框内容过长时不能滚动：弹框外框改为可滚动，设置表单在标题下滚动
> - 验收结果：M5 的双语网站发布到 `3721-my/3721-my.github.io` 的 `gh-pages` 分支，线上首页跳到中文、英文页正常，记录见 `docs/acceptance/m6-github-pages.md`。M6 完成

### M7 桌面版（4–5 天，MVP 之后）

目标：在 macOS（Apple Silicon）上双击打开就能用，不需要终端，代码和网页版完全相同。Linux / Windows 安装包和签名不在本里程碑内。

**设计**

- **包**：新增 `packages/desktop`（Electron 45.2.3）。主进程和预加载脚本用 TypeScript 写，用 esbuild 打包；依赖方向不变：desktop 只启动 server、加载 web，不引用它们的代码
- **server 进程**：主进程用 `utilityProcess.fork` 启动 server（Electron 自带的 Node），不在主进程里运行，server 崩溃不会带走窗口。开发时经 tsx 的加载器运行 `packages/server/src/main.ts`；安装包里运行 esbuild 打包的 `server.mjs`。前提是 Electron 45 的 Node 有 `node:sqlite`（第 1 层先核对）
- **桌面模式 `--desktop`**：server 不打印登录链接、不读标准输入、不打开浏览器。监听成功后经 `process.parentPort` 发 `{type: "ready", port}`；收到 `{type: "login"}` 回一个新的一次性登录链接；收到 `{type: "shutdown"}` 走现有的关闭流程。端口被占用时回 `{type: "error", code: "port_in_use"}`，主进程换下一个端口重试（最多 10 次，预览端口段跟着移）
- **资源目录**：server 现在按仓库目录找 `skills/`、`templates/starter`、`packages/web/dist`；加 `BUKITJALIL_RESOURCES` 指向安装包里的同名目录，没有时保持现状
- **一个数据目录只能有一个 server**：桌面版和 `pnpm start` 默认都用 `~/.bukitjalil`，同时运行会争用 `app.db` 和工作副本。server 启动时在数据目录建 `server.lock`（写入 pid，用 `wx` 创建），已有锁且那个 pid 还活着就拒绝启动并说明；锁的 pid 已不存在时接管。桌面版把这个错误显示在窗口里
- **窗口安全**：`contextIsolation`、`sandbox` 打开，`nodeIntegration` 关闭；只允许在管理端口的地址内导航；`window.open` 和外部链接只把 http(s) 地址交给系统浏览器（预览的"在新标签页打开"也是）；拒绝所有权限请求（摄像头、通知等）；不开 `webview`
- **预加载桥**：只暴露 `window.bukitjalil = { desktop: true, pickFolder() }`。`pickFolder` 打开系统文件夹选择框，返回路径或 null；新建网站和导入网站在桌面版用它代替网页里的目录选择器（10.1 原定）。路径照旧交给 server，位置规则仍由 server 检查
- **单实例和退出**：`requestSingleInstanceLock`，第二次打开只把已有窗口调到前面。退出时发 `shutdown`，最多等 10 秒，超时结束 server 进程。关闭最后一个窗口时 macOS 上不退出（Dock 点图标重新打开窗口），其他平台退出
- **server 异常退出**：窗口显示一个本地错误页（原因、日志目录、"重新启动"按钮），不自动反复重启
- **菜单**：标准的应用 / 编辑（复制粘贴需要它）/ 视图 / 窗口菜单；帮助菜单里"打开日志目录""打开数据目录"
- **环境**：从 Finder 打开的应用读不到 shell 的环境变量，PATH 只有系统目录。git 用 `/usr/bin/git`（没有装命令行工具时 macOS 会提示安装，健康检查已有说明）；token 只能在设置里添加（按发布账号、数据源保存，见 6.5）
- **Bukit**：不随包，第一次打开时用设置里已有的"下载安装"（带校验）。安装包更小，也不用跟着 Bukit 升级重新出包
- **打包**：用 `@electron/packager` 生成 arm64 的 `.app` 并压成 zip，包里有 `server.mjs`、`web/`、`skills/`、`templates/`。不签名、不公证（需要 Apple 开发者账号），使用说明写明第一次打开时右键 → 打开。自动更新依赖签名，不做

**分层**

1. server 桌面模式：核对 Electron 45 的 Node（`node:sqlite`、版本），`--desktop` 握手、`BUKITJALIL_RESOURCES`、`server.lock`，单元测试
2. 桌面壳（开发运行）：`packages/desktop` 主进程、预加载、窗口安全、单实例、退出、错误页、菜单，`pnpm desktop` 启动；Playwright 的 Electron 测试
3. 系统集成：系统文件夹选择框、外部链接和预览在系统浏览器打开
4. 打包：esbuild 打包 server、`@electron/packager` 出 `.app`，打包后的应用自测
5. 使用说明、README，从 Finder 打开安装包的验收记录

> M7 第 1 层实现说明（server 桌面模式，Electron 部分待安装后核对）：
> - `--desktop`：`src/desktop.ts` 的通道优先用 Electron 的 `process.parentPort`，没有时用 Node 子进程的 IPC（测试用）；没有任何通道时拒绝启动。监听成功发 `ready`，`login` 回新的一次性链接，`shutdown` 或通道断开都走关闭流程；登录链接不打印
> - 启动失败发 `{type: "error", code}`：`port_in_use`（端口被占）、`home_in_use`（数据目录被占）、`start_failed`
> - `src/lock.ts`：`server.lock` 用 `wx` 创建并写 pid；锁的进程还在（`kill(pid, 0)` 成功或 EPERM）就拒绝，进程已不在或内容读不出时接管；释放时只删自己的锁。`pnpm start` 同样拿锁，进程退出（包括启动失败）时释放
> - `resolveResources`：`BUKITJALIL_RESOURCES` 下的 `skills/`、`templates/starter/`、`web/`；没有设置时仍从仓库读
> - 测试 `desktop.test.ts` 用 tsx 真实启动 `main.ts`：握手、登录链接能换到会话 cookie、关闭后锁被删除、父进程断开时关闭、第二个 server 被拒、端口被占
> - 核对 Electron 45.2.3：自带 Node 24.22.2，`node:sqlite` 可用（SQLite 3.53.4），有内置的 TypeScript 类型擦除

> M7 第 2 层实现说明（桌面壳）：
> - `packages/desktop`：`src/main.ts`（主进程）、`src/server.ts`（`ServerProcess`）、`src/preload.ts`，esbuild 打包成 CommonJS 到 `dist/`（沙盒里的预加载脚本不能是模块）；`static/status.html` + `status.js` 是启动中和出错时的本地页面，内容只用 `textContent` 写入，CSP `default-src 'none'`
> - **开发运行要绕开 Node 的类型擦除**：Electron 的 utility process 不处理 `--import tsx`，Node 24 自带的类型擦除不支持参数属性（`constructor(readonly code …)`），server 直接退出。改为 `static/dev-server.mjs` 先注册 tsx（`tsx/esm/api`）再导入 `main.ts`
> - `ServerProcess`：`--desktop` 启动，端口被占时上移 10 再试，最多 10 次；`start()` 进行中再调用时共用同一次启动（第二次打开、Dock 点击）；保留最后 40 行输出给错误页；`stop()` 发 `shutdown`，10 秒后结束进程
> - 主进程：单实例；导航只允许管理端口的地址和本地状态页，其他 http(s) 交给系统浏览器，其余协议不打开；`window.open` 一律拒绝并交给系统浏览器（预览和发布地址的链接都是 `target="_blank"`，所以第 3 层的"外部链接"已在这里完成）；拒绝所有权限请求和 `webview`；文件夹选择只回应管理端口的页面，重新启动只回应本地状态页
> - 应用名 `BukitJalil`；`BUKITJALIL_DESKTOP_PROFILE` 指定 Electron 的用户数据目录（测试用，各自独立，不碰用户的），`BUKITJALIL_DESKTOP_PORT` 指定起始端口
> - 测试 `e2e/desktop/`（单独的 Playwright 配置，主配置忽略这个目录）：自动登录且只暴露桥接对象、退出后 server 结束并释放锁、外部链接交给系统浏览器且窗口不离开应用、通知权限被拒、第二次打开交给已运行的应用、server 被杀后显示原因并能重新启动、数据目录被占时说明原因。`pnpm e2e:desktop` 运行；CI 只在 macOS 上跑（先 `install-electron`；后来 CI 另加了 Windows 上的打包冒烟测试，不阻塞，见下面的"M7 之后"）
> - `pnpm desktop`：构建网页界面和桌面包后启动

> M7 第 3 层实现说明（系统集成）：
> - 目录选择器（`DirPicker`，新建网站和导入网站共用）在桌面版里换成"路径输入框 + 选择文件夹…"按钮，按钮打开系统文件夹选择框，从输入框当前的文件夹打开；网页里的文件夹列表和"显示隐藏文件夹"不再显示。浏览器里不变
> - `web/src/lib/desktop.ts` 读取预加载桥；主进程只把绝对路径（4096 字符以内）用作选择框的起始位置，选回来的路径照旧由 server 检查和解析（返回真实路径，macOS 上 `/var` 是 `/private/var`）
> - 外部链接和预览在系统浏览器打开已在第 2 层完成
> - 测试：在主进程替换 `dialog.showOpenDialog`，确认没有文件夹列表、选择框从当前路径打开、选中的文件夹填进输入框

> M7 第 4 层实现说明（打包）：
> - `pnpm package:desktop`（`packages/desktop/scripts/package.mjs`）生成 `packages/desktop/out/BukitJalil-darwin-arm64/BukitJalil.app` 和 `BukitJalil-<版本>-mac-arm64.zip`（后来改由 electron-builder 生成，安装包都在 `out/installers/`，见下面的"M7 之后"）
> - 应用目录 `Contents/Resources/app`：桌面壳；`server.mjs`（esbuild 只打包 BukitJalil 自己的代码和 `@bukitjalil/shared`，npm 包全部外置，因为 Pi SDK 按自身模块的位置读文件）；`migrations/`（`db.ts` 在代码旁边找）；`node_modules/`（`pnpm deploy --prod --legacy`，版本跟锁文件一致）；`skills/`、`templates/starter/`、`web/`
> - **`node_modules` 用 hoisted 布局**：packager 把 pnpm 的符号链接复制成完整副本，应用一度有 1.0 GB；改成平铺目录并去掉 tsx 和已打包的 `@bukitjalil/*` 后，应用 445 MB（Electron 266 MB、依赖 189 MB），zip 176 MB
> - 不用 asar（server 要从模板目录复制文件、对工作副本运行 git）
> - **重新做临时签名**：Electron 自带的临时签名在加入应用文件后失效，`codesign --verify --strict` 不通过，下载的副本会被 macOS 说成"已损坏"。打包后对整个应用 `codesign --force --deep --sign -` 再验证；`spctl` 仍拒绝（没有 Developer ID），使用说明写允许打开的步骤
> - 测试 `e2e/desktop/packaged.spec.ts`（打包后才运行）：只给系统 PATH（和从 Finder 打开一样）启动 `BukitJalil.app`，自动登录，用应用里的模板创建网站并提交（git），能开始对话（找到技能），Pi 的模型目录能读出（依赖完整），退出后释放锁。CI 的 macOS 任务打包后运行全部桌面测试
> - 未做：Electron fuses（关闭 `RunAsNode` 等），等有 Developer ID 签名时一起做；应用图标用 Electron 默认图标（后来补上，见下面的应用图标）

> M7 第 5 层实现说明（文档和验收）：
> - 使用说明第 2 节加"桌面版（macOS）"：得到安装包、第一次打开时在"隐私与安全性"里允许、和终端运行的区别（自动登录、系统文件夹选择框、链接在浏览器打开、⌘Q 退出、共用数据目录但不能同时运行、读不到终端环境变量）；常见问题加数据目录被占和服务意外停止；限制一节更新。README 更新状态、路线图、开发命令和"现在能做什么"
> - 验收：解压 zip 后用 `open -n` 从 Launch Services 打开（与 Finder 双击相同），自动登录、正常退出并释放锁；截图和问题见 `docs/acceptance/m7-desktop.md`。下载后带隔离属性的第一次打开需要手动确认，未走

> M7 结果：macOS arm64 桌面版完成。server 在 Electron 的 utility process 里以桌面模式运行，窗口自动登录、锁定导航和权限，新建 / 导入网站用系统文件夹选择框；`pnpm package:desktop` 生成临时签名的 `.app` 和 zip。没有 Developer ID 签名、公证、自动更新和自定义图标，没有 Linux / Windows 安装包（自定义图标和三个平台的安装包后来补上，见下）

> M7 之后：三个平台的安装包和发布流程：
> - `package.mjs` 按运行的平台打包（只接受 macOS arm64、Windows x64、Linux x64，和 Bukit 官方安装包的平台一致），再用 electron-builder 26.18.1 的 `prepackaged` 方式把打好的应用包成安装包，放在 `out/installers/`：macOS 是 dmg 和 zip（仍是临时签名，`mac.identity: null` 让 electron-builder 不再签名；已核对 dmg 和 zip 里的应用 `codesign --verify --deep --strict` 都通过），Windows 是 NSIS 安装程序（按用户安装，不需要管理员权限，可选目录），Linux 是 AppImage 和 deb。版本取 `BUKITJALIL_VERSION`（发布时是标签去掉 v）。electron-winstaller 的安装脚本在 `allowBuilds` 里关掉（只有 Squirrel 用）
> - `.github/workflows/release.yml`：推送 `v*.*.*` 标签时三个平台各在自己的机器上打包（Electron 带原生依赖不能交叉打包），打包后运行 `packaged.spec.ts` 冒烟测试，再把安装包和 `SHA256SUMS.txt` 放进**草稿** Release，由人检查后发布；手动运行只产出 workflow artifacts。带 `-` 的版本标为预发布
> - 冒烟测试改成三个平台通用（各平台的可执行文件路径；Windows 保留系统必需的环境变量；CI 的 Linux 用 xvfb 和 `--no-sandbox`）。macOS 和 Linux 必须通过；**Windows 是预览版**：服务端还有写死的 `/usr/bin:/bin`、给 Bukit 的 git 用符号链接等 Unix 假设，冒烟测试失败只报告、不挡发布，移植另做。`ci.yml` 每次推送也在 `windows-latest` 上打包并跑 `packaged.spec.ts`（`continue-on-error`）

> 应用图标：
> - 设计：蓝色渐变圆角方块上两座白色山丘（Bukit 是马来语的"山丘"，轮廓沿用原来的网页 favicon），小的那座背面颜色稍深，一条蓝色小路通到两座山之间的山口。源文件 `packages/desktop/assets/icon.svg`（整块，Windows / Linux / 窗口用）和 `icon-mac.svg`（按 macOS Big Sur 网格，1024 画布里 824 的圆角方块）
> - `pnpm --filter @bukitjalil/desktop icons`（`scripts/icons.mjs`）用 Playwright 和本机 Chrome 渲染出 `icon.png`（1024）、`icon.ico`（16–256 七个 PNG 尺寸）、`icon.icns`（`iconutil`，只能在 macOS 上生成），生成的文件提交进仓库，CI 不用再生成
> - 接入：packager 用 `.icns`（macOS 应用）和 `.ico`（Windows 可执行文件）；electron-builder 用于 dmg、NSIS 安装和卸载程序、Linux 桌面项；Windows / Linux 的窗口图标读应用目录里的 `icon.png`，从源码运行时 Dock 也换成这个图标。网页 favicon 换成同一设计，去掉了 16 像素下看不清的小路

### 里程碑总览

```text
M0 骨架 ─► M1 技术验证 ─► M2 网站与面板 ─► M3 AI 会话 ─► M4 审核与版本 ─► M5 MVP
 3–4d        3–4d           7–9d            8–10d         6–8d            4–5d
                                                                            │
                                               M6 GitHub Pages（3–4d）◄─────┤
                                               M7 桌面版（4–5d）     ◄──────┘
```

状态（2026-11-12）：M0–M7 全部完成。M7 之后又做了：三个平台的安装包和发布流程、应用图标、设置页、发布账号、Notion 数据源、OAuth 登录、自定义模型、Bukit 升到 2.0.15。待做的任务见 AGENTS.md。

---

## 15. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| Pi SDK 版本迭代快（1.4 → 1.5 已有接口变化） | 升级时接口不兼容 | 锁定精确版本；所有 Pi 调用集中在 `agent/` 一个模块，加适配层；升级前跑全套测试 |
| Bukit 常规公开二进制发布已暂停（例外发布需批准） | 新平台或新版本拿不到 | 内置兜底版本 2.0.15，设置页安装 GitHub 上的最新正式版（8.1）；原计划"有新版本时先核对源码差异、重跑 M1 脚本再升级"和"支持自定义 Bukit 路径"已不再成立（见 16）；Bukit 调用集中在 `bukit/` 模块 |
| Bukit 拒绝项目外的输出目录 | 预览构建失败 | 已解决：输出到项目内的新空目录再搬走（8.4），M1 已验证 |
| 预览端口池被其他程序占用 | 预览打不开 | 端口按需分配，被占用时跳到下一个可用端口，界面始终用服务端返回的实际地址；`/api/health` 报告端口池状态 |
| TypeScript 7 与工具链不兼容 | 类型检查或编辑器支持出问题 | 已解决：M0 确认可用，固定 7.0.2 |
| 同一网站多个会话或操作争用工作副本 | 改动互相覆盖、应用时内容被改 | 网站操作锁：会话运行、快照、应用、恢复、构建互斥，其他排队或返回 409（6.1、7.2） |
| AI 改动质量不稳定 | 用户频繁拒绝 | 技能里要求先检查再构建；审核卡片显示检查结果；支持继续对话修正同一个改动集 |
| 模型费用 | 成本不可控 | 显示每个会话的 token 和费用（Pi 事件里有用量）；可选较便宜的模型 |
| 工作树与 `main` 分叉冲突 | 应用失败 | 同一网站只允许一个 open 改动集；`merge-tree` 冲突时标记 stale，让 AI 基于新版本重做 |
| 系统 git 版本过旧（< 2.38，没有 `merge-tree --write-tree`） | 正式版本前进后无法合并 | 启动时检查，`/api/health` 和首次启动引导提示升级 |
| token 明文存储、发往第三方 | 同一用户下的恶意程序、备份或云同步能读到 token；token 发给 GitHub / Notion API | 0600 文件、应用目录 0700，接受这个威胁模型（6.5 存储细节）；API 地址写死；建议用只给单个仓库 Contents 权限的 fine-grained token（使用说明） |
| 仓库配置白名单误伤常见仓库 | 正常网站被标为只读 | M1 用常见真实仓库核对白名单；只读原因逐项列出，方便用户自行清理 |
| Bukit 内部 git 调用的行为（多语言构建、发布）与预期不同 | 构建失败或加固失效 | 多语言构建已在 M1 验证：`GIT_CONFIG_*` 环境变量生效，快照后能构建；`deploy` 内部的 git 调用也已核对：加固变量被 Bukit 删掉，但所有写操作都在新建的临时仓库里，全局和系统配置仍然隔离（M6） |

---

## 16. 待定问题

1. ~~**网站默认存放位置**~~：已确定每次由用户选择，没有默认目录（5.2）
2. **素材上传**：~~待定~~ **已确认（2026-11-12）**。用户上传图片和 PDF 到当前主题的静态目录 `themes/<主题>/static/uploads/`（设计 v3.2 已和本文 v2.29 对齐），网址 `/uploads/`（原提议的 `content/media` 和 v2 的 `assets/uploads` 都发布不出去，已改）；上传同样进改动集、走审核；不收 SVG。设计和分 5 层的实施计划见 [plans/2026-11-12-media-upload-design.md](plans/2026-11-12-media-upload-design.md)，约 2 天
3. **Notion 数据源**：~~待定~~ **已做（M7 之后）**：设置页按数据源管理 Notion token，新建网站时可选数据源和数据库，正式版本构建、网站检查和发布时传绑定数据源的 token，新建后自动构建；导入的网站在数据面板里显式绑定（5.1、6.5）。数据面板仍只显示配置，不预览 Notion 数据；AI 改动不能检查、不能预览
4. **多会话并发改同一网站**：MVP 限制一个 open 改动集，是否够用？
5. ~~**界面语言**~~：已确定做多语言，MVP 提供简体中文和英文（10.1）
6. **默认主题的外观**：MVP 已确定从 Bukit 源码复制 StarterTheme 作为起点（5.2、M2）；是否在此基础上做一套更好看的默认主题，可以放到 MVP 之后决定
7. **Bukit 安装的信任模型**（2026-11-12 审计发现）：~~待定~~ **已决定（2026-11-13）；已实施（2026-11-13）**：继续安装 GitHub 上的最新正式版（校验值用 GitHub API 返回的摘要，8.1），同时加两层保护：
   - 代码里的最低版本 `MIN_BUKIT_VERSION` 跟着依赖走：BukitJalil 一开始依赖 Bukit 的某个新行为（Notion 离线快照、正文链接补 baseUrl、主题静态目录原样复制等），就把最低版本升到第一个有这个行为的版本，低于它的 Bukit 不用。
   - CI 定期（每天一次，加上手动触发）下载真实的最新 Bukit，跑一组行为测试，只测 BukitJalil 依赖的行为：`config check` 遇到 Notion 源只要求 token 存在、`deploy --skip-build` 不校验数据源密钥、主题 `static/` 原样复制到输出根目录、`--base-url` 覆盖等。失败时说明 Bukit 的行为变了，要先核对再决定改 BukitJalil 还是改 Bukit。
   - 不恢复"代码里固定版本和 SHA-256"：Bukit 是自己的仓库，修复不应该等 BukitJalil 发版才能用上。
   - 实施结果：
     - 行为测试在 `packages/server/test/bukit-behavior.test.ts`，有 `BUKIT_BIN` 时运行，共 4 项：版本不低于 `MIN_BUKIT_VERSION`；有 Notion 源时 `config check` 没有 `NOTION_TOKEN` 就失败，给一个占位值就通过（不联网）；`build --base-url /docs/` 覆盖 `site.yaml` 里的 `/`，链接和样式都带前缀，主题 `static/robots.txt` 原样复制到输出根目录；有 Notion 源、没有 token 时 `deploy --skip-build` 照样推送成功（推到本地裸仓库，git 包装脚本和发布测试相同）
     - 普通 CI 的真实 Bukit 任务（内置版本 2.0.15）随 `pnpm test` 跑这组测试；新的 `.github/workflows/bukit-latest.yml` 每天 03:17 UTC 和手动触发时，用 `scripts/fetch-bukit.ts --latest` 取最新正式版（拿不到 GitHub 的发布信息就失败，不退回内置版本；`GITHUB_TOKEN` 只发给 api.github.com，用来提高限额），设 `BUKIT_BEHAVIOUR_REQUIRED=1` 让缺少 Bukit 时直接失败而不是全部跳过
     - 本机用 2.0.11、2.0.14 跑过（本机没有 2.0.15 的安装包，没有另外下载），4 项都通过，所以最低版本保持 2.0.11；内置版本 2.0.15 由普通 CI 的真实 Bukit 任务每次推送时跑
     - 定时任务只在 `main` 上运行，用的是 `main` 里的测试和脚本，所以合入 `main` 后才开始；仓库 60 天没有活动时 GitHub 会停掉定时任务
     - Bukit 发布 2.1.0 等 2.0.x 以外的版本时，版本测试会失败：应用也会拒绝这个版本（`versionState`），需要先核对再放宽
8. **部署设置绕过审核**（2026-11-12 审计发现）：~~待定~~ **已决定（2026-11-13）**：
   - 接受直接提交：部署设置表单的值全部来自用户自己填写，没有 AI 参与，所以 `deploy`、`site.url`、`site.baseUrl` 继续直接提交到默认分支（M6 开头）。这是第二处用户直接写入，素材上传仍走审核。
   - **预览改用网站真实的 baseUrl（已实施，2026-11-13，见 8.3、8.4）**：预览构建不再传 `--base-url /`，按网站自己的 `site.baseUrl` 构建；预览服务把输出挂在这个前缀下（例如 `http://127.0.0.1:<端口>/<仓库名>/`），访问根路径时跳转到前缀，前缀之外返回 404。这样子路径网站的预览和发布一致，正文里漏了前缀的链接在审核预览里就会坏掉，而不是发布后才坏。
     - baseUrl 来自要构建的提交里的 `site.yaml`，AI 能改它，所以前缀要校验：只允许 `/` 或若干段 `[A-Za-z0-9._~-]` 组成、以 `/` 开头和结尾的路径，不允许 `..`、`%`、反斜杠和查询串；不合规时这次预览构建失败并说明原因，不退回 `/`。
     - 正式版本预览、改动集预览、AI 的 `bukit_build` 都一样；预览地址（构建详情、预览按钮、AI 工具结果里的 URL）带上前缀。
     - 素材上传设计 3.1 第 5 点的"预览与发布不一致"因此不再需要单独处理，但正文链接补 baseUrl 仍建议在 Bukit 里做（否则 `/uploads/a.png` 在子路径网站上预览和发布都坏，只是能及早发现）。
9. **自定义 Bukit 路径**（2026-11-12 审计发现）：已删除，Intel Mac、Linux ARM 等没有官方安装包的平台因此无法构建（8.1）。要决定是否恢复
10. **未实现的两项**（2026-11-12 审计发现）：~~待定~~ **已决定（2026-11-13）：两项都补上；已实施（2026-11-13），实际规则见 6.2 和 6.3**：
    - 开新改动集时，如果这个会话之前已经有过改动集，在用户消息前附一段说明（6.2）："工作副本已重置到最新正式版本，你之前的改动已被应用 / 拒绝（按实际情况），修改前请重新读取文件"。只给模型看，不显示在对话里，也不写进会话标题。
    - AI 没调用 `summarize_changes` 时，按差异生成一行说明代替固定文本（6.3），例如"修改 3 个文件：content/pages/about.md、site.yaml 等"；文件名最多列 3 个，按新增 / 修改 / 删除分类计数。素材上传实施后，只有上传的改动集仍由上传自己维护说明。
11. **`fflate` 版本写法**：~~`packages/server/package.json` 里是 `^0.8.3`，不符合 2 节"精确版本"的规定~~ **已改成 `0.8.3`**（2026-11-13 核对）
