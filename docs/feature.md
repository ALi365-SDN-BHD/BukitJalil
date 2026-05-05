还可以补这些文档，按优先级来：

**第一优先级**

1. **开发环境文档**
   `docs/development.md`

   说明：
   - 需要安装什么 SDK
   - 如何运行 MAUI App
   - 如何运行测试
   - 如何配置 LiteDB 路径
   - 如何配置 Bukit 路径
   - 如何配置 OpenAI Key

2. **平台支持文档**
   `docs/platform-support.md`

   说明：
   - macOS 支持哪些功能
   - Windows 支持哪些功能
   - Android 支持哪些功能
   - iOS 支持哪些功能
   - 哪些功能只支持桌面端
   - 为什么移动端 V1 不跑本地 Bukit build

3. **LiteDB 存储设计文档**
   `docs/litedb-storage.md`

   说明：
   - collections 设计
   - document 结构
   - indexes
   - 数据版本
   - 迁移策略
   - 项目导入/导出

4. **Bukit 集成文档**
   `docs/bukit-integration.md`

   说明：
   - Bukit 仓库地址
   - 本地 Bukit 路径配置
   - handoff JSON 格式
   - 构建命令
   - 构建日志捕获
   - artifact 输出结构
   - 错误处理

**第二优先级**

5. **AI Provider 设计文档**
   `docs/ai-provider.md`

   说明：
   - Fake Provider
   - OpenAI Provider
   - Local LLM Provider 预留
   - Prompt 渲染
   - Structured JSON 输出
   - API Key 安全存储
   - 生成失败处理

6. **本地安全与密钥文档**
   `docs/security-and-secrets.md`

   说明：
   - OpenAI Key 存哪里
   - GitHub/Cloudflare Token 后续怎么存
   - 不进 LiteDB 明文字段的内容
   - 平台 Secure Storage 使用策略
   - 日志脱敏

7. **构建与部署流程文档**
   `docs/build-and-deploy-workflow.md`

   说明：
   - AI schema 到 Bukit build 的完整流程
   - build 状态机
   - deployment 状态机
   - local export
   - future GitHub Pages / Cloudflare Pages

8. **测试策略文档**
   `docs/testing-strategy.md`

   说明：
   - Core 测试
   - Infrastructure 测试
   - ViewModel 测试
   - LiteDB 临时库测试
   - Fake AI 测试
   - 不依赖真实 OpenAI / Bukit 的测试方式

**第三优先级**

9. **远程 API / SaaS 演进文档**
   `docs/remote-api-roadmap.md`

   说明：
   - V1 本地
   - V2 远程构建
   - V3 多用户同步
   - V4 SaaS
   - API endpoints 草案

10. **数据流 / 状态机文档**
   `docs/workflow-state-machine.md`

   说明：
   - ProjectStatus
   - GenerationStatus
   - ValidationStatus
   - BuildStatus
   - DeploymentStatus
   - 状态如何流转

11. **错误处理文档**
   `docs/error-handling.md`

   说明：
   - AI 生成失败
   - JSON 无效
   - Schema 校验失败
   - Bukit 路径无效
   - Build 失败
   - Deployment 失败
   - 移动端功能不可用

12. **贡献指南**
   `CONTRIBUTING.md`

   说明：
   - 分支规范
   - commit 规范
   - 文档规范
   - 测试要求
   - PR checklist

我建议下一步先生成这 4 个：

```text
docs/development.md
docs/platform-support.md
docs/litedb-storage.md
docs/bukit-integration.md
```

它们最接近实际开工，能把"怎么跑、怎么存、怎么构建、哪些平台能做什么"先定下来。
