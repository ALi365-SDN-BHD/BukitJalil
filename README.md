# 🏔️ BukitJalil

把**网站当作项目**来管理的系统。每个网站的配置、主题、文件、数据都在这里统一管理；建站和修改都通过和 AI 对话完成，用户不直接改代码。

> 状态：重新规划中，还没有代码。旧的 Electron + Codex 实现保留在 `main` 分支的历史里。

## 📌 定位

BukitJalil 的界面和用法参考 [Pi Web](https://github.com/agegr/pi-web)（[Pi](https://github.com/earendil-works/pi) 编程助手的 Web 界面），区别在于管理的对象不同：

| | Pi Web | BukitJalil |
| --- | --- | --- |
| 一个"项目"是 | 一个代码仓库 / 开发目录 | 一个网站 |
| 侧栏按项目分组 | 会话 | 网站和它的会话 |
| 文件面板 | 浏览、预览源码和 Git 差异 | 浏览、预览网站文件，查看改动差异 |
| 额外面板 | — | 网站配置、主题、数据（内容源）、构建预览 |
| AI 的工作 | 写代码、跑命令 | 按建站规则改网站，交给 Bukit 构建 |
| 用户直接改文件 | 可以 | 不可以：界面只读，改动都经过 AI 和审核 |

```text
用户描述需求 → AI 会话（Pi，建站规则约束） → 网站文件 / 配置 / 数据变更 → 用户审核差异 → Bukit 构建 → 预览 / 发布
```

## 🧭 核心概念

- **网站项目**：一个网站就是一个项目，有自己的目录、配置、主题、文件、数据和对话记录
- **会话**：针对某个网站的一段 AI 对话，可以恢复、重命名、从某条消息分叉
- **只读界面**：用户在界面里查看内容，但不直接编辑；想改什么就告诉 AI
- **审核**：AI 的改动先显示差异，用户确认后才生效，可以撤回和恢复历史版本
- **构建**：网站由 [Bukit](https://github.com/ALi365-SDN-BHD/Bukit.git) 构建成静态 HTML

## 🖥️ 界面

和 Pi Web 一样的三栏工作区：

```text
┌──────────────┬─────────────────────────────┬──────────────────────┐
│ 网站列表      │ 对话                         │ 网站面板（只读）       │
│  ├ 网站 A     │  用户：首页加一个 FAQ         │  [文件] [配置] [主题]  │
│  │ ├ 会话 1   │  AI：已修改 3 个文件…         │  [数据] [改动] [预览]  │
│  │ └ 会话 2   │  ┌ 改动审核 ─────────────┐   │                      │
│  └ 网站 B     │  │ 确认应用 / 拒绝         │   │  site.yaml 内容…      │
│              │  └───────────────────────┘   │                      │
│ ＋ 新建网站    │  [输入框]                    │                      │
└──────────────┴─────────────────────────────┴──────────────────────┘
```

| 面板 | 看什么 |
| --- | --- |
| 文件 | 网站目录树，预览页面、Markdown、图片、PDF 等 |
| 配置 | `site.yaml`：站点名称、语言、域名、导航、SEO 等 |
| 主题 | 当前主题、主题副本、样式变量 |
| 数据 | `site.yaml` 里的内容源：Markdown 集合、data 数据源、Notion 源 |
| 改动 | AI 每次改动的文件差异，版本历史和恢复 |
| 预览 | Bukit 构建后的页面 |
| 设置 | 模型和 API Key、技能、全局 Bukit 路径 |

## 🏗️ 架构

和 Pi Web 一样，用 [Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md) 把 Pi 嵌进本地服务进程，而不是另外再起一个 CLI 子进程。

```text
浏览器界面（只读视图 + 对话）
        │ HTTP / 流式事件
本地服务（Node）
  ├ 网站项目管理：目录、配置、主题、数据、版本
  ├ Pi SDK：每个会话一个 AgentSession
  │   ├ 只开建站工具（读写网站文件、改配置、查数据、调用构建）
  │   ├ 建站技能和提示模板
  │   └ 写入限制在网站的工作副本内
  └ Bukit：构建、预览、发布
```

### 接入方式：Pi SDK

BukitJalil 通过 SDK（`@earendil-works/pi-coding-agent` 的 `createAgentSession()`）使用 Pi，不启动 `pi` CLI，也不使用 `--mode rpc`。

- **为什么**：建站工具要直接用代码注册，工具白名单、可写路径、会话生命周期都要由 BukitJalil 精确控制；SDK 在同一个进程里，这些都能直接做到。Pi Web、Percho 等主流 Pi 界面也都是这么做的
- **版本固定**：Pi SDK 作为项目依赖锁定版本，不依赖用户本机装的 `pi` 和它的全局配置
- **只在服务端使用**：只有本地服务里的一个模块引用 Pi SDK，界面通过接口和事件流跟它通信，不直接接触 Pi

Pi 的工作方式（模型请求、工具执行、会话树、技能、扩展）由 Pi 本身提供；BukitJalil 负责网站这个领域：项目结构、哪些工具可用、改动怎么审核、怎么构建发布。

## 🧰 技术栈

全部使用 TypeScript，开发统一用 Node 24 LTS（最低 22.19）、pnpm 12.18.0、TypeScript 7.0.2、Bukit 2.0.8。服务端和界面分开，先做本地 Web 应用，以后再用 Electron 套成桌面版。每个依赖的固定版本见[开发方案 · 固定技术栈](docs/development-plan.md#2-固定技术栈)。

| 部分 | 技术 | 说明 |
| --- | --- | --- |
| 项目结构 | pnpm workspaces | `shared` / `server` / `web` 三个包 |
| 本地服务 | Node 22 + TypeScript + [Hono](https://hono.dev) | 只有服务端引用 Pi SDK，也只有它调用 Bukit |
| AI | [Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md) | 每个会话一个 `AgentSession`，版本锁定 |
| 实时推送 | SSE | AI 的流式输出、工具调用和改动事件 |
| 界面 | React + Vite + Tailwind CSS + shadcn/ui | 三栏工作区 |
| 只读查看 | Shiki，以及 Markdown / 图片 / PDF 预览 | 只能看，不能改 |
| 改动审核 | 差异查看组件 | 显示每次 AI 改动 |
| 版本 | 每个网站一个 git 仓库 | 差异、历史、恢复 |
| 系统数据 | SQLite（`node:sqlite`） | 网站列表、设置等；和网站自己的数据分开 |
| 构建 | Bukit（.NET Native AOT）子进程 | 构建、预览、发布 |
| 测试 | Vitest + Playwright | 单元测试和端到端测试 |
| 桌面版（以后） | Electron | 加载同一个本地服务和界面 |

计划中的目录结构：

```text
BukitJalil/
├── packages/
│   ├── shared/   # 类型、接口约定、事件定义
│   ├── server/   # Hono 服务：网站项目、Pi 会话、审核、版本、Bukit 调用
│   └── web/      # React 界面：网站列表、对话、只读面板
├── skills/       # 随应用发布的建站技能和提示模板
└── docs/
```

## 🔒 规则

- 用户不在界面里直接编辑文件，所有改动都通过 AI 对话发起
- AI 只能用建站相关的工具，不能随意执行系统命令
- AI 只在网站的工作副本里改动；确认后才写入正式版本
- 构建和发布由系统调用 Bukit 完成
- 每次改动都有记录，可以对比和恢复

## 🛣️ 路线图

详细设计和每个阶段的任务、验收标准见 [开发方案与实施计划](docs/development-plan.md)。

| 阶段 | 内容 | 估算 |
| --- | --- | --- |
| M0 工程骨架 | pnpm workspace、Hono 服务、三栏空界面、安全基础、CI | 2–3 天 |
| M1 技术验证 | 验证 Pi SDK 自定义工具 / 权限闸门 / 技能，Bukit 预览路径 | 2–3 天 |
| M2 网站与面板 | 新建 / 导入网站，文件、配置、主题、数据、预览面板 | 5–6 天 |
| M3 AI 会话 | Pi 会话、建站工具、权限闸门、流式对话、模型设置 | 6–8 天 |
| M4 审核与版本 | 工作副本、差异审核、应用 / 拒绝、历史与恢复 | 5–6 天 |
| M5 MVP | 端到端测试、错误处理、首次启动引导、文档 | 4–5 天 |
| M6 发布 | GitHub Pages（`bukit deploy`） | 3–4 天 |
| M7 桌面版 | Electron 壳 | 4–5 天 |

## 🔗 相关项目

- [Bukit](https://github.com/ALi365-SDN-BHD/Bukit.git)：静态站点引擎
- [Pi](https://github.com/earendil-works/pi)：可扩展的 AI agent 运行层和编程助手
- [Pi Web](https://github.com/agegr/pi-web)：Pi 的 Web 界面，BukitJalil 界面的参考

## 📄 License

MIT License
