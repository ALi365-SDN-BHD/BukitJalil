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

### 4. 自有服务器发布（暂缓，等 Bukit 支持）

**状态**（2026-11-13 定）：先不做，和第 3 项一样等 Bukit 的 `deploy` 支持。到时候 BukitJalil 只负责调用 Bukit，在那之前不在 BukitJalil 里自己写上传。

**要做的**：用 rsync over SSH 把构建产物上传到用户自己的服务器。

**已定的问题**：

- **认证**：只用 SSH 密钥，也就是用户电脑上已有的 `~/.ssh` 密钥或 ssh-agent。BukitJalil 不保存密码，也不读私钥内容。
- **上传工具**：用系统的 `ssh` 和 `rsync`。macOS 和 Linux 都自带；Windows 默认没有 rsync，先不在 Windows 上提供这个发布方式。
- **防止传错位置**：
  - 先做一次不改任何东西的试运行（`rsync --dry-run`），列出要新增、修改、删除的文件，用户确认后才真正上传。
  - 远端路径必须是用户填的绝对路径，不允许 `/` 或家目录本身。
- **多个发布目标**：和第 3 项一样，一个网站可以同时配多个发布目标。

**工作量**：Bukit 支持后约 2–3 天，包括试运行和确认界面。

### 5. Notion 数据源管理（第一步已完成，第二步等 Bukit 改动）

**已定的问题**（2026-11-13）：

- 预览：短期不能预览（方案 A），长期给 Bukit 加离线快照（方案 C）。预览时把 token 给 Bukit（方案 D）**不能选**：没审核的 `site.yaml` 可以把 `databaseId` 换成别的库，AI 就能从构建输出里读到别的数据库的内容。
- 字段显示放在现有数据面板的 Notion 卡片里展开。
- 每个源的页数先不显示，等 Bukit 输出每个源的数量（2.0.15 只有所有源合计的 `event=content.loaded count=`），不自己重算。

**第一步已完成**（2026-11-13，开发方案 5.4）：

- 数据面板"读取字段"：只在点击时、只按正式分支的 `databaseId`、用绑定的 token 调 `GET /v1/databases/{id}`，结果不交给 AI。
- 审核卡和改动面板突出 Notion 配置的变化（新增、删除、换 `databaseId`、改了哪些键）。
- BukitJalil 自己调 Notion 时按 401/403/404/429 翻译报错；构建、发布失败时从 Bukit 输出（含 `doctor`）认出 Notion 报错，在结果里给出处理办法。这些文字来自 Bukit 2.0.15 源码，升级 Bukit 时要核对 `bukit/notion-errors.ts`。

**还缺**：

- AI 检查、AI 构建和改动集预览：`ai-bukit.ts` 遇到 Notion 源直接拒绝（不给未审核内容 token）。
- 每个源的页数。

**Bukit 的限制**（源码 v2.0.15 核对）：

- `ContentProviderFactory.cs` 在读取缓存模式之前就要求 `NOTION_TOKEN`。
- `cacheMode: readonly` 时，`NotionContentSource.LoadCoreAsync` 每次仍然联网读数据库结构、查询数据库，缓存里只有页面正文和关联页面，缓存没命中就报错。

所以"先缓存，预览只读缓存"用现在的 Bukit 做不到，塞一个假 token 也不行。

**第二步：AI 改动的预览**（约 6–8 天，含 Bukit 的改动；2026-11-14 逐项定完，详见开发方案 5.5）：给 Bukit 加完整的 Notion 离线快照。

- 现在的 `cacheMode: readonly` 只冻结页面正文。数据库结构、查询结果、关联目标、跨源关联、分类可选项都要存进快照；分类可选项和 `pages_index` 没 token 时会静默跳过，离线时必须改成读快照。
- Bukit 加命令行参数 `--notion-snapshot <dir>`、`--notion-offline`，覆盖 `site.yaml` 里的 `cacheDir` 和 `cacheMode`；离线模式不要 token、不联网，快照缺项明确报错。
- **快照放在应用数据目录，不放进任何检出目录**（AI 读不到）。快照里有草稿页、网站不显示的字段和其他数据库的关联页面，比要发布的内容多。
- 存 Notion 接口的原始数据，AI 改 `propertyMap` 或模板时预览照样正确。
- AI 换 `databaseId` 或新加 Notion 源：离线构建失败，提示应用后正式构建；改过滤或排序：用旧数据，预览上说明。
- 正式构建的媒体缓存一起保存，离线构建只读使用、不下载。
- 每个网站只保留最新一份，正式构建成功后才整个替换；预览写明数据来自哪次正式构建。
- 顺便让 Bukit 输出每个源的页数，数据面板再接上。
- BukitJalil 自带的 Bukit 版本（`BUKIT_VERSION` 和三个安装包的 SHA-256）要跟着升，随新版 BukitJalil 发布；Bukit 不能由用户单独升级。
