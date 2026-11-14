# BukitJalil 架构与功能思维导图

本地 AI 建站工作台 · `pi-harness-ui @ 7c60c6d`

[打开离线 HTML 版](bukitjalil-mindmap.html)

## 建站主流程

新建或导入网站 → AI 修改工作副本 → 快照与可选预览 → 人工审核应用 → 正式构建 → 手动发布

## 总体架构与依赖

- **Web 界面 · `packages/web`**
  React、Vite、Tailwind、shadcn/ui。三栏工作区、设置页和窄屏单栏切换。TanStack Query 管理请求与缓存，通过 REST 和 SSE 访问本地服务。
- **本地服务 · `packages/server`**
  Node.js + Hono。`main.ts` 组装服务、管理端口与退出流程，`app.ts` 挂载 API 和生产静态界面。Pi SDK 在服务进程内，Git 和 Bukit 由子进程调用。
- **共享契约 · `packages/shared`**
  Web 和 Server 共同依赖 TypeScript 类型、Zod schema、事件、错误和常量。Web 通过接口与 Server 通信。
- **桌面壳 · `packages/desktop`**
  Electron 主进程以 `utilityProcess` 启动同一服务，窗口加载同一 Web 界面。预加载桥接原生选目录，负责自动登录、外链、错误恢复和优雅退出。
- **API、事件与静态内容**
  `/api` 提供 JSON 接口，`/api/events` 推送消息、工具、改动、构建及发布事件。生产由 Hono 托管界面，开发由 Vite 代理；管理端口默认 47880，预览端口池默认从 47881 开始。

源码 · [`packages/server/src/api`](../packages/server/src/api)、[`packages/server/src/events/bridge.ts`](../packages/server/src/events/bridge.ts)、[`packages/web/src/lib/events.tsx`](../packages/web/src/lib/events.tsx)、[`packages/desktop/src/server.ts`](../packages/desktop/src/server.ts)

## 网站项目与七个面板

- **首次启动与网站管理**
  引导检查 Git、Bukit、提交身份、模型和首个网站。支持选目录、创建、导入前检查、重新检查、归档、恢复归档和移除登记。未初始化 Git 的项目经确认后初始化，安全检查未通过的项目可只读导入。
- **Starter 模板与内容**
  按站名和默认语言初始化 `site.yaml`、主题、页面、文章及数据。默认使用 Markdown，可选 Notion 数据库并指定文章、页面或数据用途。多语言选项将需求交给后续 AI 对话。
- **文件、配置、主题、数据**
  可切换正式版本与待审核快照。文件树支持代码、Markdown、图片及隔离预览或下载；配置查看 YAML 和站点信息；主题查看布局、资源和静态文件；数据查看 Markdown 集合、数据文件和 Notion 源。
- **预览、改动、SEO**
  预览打开静态构建产物；改动查看差异并发起审核；SEO 查看最新报告、比较问题并生成修复提示。

源码 · [`packages/web/src/features/sites`](../packages/web/src/features/sites)、[`packages/web/src/features/panels/RightPanel.tsx`](../packages/web/src/features/panels/RightPanel.tsx)、[`packages/server/src/sites`](../packages/server/src/sites)、[`packages/server/src/panels`](../packages/server/src/panels)、[`templates/starter`](../templates/starter)

## AI 对话、模型与技能

- **会话与消息**
  站点内创建、续聊、首条消息自动命名、重命名、删除和从消息分叉。支持流式回复、工具卡、草稿、立即补充、稍后发送、停止与错误详情。同站点同时运行一个会话。
- **Pi 运行时与工具**
  按会话创建 `AgentSession`。工具允许读写、查找和搜索网站工作副本；建站工具提供站点信息、内容清单、配置检查、构建、配置 schema 和改动摘要。`grep` 使用校验过的固定版本 ripgrep。
- **模型与凭据**
  服务商模型目录、API Key、环境变量、支持的 OAuth 登录、连接测试、默认模型和思考程度。支持自定义 OpenAI / Anthropic 兼容及本地端点；开发和测试可用脚本化假模型。
- **建站技能**
  随应用提供 Bukit 配置、内容、模板、路由、构建、SEO/GEO、发布等参考技能，以及网站编辑、内容写作、多语言和发布工作流。`site-editing` 始终启用。

源码 · [`packages/server/src/agent`](../packages/server/src/agent)、[`packages/server/src/api/sessions.ts`](../packages/server/src/api/sessions.ts)、[`packages/web/src/features/chat`](../packages/web/src/features/chat)、[`skills`](../skills)

## 改动审核与 Git 版本

- **工作树、快照与差异**
  每站一个开放改动集，可由多个会话接续。快照保存在站点 Git 的私有引用，差异基于基础版本和快照，审核以树指纹绑定具体内容。
- **应用、部分应用与拒绝**
  可整批应用，也可按文件及文本差异块选择。剩余改动继续待审；新增、删除和二进制文件按整文件选。应用前重验指纹与配置检查，正式分支有新提交时重新合并并要求复审，有冲突则标记失效。拒绝关闭改动集。
- **历史与恢复**
  浏览正式分支的提交、作者与版本差异。恢复历史版本生成待审改动，审核通过后形成新的提交。应用成功后触发正式构建。
- **站点级并发控制**
  会话、构建、审核、恢复和发布等操作使用同一站点锁协调。Git 正式分支更新采用快进并保护被忽略的本地文件。

源码 · [`packages/server/src/changes`](../packages/server/src/changes)、[`packages/server/src/git`](../packages/server/src/git)、[`packages/server/src/sites/locks.ts`](../packages/server/src/sites/locks.ts)、[`packages/web/src/features/changes`](../packages/web/src/features/changes)

## Bukit 构建、预览与 SEO/GEO

- **构建引擎与报告**
  随应用打包 Bukit 2.0.15，开发和打包时下载并校验 SHA-256。服务调用配置检查、诊断、构建和审计等固定命令，记录版本、阶段、结果和报告，整理 Bukit 原始错误及远程图片占位缺失等提示。
- **正式构建与改动预览**
  正式构建用默认分支的独立检出，改动预览用审核快照。按站点真实 `baseUrl` 提供静态页面，每份打开的预览使用独立端口，可在界面内或新标签页查看。旧产物按保留策略清理。
- **SEO 与 GEO**
  构建报告按类型汇总 SEO 错误和警告，合并缺少站点 URL 的同类问题，展示 GEO 分数、覆盖和 `llms.txt`。SEO 面板按页面筛选并比较上次结果，可把当前问题填入新对话草稿。

源码 · [`packages/server/src/bukit`](../packages/server/src/bukit)、[`packages/server/src/builds`](../packages/server/src/builds)、[`packages/server/src/preview`](../packages/server/src/preview)、[`packages/web/src/features/builds`](../packages/web/src/features/builds)、[`packages/web/src/features/panels/SeoPanel.tsx`](../packages/web/src/features/panels/SeoPanel.tsx)

## Notion、插件与 GitHub Pages

- **Notion 数据源**
  设置中管理命名凭据，每个网站可绑定一个数据源并配置多个数据库。数据面板由用户点击后按正式分支的 `databaseId` 读取字段；审核突出数据源增删和配置差异；构建、发布翻译常见权限和限流错误。
- **Bukit 内置插件**
  设置的扩展页展示内置插件；网站配置页按站启停。变更写入工作副本，纳入快照与审核。
- **GitHub Pages 发布设置**
  管理多个发布账号，绑定站点、配置仓库、目标分支和自定义域，保存时验证写权限并更新 `site.yaml` 的部署与站点地址配置。
- **发布执行与记录**
  用户确认正式版本后依次执行安全检查、配置检查、诊断、构建、产物发布审计和 `bukit deploy`。支持停止、查看进度、报告和历史。

源码 · [`packages/server/src/data-sources`](../packages/server/src/data-sources)、[`packages/server/src/api/plugins.ts`](../packages/server/src/api/plugins.ts)、[`packages/server/src/publish`](../packages/server/src/publish)、[`packages/server/src/deploys`](../packages/server/src/deploys)、[`packages/web/src/features/deploys`](../packages/web/src/features/deploys)

## 应用设置与运行环境

- **通用**
  简体中文 / English，跟随系统 / 浅色 / 深色，Git 提交身份和键盘快捷键。支持站点切换与可调整三栏布局。
- **AI 模型、技能、发布、数据源、扩展**
  集中配置模型与认证、启用可选技能、管理发布账号与 Notion 凭据、查看内置插件。站点绑定和插件启停在对应的网站面板操作。
- **环境**
  查看 Git、Bukit、ripgrep、Pi 的状态。Git 提供按平台的安装或更新路径；ripgrep 可安装固定校验版本；Pi 和 Bukit 版本随应用依赖或发行包更新。

源码 · [`packages/web/src/features/settings`](../packages/web/src/features/settings)、[`packages/web/src/i18n`](../packages/web/src/i18n)、[`packages/server/src/store/settings.ts`](../packages/server/src/store/settings.ts)、[`packages/server/src/git/service.ts`](../packages/server/src/git/service.ts)

## 数据持久化与安全边界

- **网站项目和应用数据**
  用户目录中的站点保留标准 Bukit 项目与 Git 历史。应用数据目录 `~/.bukitjalil` 管理 SQLite 索引和设置、Pi JSONL、AI/正式检出、预览产物、日志和单实例锁；模型、GitHub 和 Notion 凭据独立存为本地文件。
- **本地 API 与预览隔离**
  回环监听，一次性登录地址换取 HttpOnly Cookie。管理 API 校验 Host、Origin 和写请求头，使用 CSP；预览用独立端口、沙箱 CSP 和 iframe。Electron 窗口启用上下文隔离和沙箱。
- **AI 和 Git 操作边界**
  白名单工具与路径闸门限制工作副本，保护敏感文件和应用目录。Git 使用受控环境与仓库配置白名单，关闭钩子、签名和外部驱动，导入与审核阶段均进行检查。
- **Bukit 与凭据边界**
  构建前检查插件、路径、符号链接及私网访问限制；GitHub token 按发布操作使用，Notion token 用于授权的数据源请求和正式版本操作。未审核的 Notion 构建和改动预览被拦截。

源码 · [`packages/server/src/paths.ts`](../packages/server/src/paths.ts)、[`packages/server/src/store/migrations`](../packages/server/src/store/migrations)、[`packages/server/src/security`](../packages/server/src/security)、[`packages/server/src/agent/gate.ts`](../packages/server/src/agent/gate.ts)、[`packages/server/src/bukit/guard.ts`](../packages/server/src/bukit/guard.ts)

## 工程、测试与桌面发行

- **开发与验证**
  TypeScript、pnpm workspace、Biome、Vitest 和 Playwright。覆盖服务模块、浏览器工作流、预览隔离、真实或替身 Bukit，以及源码运行和打包后的桌面冒烟。
- **CI 与发行脚本**
  CI 校验类型、单测、构建与端到端流程，另有最新版 Bukit 兼容工作流。发行工作流按平台打包并生成校验和，标签触发 GitHub Release 草稿。
- **安装包目标**
  脚本包含 macOS arm64 的 DMG/ZIP、Linux x64 的 AppImage/DEB 和 Windows x64 的 NSIS。工作流把 Windows 标为预览。使用说明的平台描述较旧，安装包可用性以实际发行与运行记录为准。

源码 · [`package.json`](../package.json)、[`packages/server/test`](../packages/server/test)、[`e2e`](../e2e)、[`packages/desktop/scripts/package.mjs`](../packages/desktop/scripts/package.mjs)、[`.github/workflows`](../.github/workflows)

## 待开发与上游依赖

- **Notion 离线预览与每源页数**
  待 Bukit 提供离线快照和每个内容源的计数，再接入未审核改动的安全预览和面板页数。
- **Cloudflare Pages、自有服务器**
  两种发布目标暂缓，待 Bukit 增加对应部署后端，再接入多目标选择。自有服务器设计采用 SSH 密钥、rsync 试运行与用户确认。
- **本地素材上传**
  已有图片与文件上传设计，计划让素材进入主题静态目录和同一审核流程。当前源码已有远程图片构建报错提示，本地上传入口仍待实现。
- **外部官方插件**
  外部官方插件接入列为后续，当前站点界面提供内置插件启停。

设计 · [`AGENTS.md`](../AGENTS.md)、[`docs/development-plan.md`](development-plan.md)、[`docs/plans/2026-11-12-media-upload-design.md`](plans/2026-11-12-media-upload-design.md)、[`README.md`](../README.md)
