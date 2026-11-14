# Notion 报错错误码与快照版本校验：实施方案

> 日期：2026-11-14 · 状态：方案，第 4 节的 D1–D8 都已定（2026-11-14）。Bukit 部分动代码前要用户确认开工 · 对应：[开发方案](development-plan.md) 5.4、5.5，[AGENTS.md](../AGENTS.md) 待开发任务第 5 项
>
> 源码按 Bukit main `e7651fb1`（之后的 `7038ad32` 只多了文档提交）和 BukitJalil `93132cc` 核对。行号会随提交漂移，实施时以符号名为准，文中行号都是"约"。
>
> 修订：
> - v2（2026-11-14）按一次静态审阅修正 8 处会卡住或行为不对的地方：多语言子进程的错误码、测试放的位置、映射函数放在哪里、0B11/0B12、doctor 的失败行、新 catch 的范围、fixture 的生成方式、BukitJalil 的测试。另外改了若干措辞和精度问题。
> - v2 同日跟上 BukitJalil `93132cc`：第二步（AI 改动用离线快照构建）已经接入，快照报错按 `missing` / `stale` / `change` 分类，但仍靠正则认文字。快照错误码改成按这个分类拆分，BukitJalil 这边不再新增快照类的 `NotionProblem`。
> - v3（2026-11-14）按第二次静态审阅修正：
>   - public-api-drift 会因为 `DiagnosticCode` 新增枚举值失败，要审查后更新基线（不是"无变化"）；
>   - 兼容测试只比较发布文件，排除带时间的 `.bukit/` 报告和 `.bukit-build-state.json`；
>   - `NotionSnapshot.Format` 对所有 `BukitException` 都带码，`config check` 的配置错误不再丢码；
>   - `change` 的提示补"改了过滤、排序"，`stale` 的提示去掉"Bukit 升级了"；
>   - 假接口对未知路径直接失败、正文用 HTML 注释标记、fixture 数据笔误和快照语义变化分开处理，以及几处措辞。
>   - 审阅提的"开发方案 5.5 还写着 fixture 含媒体缓存"在 v2.48 已经改掉，不用再改。
>   - 同日补：风险表和 3.5 对 fixture 重新生成的规则统一；`stale` 提示的 zh-CN 文案和两处注释也要改；`stale` 定义和工期说明的措辞。

## 1. 要解决的问题

### 1.1 Notion 报错没有机器可读的错误码

BukitJalil 现在靠 `packages/server/src/bukit/notion-errors.ts` 里的正则从 Bukit 输出的文字认出两类问题，Bukit 一改措辞就认不出来：

- `notionProblemIn`：Notion 接口报错（401、403、404、429、字段不存在、网络错误），用于正式构建和发布。
- `notionSnapshotProblemIn`（`93132cc` 新增）：离线快照不能用的原因，用于 AI 检查、AI 构建、改动预览和应用前的检查（`agent/ai-bukit.ts`、`builds/service.ts`）。分两类：
  - `change`：改动需要正式构建没读过的 Notion 数据，再正式构建一次也没用，要先应用改动。包括"没有这个数据库"、"没有这一页渲染好的正文"（改动打开了某个源的正文渲染）、"多份查询都对不上"（改了过滤或排序）。
  - `stale`：快照要重新录（不存在、格式不对、读不了、缺数据；2.1.0 下 Bukit 版本不对也算，2.2.0 以后不再有这一条）。
  - 第三类 `missing` 是 BukitJalil 自己判断的（没有快照记录），不来自 Bukit 的输出。
  - 它的 `SNAPSHOT_ERROR` 正则还包含 `was written by`（Bukit 版本不符），3.4 删掉版本比较后这条文字就不会再出现。

核对到的现状：

| 位置 | 现状 | 后果 |
|---|---|---|
| `NotionApiException`（`Bukit.Notion/Transport`） | 已有 `Kind`（HttpStatus / RateLimited / InvalidJson / Transport）和 `StatusCode` | 结构化信息是有的 |
| `NotionContentClient`：`SendWithServerTimeAsync` 的 catch（约 `:148`）、`GetAsync` 的 catch（约 `:174`） | `throw new ContentException(exception.Message, exception)`，不带错误码 | 信息在这里丢掉 |
| `NotionContentClient.ReadOffline`（约 `:219`） | 离线重放快照里记下的 403/404，同样包成不带码的 `ContentException` | 同上 |
| `NotionDatabaseOptionReader`（约 `:32`） | 读分类可选项失败，同样包成不带码的 `ContentException` | 同上 |
| `NotionDatabaseSchemaResolver.ResolveRequired`（约 `:89`） | 字段不存在：`ContentException`，不带码 | 只能靠文字 `... not found (case-insensitive match)` |
| `Program.cs` 顶层 catch（约 `:67-95`） | 只读最外层异常的 `Code`；写进 JSON 时用 `Code.Value.ToString()`，是枚举名（如 `ConfigInvalidValue`） | Notion 报错的 `code` 都是 `cli-error`；和契约矩阵约定的 `BKT-xxxx` 不一致 |
| `CliErrorRenderer.RenderJson(command, ex, …)`（约 `:67-79`） | 用 `BKT-xxxx` | 有测试（`CliErrorRendererTests` 断言 `BKT-0002`），但 `Program.cs` 不走这条路 |
| `NotionSnapshotException` | 继承 `BukitException`，所有快照错误都用 `ConfigInvalidValue` | 和普通配置错误同一个码，分不出来 |
| `Program.cs` 的 catch 顺序 | 只接 `ConfigException`、`ContentException`、`RenderException`、`WorktreeBuildException`，`NotionSnapshotException` 落进通用分支 | `build` 的快照错误退出码是 1，`code` 是 `cli-error`，自带的码也丢了 |
| `ConfigCommand.Check`（约 `:38/85`）、`DoctorCommand`（约 `:34/348/425`） | 接住快照错误后 `Console.WriteLine(ex.Message)`，退出码 1 | 只有文字 |
| `DoctorNotionChecker`（约 `:29/33/56/60/155/159`） | `✖ Notion database check failed: 401 Unauthorized`、`✖ Notion request failed: …`、`✖ Schema check failed: …`、`⚠ Notion API unreachable: HTTP 401`、`⚠ Notion API connectivity check failed: …` | doctor 没有 JSON 输出 |
| `WorktreeBuildCoordinator`：`RunWorkerAsync`（约 `:64-70`）、`RunAsync`（约 `:100`）、`RunWorkerProcessAsync`（约 `:135-140`） | 多语言子进程失败统一包成 `i18n-worktree-worker-failed`；父进程报 `Worker for language 'en' exited with code 1.`，`Program.cs` 对 `WorktreeBuildException` 固定返回 1 | 多语言网站（starter 就是）拿不到原来的码；`bukitErrorsIn` 取最后一份 cli-error，也看不到原因 |
| 子进程的启动参数 | 只有 `build` 和可选的 `--secrets-stdin`，没有 `--log-format`；`Program.cs` 只从 argv 判断是否输出 JSON | 子进程的报错永远是文字行 `Error: [<code>] <消息>`，不是 cli-error JSON |

可以借用的现有做法：`DiagnosticExceptionFormatter.Format(ex)` 输出 `[BKT-xxxx] 消息`，doctor 报配置错误时已经在用（`DoctorCommand` 约 `:68/94`），技能 `bukit-troubleshooting` 和 `bukit-cli-reference` 约 `:237` 也按这个写法列错误。

**注意**：`bukit-cli-reference` 约 `:179` 的 cli-error 示例写的是 `"code": "ContentCollectionMissing"`（枚举名），和 `:237` 的 `[BKT-0001]` 自相矛盾。D1 之后两处要统一。

### 1.2 快照的版本校验太严

`NotionSnapshotSession.ReadValidManifest`（约 `:528-532`）要求快照里记的 Bukit 版本和当前版本完全一致。

- 版本取自 `AssemblyInformationalVersion`，从编译好的 dll 里读到的是 `2.1.0+960911a1f789…`，带着提交哈希。所以只换了提交、版本号不变，快照也会失效。
- Bukit 跟着 BukitJalil 发版。用户每次升级 BukitJalil，所有网站的快照都会失效，在下一次正式构建之前，所有 Notion 网站的 AI 预览都会失败。
- 正式构建写新快照时，`BeginWrite` 会把旧快照的正文复制过来复用（`SeedBodies`），前提是旧快照能通过 `ReadValidManifest` 的同一个校验。带 `--notion-snapshot` 时快照是唯一的正文缓存。所以升级后第一次正式构建要从 Notion 重新读取全部正文，而 Notion 限速大约每秒 3 次请求。

**已定**（2026-11-14，开发方案 5.5）：选 (a)，只校验 `FormatVersion`，再加一个固定快照的兼容测试。

## 2. 目标和不做的事

目标：

1. Bukit 对所有 Notion 失败和快照失败给出稳定的错误码：
   - `build` 放进 cli-error JSON；
   - `config check`、`doctor` 放进文字行；
   - 多语言网站也能拿到原来的码。
2. 快照只按格式版本校验，升级 Bukit 后旧快照照样可用。旧正文能否复用另有条件：正文缓存格式（`NotionCacheManager.CacheFormat`）和渲染器版本（`NotionBlocksRenderer.ContractVersion`）都没变时才复用。2.1.0 → 2.2.0 两者都不变。
3. 用测试守住第 2 点：快照数据的意思一变，测试就失败。
4. BukitJalil 改为按错误码认出 Notion 接口报错和快照报错，删掉两组正则。

不做：

- 不给 doctor 加 JSON 输出（文字行带 `[BKT-xxxx]` 前缀就够用）。
- 不改 Notion 报错的英文措辞（BukitJalil 不再依赖它）。
- 不改离线快照的接入方式（开发方案 5.5 第二步，`93132cc` 已完成），只把它认快照报错的方式从文字换成错误码，分类（`missing` / `stale` / `change`）和界面不变。
- 不给其他 `ContentException`（Markdown、数据文件等）补码。
- 不改直接抛 `BukitException` 的 I18n 和资源错误（`I18nReservedPrefixGuard`、`I18nRootOutputConflictGuard`、`AssetOutputPlan`）的输出：它们现在退出码 1、`code` 是 `cli-error`，而 Bukit 的退出码表就是这么写的（`bukit-cli-reference` 约 `:152`："asset output collision, JSON code `cli-error`"）。这是另一个问题，记下来，不在这次做（见 D6）。
- 不改 `--notion-snapshot` / `--notion-offline` 的用法错误（缺目录、目录在网站里）：它们仍是 `CommandArgumentException`，没有 Notion 码。0B14 只覆盖 `NormalizeTarget` 里的空值和文件系统根目录。

## 3. 设计

### 3.1 错误码表

在 `DiagnosticCode` 里新开 `0x0Bxx` 段（Notion），枚举名都以 `Notion` 开头，格式化后是 `BKT-0Bxx`。

Notion 接口错误：

| 码 | 枚举名 | 什么时候 | BukitJalil 的 `NotionProblem` |
|---|---|---|---|
| BKT-0B01 | `NotionUnauthorized` | HTTP 401（token 无效或被撤销） | `unauthorized` |
| BKT-0B02 | `NotionForbidden` | HTTP 403 | `forbidden` |
| BKT-0B03 | `NotionNotFound` | HTTP 404（数据库没分享给集成，或不存在） | `not_shared` |
| BKT-0B04 | `NotionRateLimited` | 429，重试用完 | `rate_limited` |
| BKT-0B05 | `NotionPropertyMissing` | `propertyMap` 指向的字段在数据库里不存在 | `property_missing` |
| BKT-0B06 | `NotionRequestFailed` | 其他 HTTP 状态（400、5xx 等） | `request_failed`（新增） |
| BKT-0B07 | `NotionNetwork` | 网络错误或超时（`Kind = Transport`） | `network` |
| BKT-0B08 | `NotionInvalidResponse` | Notion 返回的不是合法 JSON（`Kind = InvalidJson`，状态码可能是 2xx） | `request_failed` |

快照错误，按 BukitJalil 现有的分类拆分。离线时查询结果来自快照，正常录下的快照里缺正文、查询对不上，基本都是改动造成的。两个边角情况：
- 0B12 的原文同时写了"正式构建之后改过"和"正式构建没渲染过"两种可能。前者在正常录制下不会出现（录制构建会重新渲染），所以归 `change`。
- 0B13 的 `recorded.Length != 1` 也包括查询目录存在但为空（0 份），那其实是快照不完整，重新录更合适；正常录制不会产生，按 0B13 处理，知道即可。

| 码 | 枚举名 | 什么时候 | BukitJalil 的 `NotionSnapshotProblem` |
|---|---|---|---|
| BKT-0B10 | `NotionSnapshotUnavailable` | 快照不存在、不完整、manifest 读不了、格式版本不符 | `stale` |
| BKT-0B11 | `NotionSnapshotDatabaseMissing` | manifest 里没有这个数据库（改动换了 `databaseId` 或新加了源） | `change` |
| BKT-0B12 | `NotionSnapshotBodyMissing` | 快照里没有这一页渲染好的正文（改动打开了某个源的正文渲染） | `change` |
| BKT-0B13 | `NotionSnapshotQueryMismatch` | 一个数据库录了多份查询，都对不上现在的过滤和排序 | `change` |
| BKT-0B14 | `NotionSnapshotEntryMissing` | 数据库在快照里，但缺其他数据或读不了（查询结果、查询页、页面、关联目标、分类可选项、条目） | `stale` |
| BKT-0B15 | `NotionSnapshotWriteFailed` | 带 token 正式构建时写快照失败（建目录、写条目、替换） | 不归类；正式构建失败，按 Bukit 原文显示 |
| BKT-0B16 | `NotionSnapshotOptionInvalid` | `--notion-snapshot` 的值是空的或文件系统根目录（`NormalizeTarget`） | 不归类，按 Bukit 原文显示 |
| BKT-0B17 | `NotionSnapshotUnsupportedRequest` | 离线时出现快照不重放的请求类型（属于 Bukit 自身的缺陷，重新正式构建也没用） | 不归类，按 Bukit 原文显示 |

只有一个数据库录了一份查询、过滤或排序变了的情况，Bukit 照样用这份查询并输出 `event=notion.snapshot.query_changed` 警告，不报错，所以没有码。

`kind` 和状态码到错误码的映射，**先看 `Kind` 再看状态码**：

1. `Transport` → 0B07；
2. `InvalidJson` → 0B08（它可能带 2xx 状态，按状态判会误报成 0B06）；
3. `RateLimited` → 0B04；
4. 其余按状态码：401 → 0B01，403 → 0B02，404 → 0B03，429 → 0B04，其他 → 0B06。

离线重放快照里记下的 403/404（`ReadOffline`）用和联网时一样的 0B02/0B03。

快照错误发生的位置和对应的码：

| 位置（`NotionSnapshotSession` 除非另注） | 码 |
|---|---|
| `OpenOffline` 没有快照或不完整（约 `:123`）、`ReadValidManifest` manifest 读不了（约 `:519`）或格式不符（约 `:524`） | 0B10 |
| `EnsureDatabase`（约 `:152`） | 0B11 |
| `NotionCacheManager` 缺正文（约 `:130`） | 0B12 |
| `ReadQuery` 多份查询都对不上（约 `:287`） | 0B13 |
| `ReadQuery` 里数据库在 manifest 中但查询目录不存在（约 `:277`，先调用 `EnsureDatabase`，所以走到这里的都是"数据库在、数据缺"）、查询页读不了（约 `:308`）；条目读不了（约 `:364/383`）；`ReadJson` 的 `Missing(...)`（约 `:374`） | 0B14 |
| `BeginWrite` 建目录失败（约 `:104`）、`Commit` 保存失败（约 `:237`）、`WriteRaw` 写条目失败（约 `:452`）、`NotionCacheManager` 写正文失败（约 `:45/173`） | 0B15 |
| `NormalizeTarget`（约 `:667/673`） | 0B16 |
| `NotionContentClient`：`Transport` 属性（约 `:108`）、`SendWithServerTimeAsync` 离线分支（约 `:129`）、`ReadOffline` 末尾（约 `:226`） | 0B17 |
| `ReadValidManifest` 的 Bukit 版本比较（约 `:530`） | 删除（见 3.4） |

`Missing(what)` 默认用 0B14，`NotionCacheManager` 缺正文的那一处改为显式给 0B12（比如 `Missing(what, DiagnosticCode.NotionSnapshotBodyMissing)`，或单独的工厂方法 `BodyMissing(pageId)`）。`:277` 不需要另给码，因为它前面的 `EnsureDatabase` 已经接住"数据库不在 manifest 里"的情况。

### 3.2 怎么带出错误码

**错误码的写法统一为 `BKT-xxxx`**（D1）：

- `Program.cs` 的 `ConfigException`、`ContentException`、`RenderException` 分支，把 `ex.Code.Value.ToString()` 换成 `DiagnosticCodeFormatter.Format(ex.Code.Value)`，和 `CliErrorRenderer.RenderJson(command, ex, …)` 以及契约矩阵一致。
- 这会把现有配置、内容、渲染错误的 `code` 从枚举名改成 `BKT-xxxx`，是对外可见的变化，要写进 CHANGELOG，`bukit-cli-reference` 约 `:179` 的示例也要改。BukitJalil 现在不读 `code`，不受影响。

**映射函数放在哪里**（D7）：

- `Bukit.Notion` 是叶子项目，没有任何 ProjectReference，看不到 `DiagnosticCode`。CLI 按设计不直接依赖 `Bukit.Content`（见 `Bukit.Engine/NotionSnapshot.cs` 的注释）。
- 做法沿用 `NotionSnapshot` 的桥接：
  - 在 `Bukit.Content/Notion` 加 `internal static class NotionErrorCodes`，两个方法：
    - `DiagnosticCode For(NotionApiErrorKind? kind, HttpStatusCode? status)`：按上面的顺序映射；
    - `ContentException Wrap(NotionApiException exception)` → `new ContentException(exception.Message, exception, For(exception.Kind, exception.StatusCode))`，消息不变。
  - 在 `Bukit.Engine` 加一个 `internal` 的转发（比如放进 `NotionSnapshot` 旁边的 `NotionDiagnostics.CodeFor(kind, status)`）。`Bukit.Content` 已经对 `Bukit.Engine` 开放 internal，`Bukit.Engine` 已经对 CLI 程序集 `bukit` 开放 internal，所以 `DoctorNotionChecker` 能用。
- 好处：不新增项目引用，不改 Core 的依赖边界，映射函数和桥接都不是公开 API。
- 但 `DiagnosticCode` 本身是公开枚举，新增 0B01–0B08、0B10–0B17 共 16 个值，是公开成员的增加。public-api-drift 基线（Bukit 的 `docs/governance/bukit-core-public-api-baseline.v1.json`）逐个列了它的成员，新增成员会报 `review-required`，检查以退出码 1 失败。审查后更新基线，CHANGELOG 写一句"公开枚举 `DiagnosticCode` 新增 Notion 码"。
- doctor 手里是 `NotionHealthResult`（`:29/33/155/159`）和 `NotionDatabaseSchema`（`:56/60`），两者都有 `ErrorKind`、`StatusCode`，不是异常，所以共享函数的参数是 `(kind, status)`。两个都可能为空（比如不是 HTTP 失败），`For(null, null)` 返回 0B06，不抛异常。

**Notion 失败带码**：

- `NotionContentClient` 的三处包装（两个 catch 和 `ReadOffline`）、`NotionDatabaseOptionReader` 的包装都改用 `NotionErrorCodes.Wrap`。
- 只加码，不换异常类型和包装层次。按 `ContentException { InnerException: NotionApiException { StatusCode: … } }` 判断的地方（如 `NotionContentSource` 约 `:512-513` 判断关联页面没权限，得到 `notion.relation.permission_denied`）照样成立。
- `NotionDatabaseSchemaResolver.ResolveRequired` 抛的 `ContentException` 带上 0B05。同一个文件里另外两处（数据库结构缺 `properties`、字段名只差大小写）不属于 Notion 接口失败，这次不加码。

**快照失败带码**：

- `NotionSnapshotException` 的构造函数加 `DiagnosticCode` 参数（不再固定用 `ConfigInvalidValue`），按 3.1 的表给每个 `throw` 指定码。可以加几个静态工厂（`Unavailable(...)`、`WriteFailed(...)`、`Missing(...)`），避免到处写码。
- `Program.cs` 在通用 `catch (Exception)` 前加一个**只接快照错误**的分支：`catch (Exception ex) when (NotionSnapshot.IsSnapshotError(ex))`，退出码 2（D3），`code` 用 `BKT-xxxx`（D6）。
  - 不写成 `catch (BukitException)`：那样会把上面"不做"里列的 I18n、资源错误从退出码 1 / `cli-error` 一起改成 2 / `BKT-xxxx`，和现有退出码表不符。
  - `Bukit.Engine/NotionSnapshot.cs` 加 `internal static string Format(Exception)` 和 `internal static string? CodeOf(Exception)`，CLI 不需要引用 `Bukit.Content`。
- 退出码只在单语言 `build` 是 2：
  - `config check` 和 `doctor` 的快照错误仍然返回 1（它们所有检查失败都返回 1，这是有意的）；
  - 多语言 `build` 仍然返回 1（见下面多语言子进程一段，D5）。
  - BukitJalil 只看成功与否和错误码，不按退出码区分原因。

**`config check` 和 `doctor` 的文字行**：

- 接住快照错误的地方（`ConfigCommand.Check` 两处、`DoctorCommand` 三处）从 `Console.WriteLine(ex.Message)` 改成 `NotionSnapshot.Format(ex)`，输出 `[BKT-0B11] Notion offline snapshot has no data for database …`。
- `NotionSnapshot.Format(Exception)` 对任何 `BukitException` 都委托 `DiagnosticExceptionFormatter.Format`，不只处理快照异常。原因：`ConfigCommand` 约 `:85` 的 catch 同时接住 `ConfigException`，`DoctorCommand` 约 `:425` 的 catch 同时接住 `ConfigException` 和 `ContentException`，这些异常也可能带码（如 `BKT-0002`）；只处理快照异常的话，这些错误会退回没有前缀的 `ex.Message`。
- `DoctorNotionChecker` 的**所有 Notion 请求失败行和警告行**都加码，码用 `NotionDiagnostics.CodeFor(result.ErrorKind, result.StatusCode)` 算。`CheckNotionSchemaAsync` 的 `✖ Some mapped properties have issues…`（约 `:127`）是 `propertyMap` 对不上的汇总提示，不是请求失败，这次不加码。
  - 失败：`✖ [BKT-0B01] Notion database check failed: 401 Unauthorized`（约 `:29`）、`✖ [BKT-0B07] Notion request failed: …`（约 `:33`）、`✖ [BKT-0B01] Cannot fetch database: 401`（约 `:56`）、`✖ [BKT-0B08] Schema check failed: …`（约 `:60`）；
  - 警告：`⚠ [BKT-0B01] Notion API unreachable: HTTP 401`（约 `:155`）、`⚠ [BKT-0B07] Notion API connectivity check failed: …`（约 `:159`）。doctor 在警告后继续跑。
  - 这样 doctor 的网络错误和无效响应也有码，不只 build 才有 0B07/0B08。

**多语言子进程**（D5）：

- 子进程（`RunWorkerAsync` 的 catch）：接住的异常是带码的 `BukitException`（快照错误或带码的 `ContentException`）时，`WorktreeBuildException` 的 code 用它的 `BKT-xxxx`，不用 `i18n-worktree-worker-failed`。消息照旧。
- 子进程不带 `--log-format`，所以不管父进程是什么格式，它的报错都是文字行 `Error: [BKT-0B11] Internal multilingual build worker failed: …`（`WorktreeBuildException` 的消息本来就以 `[code]` 开头）。
- 父进程（`RunWorkerProcessAsync`）：子进程退出码不是 0 时，在已经收集的 `result.StandardError` 里找最后一行匹配 `^Error: \[(BKT-[0-9A-F]{4})\] (.*)$` 的文字，抛 `WorktreeBuildException(code, $"Worker for language '{lang}' failed: {message}")`；找不到时保持原来的 `i18n-worktree-worker-failed` 和原来的文字。
  - 不改子进程的启动参数（另一种做法是把 `--log-format` 传给子进程再解析 JSON，但 text 模式下仍然拿不到码，改动也更多）。
  - 父进程最后输出的 cli-error 文档（BukitJalil 读的就是它）里既有原来的码，也有原来的原因。
- 多语言 `build` 的退出码仍然是 `WorktreeBuildException` 的 1，不随子进程变成 2。要改得让 `WorktreeBuildException` 带退出码，会连带改变其他子进程失败的退出码，这次不做。

### 3.3 BukitJalil 怎么读

两个读输出的地方都不区分命令：

- `buildReport`（`builds/service.ts`，`deploys/service.ts` 也调用它）用 `notionProblemIn` 处理正式构建、config check、doctor、发布的输出；
- 离线运行（`agent/ai-bukit.ts` 和 `builds/service.ts` 里的改动预览、应用前检查）用 `notionSnapshotProblemIn`，传入的是 stderr 加 stdout。

两种来源的格式不会重叠，所以这两个函数都不需要"命令类型"参数（D8）。共同的规则：

- **cli-error 的 `code`**：
  - 新增 `bukitErrorCodesIn(stderr): string[]`（`report-errors.ts`），和 `bukitErrorsIn` 用同一个"找最后一份 cli-error 文档"的逻辑，只返回 `code`。
  - `bukitErrorsIn` 和 `BuildReport.bukitErrors: string[]` 都不改，`mediaProblemIn` 也不受影响。
  - 只有 `build`（和发布前的构建）会输出 cli-error。
- **行首的码**：
  - 只认 `✖ [BKT-0Bxx]` 和行首的 `[BKT-0Bxx]`（来自 `DiagnosticExceptionFormatter` 和 `NotionSnapshot.Format`），只在 `config check`、`doctor` 里出现。
  - `⚠ [BKT-…]` 是警告，不认。
  - 多语言构建转发的子进程文字行以 `Error: [` 开头，也不认，以最后那份 cli-error 的 `code` 为准。
- **规则**：
  - 先看 cli-error 的 `code`，是 `BKT-0B..` 就用它；
  - 没有时找最后一个行首的码；
  - 都没有就返回 null。
  - 不在任意位置搜 `BKT-0B..`：构建日志里可能出现页面内容，AI 能控制。
- 两个函数共用一个"取码"的 helper（返回最后一个 `BKT-0Bxx` 或 null），各自按 3.1 的表映射：
  - `notionProblemIn` 只认 0B01–0B08；
  - `notionSnapshotProblemIn` 只认 0B10–0B14，0B10、0B14 → `stale`，0B11、0B12、0B13 → `change`；
  - 0B15–0B17 两边都不认，按 Bukit 原文显示（已有的 `bukitErrors`）。
- `notion-errors.ts`：
  - 删掉现有的 `PATTERNS`、`NOT_FATAL`、`CHANGE_CAUSED`、`SNAPSHOT_ERROR` 四组正则。警告行带 `⚠`，按上面的规则本来就不认；关联页面失败的警告 `event=notion.relation.resolve_failed` 不带码；doctor 的成功行 `✔ Notion offline snapshot (…)` 没有码，不需要再特意过滤。
  - `MIN_BUKIT_VERSION` 跟着升，低于它的 Bukit 不用，不需要兼容旧文字。
  - 两个函数的签名从"一段文字"改成接收 stderr 和全部输出（或调用方先取好码再传进去），`builds/service.ts`、`deploys/service.ts`、`agent/ai-bukit.ts` 的调用跟着改。
- `packages/shared/src/data-sources.ts`：`NotionProblem` 只加 `request_failed`，更新注释（不再说"texts come from Bukit 2.0.15"）。`NotionSnapshotProblem`（`packages/shared/src/builds.ts`）的三个值不变，注释改成"按 Bukit 的错误码分类"。
- 界面文字（`packages/web/src/i18n/en.ts`、`zh-CN.ts`）：
  - 加 `request_failed`："Notion 返回错误，稍后再试；一直失败就看 Bukit 的原始报错"。
  - `notionSnapshot.problem.change`（en、zh-CN 两份）和给 AI 的 `NOTION_TEXT.change`（`agent/ai-bukit.ts`）现在只列"换了 `databaseId`、新加 Notion 源、打开正文渲染"，补上"或改了过滤、排序"（0B13）。这个缺口在 `93132cc` 的文字分类里就有，这次按码拆分时一起补。
  - `notionSnapshot.problem.stale` 两份都要改：en 现在写"Bukit was upgraded or the data is incomplete"，zh-CN 写"（Bukit 升级了或数据不完整）"。2.2.0 以后升级 Bukit 不会再让快照失效，只有格式版本变了才会，两份都改成"格式变了或数据不完整"。
  - 同样的说法还在两处注释里，一起改成"another format, unreadable or incomplete"这类不提 Bukit 版本的写法：`packages/shared/src/builds.ts` 里 `NotionSnapshotProblem` 的注释（"another format or Bukit version"），`packages/server/src/bukit/notion-errors.ts` 里 `notionSnapshotProblemIn` 的注释（同样的话）。
  - 这几个文件别的会话也在改，行号经常变，按键名和函数名找。
- 升级内置 Bukit：`BUKIT_VERSION`、三个安装包的 SHA-256、`MIN_BUKIT_VERSION` 都改成 2.2.0（开发方案 8.1 的规则）。

### 3.4 快照版本校验

Bukit：

- 删除 `ReadValidManifest` 的 Bukit 版本比较，以及 `NotionSnapshotException`、`NotionSnapshot.IsSnapshotError` 注释里"或 Bukit 版本"的说法。
- `bukitVersion` 照样写进 manifest。`NotionSnapshot.DescribeFields()` 和 `Describe()` 加上这个字段。注意 `Describe()` 会出现在 `config check`、`doctor` 给用户看的输出里（`notion: offline snapshot (format 1, …)`），只用于说明和排查，不当作校验依据。
- `BukitVersionOverride` 留着给测试用。
- `FormatVersion` 加一段注释，写明什么时候必须升：
  - 已有数据项的意思变了；
  - 换了 Notion API 版本（`NotionApiUrls.NotionVersion`）；
  - 快照目录结构变了。
  - 只是新增数据项、旧快照里没有时会明确报 0B14 的，不用升。
- 更新 CHANGELOG 和 `guide/user/06-notion-content.md` 约 `:205` 里"Bukit 版本对不上就报错"的说法。

BukitJalil：
- `93132cc` 已经在构建报告里记下 `event=notion.cache.renderer_mismatch`（`rendererMismatch`），这次不用改。
- 升级到 2.2.0 后，用 2.1.0 录的快照照样能用，不需要在升级时重新正式构建。
- `bukit-behavior.test.ts` 里"Bukit 2.1.0 also wants its full version"的那段（手写 manifest 时读 `bukit version` 填 `bukitVersion`）改成填任意值，并加一句断言：版本不同也能读。

### 3.5 兼容测试

快照只是 Notion 原始数据加渲染好的正文，**不包括媒体缓存**：图片来自网站自己的媒体缓存（`--notion-snapshot` 不管它，BukitJalil 另外保存，开发方案 5.5 第 4 条）。所以兼容测试只管快照本身，fixture 网站设 `media.downloadToLocal: false`，不放图片。

fixture 放在 Bukit 的 `tests/fixtures/notion-snapshot-format-1/`：

- `api/`：**手写的** Notion 接口原始数据，是 fixture 的源头。内容：
  - 两个数据库：一个文章库、一个被关联的库，用于跨源关联；
  - 每种用到的字段类型；
  - 一条草稿（验证草稿被查询里的 `Published` 过滤排除）；
  - 一个关联目标、一条 404 的关联；
  - 分类可选项；`pages_index` 用到的页面；
  - 每页正文的 block。
- `site/`：一个最小网站（`site.yaml` 加一个自带的小主题，开启分类和 `pages_index`），只依赖 fixture 自己的模板，不受内置主题改动影响。模板用两个 HTML 注释把正文包起来（`<!--notion-body-->…<!--/notion-body-->`），方便测试在渲染器版本不同时去掉正文再比较。不用 `<div data-notion-body>`：正文里通常有嵌套的 `<div>`，按标签截取会截错。
- `snapshot/`：用 `api/` 带 token 正式构建 `site/` 录下的 `format=1` 快照，提交进仓库。manifest 里的 `bukitVersion` 改写成一个固定的旧值（如 `2.0.0`，合成值，保证与任何当前构建都不同）。正文条目里的 `version` 是当时的 `NotionCacheManager.CacheFormat`（2），`renderer` 是当时的 `NotionBlocksRenderer.ContractVersion`（1）。
- `README.md`：写明这份 fixture 是怎么生成的、什么时候允许换。

生成方式：

- 测试放在 `tests/Bukit.Engine.Tests`：它能跑完整站点（主题、路由、分类、`pages_index`），对 `Bukit.Content` 开放 internal，可以用 `NotionContentClient.TransportOverride`；`SiteEngineNotionSnapshotTests` 已经有这种用法。`Bukit.Content.Notion.Tests` 只跑 `NotionContentSource`，跑不了完整站点。
- 写一个按目录取数据的假接口 `DirectoryNotionApi : HttpMessageHandler`：按请求路径和查询内容从 `api/` 读响应，并记下所有请求。`api/` 里没有的路径**直接让测试失败**，不返回 404：返回 404 的话，漏掉的一页可能被当成"关联目标 404"的警告继续构建，输出比较照样通过，掩盖 fixture 漏数据。要测 404 的关联，就在 `api/` 里显式放一个 404 响应（比如 `<路径>.404.json`）。联网构建结束后再断言收到的请求集合等于预期的集合。现有的 `FakeNotionApi` 是硬编码的两页，不会返回跨源关联、分类可选项和 `pages_index`，不能用。
- 生成测试默认跳过，设了 `BUKIT_GENERATE_SNAPSHOT_FIXTURE=1` 才跑：用 `DirectoryNotionApi` 带 `--notion-snapshot` 构建一次，把快照写进 `snapshot/`，再改写 manifest 的 `bukitVersion`。之后不再原地重新生成。

测试（`tests/Bukit.Engine.Tests/NotionSnapshotCompatibilityTests.cs`）：

1. **能读**：`NotionSnapshotSession.OpenOffline(fixture/snapshot 的临时副本)` 成功，manifest 的 `bukitVersion` 和当前版本不同。
2. **离线等于联网**：
   - 离线：从 fixture 快照的临时副本离线构建 `site/`，断言 `DirectoryNotionApi` 一次请求都没收到；
   - 联网：用 `DirectoryNotionApi` 带 token 构建同一个网站，不带快照；
   - 只比较发布文件，沿用 `NotionOfflineSnapshotMultilingualTests.Published` 的排除规则：不比较 `.bukit/` 下的报告（SEO、GEO、发布审计报告里带生成时间）和 `.bukit-build-state.json`（`BuildSummaryReportWriter` 写了 `startedAt`、`durationMs`），两次构建这些文件必然不同。可以把 `Published` 挪到一个共用的测试 helper 里。
   - 当前 `NotionBlocksRenderer.ContractVersion` 等于快照里记的 `renderer` 时，发布文件完全相同；不等时先去掉 `<!--notion-body-->…<!--/notion-body-->` 之间的内容再比较，并断言离线构建输出了一次 `event=notion.cache.renderer_mismatch`。
3. **跨版本复用正文**（不依赖 fixture，放在 `NotionSnapshotTests`）：用 `BukitVersionOverride = "0.0.0-other"` 录一份快照，再用当前版本带 token 重录。
   - 没改过的页面不再请求 `/blocks/<id>/children`（正文从旧快照复用）。
   - 把其中一条正文的 `renderer` 改成别的值，`version` 保持 `CacheFormat` 不变，再重录：这一页会重新请求。测试先断言 `version` 等于 `CacheFormat`，确认重新请求是因为渲染器版本不同，不是因为缓存格式不同。

命令行冒烟（`build --notion-snapshot <fixture 副本> --notion-offline`，没有 token、没有网络请求、退出码 0）放进 `ProgramEntryPointTests` 或 `NotionOfflineSnapshotCommandTests`，复用 fixture 的 `site/` 和 `snapshot/`。

规则写在 fixture 的 README 和 `FormatVersion` 的注释里：

- 第 2 项失败时，先判断原因：
  - 如果是快照存的数据不够或意思变了，就升 `FormatVersion`，新建 `notion-snapshot-format-2/`，删掉 format-1，并加一个测试证明 format-1 被拒绝、报 0B10；
  - 如果只是 Bukit 对同一份原始数据的解析或模板输出变了，联网和离线会一起变，第 2 项本来就不会失败。所以这个测试没有"改预期结果"这条路。
- 不允许为了让测试通过而重新生成 format-1 的 `snapshot/`。要分清两种情况：
  - **fixture 数据本身写错了**（`api/` 手写笔误、漏了一页）：可以改 `api/` 并重新生成 `snapshot/`，README 里记一笔改了什么、为什么。这不是快照的意思变了。
  - **快照的意思变了**：必须升 `FormatVersion`，按上面的做法换 format-2。
  - 判断标准：用改之前的 Bukit 重新生成，得到的 `snapshot/` 和用新 Bukit 生成的是否相同。相同就是 fixture 的错，不同就是快照的意思变了。

### 3.6 测试放在哪里

| 要验证的 | 放在 | 理由 |
|---|---|---|
| cli-error JSON 的 `code` 和退出码（快照错误 2、`BKT-xxxx` 写法、I18n/资源错误仍是 1 和 `cli-error`） | `tests/Bukit.Cli.Tests/ProgramEntryPointTests.cs` | 它在进程内走 `Main`，分别捕获 stdout、stderr 和退出码（`NotionOfflineSnapshotMultilingualTests` 也跑真实命令行，但在子进程里，见最后一行） |
| `build` 抛出的快照异常带哪个码 | `NotionOfflineSnapshotCommandTests`：`Assert.ThrowsAsync<NotionSnapshotException>` 后断言 `.Code` | 它直接调 `BuildCommand.RunInProcessAsync`，异常不经过 `Program.cs`；`CaptureAsync` 只接管 stdout |
| `config check`、`doctor` 的 `[BKT-0B1x]` 行 | `NotionOfflineSnapshotCommandTests`（`CaptureAsync` 接管的就是 stdout） | 这两个命令把报错写到 stdout |
| doctor 的 Notion 检查行 | `tests/Bukit.Cli.Tests/DoctorNotionCheckerTests.cs` | 现有的精确字符串断言（约 `:35/49/61/144-148`）都要改成带码的文字 |
| 多语言子进程透传 | `NotionOfflineSnapshotMultilingualTests`（真实子进程） | `RunBukitAsync` 现在返回 `stdout + stderr` 合在一起的文字，先改成分别返回 stdout 和 stderr。加 `--log-format json` 时，断言 stderr 最后一份 cli-error 的 `code` 是 `BKT-0B11`、消息里有原来的原因、退出码 1；不加时断言 stderr 最后一行是父进程的 `Error: [BKT-0B11] Worker for language … failed: …` |

现有测试要改：

- `NotionSnapshotTests.OtherBukitVersionOrFormat_IsAnError` 改名为 `OtherFormat_IsAnError`：Bukit 版本不同时能读；格式不同或没有快照时报错，断言 `Code` 是 0B10。
- `NotionOfflineSnapshotCommandTests.ChangedDatabaseId_FailsConfigCheckDoctorAndBuildOffline`：`config check`、`doctor` 断言输出含 `[BKT-0B11]`，`build` 断言异常的 `Code` 是 0B11。`OptionMisuse_IsAnArgumentError` 里的 "snapshot not found" 断言 `[BKT-0B10]`。
- `tests/Bukit.Shared.Tests/BuildDiagnosticCodeTests.cs`：
  - `DiagnosticCode_Category_Ranges_AreNonOverlapping` 的范围表要加 `["Notion"] = (0x0B01, 0x0BFF)`，否则新码在 `ranges.Keys.First(...)` 找不到前缀会抛异常；
  - `DiagnosticCode_Categories_AreWellDefined` 加一条 `Assert.StartsWith("Notion", …)`。
- `DiagnosticCodeFormatter.Describe` 给新码写说明，`Describe_AllCodes_ReturnsMeaningfulDescription` 的 `InlineData` 补上新码。不加"所有码都必须有具体说明"的测试：现有的 `ThemeSourceUnavailable`、`RouteInvalidInternalUrl` 等本来就走兜底说明。

## 4. 已定的问题

全部已定（2026-11-14）。D1–D4 是第一版定的，D5–D8 是审阅后新增、用户确认按建议定的。

| | 问题 | 定为 | 理由 |
|---|---|---|---|
| D1 | `Program.cs` 输出的错误码从枚举名改成 `BKT-xxxx` | 改 | 契约矩阵、`CliErrorRenderer` 的测试、`[BKT-xxxx]` 文字格式都用 `BKT-xxxx`，只有 `Program.cs` 和 `bukit-cli-reference` 约 `:179` 的示例用枚举名；两处一起改，BukitJalil 不读旧写法 |
| D2 | Bukit 发什么版本 | 2.2.0 | 2026-11-14 审阅后改定。公共枚举 `DiagnosticCode` 新增 16 个成员、CLI 的 `code` 写法与单语言快照退出码变化，用一个 minor 信号；不升 3.0.0，因为这些改动是把行为改回文档约定，且已知消费者 BukitJalil 不读旧 `code` 或退出码。CHANGELOG 的 2.2.0 条目要单独写明 D1 改了 `code` 的写法 |
| D3 | `build` 的快照错误退出码 | 2 | 和内容错误一致；现在是落进通用分支的 1。范围见 D5、D6 |
| D4 | Notion 码段 | `0x0Bxx`，0B01–0B08 是接口错误，0B10–0B17 是快照错误 | `0x0A` 已给 I18n；留出空位以后加。码段是用户定的；快照部分的具体分配在 v2 里按审阅和 BukitJalil 现有分类调整过（原来是 0B10–0B14），仍在这个码段内 |
| D5 | 多语言子进程怎么把码传给父进程；多语言 `build` 的退出码 | 父进程解析子进程 stderr 最后一行 `Error: [BKT-xxxx] …`；退出码保持 1 | 子进程不带 `--log-format`，没有 cli-error JSON；解析文字行在 text 和 JSON 两种模式下都能用，不改启动参数。退出码 1 不变，免得连带改变其他子进程失败的退出码 |
| D6 | 新 catch 的范围 | 只接快照错误（`when NotionSnapshot.IsSnapshotError(ex)`），不接所有 `BukitException` | I18n、资源错误现在是退出码 1 / `cli-error`，退出码表就这么写；一起改是另一项对外变化，和这次无关 |
| D7 | `(kind, status) → DiagnosticCode` 映射放在哪里 | `Bukit.Content` 里 internal 实现，经 `Bukit.Engine` 的 internal 桥接给 CLI | 不给 `Bukit.Notion` 加 `Bukit.Shared` 引用（改 Core 边界），不加公开 API；和现有的 `NotionSnapshot` 桥接同一个做法 |
| D8 | BukitJalil 怎么区分 build 和 check/doctor 的输出 | `notionProblemIn`、`notionSnapshotProblemIn` 都不加命令参数：先看 cli-error 的 `code`，再看行首的 `[BKT-0Bxx]` / `✖ [BKT-0Bxx]`；新增 `bukitErrorCodesIn`，不改 `bukitErrorsIn` | 两种格式不会重叠；改动最小，不波及 `mediaProblemIn` 和 `BuildReport.bukitErrors` |

Bukit 的仓库规则（Bukit 的 `AGENTS.md`）要求：改 `src/Bukit-Core/` 和对外契约必须是用户确认过的单独 Core 任务，同一时间只有一个改代码的 agent，只跑本任务指定的专项测试，不跑全量。问题都已定下，动 Bukit 的代码前仍要用户确认开工。

## 5. 实施步骤

### 第 1 层：Bukit 快照版本校验和兼容测试（约 1–1.5 天）

1. 删除 Bukit 版本比较；改 `FormatVersion`、`NotionSnapshotException`、`IsSnapshotError` 的注释；`Describe` 加 `bukitVersion`。
2. 写 `DirectoryNotionApi`、手写 `api/`、fixture 网站 `site/`，写默认跳过的生成测试，生成并提交 `snapshot/` 和 README。
3. 写 3.5 的第 1、2 项（`Bukit.Engine.Tests`）和第 3 项（`NotionSnapshotTests`）；改 `OtherBukitVersionOrFormat_IsAnError`（这一层只去掉版本断言，码的断言放第 2 层）。
4. CHANGELOG（en、ms、zh-CN 三份）和 `guide/user/06-notion-content.md` 改掉"Bukit 版本对不上就报错"。

专项测试：`dotnet test tests/Bukit.Content.Notion.Tests`；`dotnet test tests/Bukit.Engine.Tests --filter "NotionSnapshot"`。

### 第 2 层：Bukit 错误码（约 1.5 天）

1. `DiagnosticCode` 加 0B01–0B08、0B10–0B17；`DiagnosticCodeFormatter.Describe` 补上说明。
2. 契约矩阵 `docs/bukit-1.0-contract-matrix.zh-CN.md` 的"诊断码范围"整表按 `DiagnosticCode` 现状更正：Content 改成 0501-0504，补 `BKT-0Axx | I18n | 0A01-0A02` 和 `BKT-0Bxx | Notion`。只加一行 Notion 的话，表仍然和代码不一致。
3. `NotionErrorCodes`（`Bukit.Content`）和 `NotionDiagnostics` 桥接（`Bukit.Engine`）；`Bukit.Content` 的四处包装和字段不存在改用带码的 `ContentException`。
4. `NotionSnapshotException` 按 3.1 的表带码；`NotionSnapshot` 加 `Format`、`CodeOf`。
5. `Program.cs`：三个分支改用 `BKT-xxxx`（D1）；加只接快照错误的分支（D3、D6）。
6. `config check`、`doctor` 的快照错误行带码；`DoctorCommand` 约 `:425` 的 `ContentException` 行带码；`DoctorNotionChecker` 所有 Notion 请求失败行和警告行加码；`NotionSnapshot.Format` 对所有 `BukitException` 都带码。
7. 多语言子进程带码，父进程解析 `Error: [BKT-xxxx]`（D5）。
8. 测试：
   - 按 3.6 的表放；
   - `NotionErrorCodes.For` 的单元测试放在 `Bukit.Content.Notion.Tests`：覆盖 401、403、404、429、500、Transport、`RateLimited`、带 200 状态的 `InvalidJson` 得到 0B08 而不是 0B06，以及 `(null, null)` 得到 0B06；
   - 每类快照错误各一个带码断言（0B10–0B17），其中 0B12（缺正文）和 0B14（缺其他数据）要分开断言；
   - `NotionContentSourceTests`、`CrossSourceRelationProjectionTests` 照常通过（关联页面没权限的判断不变）。
9. 文档：
   - CHANGELOG 三份：新错误码（公开枚举 `DiagnosticCode` 新增 Notion 码）；`code` 改成 `BKT-xxxx`；单语言 `build` 的快照错误退出码改成 2；多语言网站的报错带上原来的码和原因；
   - `guide/user/06-notion-content.md`、`14-troubleshooting.md` 列出 Notion 错误码；
   - 技能 `bukit-troubleshooting` 补 Notion 错误码；`bukit-cli-reference` 的 cli-error 示例（约 `:179`）改成 `BKT-xxxx`，退出码表（约 `:152`）里写明单语言 `build` 的快照错误是 2、多语言是 1。

专项测试：
- `dotnet test` 分别跑：
  - `tests/Bukit.Content.Notion.Tests`；
  - `tests/Bukit.Shared.Tests`；
  - `tests/Bukit.Cli.Tests --filter "ProgramEntryPoint|CliErrorRenderer|NotionOffline|DoctorNotionChecker"`；
  - `tests/Bukit.Engine.Tests --filter "NotionSnapshot"`；
- 外加 `dotnet format --verify-no-changes`、analyzer ratchet、public-api-drift。public-api-drift 会因为 `DiagnosticCode` 新增的枚举值报 `review-required`（映射函数和桥接按 D7 不是公开 API，不会出现在报告里）；逐条审查后更新 `docs/governance/bukit-core-public-api-baseline.v1.json`，再跑一次通过。

### 第 3 层：审计、修复、复查，Bukit 发版（约 0.5 天，发版要用户确认）

- 按 Bukit 的流程做一次专项审查，有 Critical、Important 问题就修复后复查。
- 用户确认后发 2.2.0（D2），拿到三个平台安装包的 SHA-256。

### 第 4 层：BukitJalil 升级 Bukit，按错误码认 Notion 报错（约 0.5–1 天）

1. `packages/server/src/bukit/install.ts`：`BUKIT_VERSION`、`MIN_BUKIT_VERSION` 改成 2.2.0，换三个 SHA-256。
2. `report-errors.ts` 加 `bukitErrorCodesIn`；`notion-errors.ts` 按 3.3 的规则改，删掉四组正则。`notionProblemIn`、`notionSnapshotProblemIn` 的签名改成接收 stderr 和全部输出两份文字（或调用方先取好码传进去），`builds/service.ts`、`deploys/service.ts`、`agent/ai-bukit.ts` 的调用跟着改。
3. `NotionProblem` 加 `request_failed`，补中英文界面文字；`NotionSnapshotProblem` 只改注释；`change` 的提示（界面和 `NOTION_TEXT`）补"改了过滤、排序"，`stale` 的提示去掉"Bukit 升级了"（3.3）。
4. 测试：
   - `packages/server/test/notion.test.ts`：
     - 每个码映射到对应的 `NotionProblem` 或 `NotionSnapshotProblem`，0B15–0B17 两边都返回 null；
     - cli-error 的 `code` 优先于行首的码；
     - `config check`、`doctor` 的 `✖ [BKT-0Bxx]` 和行首 `[BKT-0Bxx]` 能认出；
     - `⚠ [BKT-0B01] Notion API unreachable: HTTP 401` 加上一条别的失败时，返回的是那条失败，不是 401；
     - 日志里出现在行中间的 `BKT-0B01`、以 `Error: [BKT-` 开头的子进程转发行、doctor 的 `✔ Notion offline snapshot (…)` 成功行都不算；
     - 多语言网站最后一份 cli-error 的码能认出。
     - `93132cc` 加的按文字分类的用例改成按码。
   - `packages/server/test/builds.test.ts`、`deploys.test.ts`、`site-tools.test.ts`：构建、发布失败时报告带 `notionProblem`；离线运行失败时带 `notionSnapshotProblem`。`93132cc` 加的用例里假输出的文字改成带码的输出。
   - `packages/server/test/bukit-behavior.test.ts`（用真实 Bukit，不联网、不给 token）：`93132cc` 已有的"checks and builds a Notion site offline"改成断言码：
     - 没有快照：`build --log-format json` 的 cli-error `code` 是 `BKT-0B10`、退出码 2；`config check`、`doctor` 有 `[BKT-0B10]` 开头的行；
     - 手写一份 `databases: []` 的 manifest（现有测试就是这么造的，所以不联网也能测 0B11）：三个命令都报 `BKT-0B11`；`bukitVersion` 填一个和当前不同的值，同时验证版本不同也能读。
   - `e2e/fake-bukit.ts` 和 `e2e/*.spec.ts` 不改：现在的 e2e 用例不输出 Notion 报错，这次也不新增。
5. 开发方案：
   - 5.4 改成"按 Bukit 的错误码认出 Notion 报错"，删掉"升级 Bukit 时要核对 `notion-errors.ts`"的说法；
   - 5.5 第二步里"按文字分清 stale / change"改成按码；
   - 8.1 记下 Bukit 2.2.0。
6. `pnpm -s check`、全部测试和构建通过后提交推送。

### 合计

Bukit 约 3–3.5 天（含审计和发版），BukitJalil 约 0.5–1 天，合计约 3.5–4.5 天。

比第一版多约 1 天，因为：
- fixture 要写按目录取数据的假接口和完整站点；
- 多了跨版本复用正文的测试；
- doctor 所有 Notion 请求失败行和警告行都要加码；
- 契约矩阵要整表更正。

## 6. 风险和对策

| 风险 | 对策 |
|---|---|
| D1 改了现有错误的 `code`，有别的使用方按枚举名判断 | CHANGELOG 写明；技能文档的示例一起改；BukitJalil 不受影响；Bukit 仓库里搜一遍按 `code` 判断的地方一起改 |
| 新 catch 改了不相关错误的退出码 | 按 D6 只接快照错误；`ProgramEntryPointTests` 断言资源输出冲突仍是退出码 1、`cli-error` |
| public-api-drift 报的 16 条新增成员没细看就更新了基线 | 逐条核对都是 `DiagnosticCode` 的 Notion 码、值和 3.1 的表一致，没有别的公开成员变化，再更新基线；不能只看检查变绿 |
| 包装方式变了，按 `ContentException { InnerException: NotionApiException }` 判断的代码失效（如 `notion.relation.permission_denied`） | 只加码、不换异常类型和包装层次；运行 `NotionContentSourceTests`、`CrossSourceRelationProjectionTests` |
| 映射先看状态码，把带 2xx 的 `InvalidJson` 误报成 0B06 | 映射先看 `Kind`；单元测试覆盖 |
| 改了快照数据的意思却忘了升 `FormatVersion` | 3.5 第 2 项"离线等于联网"会失败。fixture 数据写错（`api/` 笔误、漏页）可以改并重新生成 `snapshot/`，README 记一笔；快照的意思变了必须升 `FormatVersion`，不允许用改 fixture 来掩盖（判断方法见 3.5 末尾） |
| 兼容测试太脆，和快照无关的改动也让它失败 | 联网和离线用同一个 Bukit、同一个网站、同一份原始数据比较，解析和模板的变化两边一起变；fixture 网站用自己的主题；渲染器版本不同时去掉正文再比较 |
| 旧版渲染的正文进了预览 | 离线时照样用，输出 `renderer_mismatch` 警告，BukitJalil 在预览上说明；正式构建会重新渲染 |
| 多语言父进程认不出子进程的码 | 认不出就退回原来的 `i18n-worktree-worker-failed`，不影响构建结果本身；text 和 JSON 两种模式都有测试 |
| BukitJalil 被构建日志里的假错误码或警告误导 | 只认 cli-error 的 `code` 字段、行首的 `[BKT-0Bxx]` 和 `✖ [BKT-0Bxx]`，不认 `⚠` 和行中间的码；有测试覆盖 |
