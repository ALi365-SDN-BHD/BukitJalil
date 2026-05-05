# BukitJalil V1 Implementation Plan

## 1. 文档目标

本计划用于把 `BukitJalil V1 PRD` 和 `BukitJalil V1 Migration Plan` 进一步落到可执行层。

它关注的不是产品为什么做，而是：

- 先做什么；
- 后做什么；
- 每一阶段要交付什么；
- 每个模块如何拆解；
- 哪些内容必须验证后才能进入下一阶段。

一句话目标：

```text
用最短路径把 BukitJalil V1 做成一个可运行、可演示、可继续扩展的 AIBuilding 等价版。
```

## 2. 实施原则

### 2.1 先跑通闭环，再做优化

V1 的核心不是代码结构完美，而是尽快形成以下闭环：

```text
创建项目 -> AI 对话 -> 生成 demo -> 写入项目 -> build -> preview -> deploy
```

### 2.2 每个阶段都必须可演示

每个阶段结束时，必须保证当前成果能够：

- 启动；
- 被截图或录屏演示；
- 被后续阶段直接复用。

### 2.3 旧能力迁移，新能力预留

V1 以迁移 `AIBuilding` 已验证能力为主，同时只为后续结构化功能保留接口，不在 V1 主路径中强推。

### 2.4 尽量避免大一统组件

即使 V1 节奏优先，也要避免把所有状态和工作流再次塞入单个 Razor 组件。

## 3. 总体阶段划分

```text
Phase 1  Solution Scaffold
Phase 2  Persistence + Settings
Phase 3  AI Workspace Shell
Phase 4  Tool Execution + Demo Flow
Phase 5  File Workflow + Bukit Config
Phase 6  Build + Preview
Phase 7  Deployment
Phase 8  Stabilization
```

## 4. Phase 1: Solution Scaffold

### 4.1 目标

建立新的 `BukitJalil` 解决方案和最小可启动应用。

### 4.2 任务

- 创建新的 solution；
- 创建 `BukitJalil.App`；
- 创建 `BukitJalil.SharedUi`；
- 创建 `BukitJalil.Core`；
- 创建 `BukitJalil.Infrastructure`；
- 创建基础测试项目；
- 建立项目引用关系；
- 建立 `MauiProgram`；
- 建立基础路由与主布局。

### 4.3 产出

- 应用可启动；
- 左侧导航和主内容区可显示；
- 各项目能正常编译；
- DI 容器可注册基础服务。

### 4.4 验收标准

- `dotnet build` 成功；
- MAUI 应用可打开；
- 至少存在一个占位页面，例如 `ProjectsPage`；
- `App`、`Core`、`Infrastructure`、`SharedUi` 的边界清晰。

## 5. Phase 2: Persistence + Settings

### 5.1 目标

先把本地基础设施跑起来，包括数据库、设置和项目元数据。

### 5.2 任务

- 迁移或重建 `AppDatabase`；
- 建立基础集合；
- 建立 `SettingsStore`；
- 建立 `ProjectStore`；
- 建立 `PlatformStore`；
- 建立 `ChatSessionStore`；
- 建立 `ProjectLogStore`；
- 建立 `AppSettings`、`WebsiteProject`、`DeploymentTarget` 等基础模型；
- 建立设置页；
- 建立项目列表页基础数据加载。

### 5.3 产出

- 设置可保存；
- 项目可创建和读取；
- 平台配置可持久化；
- 聊天会话具备存储接口。

### 5.4 验收标准

- 关闭应用再打开，设置仍存在；
- 创建项目后可在项目列表中看到；
- 本地数据库文件成功生成；
- LiteDB 初始化与索引无错误。

## 6. Phase 3: AI Workspace Shell

### 6.1 目标

建立新的工作台外壳，但此阶段先不追求完整执行链。

### 6.2 任务

- 创建 `ProjectWorkspacePage`；
- 创建 `ChatPanel`；
- 创建 `PreviewPanel`；
- 创建 `CodePanel`；
- 创建 `FileTreePanel`；
- 创建 `BuildPanel`；
- 创建 `LogPanel`；
- 创建 `WorkspaceViewModel`；
- 接入基础页面切换；
- 接入 Provider 下拉选择。

### 6.3 产出

- 有完整工作台布局；
- 可以在不同面板之间切换；
- 能显示项目基础信息；
- 能显示聊天消息列表占位。

### 6.4 验收标准

- 从项目页可进入工作台；
- 工作台结构稳定；
- 页面刷新或重进不会报错；
- UI 已具备承载后续功能的骨架。

## 7. Phase 4: Tool Execution + Demo Flow

### 7.1 目标

让工作台具备最小 AI 执行能力，先打通对话生成 demo 的路径。

### 7.2 任务

- 迁移 `ILlmProvider` 体系；
- 建立 `ProviderRegistry`；
- 接入可用 Provider 列表；
- 先接入一个可运行 Provider；
- 迁移 `ToolRegistry`；
- 建立 `ToolExecutionCoordinator`；
- 先实现最小工具集：
  - `generate_theme`
  - `set_phase`
  - `read_file`
  - `write_file`
  - `list_files`
- 建立消息历史模型；
- 建立敏感操作确认机制；
- 完成第一版 tool loop。

### 7.3 产出

- 用户可在工作台输入需求；
- AI 可以返回文本；
- AI 可以调用最小工具集；
- 可以生成 demo 并展示在预览区。

### 7.4 验收标准

- 对话能成功发起；
- demo 能显示在 Preview；
- HTML/CSS/JS 能显示在 Code 面板；
- 错误时有清晰提示。

## 8. Phase 5: File Workflow + Bukit Config

### 8.1 目标

把 demo 从“预览结果”推进到“真实项目文件结构”。

### 8.2 任务

- 接入项目目录创建逻辑；
- 支持安全路径解析；
- 建立 demo 确认动作；
- 写入 Bukit 模板目录结构；
- 迁移或重建 `BukitConfigService`；
- 生成 `site.yaml`；
- 让工作台能刷新文件树；
- 让用户可以查看文件内容。

### 8.3 产出

- 生成结果能真实落入项目目录；
- 可以从 demo 转到 Bukit 项目结构；
- 可在 `Files` 面板中查看结果。

### 8.4 验收标准

- 项目目录自动创建；
- 主题文件写入成功；
- `site.yaml` 能成功生成；
- 文件树能正确展示生成结果。

## 9. Phase 6: Build + Preview

### 9.1 目标

打通从项目文件到本地构建和预览的流程。

### 9.2 任务

- 迁移 `BukitCliService`；
- 接入 `build`；
- 接入 `preview`；
- 记录 build 输出；
- 在 `BuildPanel` 中显示日志；
- 在 `PreviewPanel` 中支持 localhost 预览；
- 增加 build 失败的 UI 呈现；
- 为后续自动诊断预留入口。

### 9.3 产出

- 用户可点击构建；
- 用户可看到 build 日志；
- 构建成功后可本地预览。

### 9.4 验收标准

- 至少一个样例项目能成功 build；
- preview 端口能被正确识别；
- 构建失败时日志可见；
- 再次构建不会导致应用进入异常状态。

## 10. Phase 7: Deployment

### 10.1 目标

跑通 V1 的发布链路。

### 10.2 任务

- 迁移 `DeployService`；
- 优先接入 GitHub Pages；
- 建立 `PlatformsPage`；
- 支持创建和编辑部署目标；
- 在工作台中发起部署；
- 展示部署输出；
- 返回部署 URL。

### 10.3 产出

- 用户可配置平台；
- 用户可将构建产物部署到至少一个平台；
- 用户可看到部署结果。

### 10.4 验收标准

- GitHub Pages 至少一条路径可用；
- 平台配置保存后可恢复；
- 部署失败时能看到可操作信息；
- 成功部署后可拿到访问地址。

## 11. Phase 8: Stabilization

### 11.1 目标

在 V1 可用闭环形成后，提升可维护性和稳定性。

### 11.2 任务

- 清理命名；
- 拆分超大组件逻辑；
- 增加项目日志分类展示；
- 增加会话恢复与退出保存；
- 补充核心测试；
- 增加开发文档；
- 整理配置与依赖说明。

### 11.3 产出

- 一套可持续迭代的 V1 基线；
- 比 `AIBuilding` 更清晰的代码结构；
- 可交接和可继续演进的工作成果。

### 11.4 验收标准

- 核心闭环稳定；
- 关键基础设施有测试覆盖；
- 文档足够支撑下一阶段开发；
- 不再依赖单个超大组件承载全部业务。

## 12. 模块拆解

### 12.1 App

负责：

- MAUI 启动；
- 平台特性；
- 主布局宿主；
- 依赖注入。

### 12.2 SharedUi

负责：

- 页面与组件；
- 工作台布局；
- 面板 UI；
- 设置页、平台页、项目页。

### 12.3 Core

负责：

- 领域模型；
- Provider 契约；
- Tool 契约；
- Knowledge 核心；
- 工作流接口；
- 校验接口预留。

### 12.4 Infrastructure

负责：

- LiteDB；
- Provider 实现；
- Bukit CLI；
- 部署服务；
- Prompt 实现；
- Store；
- 日志实现。

## 13. 关键实现顺序

推荐遵循以下优先级：

1. `App + Core + Infrastructure` 基础骨架
2. `LiteDB + Settings + Projects`
3. `Workspace 外壳`
4. `Provider + Tool Loop`
5. `Demo 生成`
6. `文件写入与 site.yaml`
7. `Build + Preview`
8. `Deploy`
9. `Stabilization`

## 14. 关键风险

### 14.1 过早追求终极架构

风险：

- V1 长期停留在设计状态；
- 迟迟没有可运行产品。

应对：

- 以运行闭环为第一优先级；
- 结构化能力只预留，不抢占主路径。

### 14.2 复制旧实现导致新技术债

风险：

- `AiStudio` 级别的大组件再次出现；
- 逻辑难以维护。

应对：

- 迁移时保留产品体验，不保留过重耦合实现。

### 14.3 CLI 和本地环境依赖导致体验不稳定

风险：

- Bukit 路径错误；
- 本地 preview 失败；
- 部署工具缺失。

应对：

- 在设置页做明显校验；
- 提供清晰错误提示；
- 保留日志输出和诊断入口。

## 15. Definition of Done

当以下条件同时满足时，可认为 `BukitJalil V1` 达到实施完成标准：

- 新 solution 可稳定启动；
- 用户可创建、打开、删除项目；
- 用户可在工作台进行 AI 对话；
- 用户可生成并预览 demo；
- 用户可将结果写入 Bukit 项目结构；
- 用户可运行 build 和 preview；
- 用户可部署到至少一个平台；
- 设置、日志、会话可恢复；
- 核心模块有基础测试；
- 文档足够支撑团队继续开发。

## 16. 一句话总结

```text
BukitJalil V1 的实施重点，不是一次做完所有理想能力，而是先用最小路径做出一个真正可运行的产品闭环。
```
