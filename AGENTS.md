# AGENTS.md

给在这个仓库里工作的 AI 编程助手看的说明。项目介绍见 [README](README.md)，详细设计、安全规则和每个阶段的实现说明见 [开发方案与实施计划](docs/development-plan.md)。动手前先读开发方案里和任务相关的章节，尤其是安全规则（第 7 节 git 加固、构建前检查、密钥规则）。

## 待开发任务

M0–M7 已完成。下面是还没排期的任务，按建议顺序排列。每项开工前先把"要先定的问题"定下来并写进开发方案，再按分层做：实现 → 审计 → 修复 → 复查 → 提交推送。

### 1. 按代码块部分应用

**现状**：审核改动时只能整份应用或整份拒绝。

**要做的**：在差异视图里，可以按文件、甚至按代码块挑一部分应用，剩下的拒绝或者留着。

**要先定的问题**：

- 没选中的部分怎么处理？是直接丢掉，还是留在改动集里让 AI 接着改？留着会牵扯到工作副本和快照的一致性。
- 现在"审核时看到的内容 = 应用的内容"靠树指纹来保证。部分应用后，指纹要改成对"选中后的结果"计算。
- 最小可行版本：先做"按文件"选择，"按代码块"放第二步。

**工作量**：按文件约 2–3 天；按代码块约 4–6 天（要处理 patch 拼接和冲突）。

### 2. SEO/GEO 报告面板

**现状**：大部分已经做了。每次构建都会跑 `bukit seo audit` 和 `geo audit`，结果摘要显示在构建详情里，e2e 也有测试。

**还缺的**：独立的面板，可以看全部问题清单、按页面筛选、和上次构建对比，再加一个"让 AI 修这些问题"的按钮。

**要先定的问题**：做成单独的标签页，还是在构建详情里展开？

**工作量**：约 2–3 天，是这几项里最轻的。

### 3. Cloudflare Pages 发布

**现状**：Bukit 的 `deploy` 只支持 `github-pages` 一种，所以这一项要 BukitJalil 自己实现上传，不能直接调 Bukit。

**要做的**：构建产物通过 Cloudflare 的上传 API 发布，界面上需要账号 ID、项目名和 API token。

**要先定的问题**：

- 发布目标写在哪里？现在 GitHub Pages 的配置在 `site.yaml` 的 `deploy` 段，而 Bukit 的配置格式只认 `github-pages`。如果把 Cloudflare 的配置也写进去，Bukit 校验配置时可能报错，所以大概率要另外存在 BukitJalil 自己的设置里。
- 新的 token 同样要走现有的密钥规则：只在用户点"发布"时才用。

**工作量**：约 3–4 天，包括抽出一层"发布目标"的接口。

### 4. 自有服务器发布

**要做的**：用 SFTP 或 rsync over SSH，把构建产物上传到用户自己的服务器。

**要先定的问题**：

- 认证方式：SSH 密钥（用户机器上已有的）还是密码？要不要依赖系统里的 `rsync` / `ssh`？Windows 上没有这些。
- 安全：服务器地址、路径都是用户填的，要防止上传到错误位置，要不要先列出差异、确认后再覆盖？

**工作量**：约 3–4 天。如果先做了第 3 项，"发布目标"那层接口可以复用，会快一些。

### 5. Notion 数据源管理

**现状**（按 2026-11-12 工作区里还没提交的改动核对，那批改动变了要重看）：

- 已做：
  - "设置 → 数据源"可以添加 Notion 数据源，每个数据源有自己的 token，显示后四位，可以替换、删除。token 存在 `data-source-tokens.json`（权限 600），接口不返回 token 本身。
  - 新建网站时可以选一个 Notion 数据源，BukitJalil 调 Notion `/search` 列出这个 token 能读的数据库，选中的写进 `site.yaml`。
  - 正式构建会传 `NOTION_TOKEN`（`builds/service.ts`）。
- 还缺：
  - 发布：`deploys/service.ts` 遇到 Notion 网站直接返回 `notion`。
  - AI 检查、AI 构建和改动集预览：`ai-bukit.ts` 遇到 Notion 源直接拒绝。所以应用改动前的检查一定失败，每次都得强制应用，用户分不清是"出错了"还是"检查不了"。
  - 新建的 Notion 网站，状态记为 `configCheck: "notion"` 后既不跑 `config check`，也不自动做第一次构建（`builds/service.ts` 的 `startAfterAdd`）。但正式分支是审核过的内容，可以带 token 跑。
  - 导入的网站没有绑定数据源时，如果只有一个 Notion 数据源就自动用它的 token（`main.ts` 的 `notionToken`）。这有两个问题：
    - 导入的第三方网站可以在 `site.yaml` 里指向这个 integration 能读的任何数据库，构建后再发布出去。
    - 以后加了第二个数据源，这个网站会突然不能构建。
  - 现在也没有接口或界面让用户手动绑定数据源。
  - 数据面板里的 Notion 源只显示配置，文案还是"MVP 不连接 Notion"。
  - 开发方案 6.5、M6 和安全表还写着 `secrets.json` 和"环境变量优先"，和代码对不上。

**Bukit 的限制**（源码 v2.0.15 核对）：

- `ContentProviderFactory.cs` 在读取缓存模式之前就要求 `NOTION_TOKEN`。
- `cacheMode: readonly` 时，`NotionContentSource.LoadCoreAsync` 每次仍然联网读数据库结构、查询数据库，缓存里只有页面正文和关联页面，缓存没命中就报错。

所以"先缓存，预览只读缓存"用现在的 Bukit 做不到，塞一个假 token 也不行。

**要做的**，分两步：

1. 不改 Bukit（约 2–3 天）：
   - 发布支持 Notion：check、doctor、build 都传 token；`deploy --skip-build` 本身要不要 token 需要实测。
   - 新建 Notion 网站后自动跑 `config check` 和第一次构建，都带 token。
   - 去掉"只有一个数据源就自动用"的兜底，改成在数据面板里显式绑定数据源（要加接口；`sites.notion_data_source_id` 和 `setNotionDataSourceId` 已经有了）。
   - 数据面板显示 Notion 数据：
     - 字段由 BukitJalil 调 `GET /databases/{id}` 读取（Bukit 没有列出 Notion 数据的命令）。
     - 页数取上次正式构建报告里的数字，不要自己重新实现 Bukit 的过滤条件，否则两边对不上。
     - 只用正式分支 `site.yaml` 里的 `databaseId`，只在用户打开面板或点刷新时调用，结果不交给 AI 工具。
   - 应用改动时，"Notion 网站检查不了"和"检查失败"分开，前者不要求强制应用。
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
