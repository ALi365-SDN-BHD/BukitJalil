# BukitJalil V1 Migration Plan

## 1. 目标

本计划用于指导 `AIBuilding` 向 `BukitJalil V1` 的迁移。

迁移目标不是简单复制旧代码，而是：

- 保持 V1 产品能力与 `AIBuilding` 基本等价；
- 在新项目结构中重建更清晰的模块边界；
- 优先复用成熟基础设施；
- 为 V1.5 和 V2 的结构化演进预留扩展点。

一句话目标：

```text
先把 AIBuilding 的可用产品能力迁移过来，再把 BukitJalil 做成更干净、更可演进的版本。
```

## 2. 迁移原则

### 2.1 产品先行

V1 的优先目标是得到一个完整可运行的产品，而不是先追求理想化架构。

### 2.2 基础设施复用优先

已验证稳定的底层能力优先迁移，包括：

- MAUI Blazor 宿主；
- LiteDB；
- Provider 抽象；
- Bukit CLI；
- 部署服务；
- 本地知识库检索。

### 2.3 界面保形，内部重组

工作台交互形态可以延续 `AIBuilding`，但内部逻辑应拆分为更清晰的服务和状态对象。

### 2.4 逐步结构化

V1 仍以文件驱动为主，但要在架构上预留：

- schema 校验接口；
- generation records；
- future workflow service；
- content draft 模型扩展点。

## 3. 迁移范围

### 3.1 直接迁移

以下模块建议优先迁移，尽量少改动核心行为：

#### 3.1.1 Provider 体系

来源：

- `AIBuilding.Core/Providers/`

目标：

- `BukitJalil.Infrastructure/AI/Providers/`

迁移内容：

- `ILlmProvider`
- `OpenAiProviderBase`
- `OpenAiCompatibleProvider`
- `AnthropicProvider`
- `DeepSeekProvider`
- `QwenProvider`
- `DoubaoProvider`
- `KimiProvider`
- `GeminiProvider`
- `ProviderRegistry`
- `IProviderConfigSource`

迁移要求：

- 统一命名空间；
- 移除旧产品名耦合；
- 保留现有模型解析与 Base URL 校验能力；
- 保留环境变量覆盖设置的逻辑。

#### 3.1.2 LiteDB 基础接入

来源：

- `AIBuilding.Desktop/Data/AppDatabase.cs`

目标：

- `BukitJalil.Infrastructure/Persistence/AppDatabase.cs`

迁移内容：

- LiteDB 初始化；
- 数据库密码与密钥存储；
- 基础索引创建；
- AppData 路径约定。

迁移要求：

- 保留 Windows DPAPI 逻辑；
- 保留非 Windows 密钥文件逻辑；
- 将数据库路径策略改为更可配置，但 V1 可先保持本地默认路径；
- 抽出连接工厂或配置对象，为后续多库策略留口。

#### 3.1.3 本地知识库检索

来源：

- `AIBuilding.Core/Knowledge/`
- `AIBuilding.Desktop/Services/KnowledgeService.cs`

目标：

- `BukitJalil.Core/Knowledge/`
- `BukitJalil.Infrastructure/Knowledge/`

迁移内容：

- `DocumentChunk`
- `DocumentPreprocessor`
- `KnowledgeIndex`
- `KnowledgeService`

迁移要求：

- 保留 BM25 检索实现；
- 保留 Markdown 分块和缓存策略；
- 调整文档目录发现逻辑，使其更贴合 BukitJalil；
- 保留中文检索优化。

#### 3.1.4 Bukit CLI 集成

来源：

- `AIBuilding.Desktop/Services/BukitCliService.cs`

目标：

- `BukitJalil.Infrastructure/Bukit/BukitCliService.cs`

迁移内容：

- `build`
- `preview`
- 输出采集
- 端口识别

迁移要求：

- 保持 V1 行为一致；
- 后续在 V2 前加一层 handoff 校验或 workflow service；
- 不直接耦合 UI。

#### 3.1.5 部署服务

来源：

- `AIBuilding.Desktop/Services/DeployService.cs`

目标：

- `BukitJalil.Infrastructure/Deployment/DeployService.cs`

迁移内容：

- GitHub Pages
- Vercel
- Netlify
- Cloudflare Pages

迁移要求：

- V1 先确保 GitHub Pages 跑通；
- 其他平台先按旧实现迁移基础骨架；
- 保留输入校验和 token 传递安全策略。

#### 3.1.6 会话与日志存储

来源：

- `ChatSessionStore`
- `ProjectLogStore`
- `ProjectLogger`

目标：

- `BukitJalil.Infrastructure/Stores/`

迁移要求：

- 保持会话恢复能力；
- 保持日志分类；
- 后续可逐步演进为结构化 `generation_runs`、`build_runs`、`deployment_runs`。

### 3.2 重构迁移

以下模块价值很高，但不适合原样迁移。

#### 3.2.1 AiStudio 工作台

来源：

- `AIBuilding.Desktop/Components/AiStudio.razor`

问题：

- UI 组件过大；
- 持有过多状态；
- 直接负责 tool loop、预览、日志、自动诊断、会话恢复；
- 难以测试和演进。

目标拆分：

- `ProjectWorkspacePage`
- `ChatPanel`
- `PreviewPanel`
- `CodePanel`
- `FileTreePanel`
- `BuildPanel`
- `LogPanel`
- `WorkspaceViewModel`

迁移要求：

- 保留交互体验；
- 不保留“大组件承载所有业务”的实现方式；
- 所有工作流逻辑下沉到 service 层。

#### 3.2.2 ToolExecutor

来源：

- `AIBuilding.Desktop/Services/ToolExecutor.cs`

问题：

- 单类承担过多职责；
- 同时负责文件、主题、配置、构建、部署、设置、平台管理；
- 扩展成本高。

目标拆分：

- `FileToolService`
- `ThemeToolService`
- `ProjectConfigToolService`
- `BuildToolService`
- `DeploymentToolService`
- `SettingsToolService`
- `ToolExecutionCoordinator`

迁移要求：

- 保留统一工具路由入口；
- 内部按领域拆分；
- 将敏感操作确认放在 UI 或 workflow 层，而不是底层执行器中。

#### 3.2.3 PromptBuilder

来源：

- `AIBuilding.Core/PromptBuilder.cs`

问题：

- 超长系统提示承载了太多产品规则；
- 规则与实现绑定；
- 测试和演进成本高。

目标拆分：

- `PromptPolicy`
- `PromptTemplateRenderer`
- `ConversationPromptBuilder`
- `RepairPromptBuilder`

迁移要求：

- 保留 V1 的阶段式经验；
- 将“单轮单问”“主动查文档”“错误自愈”等规则逐步下沉为显式逻辑；
- Prompt 仍可先保留文件内模板，再逐步外置到 `prompts/`。

#### 3.2.4 数据模型命名

来源：

- `Contracts.cs`

问题：

- 命名与旧产品强绑定；
- 一些模型过于面向当前实现细节。

迁移要求：

- `ProjectEntry` -> `WebsiteProject` 或 `ProjectRecord`
- `ThemeEntry` -> `ThemeRecord`
- `DeployPlatform` -> `DeploymentTarget`
- `ProjectLog` -> `ProjectEventLog`

说明：

V1 不必一次性完成终极模型设计，但需要先完成产品命名切换。

### 3.3 延后迁移

以下内容不作为 V1 主交付目标：

- `ConversationOrchestrator`
- 完整结构化 schema 工作流
- 审批流
- 远程构建 API
- 移动端伴随模式
- 团队协作能力

## 4. 建议的新解决方案结构

```text
BukitJalil/
|-- src/
|   |-- BukitJalil.App/
|   |-- BukitJalil.SharedUi/
|   |-- BukitJalil.Core/
|   `-- BukitJalil.Infrastructure/
|-- tests/
|   |-- BukitJalil.Core.Tests/
|   |-- BukitJalil.Infrastructure.Tests/
|   `-- BukitJalil.App.Tests/
|-- prompts/
|-- schemas/
`-- docs/
```

### 4.1 模块职责

#### `BukitJalil.App`

- MAUI 宿主
- 平台服务
- 启动配置
- DI 入口

#### `BukitJalil.SharedUi`

- Razor UI 组件
- 工作台页面
- 设置页
- 平台页
- 可复用面板组件

#### `BukitJalil.Core`

- 领域模型
- Provider 接口
- 知识检索核心
- 工具调用契约
- workflow service 契约

#### `BukitJalil.Infrastructure`

- Provider 实现
- LiteDB
- Bukit CLI
- Deploy
- Stores
- Prompt 实现

## 5. 迁移顺序

### Phase 1: 建立新宿主

目标：

- 创建新 solution；
- 建立 `App`、`Core`、`Infrastructure`、`SharedUi` 项目；
- 跑通空壳应用。

产出：

- 新项目结构；
- 基础 DI；
- 可启动的 MAUI Blazor 应用。

### Phase 2: 迁移基础设施

目标：

- 接入 LiteDB；
- 接入 Provider；
- 接入 SettingsStore、ProjectStore、PlatformStore、ChatSessionStore；
- 接入 KnowledgeService。

产出：

- 可以持久化设置和项目；
- 可以枚举可用 Provider；
- 可以初始化文档索引。

### Phase 3: 迁移工作台最小闭环

目标：

- 建立 Workspace 页面；
- 接入对话区；
- 接入基础工具执行；
- 支持 demo 生成与预览。

产出：

- 能与 AI 对话；
- 能生成 demo；
- 能查看 preview/code。

### Phase 4: 迁移文件工作流

目标：

- 接入文件树；
- 支持读写项目文件；
- 支持确认 demo 写入 Bukit 模板结构。

产出：

- 能从 demo 进入真实项目目录结构；
- 能查看并修改文件。

### Phase 5: 接入 Bukit build/preview

目标：

- 生成 `site.yaml`；
- 执行 build；
- 执行 preview；
- 展示构建日志。

产出：

- 本地构建闭环跑通。

### Phase 6: 接入部署

目标：

- 支持至少一个部署目标；
- 建立平台配置页；
- 展示部署结果。

产出：

- 完成发布链路闭环。

### Phase 7: 重构与稳定化

目标：

- 拆解大组件；
- 清理命名；
- 增加测试；
- 补充文档。

产出：

- 一个可运行且结构比 AIBuilding 更健康的 V1 基线。

## 6. 测试策略

### 6.1 V1 必测模块

- LiteDB 初始化与存取；
- Provider 注册与解析；
- Base URL 校验；
- 文档预处理与检索；
- 项目目录安全解析；
- Bukit CLI 参数构造；
- Deploy 参数校验；
- ChatSession 保存与恢复。

### 6.2 V1 可延后测试

- UI 端到端复杂行为；
- 自动修复链路；
- 多平台部署全量覆盖；
- 复杂 Prompt 质量测试。

## 7. 风险与应对

### 7.1 风险：旧 UI 逻辑耦合过深

应对：

- 只保留交互形态；
- 不直接复制 `AiStudio.razor` 的完整实现。

### 7.2 风险：Prompt 规则过重依赖模型行为

应对：

- V1 暂时沿用；
- 同时逐步把关键规则移到显式服务逻辑。

### 7.3 风险：迁移过多导致节奏失控

应对：

- 以“可运行闭环”为里程碑；
- 每阶段结束都要求产品可演示。

### 7.4 风险：V1 与 V2 方向冲突

应对：

- 明确 V1 为文件驱动；
- 只为结构化能力预留接口，不强行混用两套主流程。

## 8. 完成定义

当满足以下条件时，可认为迁移计划完成第一阶段目标：

- 新的 BukitJalil solution 可以启动；
- 可以创建并保存项目；
- 可以进行 AI 对话；
- 可以生成 demo；
- 可以写入项目文件；
- 可以 build 和 preview；
- 可以部署到至少一个平台；
- 可以恢复设置、日志与聊天历史。

## 9. 一句话总结

```text
BukitJalil V1 的迁移策略不是“复制 AIBuilding”，而是“提取它已验证的产品能力，在更干净的新结构里重新落地”。
```
