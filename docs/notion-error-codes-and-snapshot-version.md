# Notion 报错错误码与快照版本校验：实施方案

> 日期：2026-11-14 · 状态：方案，Bukit 部分开工前要用户确认（见第 4 节） · 对应：[开发方案](development-plan.md) 5.4、5.5，[AGENTS.md](../AGENTS.md) 待开发任务第 5 项
>
> 源码按 Bukit main `e7651fb1`（v2.1.0 之后）和 BukitJalil `48b1e11` 核对。

## 1. 要解决的问题

### 1.1 Notion 报错没有机器可读的错误码

BukitJalil 现在靠 `packages/server/src/bukit/notion-errors.ts` 里的正则从 Bukit 输出的文字认出 Notion 报错（401、403、404、429、字段不存在、网络错误）。Bukit 一改措辞就认不出来。Notion 离线快照上线后（开发方案 5.5 第二步），还要分清"没有快照，请先正式构建"和"AI 换了 `databaseId`，应用后正式构建"，靠文字更难。

核对到的现状：

| 位置 | 现状 | 后果 |
|---|---|---|
| `Bukit.Notion/Transport/NotionApiException.cs` | 已有 `Kind`（HttpStatus / RateLimited / InvalidJson / Transport）和 `StatusCode` | 结构化信息是有的 |
| `Bukit.Content/Notion/NotionContentClient.cs:148`、`:174` | `throw new ContentException(exception.Message, exception)`，不带错误码 | 信息在这里丢掉 |
| `Bukit.Content/Notion/NotionContentClient.cs:219` | 离线重放快照里记下的 403/404，同样包成不带码的 `ContentException` | 同上 |
| `Bukit.Content/Notion/NotionDatabaseOptionReader.cs:32` | 读分类可选项失败，同样包成不带码的 `ContentException` | 同上 |
| `Bukit.Content/Notion/NotionDatabaseSchemaResolver.cs:89` | 字段不存在：`ContentException`，不带码 | 只能靠文字 `... not found (case-insensitive match)` |
| `Bukit.Cli/Program.cs:72-90` | 只读最外层异常的 `Code`；写进 JSON 时用 `Code.Value.ToString()`，是枚举名（如 `ConfigInvalidValue`） | Notion 报错的 `code` 都是 `cli-error`；和文档约定的 `BKT-xxxx` 不一致 |
| `Bukit.Cli.Shared/Cli/Rendering/CliErrorRenderer.cs:66-77` | `RenderJson(command, ex, …)` 用 `BKT-xxxx` | 有测试（`CliErrorRendererTests.cs:157` 断言 `BKT-0002`），但 `Program.cs` 不走这条路 |
| `Bukit.Content/Notion/Snapshot/NotionSnapshotException.cs` | 继承 `BukitException`，所有快照错误都用 `ConfigInvalidValue` | 和普通配置错误同一个码，分不出来 |
| `Program.cs` 的 catch 顺序 | 只接 `ConfigException`、`ContentException`、`RenderException`、`WorktreeBuildException`，`NotionSnapshotException` 落进通用分支 | `build` 的快照错误退出码是 1，`code` 是 `cli-error`，自带的码也丢了 |
| `ConfigCommand.cs:38`、`DoctorCommand.cs:34/348/425` | 接住快照错误后 `Console.WriteLine(ex.Message)` | 只有文字 |
| `DoctorNotionChecker.cs:29/56/155` | `✖ Notion database check failed: 401 Unauthorized` 等文字行 | doctor 没有 JSON 输出 |
| `WorktreeBuildCoordinator.cs:66/100/137` | 多语言子进程失败统一包成 `i18n-worktree-worker-failed`；父进程报的是 `Worker for language 'en' exited with code 1.` | 多语言网站（starter 就是）拿不到原来的码；`bukitErrorsIn` 取最后一份 cli-error，也看不到原因 |

可以借用的现有做法：`DiagnosticExceptionFormatter.Format(ex)` 输出 `[BKT-xxxx] 消息`，doctor 报配置错误时已经在用（`DoctorCommand.cs:68/94`），Bukit 的技能文档也按这个写法列错误（`bukit-troubleshooting`、`bukit-cli-reference`）。

### 1.2 快照的版本校验太严

`NotionSnapshotSession.cs:528-532` 要求快照里记的 Bukit 版本和当前版本完全一致。

- 版本取自 `AssemblyInformationalVersion`，从编译好的 dll 里读到的是 `2.1.0+960911a1f789…`，带着提交哈希。所以只换了提交、版本号不变，快照也会失效。
- Bukit 跟着 BukitJalil 发版。用户每次升级 BukitJalil，所有网站的快照都会失效，在下一次正式构建之前，所有 Notion 网站的 AI 预览都会失败。
- 正式构建写新快照时，`BeginWrite` 会把旧快照的正文复制过来复用（`SeedBodies`，`:108`、`:565`），前提是旧快照能通过 `ReadValidManifest` 的同一个校验。带 `--notion-snapshot` 时快照是唯一的正文缓存。所以升级后第一次正式构建要从 Notion 重新读取全部正文，而 Notion 限速大约每秒 3 次请求。

**已定**（2026-11-14，开发方案 5.5）：选 (a)，只校验 `FormatVersion`，再加一个固定快照的兼容测试。

## 2. 目标和不做的事

目标：

1. Bukit 对所有 Notion 失败和快照失败给出稳定的错误码，`build`（cli-error JSON）、`config check`、`doctor`（文字行）用同一套，多语言网站也能拿到原来的码。
2. 快照只按格式版本校验，升级 Bukit 后旧快照照样可用，旧正文照样复用。
3. 用测试守住第 2 点：快照数据的意思一变，测试就失败。
4. BukitJalil 改为按错误码认出 Notion 报错，删掉正则；为第二步预留快照相关的提示。

不做：

- 不给 doctor 加 JSON 输出（文字行带 `[BKT-xxxx]` 前缀就够用）。
- 不改 Notion 报错的英文措辞（BukitJalil 不再依赖它）。
- 不在这次接入离线快照（那是开发方案 5.5 第二步，单独做；这里只把它要用的错误码准备好）。
- 不给其他 `ContentException`（Markdown、数据文件等）补码。

## 3. 设计

### 3.1 错误码表

在 `DiagnosticCode` 里新开 `0x0Bxx` 段（Notion），格式化后是 `BKT-0Bxx`。

| 码 | 枚举名 | 什么时候 | BukitJalil 的 `NotionProblem` |
|---|---|---|---|
| BKT-0B01 | `NotionUnauthorized` | HTTP 401（token 无效或被撤销） | `unauthorized` |
| BKT-0B02 | `NotionForbidden` | HTTP 403 | `forbidden` |
| BKT-0B03 | `NotionNotFound` | HTTP 404（数据库没分享给集成，或不存在） | `not_shared` |
| BKT-0B04 | `NotionRateLimited` | 429，重试用完 | `rate_limited` |
| BKT-0B05 | `NotionPropertyMissing` | `propertyMap` 指向的字段在数据库里不存在 | `property_missing` |
| BKT-0B06 | `NotionRequestFailed` | 其他 HTTP 状态（400、5xx 等） | `request_failed`（新增） |
| BKT-0B07 | `NotionNetwork` | 网络错误或超时（`Kind = Transport`） | `network` |
| BKT-0B08 | `NotionInvalidResponse` | Notion 返回的不是合法 JSON（`Kind = InvalidJson`） | `request_failed` |
| BKT-0B10 | `NotionSnapshotUnavailable` | 快照不存在、不完整、manifest 读不了、格式版本不符 | `snapshot_unavailable`（新增） |
| BKT-0B11 | `NotionSnapshotDatabaseMissing` | 快照里没有这个数据库（AI 换了 `databaseId` 或新加了源） | `snapshot_database_missing`（新增） |
| BKT-0B12 | `NotionSnapshotEntryMissing` | 快照缺某条数据或读不了（正文、页面、关联目标、分类可选项、查询页），或有多份查询都对不上 | `snapshot_stale`（新增） |
| BKT-0B13 | `NotionSnapshotWriteFailed` | 写快照失败（建目录、写条目、替换） | `snapshot_write_failed`（新增） |
| BKT-0B14 | `NotionSnapshotOptionInvalid` | `--notion-snapshot` 的值不对（空、文件系统根目录） | 不翻译，按 Bukit 原文显示 |

离线重放快照里记下的 403/404（`NotionContentClient.cs:219`）用和联网时一样的 0B02/0B03。

快照错误发生的位置和对应的码：

| 位置（`NotionSnapshotSession.cs` 除非另注） | 码 |
|---|---|
| `:104` 建目录失败、`:237` 保存失败、`:452` 写条目失败、`NotionCacheManager.cs:45/173` | 0B13 |
| `:123` 没有快照或不完整、`:519` manifest 读不了、`:524` 格式不符 | 0B10 |
| `:152` `EnsureDatabase`、`:277` 没有这个数据库的查询结果 | 0B11 |
| `:287` 多份查询都对不上、`:308` 查询页读不了、`:364/383` 条目读不了、`:374` `Missing(...)`、`NotionCacheManager.cs:130` 缺正文、`NotionContentClient.cs:108/129/226` 离线时遇到快照不支持的请求 | 0B12 |
| `:667/673` 参数不对 | 0B14 |
| `:530` Bukit 版本不符 | 删除（见 3.4） |

### 3.2 怎么带出错误码

**错误码的写法统一为 `BKT-xxxx`**（待确认 D1）：

- `Program.cs` 的 `ConfigException`、`ContentException`、`RenderException` 分支，把 `ex.Code.Value.ToString()` 换成 `DiagnosticCodeFormatter.Format(ex.Code.Value)`，和 `CliErrorRenderer.RenderJson(command, ex, …)`、契约矩阵、技能文档一致。
- 这会把现有配置、内容、渲染错误的 `code` 从枚举名改成 `BKT-xxxx`，是对外可见的变化，要写进 CHANGELOG。BukitJalil 现在不读 `code`，不受影响。

**Notion 失败带码**：

- 在 `Bukit.Content/Notion` 加一个内部 helper，比如 `NotionErrors.ToContentException(NotionApiException)`，按 `Kind` 和 `StatusCode` 选码，返回 `new ContentException(exception.Message, exception, code)`。消息不变。
- `NotionContentClient.cs:148`、`:174`、`:219` 三处，以及 `NotionDatabaseOptionReader.cs:32`（读分类可选项，同样包成不带码的 `ContentException`）都改用它。
- 检查所有按 `ContentException { InnerException: NotionApiException { StatusCode: … } }` 判断的地方（如 `NotionContentSource.cs:512-513` 判断关联页面没权限），确认包装方式不变。只加码，不换异常类型。
- `NotionDatabaseSchemaResolver.ResolveRequired` 抛的 `ContentException` 带上 0B05。同一个文件里另外两处（数据库结构缺 `properties`、字段名只差大小写）不属于 Notion 接口失败，这次不加码。

**快照失败带码**：

- `NotionSnapshotException` 的构造函数加 `DiagnosticCode` 参数（不再固定用 `ConfigInvalidValue`），按 3.1 的表给每个 `throw` 指定码。`Missing(what)` 用 0B12。可以加几个静态工厂（`Unavailable(...)`、`WriteFailed(...)`），避免到处写码。
- `Program.cs` 在通用 `catch (Exception)` 前加一个 `catch (BukitException ex)` 分支：退出码 2（和内容错误一致，待确认 D3），`code` 用 `BKT-xxxx`，没有码时用 `cli-error`。这个分支也接住以后其他直接继承 `BukitException` 的异常。

**`config check` 和 `doctor` 的文字行**：

- 接住快照错误的地方（`ConfigCommand.cs:38/85`、`DoctorCommand.cs:34/348/425`）从 `Console.WriteLine(ex.Message)` 改成 `DiagnosticExceptionFormatter.Format(...)`，输出 `[BKT-0B11] Notion offline snapshot has no data for database …`。
  - `NotionSnapshot.IsSnapshotError` 拿到的是 `Exception`，在 `Bukit.Engine/NotionSnapshot.cs` 加一个 `Format(Exception)`，CLI 不需要引用 `Bukit.Content`。
- 接住 `ContentException` 的地方（`DoctorCommand.cs:425`）同样换成带码的格式。
- `DoctorNotionChecker` 的 HTTP 失败行（`:29/56/155`）加前缀，比如 `✖ [BKT-0B01] Notion database check failed: 401 Unauthorized`。码用和 3.1 同一个映射函数算（`NotionHealthResult` 里有 `ErrorKind` 和 `StatusCode`）。
  - 这个 helper 要放在 `Bukit.Notion`，CLI 和 `Bukit.Content` 才都能用。所以只把"`NotionApiException` → `DiagnosticCode`"这一步放进 `Bukit.Notion`，包成 `ContentException` 的那一步留在 `Bukit.Content`。
- `:155` 的连通性检查是警告（`⚠`），doctor 会继续跑，也加码，但 BukitJalil 不把它当失败原因（保留现有的 `NOT_FATAL` 规则）。

**多语言子进程**：

- 子进程（`RunWorkerAsync`，`:62-68`）：接住的异常是带码的 `BukitException` 时，`WorktreeBuildException` 的 code 用它的 `BKT-xxxx`，不用 `i18n-worktree-worker-failed`。消息照旧。
- 父进程（`RunWorkerProcessAsync`，`:133-138`）：子进程退出码不是 0 时，从已经收集到的 `result.StandardError` 里找最后一份 cli-error JSON，取第一条 error 的 `code` 和 `message`，抛 `WorktreeBuildException(code ?? "i18n-worktree-worker-failed", $"Worker for language '{lang}' failed: {message}")`。找不到时保持原来的文字。
  - 这样最后一份 cli-error 文档（BukitJalil 读的就是它）里既有原来的码，也有原来的原因。
  - cli-error 的类型 `CliErrorPayload` 和 JSON 上下文 `CliErrorJsonContext` 在 `Bukit.Cli.Shared` 里是 `internal`，没有 `InternalsVisibleTo`。在 `CliErrorRenderer` 旁边加一个解析方法（比如 `TryReadLast(string stderr, out CliErrorDiagnostic first)`），复用这两个类型，不在 `Bukit.Cli` 里另写一套。它是新的公开方法，要过 public-api-drift。

### 3.3 BukitJalil 怎么读

- `report-errors.ts`：`bukitErrorsIn` 改成同时返回每条 error 的 `code`（比如 `{ code, message }[]`，或另加一个 `bukitErrorCodesIn`），不改现在按消息显示的界面。
- `notion-errors.ts`：
  - 删掉现有的正则表。`MIN_BUKIT_VERSION` 会跟着升到新版本，低于它的 Bukit 不用，不需要兼容旧文字。
  - 改成按错误码判断：
    - `build`：读 cli-error 文档里的 `code`；
    - `config check`、`doctor`：认行首的 `[BKT-0Bxx]` 或 `✖ [BKT-0Bxx]`。
  - 不在任意位置搜 `BKT-0B..`：构建日志里可能出现页面内容，AI 能控制。
  - 保留 `NOT_FATAL`：连通性检查的警告和 `event=notion.relation.resolve_failed` 不算失败原因。
  - 码到 `NotionProblem` 的映射是一张表（3.1 最后一列），放在 `notion-errors.ts`。
- `packages/shared/src/data-sources.ts`：`NotionProblem` 加 `request_failed`、`snapshot_unavailable`、`snapshot_database_missing`、`snapshot_stale`、`snapshot_write_failed`。更新注释（不再说"texts come from Bukit 2.0.15"）。
- 界面文字（`packages/web/src/i18n/en.ts`、`zh-CN.ts`）：
  - `request_failed`："Notion 返回错误，稍后再试；一直失败就看 Bukit 的原始报错"；
  - `snapshot_unavailable`："还没有可用的 Notion 数据，先正式构建一次"；
  - `snapshot_database_missing`："这次改动换了 Notion 数据库或新加了数据源，应用改动后正式构建才有数据"；
  - `snapshot_stale`："Notion 内容在上次正式构建后有变化，正式构建后再预览"；
  - `snapshot_write_failed`："保存 Notion 数据失败，检查磁盘空间和权限"。
  - 快照相关的四项在第二步接入离线构建前不会出现，但这次一起加上，第二步只管接线。
- 升级内置 Bukit：`BUKIT_VERSION`、三个安装包的 SHA-256、`MIN_BUKIT_VERSION` 都改成新版本（开发方案 8.1 的规则）。

### 3.4 快照版本校验

Bukit：

- 删除 `NotionSnapshotSession.cs:528-532` 的 Bukit 版本比较，以及 `NotionSnapshotException` 注释里"或 Bukit 版本"的说法。
- `bukitVersion` 照样写进 manifest。`NotionSnapshot.DescribeFields()` 和 `Describe()` 加上这个字段，方便排查；只是日志字段，不当作校验依据。
- `BukitVersionOverride` 留着给测试用。
- `FormatVersion` 加一段注释，写明什么时候必须升：已有数据项的意思变了；换了 Notion API 版本（`NotionApiUrls.NotionVersion`）；快照目录结构变了。只是新增数据项、旧快照里没有时会明确报 0B12 的，不用升。
- 更新 CHANGELOG 和 Notion 指南里"carries its format and Bukit version"的说法。

BukitJalil：只在第二步用到，见开发方案 5.5。离线构建输出里有 `event=notion.cache.renderer_mismatch` 时，预览提示"部分正文是旧版渲染，正式构建后会更新"；0B10 和没有快照一样处理。

### 3.5 兼容测试

固定快照放在 Bukit 的 `tests/fixtures/notion-snapshot-format-1/`：

- `snapshot/`：一份完整的 `format=1` 快照。manifest 里的 `bukitVersion` 写一个固定的旧值（如 `2.1.0`），保证它和当前版本不同。内容覆盖：
  - 两个数据库：一个文章库、一个被关联的库，用于跨源关联；
  - 每种用到的字段类型；
  - 一条草稿（验证草稿过滤在查询之后）；
  - 一个关联目标、一条记下的 404 关联；
  - 分类可选项、`pages_index` 数据；
  - 每页的正文（`renderer: 1`）；
  - 一张已缓存的图片。
- `api/`：生成这份快照时假 Notion 接口用的原始数据，包括正文的 block。快照里只有渲染后的正文，没有 block 原始数据，联网对照时要用。
- `site/`：一个最小网站（`site.yaml` 加一个自带的小主题），只依赖 fixture 自己的模板，不受内置主题改动影响。
- `README.md`：写明这份 fixture 是怎么生成的、什么时候允许换。

生成方式：一个默认跳过的测试（设了环境变量 `BUKIT_GENERATE_SNAPSHOT_FIXTURE=1` 才跑），用 `NotionSnapshotTests` 里现成的 `FakeNotionApi` 录一次，提交进仓库。之后不再原地重新生成。

测试（`tests/Bukit.Content.Notion.Tests/NotionSnapshotCompatibilityTests.cs`）：

1. **能读**：`NotionSnapshotSession.OpenOffline(fixture)` 成功，manifest 的 `bukitVersion` 和当前版本不同。
2. **离线等于联网**：
   - 离线：从 fixture 快照加载，生成内容描述（沿用 `NotionSnapshotTests.LoadAsync` 的写法：每个文档的 ID、字段、正文）。
   - 联网：让 `FakeNotionApi` 用 `api/` 的原始数据，不带快照、`cacheMode` 关掉，加载出同样的描述。
   - 两者逐项相同。正文只在 `NotionBlocksRenderer.ContractVersion` 等于 fixture 里记的渲染器版本时比较；不等时只比较其他字段，并断言输出了一次 `event=notion.cache.renderer_mismatch`。
3. **命令行冒烟**（放在 `tests/Bukit.Cli.Tests/NotionOfflineSnapshotCommandTests.cs`）：`build --notion-snapshot <fixture 的临时副本> --notion-offline` 用 fixture 的网站构建，退出码 0，没有任何网络请求，不需要 token。
4. **跨版本复用正文**：用 `BukitVersionOverride = "0.0.0-other"` 录一份快照，再用当前版本带 token 重录：
   - 没改过的页面不再请求 `/blocks/<id>/children`（正文从旧快照复用）；
   - 把其中一条正文的 `renderer` 改成别的值后再录，这一页会重新请求（渲染器不同不复用）。

规则写在 fixture 的 README 和 `FormatVersion` 的注释里：

- 第 2 项失败时，先判断原因：
  - 如果是快照存的数据不够或意思变了，就升 `FormatVersion`，新建 `notion-snapshot-format-2/`，删掉 format-1，并加一个测试证明 format-1 被拒绝、报 0B10；
  - 如果只是 Bukit 对同一份原始数据的解析变了，联网和离线会一起变，第 2 项本来就不会失败。所以这个测试没有"改预期结果"这条路。
- 不允许为了让测试通过而重新生成 format-1 的 fixture。

现有测试要改：

- `NotionSnapshotTests.OtherBukitVersionOrFormat_IsAnError` 改名为 `OtherFormat_IsAnError`：Bukit 版本不同时能读；格式不同或没有快照时报错，并断言码是 0B10。
- `NotionOfflineSnapshotCommandTests` 里所有快照错误的断言加上码（`[BKT-0B10]`、`[BKT-0B11]`），`build` 的快照错误断言 cli-error JSON 里的 `code` 和退出码 2。

## 4. 开工前要定的问题

| | 问题 | 建议 | 理由 |
|---|---|---|---|
| D1 | `Program.cs` 输出的错误码从枚举名改成 `BKT-xxxx` | 改 | 契约矩阵、`CliErrorRenderer` 的测试、技能文档都用 `BKT-xxxx`，只有 `Program.cs` 不一样；BukitJalil 不读旧写法 |
| D2 | Bukit 发什么版本 | 2.2.0 | D1 改了对外可见的输出，新增一段错误码；按 semver 算新功能，不是补丁 |
| D3 | `build` 的快照错误退出码 | 2 | 和内容错误一致；现在是落进通用分支的 1 |
| D4 | Notion 码段 | `0x0Bxx`，0B01–0B08 是接口错误，0B10–0B14 是快照错误 | `0x0A` 已给 I18n；留出空位以后加 |

Bukit 的仓库规则（Bukit 的 `AGENTS.md`）要求：改 `src/Bukit-Core/` 和对外契约必须是用户确认过的单独 Core 任务，同一时间只有一个改代码的 agent，只跑本任务指定的专项测试，不跑全量。所以这四项定下来、用户确认开工后才动 Bukit 的代码。

## 5. 实施步骤

### 第 1 层：Bukit 快照版本校验和兼容测试（约 0.5 天）

1. 删除 Bukit 版本比较；改 `FormatVersion`、`NotionSnapshotException` 的注释；`Describe` 加 `bukitVersion`。
2. 生成并提交 `tests/fixtures/notion-snapshot-format-1/`，包括生成用的测试。
3. 写 3.5 的第 1、2、4 项测试；改 `OtherBukitVersionOrFormat_IsAnError`。第 3 项放到第 2 层，和错误码一起改命令行测试。
4. CHANGELOG（en、ms、zh-CN 三份）和 `guide/user/06-notion-content.md:205` 改掉"Bukit 版本对不上就报错"。

专项测试：`dotnet test tests/Bukit.Content.Notion.Tests`。

### 第 2 层：Bukit 错误码（约 1–1.5 天）

1. `DiagnosticCode` 加 0B01–0B08、0B10–0B14；`DiagnosticCodeFormatter.Describe` 补上说明；契约矩阵 `docs/bukit-1.0-contract-matrix.zh-CN.md` 的"诊断码范围"加 `BKT-0Bxx | Notion`。
2. `Bukit.Notion` 加"`NotionApiException` → `DiagnosticCode`"的映射；`Bukit.Content` 的三处包装和字段不存在改用带码的 `ContentException`。
3. `NotionSnapshotException` 按 3.1 的表带码。
4. `Program.cs`：三个分支改用 `BKT-xxxx`（D1），加 `catch (BukitException)`（D3）。
5. `config check`、`doctor` 的文字行带 `[BKT-xxxx]`；`DoctorNotionChecker` 的 HTTP 失败行加码。
6. 多语言子进程和父进程透传错误码（3.2 最后一段）。
7. 测试：
   - `Bukit.Notion.Tests`：映射函数覆盖 401、403、404、429、500、Transport、InvalidJson；
   - `Bukit.Content.Notion.Tests`：联网 401/404、离线重放 404、字段不存在各自的码；每类快照错误各一个；
   - `Bukit.Shared.Tests`：新码唯一，`Describe` 都有说明（`BuildDiagnosticCodeTests` 已有唯一性检查，补 `Describe` 覆盖）；
   - `Bukit.Cli.Tests`：
     - `ProgramEntryPointTests` 断言 `ContentException` 带码、快照错误的 JSON `code` 和退出码；
     - `NotionOfflineSnapshotCommandTests` 加码的断言和 3.5 第 3 项；
     - `NotionOfflineSnapshotMultilingualTests` 断言多语言网站离线构建换了 `databaseId` 时，最后一份 cli-error 的 `code` 是 `BKT-0B11`。
   - `Bukit.Engine.Tests`：`I18nWorktreeNotionSnapshotTests` 里相应断言。
8. 文档：
   - CHANGELOG 三份：新错误码；`code` 改成 `BKT-xxxx`；快照错误退出码；多语言网站的报错带上原因；
   - `guide/user/06-notion-content.md`、`14-troubleshooting.md` 列出 Notion 错误码；
   - 技能 `bukit-troubleshooting`、`bukit-cli-reference` 补上 Notion 错误码。

专项测试：`dotnet test` 分别跑 `tests/Bukit.Notion.Tests`、`tests/Bukit.Content.Notion.Tests`、`tests/Bukit.Shared.Tests`、`tests/Bukit.Cli.Tests`（`--filter` 选 `ProgramEntryPoint|CliErrorRenderer|NotionOffline|Doctor`）、`tests/Bukit.Engine.Tests`（`--filter NotionSnapshot`）；外加 `dotnet format --verify-no-changes`、analyzer ratchet、public-api-drift。

### 第 3 层：审计、修复、复查，Bukit 发版（约 0.5 天，发版要用户确认）

- 按 Bukit 的流程做一次专项审查，有 Critical、Important 问题就修复后复查。
- 用户确认后发 2.2.0（D2），拿到三个平台安装包的 SHA-256。

### 第 4 层：BukitJalil 升级 Bukit，按错误码认 Notion 报错（约 0.5–1 天）

1. `packages/server/src/bukit/install.ts`：`BUKIT_VERSION`、`MIN_BUKIT_VERSION` 改成 2.2.0，换三个 SHA-256。
2. `report-errors.ts` 返回 `code`；`notion-errors.ts` 改按码判断，删正则（3.3）。
3. `NotionProblem` 加新值，补中英文界面文字。
4. 测试：
   - `packages/server/test/notion.test.ts`：每个码映射到对应的 `NotionProblem`；`config check`、`doctor` 的行首格式能认出；警告行和页面内容里出现的 `BKT-0B01` 不算失败原因；多语言网站最后一份 cli-error 的码能认出；
   - `packages/server/test/builds.test.ts`、`deploys.test.ts`：构建、发布失败时报告带 `notionProblem`；
   - `e2e/fake-bukit.ts`：假 Bukit 改为输出带 `code` 的 cli-error 和 `[BKT-0Bxx]` 行，`e2e/sites.spec.ts` 里相应的用例跟着改；
   - `packages/server/test/bukit-behavior.test.ts`（用真实 Bukit）：
     - `build --notion-snapshot <空目录> --notion-offline` 的 cli-error `code` 是 `BKT-0B10`，退出码 2；
     - 一份换了 `databaseId` 的 `config check --notion-offline` 输出 `[BKT-0B11]` 行。
     - 这两项都不联网。需要真实 token 的 401、404 不放进 CI。
5. 开发方案：
   - 5.4 改成"按 Bukit 的错误码认出 Notion 报错"，删掉"升级 Bukit 时要核对 `notion-errors.ts`"的说法；
   - 8.1 记下 Bukit 2.2.0；
   - 5.5 第二步的"BukitJalil 要做的"里写明用哪些码。
6. `pnpm -s check`、全部测试和构建通过后提交推送。

### 合计

Bukit 约 2–2.5 天（含审计和发版），BukitJalil 约 0.5–1 天，合计约 2.5–3.5 天。比原来分开估的"0.5–1 天 + 改动很小"多，因为加上了多语言透传、doctor 和 `config check` 的格式、错误码写法统一、兼容测试的 fixture，以及 BukitJalil 的升级。

## 6. 风险和对策

| 风险 | 对策 |
|---|---|
| D1 改了现有错误的 `code`，有别的使用方按枚举名判断 | CHANGELOG 写明；BukitJalil 不受影响；Bukit 仓库里搜一遍按 `code` 判断的地方（`ProgramEntryPointTests` 等）一起改 |
| 包装方式变了，按 `ContentException { InnerException: NotionApiException }` 判断的代码失效（如关联页面没权限 `notion.relation.permission_denied`） | 只加码、不换异常类型和包装层次；保留并运行 `NotionContentSourceTests`、`CrossSourceRelationProjectionTests` |
| 改了快照数据的意思却忘了升 `FormatVersion` | 3.5 第 2 项"离线等于联网"会失败；fixture 不允许原地重新生成 |
| 兼容测试太脆，和快照无关的改动也让它失败 | 只比较内容源加载出的结果，不比较 HTML；fixture 网站用自己的主题；正文只在渲染器版本相同时比较 |
| 旧版渲染的正文进了预览 | 离线时照样用，输出 `renderer_mismatch` 警告，BukitJalil 在预览上说明；正式构建会重新渲染 |
| 多语言父进程解析子进程 stderr 出错 | 解析失败就退回原来的 `i18n-worktree-worker-failed`，不影响构建结果本身；有测试覆盖 |
| BukitJalil 被构建日志里的假错误码误导 | 只认 cli-error 的 `code` 字段和行首格式，不全文搜索；有测试覆盖 |
