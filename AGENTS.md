# AGENTS.md

给在这个仓库里工作的 AI 编程助手看的说明。项目介绍见 [README](README.md)，详细设计、安全规则和每个阶段的实现说明见 [开发方案与实施计划](docs/development-plan.md)。动手前先读开发方案里和任务相关的章节，尤其是安全规则（第 7 节 git 加固、构建前检查、密钥规则）。

## 待开发任务

M0–M7 已完成。下面是还没排期的任务，按建议顺序排列。每项开工前先把"要先定的问题"定下来并写进开发方案，再按分层做：实现 → 审计 → 修复 → 复查 → 提交推送。

### 3. Cloudflare Pages 发布（暂缓，等 Bukit 支持）

**状态**（2026-11-13 定）：先不做。等 Bukit 的 `deploy` 支持 Cloudflare Pages、配置格式里有对应的发布目标后，BukitJalil 再像 GitHub Pages 一样调用 Bukit 实现。在那之前，不要在 BukitJalil 里自己写 Cloudflare 上传。

**现状**：Bukit 的 `deploy` 只支持 `github-pages` 一种，配置格式也只认它，所以把 Cloudflare 的配置写进 `site.yaml` 的 `deploy` 段，Bukit 校验时会报错。

**已定的问题**：

- 一个网站可以同时配多个发布目标（GitHub Pages 和 Cloudflare Pages 并存），发布时选发到哪里。`site.url` 只能指向其中一个，其他目标上的 canonical 会指向别处，界面要说明。
- 只用 Cloudflare 上已有的 Pages 项目，项目不存在就报错，不由 BukitJalil 创建。
- 如果到时候仍要 BukitJalil 自己计算上传用的 BLAKE3 文件哈希，用 `@noble/hashes`（精确版本）。由 Bukit 负责上传时就不需要。
- 新的 token 同样走现有的密钥规则：存为发布账号，只在用户点"发布"时才用。

**参考**（2026-11-13 按 wrangler 源码核对的 Direct Upload 流程，供 Bukit 实现时对照）：

1. `GET /accounts/{id}/pages/projects/{name}/upload-token` 拿到 JWT。
2. `POST /pages/assets/check-missing` 查出缺哪些文件，`POST /pages/assets/upload` 上传，`POST /pages/assets/upsert-hashes` 登记。这三步用 JWT 认证，JWT 过期就重新取。
3. `POST /accounts/{id}/pages/projects/{name}/deployments` 创建部署，multipart 的 `manifest` 字段是 `{"/路径": 哈希}`，`_headers`、`_redirects` 单独作为文件字段。
4. 文件哈希是 BLAKE3(文件 base64 + 扩展名) 的前 32 个十六进制字符。单个文件最大 25 MiB，默认最多 20000 个文件。

**工作量**：Bukit 支持后约 2–3 天，包括抽出一层"发布目标"的接口和多目标的界面。

### 4. 自有服务器发布

**要做的**：用 SFTP 或 rsync over SSH，把构建产物上传到用户自己的服务器。

**要先定的问题**：

- 认证方式：SSH 密钥（用户机器上已有的）还是密码？要不要依赖系统里的 `rsync` / `ssh`？Windows 上没有这些。
- 安全：服务器地址、路径都是用户填的，要防止上传到错误位置，要不要先列出差异、确认后再覆盖？

**工作量**：约 3–4 天。如果先做了第 3 项，"发布目标"那层接口可以复用，会快一些。

### 5. Notion 数据源管理

**现状**（按 2026-11-13 的代码核对）：

- 已做：
  - "设置 → 数据源"可以添加 Notion 数据源，每个数据源有自己的 token，显示后四位，可以替换、删除。token 存在 `data-source-tokens.json`（权限 600），接口不返回 token 本身。
  - 新建网站时可以选一个 Notion 数据源，BukitJalil 调 Notion `/search` 列出这个 token 能读的数据库，可以勾选多个，写进 `site.yaml`（源名称用下划线、以字母开头）。
  - 正式构建会传 `NOTION_TOKEN`（`builds/service.ts`），而且只用网站绑定的数据源的 token。新建网站时选的数据源自动绑定，导入的网站在数据面板里显式绑定（`PUT /api/sites/:siteId/notion-source`），不再"只有一个数据源就自动用"。
  - 绑定了数据源的网站：网站检查的 `config check` 带 token 跑，新建后自动构建；发布时 check、doctor、build 带 token（`deploy --skip-build` 不需要，Bukit 源码核对过）。没绑定时状态和结果都是 `notion`。
  - 应用改动：网站已绑定、默认分支本来就用 Notion 时，"检查不了"不算失败，不要求强制，界面提示看正式构建的结果；改动自己加进 Notion 源时仍要求强制。
- 还缺：
  - AI 检查、AI 构建和改动集预览：`ai-bukit.ts` 遇到 Notion 源直接拒绝（不给未审核内容 token），所以 AI 改动不能检查、不能预览。
  - 数据面板里的 Notion 源只显示配置。

**Bukit 的限制**（源码 v2.0.15 核对）：

- `ContentProviderFactory.cs` 在读取缓存模式之前就要求 `NOTION_TOKEN`。
- `cacheMode: readonly` 时，`NotionContentSource.LoadCoreAsync` 每次仍然联网读数据库结构、查询数据库，缓存里只有页面正文和关联页面，缓存没命中就报错。

所以"先缓存，预览只读缓存"用现在的 Bukit 做不到，塞一个假 token 也不行。

**要做的**，分两步：

1. 不改 Bukit（剩余约 1–2 天）：
   - 数据面板显示 Notion 数据：
     - 字段由 BukitJalil 调 `GET /databases/{id}` 读取（Bukit 没有列出 Notion 数据的命令）。
     - 页数取上次正式构建报告里的数字，不要自己重新实现 Bukit 的过滤条件，否则两边对不上。
     - 只用正式分支 `site.yaml` 里的 `databaseId`，只在用户打开面板或点刷新时调用，结果不交给 AI 工具。
   - 审核卡上突出显示 Notion 配置的变化（`databaseId`、过滤条件等），因为应用后正式构建会带 token 去拉那个库。
   - token 失效、数据库没共享给 integration 时，把 Bukit 的报错翻译成明确的提示。
   - 同步开发方案和用户指南。
2. AI 改动的预览（约 4–6 天，含 Bukit 的改动）：给 Bukit 加完整的离线快照。
   - readwrite 时把数据库结构和查询结果也存下来。
   - 新增一个不要 token、不联网的离线模式。
   - BukitJalil 正式构建时把快照写到 AI 工作副本之外，预览时只读放进检出，预览显示的就是"上次正式构建时的 Notion 数据"。
   - BukitJalil 的最低 Bukit 版本要跟着升。

**要先定的问题**：

- 预览方案。备选：
  - A：继续不能预览。
  - B：BukitJalil 自己把 Notion 转成 Markdown 快照，预览时换掉数据源。缺点是 Notion 正文由 Bukit 自己的渲染器生成，转成 Markdown 后关联、`propertyMap`、颜色块等和正式版不一致，还要多维护一套转换器。
  - C：Bukit 离线快照。保真度最高，Bukit 也是自己的仓库。
  - D：预览时把 token 给 Bukit。**不能选**：没审核的 `site.yaml` 可以把 `databaseId` 换成别的库，AI 就能从构建输出里读到别的数据库的内容，违反密钥规则。

  建议短期 A（加上上面应用流程的改进），长期 C。
- 选 C 的话：
  - 缓存目录和模式必须由 BukitJalil 指定，不能读 `site.yaml`（AI 能改它），所以 Bukit 要提供命令行覆盖，或者由 BukitJalil 生成一份临时配置。
  - 快照内容会进入 AI 能读的检出目录。快照只包含按正式分支过滤条件查出的页面，这些本来就要发布，但要写进安全规则。
- 数据面板放在现有的数据面板卡片里展开，还是单独做 Notion 详情页？

**工作量**：第一步约 2–3 天，第二步约 4–6 天。
