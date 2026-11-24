# AGENTS.md

给在这个仓库里工作的 AI 编程助手看的说明。项目介绍见 [README](README.md)，详细设计、安全规则和每个阶段的实现说明见 [开发方案与实施计划](docs/development-plan.md)。动手前先读开发方案里和任务相关的章节，尤其是安全规则（第 7 节 git 加固、构建前检查、密钥规则）。

## C# 代码规则

改 Bukit 或其他 C# 代码时遵守：

1. 正确性和安全优先。
2. 不写冗余代码，复用已有的 helper。
3. 只优化热路径。
4. 在 net10.0 下用更清晰的现代写法。
5. 以工具结果为准：必须通过 `dotnet-format`、analyzer ratchet 和 public-api-drift，复杂度不能超过基线。

## 开发 SOP

开发任务按下面的流程做（2026-11-19 定）：

1. **分析梳理核实需求**：对照方案（设计文档和开发方案）理清并核实要做什么。
2. **按照方案实施**。
3. **审计执行结果**：有问题就写进问题记录；没有问题就回到第 1 步，做下一个需求。三步循环执行。
4. **最后审计问题记录**：逐条核实，只修真实存在的问题。

开发期间严禁漂移、超范围开发。

## 修复 SOP

方案里的分层里程碑（`docs/development-plan.md` 的“M<n> 分层实施”）按下面的自动循环做，层与层之间不等用户确认（2026-11-19 定，原“执行 SOP”改名）：

1. **实现这一层**：写代码和测试，并在开发方案里补“M<n> 第 k 层实现说明”。
2. **审计**：按代码审查方式检查，报告发现的问题。
3. **修复并复查**：有问题就全部修完，带着结果重新报告，再审计一次；重复直到某次审计没有发现问题。连续 3 轮后停下来问用户。
4. **提交推送**：审计通过，且 `pnpm -s check`、完整测试和构建都通过后，提交并推送。
5. **进入下一层**。

停下来问用户的情况：里程碑的最后一层做完了；某一步需要用户决定或只有用户能做（真实 API key、下载文件、方案没定的设计选择）；检查反复失败。方案里交给其他会话做的层跳过（例如 M4 第 7 层 SEO/GEO）。

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

### 5. Notion 数据源管理（已完成：字段读取、离线快照、错误码）

**已定的问题**（2026-11-13）：

- 预览：短期不能预览（方案 A），长期给 Bukit 加离线快照（方案 C）。预览时把 token 给 Bukit（方案 D）**不能选**：没审核的 `site.yaml` 可以把 `databaseId` 换成别的库，AI 就能从构建输出里读到别的数据库的内容。
- 字段显示放在现有数据面板的 Notion 卡片里展开。
- 每个源的条数用 Bukit 输出的 `event=content.source.loaded`（2.1.0 起），不自己重算；数据面板已显示。

**第一步已完成**（2026-11-13，开发方案 5.4）：

- 数据面板"读取字段"：只在点击时、只按正式分支的 `databaseId`、用绑定的 token 调 `GET /v1/databases/{id}`，结果不交给 AI。
- 审核卡和改动面板突出 Notion 配置的变化（新增、删除、换 `databaseId`、改了哪些键）。
- BukitJalil 自己调 Notion 时按 401/403/404/429 翻译报错；构建、发布失败时从 Bukit 输出（含 `doctor`）认出 Notion 报错，在结果里给出处理办法。现在按 Bukit 2.2.0 起的 `BKT-0Bxx` 码认（见下面的错误码）。

**错误码**（已完成，Bukit 2.2.0 起）：Notion 报错和快照报错按 Bukit 的 `BKT-0Bxx` 码识别（`bukit/notion-errors.ts` 的码表），去掉了文字匹配；快照只校验格式版本。方案和码表见 [docs/notion-error-codes-and-snapshot-version.md](docs/notion-error-codes-and-snapshot-version.md)。内置 Bukit 现在是 2.2.7（2.2.3 起带 `--notion-pin`，码表加了 0B18、0B19；2.2.4–2.2.7 码表没有变化），升级时要核对码表有没有变化。

**Bukit 的限制**（源码 v2.0.15 核对）：

（下面是 2.1.0 之前的情况，2.1.0 的 `--notion-snapshot` / `--notion-offline` 已经解决。）

- `ContentProviderFactory.cs` 在读取缓存模式之前就要求 `NOTION_TOKEN`。
- `cacheMode: readonly` 时，`NotionContentSource.LoadCoreAsync` 每次仍然联网读数据库结构、查询数据库，缓存里只有页面正文和关联页面，缓存没命中就报错。

所以"先缓存，预览只读缓存"用现在的 Bukit 做不到，塞一个假 token 也不行。

**第二步：AI 改动的预览**（已完成：Bukit 2.1.0 带离线快照，BukitJalil 这边 2026-11-14 实现，实现说明见开发方案 5.5 末尾；下面是当时定的设计）：给 Bukit 加完整的 Notion 离线快照。

- 现在的 `cacheMode: readonly` 只冻结页面正文。数据库结构、查询结果、关联目标、跨源关联、分类可选项都要存进快照；分类可选项和 `pages_index` 没 token 时会静默跳过，离线时必须改成读快照。
- Bukit 加命令行参数 `--notion-snapshot <dir>`、`--notion-offline`，覆盖 `site.yaml` 里的 `cacheDir` 和 `cacheMode`；离线模式不要 token、不联网，快照缺项明确报错。
- **快照放在应用数据目录，不放进任何检出目录**（AI 读不到）。快照里有草稿页、网站不显示的字段和其他数据库的关联页面，比要发布的内容多。
- 存 Notion 接口的原始数据，AI 改 `propertyMap` 或模板时预览照样正确。
- AI 换 `databaseId` 或新加 Notion 源：离线构建失败，提示应用后正式构建；改过滤或排序：用旧数据，预览上说明。
- 正式构建的媒体缓存一起保存，离线构建只读使用、不下载。
- 每个网站只保留最新一份，正式构建成功后才整个替换；预览写明数据来自哪次正式构建。
- 快照只校验格式版本（`FormatVersion`），不要求 Bukit 版本一致，否则每次升级 BukitJalil 所有快照都失效（2026-11-14 定）。Bukit 的测试里放一份固定的 `format=1` 快照，离线构建结果必须不变；改了快照数据的意思或换了 Notion API 版本就升 `FormatVersion`。
- 顺便让 Bukit 输出每个源的页数，数据面板再接上。
- BukitJalil 自带的 Bukit 版本（`BUKIT_VERSION` 和五个安装包的 SHA-256）要跟着升，随新版 BukitJalil 发布；Bukit 不能由用户单独升级。

### 6. 素材上传（已实现）

设计见 [docs/plans/2026-11-12-media-upload-design.md](docs/plans/2026-11-12-media-upload-design.md)（v4.1）。2026-11-16 已实现并合并到 `pi-harness-ui`（`8d7f4f3`），验收见 [docs/acceptance/media-upload.md](docs/acceptance/media-upload.md)。下面三项是 2026-11-16 从中移出的，不随它实施。

### 7. 改动集作者和说明的规则（已完成）

2026-11-16 已完成，规则见开发方案 7.2：

- **作者**：`apply` 和 `applyPartial` 都按 `!aiJoined` 判断用户作者（`ChangeService.authorOf`），对话被删除后 AI 参与过的改动集仍记 AI 作者。
- **说明**：恢复、插件开关写的说明存在 `user_summary`，和 AI 的说明分开。对话加入后，提交说明第一行仍是用户说明，下面补 AI 的说明；AI 没写时补 `AI changes: …`，列出 AI 改过的文件（快照时记录，插件开关和上传不算 AI 的）。

### 8. 全局请求体上限（不做）

`/api` 没有全局请求体上限。2026-11-16 定：不加。BukitJalil 是本机客户端，`/api` 只监听 127.0.0.1，还有一次性登录链接、精确 Origin 和自定义请求头挡住别的网页，请求只来自用户自己的界面。素材上传路由保留自己的 14 MiB 上限。

### 9. 上传网址的发布前检查（已完成）

改 `site.baseUrl` 后，正文里写死的旧上传网址会失效，构建不报错。2026-11-16 已实现（素材上传设计 v4.2 的 4.9）：

- 构建成功后扫描输出 HTML 的 `src`、`href`、`srcset`；引用必须按路径段带当前 `baseUrl`，去掉后是输出里大小写一致的普通文件，否则在构建报告的警告里列出页面和网址，不阻断预览。
- 发布在 `publish audit` 之前做同一个检查；有问题时以新的 `DeployOutcome` `upload_prefix` 结束，`detail` 列出页面和网址，不进入 `deploy`。
- 文件本身不在 `uploads/` 集合里的引用不查；绝对、协议相对、相对和 `data:` 不查。

### 10. 应用更新（已完成，仅手动安装）

2026-11-16 已实现：左下角版本后面有“更新”按钮；检查 GitHub Releases，用户点“下载安装包”后后台下载并校验 SHA-256，完成后打开对应平台的安装程序（macOS dmg、Windows exe、Linux AppImage 或 deb；Linux 按 `APPIMAGE` 选格式）。Linux AppImage 会替换运行中的文件并重启；deb 用系统安装器；Windows 在平台支持前隐藏更新按钮。没有 Developer ID 时 macOS 不能应用内安装，所以没有使用 Squirrel.Mac；以后签名后再换成 `electron-updater`。版本号改为根 `package.json` 唯一来源，发布标签必须和它一致。设计见 [docs/plans/2026-11-16-auto-update-design.md](docs/plans/2026-11-16-auto-update-design.md)。

**阶段和已知风险**（2026-11-16）：开发/测试阶段，只在测试环境使用。更新包和 `SHA256SUMS.txt` 来自同一个 GitHub Release，没有独立签名；发布账号或 CI 的写权限被攻破时，能让客户端下载并打开恶意安装包。对外发布前必须先选一个方案：删掉应用内下载/打开、只打开 Release 页面；或加 Ed25519 签名清单，私钥离线保存。详见设计文档第 10 节。

### 11. 预览里的搜索（已在 Bukit 2.2.6 上验证）

2026-11-16 已在 Bukit 仓库的分支 `codex/add-search-index-script` 提交脚本形式的搜索索引（每个 `search.json` 旁边写 `search.json.js`；内置搜索先 `fetch`，被 CSP 拦下时改用同源 `<script>`），已推送并开了 PR #196，尚未合并发布。2026-11-16 Bukit 2.2.6 发布了这项改动（PR #196），内置版本已升到 2.2.6。升级前预览里的搜索不可用：starter 的搜索页点了没有结果也没有提示，内置 `bukit-search.html` 显示 "Search is unavailable"；发布后的网站正常（没有预览那条 CSP）。2026-11-16 用 Bukit 2.2.6 构建的 `bukit-search.html`，在带预览 CSP（`connect-src 'none'`）的服务里，Chromium、Firefox、WebKit 三种浏览器都能搜到结果、没有页面错误；索引走 `search.json.js` 的 `<script>` 回退。已经生成到主题里的搜索页不会自动获得回退，主题作者要复制新生成的 `themes/starter/layouts/pages/search.html` 里整段 `<script>`。

### 12. Windows 移植（已估算，未开工）

2026-11-18 估算，两轮实测和测试修复后修订为约 4–6 个工作日，阻塞项、实测结果、顺序和验收见开发方案 14 里"M7 之后：Windows 移植估算"。现状：Windows 仍是预览，CI 不阻塞，应用内更新按钮隐藏；打包后的桌面版在 Windows runner 上已通过冒烟测试。第 0 项已完成；最大的单一问题是仓库没有 `.gitattributes`（Windows 检出变 CRLF，占单元测试失败的 206/252），已加上，测试也修好了：Windows 上单元测试 538 通过、132 跳过、0 失败，e2e 43 通过、0 失败（跳过的主要是依赖 shell 脚本替身 Bukit 的用例）。环境变量、Bukit 的 `PATH`、`rg` 的 Windows 包、`O_NOFOLLOW` 的 `lstat` 检查、Windows 上的更新按钮，代码都已写完（2026-11-18），待 Windows 实机验证。还剩：把 Windows CI 改成必须通过，以及补一套用真 Bukit 的测试，见开发方案第 5、10 项。另外，Linux 没有钥匙串时不保存 token 和密钥；原计划另做的"应用主密码"由第 14 项 PIN 锁定覆盖。

### 13. 主题开发（2026-11-19 定，已完成）

左栏顶部切换"网站构建 / 主题开发"，主题开发包括按描述新建主题、导入主题、克隆网站（仅桌面版）。设计和已定的问题见 [docs/plans/2026-11-19-theme-development-design.md](docs/plans/2026-11-19-theme-development-design.md)，分层见开发方案 14 的"主题开发"。T0（抽出"项目"）→ T1（新建、模式切换、参考图、应用到网站、导出）→ T2（导入主题）→ T3（克隆网站）已全部实现（2026-11-19），实现说明和已知取舍见开发方案 14。新建主题时先在首页定稿风格，用户确认后再做其他页面类型（设计第 4 节、第 9 节第 9 条，只改技能的工作顺序）。两轮审计的问题都已修复，PR #7 已合并到 `main`（2026-11-19，`81f180b`）。

### 14. PIN 锁定和数据库加密（2026-11-20 定，2026-11-21 已完成）

桌面版用 PIN 锁定应用；四类密钥和 Pi 会话记录都存进数据库，整库用 SQLCipher 加密，PIN 是口令，做法参考 SmartEMR（`249b47b`）。6 个问题已逐条定下：整库加密加库内随机字段密钥；只用 PIN，去掉钥匙串；4–8 位数字、SQLCipher 默认 KDF；锁定只拦界面和接口，任务继续，空闲自动锁定默认关闭，桌面版必须设置 PIN；忘记 PIN 在锁屏上重置；`pnpm dev` 和测试不要 PIN。拷走 `app.db` 后可以离线试 PIN，这是已知取舍。设计见开发方案 6.9，分层 P0–P4 见开发方案 14 的"PIN 锁定"，五层都已实现（2026-11-21），实现说明在各层后面。两轮审计的问题都已修复，PR #11 已合并到 `main`（2026-11-21，`aa8b9f4`）。

### 15. 内容管理：Notion 数据源（2026-11-21 定，已完成）

左上角加第三个模式"内容管理"，只针对 Notion 数据源，和网站无关：左栏列出所有数据源和它们能访问的数据库，中栏是条目列表和正文，右栏是属性。保存直接写进 Notion，没有审核和版本；网站下次正式构建时用上。Markdown 不做。正文只在块都在支持范围内时可编辑，图片只支持外链。设计见开发方案 5.6，分层 C0–C3 见开发方案 14 的"内容管理"，四层都已实现（2026-11-21），实现说明和问题记录在各层后面。两轮审计和 PR 评审的问题都已修复，PR #13 已合并到 `main`（2026-11-21，`001d66c`）。

### 16. 内容管理：块编辑器和 AI 对话（2026-11-22 定）

用户选定：正文用 Notion 式块编辑器（BlockNote），先做编辑器；中栏加 AI 对话，AI 可以修改当前条目、新建条目，写入前都要用户确认。设计见 [docs/plans/2026-11-22-content-editor-and-ai-design.md](docs/plans/2026-11-22-content-editor-and-ai-design.md)。编辑器 E0–E2 已完成（2026-11-22）；AI 对话的问题已定（2026-11-22）：中栏底部可折叠面板、按数据库保存对话、AI 能读当前条目和数据库字段并能搜索读取同库条目、沿用网站构建的模型；细节和分层 A0–A4 见设计文档第二部分。A0–A4 已全部实现（2026-11-22），实现说明在设计文档各层后面。PR #19 已合并到 `main`（2026-11-22，`d1415e1`）；合并后严格审计的 6 条和复查的 4 条已修（设计文档"合并后严格审计"），PR #20 已合并（2026-11-22，`1c61428`）。

### 17. 主题设计规范和默认设计系统（2026-11-22 定，已完成）

主题开发现在没有设计系统：token 键名随意，新主题从没有 `tokens.yaml` 的 starter 开始，设计规则只有"设计质量自查"和"严格拒绝 AI 味设计"（`theme-development` 技能），全靠 AI 自觉。方案：固定 token 约定，加一个 `theme-design` 技能（方向说明、组件清单、中文排版，并入自查和 AI 味规则），BukitJalil 自带一套符合规范的**默认设计系统**作为新主题的起点，再加 `theme_lint` 工具自动检查。现状、缺口、分层 D0–D3 和问题 Q1–Q9 见开发方案 14 的"主题设计规范和默认设计系统"。Q1–Q9 已按建议定下（2026-11-22），D0 → D1 → D2 已全部实现（2026-11-22）：`theme-design` 必需技能、新建和克隆的主题从默认设计系统开始、`theme_lint` 工具和应用到网站时的设计检查提醒（只提示不阻断）；D2 补充借鉴了 Claude 的设计指引和 Material 3（AI 味清单补四种、结构要表达信息、`border-strong`、`tabular-nums`）；D3（预览截图给 AI）不做。实现说明在开发方案各层后面。评审提出的线性扫描问题已修复，PR #21 已合并到 `main`（2026-11-22，`18c60c3`）。

### 18. 借鉴 taste skill：配色库和文案清单（2026-11-23 定，已完成）

taste skill（Leonxlnx/taste-skill，MIT）不能整套给 Pi agent 用：它离不开 `node` 脚本和无头 Chrome，做的是公司官网和落地页，字体走 Google Fonts。只借两样：一是配色库，做成主题项目的 `theme_palettes` 工具（D4）：筛掉 AI 味配色后剩 42 套，补齐 token 约定的颜色键并推导暗色，对比度保证达标，在"设计方向"里给用户选；二是文案"AI 味"清单，写进 `content-writing` 技能（D5），中文部分我们自己写。问题 Q10–Q16 已按建议定下，D4、D5 已实现（2026-11-23），实现说明在开发方案各层后面。分层和问题见开发方案 14 的"借鉴 taste skill：配色库和文案清单"。

### 19. 借鉴 taste skill（续）：静态检查三条规则和 D3 渲染检查（2026-11-23 定，已完成）

taste skill 在真浏览器里检查横向溢出、重叠、点击区、标题层级、焦点环等。我们的 AI 不能跑命令，所以分两层：D6 给 `theme_lint` 加三条能从源码看出来的规则（主题颜色用紫色、滚动淡入、倾斜效果），只提醒不阻断；D3 重新定为桌面版的 `theme_render_check` 工具，由主进程用隐藏窗口渲染预览，在 320、390、768、1280 宽度查溢出、点击区、标题层级、焦点环和重叠，返回文字结果。问题 Q17–Q21 已按建议定下（2026-11-23），D6、D3 已实现（2026-11-23），实现说明见开发方案 14 的"借鉴 taste skill（续）"。

### 20. 借鉴 Material 3：第二套设计系统（2026-11-24 定，实施中）

用户问能不能加谷歌和苹果的设计系统，定下只做 Material。苹果不做：规范没有开放许可，SF 字体和图标不能用在网站上，标志性的毛玻璃又是 `theme_lint` 报的 AI 味写法。Material 3 做成新建主题时可选的第二套设计系统：D7 写设计系统文件（颜色用 Apache-2.0 的 `@material/material-color-utilities` 在开发时生成，取大圆角、状态层、色阶卡片等特征，token 键不变）；D8 在新建主题对话框里选。问题 Q22–Q28 已按建议定下（2026-11-24），见开发方案 14 的"借鉴 Material 3"。
