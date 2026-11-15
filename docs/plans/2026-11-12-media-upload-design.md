# 素材上传：设计与实施计划

> 日期：2026-11-12 · 版本：v4.1（2026-11-16，见第 8 节） · 状态：已实现（2026-11-16，合并到 `pi-harness-ui` `8d7f4f3`） · 对应：开发计划"16. 待定问题"第 2 条 · 估算：约 2 个工作日

## 1. 是什么，为什么做

**是什么**：用户上传图片和 PDF，文件放到当前主题的 `static/uploads/`，发布后网址是 `<site.baseUrl>uploads/<文件名>`。上传和 AI 的修改一样进改动集、要审核。不收 SVG。

**为什么**：AI 只能写 1 MB 以内的文本文件（开发计划 6.3），用户现在没办法往网站里加自己的图片。这是目前功能上最明显的缺口。

**v1 不做**：

- SVG（可以带脚本）、avif、视频、音频、字体、压缩包。
- 删除、重命名、移动已有素材；子目录；裁剪、压缩、缩略图生成；素材管理页面。
- 换主题时自动搬运素材。
- 重名时自动改名、两份都保留（只有替换或跳过）。
- 删除照片里的拍摄位置（只检测 JPEG 并提示，见 4.5）。
- 让 AI 的读工具拒绝读二进制文件（权限闸门的改动）。
- 另作任务的事项见第 7 节。

## 2. 素材放在哪里，网址怎么写

### 2.1 规则

| | 规则 |
|---|---|
| 上传目录 | `theme.static` 缺失或（不区分大小写）等于 `static` 时，是 `themes/<theme.name>/static/uploads/`；是别的非空值时，是网站根目录下的 `<theme.static>/uploads/`；显式空字符串拒绝上传 |
| 网址 | `<site.baseUrl>uploads/<文件名>`。`site.baseUrl` 先规范化成以 `/` 结尾，再拼接：`/` 得到 `/uploads/logo.png`，`/blog` 或 `/blog/` 得到 `/blog/uploads/logo.png` |
| 正文、front matter 里的写法 | 用上面拼好的网址，也就是接口和 `site_info` 返回的 `url` |
| 主题模板里的写法 | `{{ site.base_url }}/uploads/<文件名>`；starter 里写 `{{ base_url }}/uploads/<文件名>`。不要把已经带前缀的 `url` 再拼一次 |

`theme.name` 和 `theme.static` 从改动集快照里的 `site.yaml` 读取，规则和 Bukit 的 `BuildPathUtils` 一致：比较时不区分大小写，但不去空格，也不去掉末尾的 `/`。所以 `static/` 不算默认值，按网站根目录下的 `static/` 解析。`site.baseUrl` 从默认分支的 `site.yaml` 读取（部署设置直接提交到默认分支），否则改动集开着时改了部署设置，返回的网址会落在旧前缀下。

不能直接写 `/uploads/...`：部署设置会自动把 GitHub Pages 项目站点的 `site.baseUrl` 设成 `/<仓库名>/`，而 Bukit 不改写正文里的根路径，这样写在预览和发布时都是坏图。

对用户的影响：

- 上传的文件不管有没有被引用，都会发布。
- 素材跟着主题走：换主题后，旧主题目录里的素材不再发布。使用说明里写明，换主题前由 AI 提醒。
- 改 `site.baseUrl` 后，正文里写死的旧网址会失效。部署设置表单在 `site.baseUrl` 下给出固定提醒；v1 不自动检查（第 7 节）。

### 2.2 依据（Bukit 2.2.3）

- **网站根目录的 `assets/` 和 `static/` 不会被复制**，主题静态目录会原样复制到输出根目录（`BuildPathUtils.cs`、`AssetOutputPlan.cs`）。
- **Bukit 的媒体目录 `content.media.downloadDir` 不能用**：值为默认时，实际目录是 `.cache/media`（`ContentProviderFactory.BuildEffectiveMediaConfig`）。它不进快照，也只发布被引用的文件。
- **2026-11-15、11-16 在 starter 临时站点实测**：
  - 没被引用的 `themes/starter/static/uploads/a.png` 会输出到 `uploads/a.png`；以 `.` 开头的文件不复制。
  - `site.baseUrl: /blog/` 时，正文里的 `/uploads/a.png` 原样输出，是坏的。正文里写 `/blog/uploads/a.png`、模板里写 `{{ base_url }}/uploads/a.png`，输出都是 `/blog/uploads/a.png`，是对的。front matter 写成带前缀的形式时，经 `page.seo` 输出不会重复加前缀。
  - 多语言网站会把静态目录同时复制到根目录和 `/<语言>/` 目录，所以模板里 `{{ site.base_url }}` 带语言前缀时也能找到文件。
  - `config check` 和 `doctor` 都不报缺失的上传文件。
- Bukit 随 BukitJalil 一起固定版本（`BUKIT_VERSION` 加三个安装包的 SHA-256），用户不能单独升级。上面的关键行为放进 `bukit-behavior.test.ts`（6.1），升级时由 CI 发现变化。

不采用的放法：网站根目录的 `assets/uploads/` 或 `static/`（Bukit 不复制）；改 `content.media.downloadDir` 或 `theme.static`（要改用户的 `site.yaml`，还会影响主题自带的文件）。

## 3. 用户流程

```
选择或拖入文件 → 浏览器检查大小和扩展名 → 逐个上传
  → 服务端校验，写进 AI 工作副本，生成快照 → 改动集更新（没有就新建）
  → 用户让 AI 引用这些文件 → 审核：预览、检查，然后应用或拒绝
```

入口有三个，共用一个上传组件：

1. 网站主页"开始新对话"旁边的"上传素材"。
2. 对话输入框的回形针按钮，也可以把文件拖到对话区。上传完成后，在输入框里插入"已上传 logo.png（<url>）"，用户可以接着写，也可以删掉。
3. 改动面板顶部的"上传素材"。

对话正在运行或有消息排队时，三个入口都不可用，并说明原因。

## 4. 设计

### 4.1 接口

```
POST /api/sites/:siteId/media
Content-Type: application/json
X-BukitJalil: 1

{ "name": "Logo 最终版.PNG", "data": "<base64>", "replace": false }
```

- **用 JSON 加 base64，不用 multipart**：现有的防跨站规则要求写请求是 JSON，并带 `x-bukitjalil` 请求头（`security/guard.ts`），这样不需要给上传开例外。代价是请求体约大三分之一。
- **严格检查 base64**：`Buffer.from` 会悄悄跳过非法字符，所以先用正则检查字符和长度，不合格返回 `request.invalid_body`。
- **一次一个文件**：浏览器按顺序上传。
- **请求体上限**：只在这个路由上挂 Hono 的 `bodyLimit`，上限 14 MiB；超过返回 413 `request.too_large`。

成功返回 `201`：

```json
{ "path": "themes/starter/static/uploads/logo.png", "url": "/blog/uploads/logo.png",
  "size": 48213, "mime": "image/png", "replaced": false, "location": false, "changeId": "…" }
```

- `location` 为真，表示这张照片带拍摄位置（4.5）。
- 改动集的变化照常通过现有的 SSE `change` 事件推送。

重名时返回 409 `media.exists`，参数里带已存在的 `name`。

### 4.2 校验

| # | 检查 | 规则 | 错误码 |
|---|---|---|---|
| 1 | 网站状态 | 不是只读网站；没有运行中或排队的对话（`agent.busy(siteId)`，和插件开关相同）；拿得到网站操作锁 | `site.read_only` / `site.busy` |
| 2 | 请求体 | `data` 是合法的 base64 | `request.invalid_body` |
| 3 | 大小 | 解码后 1 字节到 10 MiB | `media.empty` / `media.too_large` |
| 4 | 文件名 | 原始文件名有扩展名，最长 255 个字符，不含控制字符 | `media.bad_name` |
| 5 | 格式 | 按文件头识别 png、jpeg、gif、webp、pdf，其他一律拒绝 | `media.unsupported_type` |
| 6 | 扩展名 | 和识别出的格式一致（`.jpg` 和 `.jpeg` 都算 jpeg） | `media.type_mismatch` |
| 7 | 网站配置 | 快照里的 `site.yaml` 能解析、有 `theme.name`；`theme.static` 不是空字符串；主题目录已经存在（不能靠新建 `uploads/` 造出一个假主题） | `media.config_invalid` |
| 8 | 上传目录 | 在检出目录内；路径的每一级都不是符号链接（`PathGate` 只检查真实路径是否在根目录内，不能代替这一条）；不在受保护路径下（`BUILD_DIRS`、`node_modules`、`plugins`、任何一级以 `.env` 开头）；不被 `.gitignore` 忽略（用 `git check-ignore` 检查） | `media.dir_unsafe` |
| 9 | 重名 | 上传目录里已有同名文件（用 `foldName` 比较，只差大小写也算），而 `replace` 不为真 | `media.exists` |

第 2–6 条只看请求本身，在打开改动集之前检查。格式不对的上传不会新建改动集，也不会重置 AI 工作副本。

**文件名整理**（`normalizeMediaName`）：

1. 做 NFKC 规范化，转小写；扩展名 `jpeg` 统一成 `jpg`。
2. 主名里不属于 `a-z0-9._-` 的字符换成 `-`，合并连续的 `-`，去掉首尾的 `-` 和 `.`，最长 80 个字符。
3. 整理后主名为空时（例如全是中文），改用 `upload-<YYYYMMDD>-<8 位十六进制>`。
4. 主名第一个点之前的部分是 Windows 保留名（`con`、`prn`、`aux`、`nul`、`com1`–`9`、`lpt1`–`9`；`CON.tar.png` 按 `con` 算）时，在后面加 `-file`。

整理后的名字只含 `a-z0-9._-`，不会出现目录分隔符，也不会是空名字。`..` 只能出现在名字中间，构不成路径。

例子：`Logo 最终版.PNG` 整理成 `logo.png`，`首页横幅.jpeg` 整理成 `upload-20261112-a3f9c1d2.jpg`，`CON.png` 整理成 `con-file.png`。

### 4.3 写入流程（`MediaService.upload`）

全程持有网站操作锁 `media`：

1. 按 4.2 第 1–6 条检查。
2. 调用 `ChangeService.beginUserChange(siteId)`：已有改动集就加入，没有就新建。这个方法已经存在，内部调用 `openChangeSet`，只需要从私有改为公开。
3. 读快照里的 `site.yaml`，解析出上传目录，按 4.2 第 7–9 条检查。
4. 先写到工作副本外面的 `worktrees/<siteId>/.upload-tmp/`，再改名到目标位置。临时目录和工作副本在同一个分区上，所以改名是原子操作。每次上传前清空临时目录。不能把临时文件放在工作副本里：快照用 `git add -A`，半个文件会被收进改动。
5. 替换已有文件时：按 `foldName` 找到实际存在的文件名，先把旧文件改名到临时目录作为备份，再把新文件改名到整理后的名字。这样 Linux 上不会同时留下 `Logo.png` 和 `logo.png`。
6. 调用 `ChangeService.snapshot(siteId, cwd)`：
   - 成功：删除备份。
   - 失败：删除新文件，把备份改回原位，再返回错误。接口报错的文件不能进入下一次快照。
7. 第 3 步以后任何一步失败，而改动集是本次请求新建的，就关闭这个改动集。做法和 `setPlugin` 相同。

创建目录和写最终文件时，还要再过一次 `PathGate.check(abs, "write")`，作为第二道检查。

### 4.4 改动集：沿用现有规则

上传不新增改动集字段、尾注或说明逻辑：

- **作者**：沿用 `apply` 的现有规则。只有上传的改动集没有关联会话，作者是用户；在恢复版本的改动集里上传，作者也是用户；有对话参与过，作者是 AI。
- **提交说明**：上传不写说明。AI 没写说明时，`apply` 用 `diffSummary` 生成，例如 `Add 2 files: themes/starter/static/uploads/logo.png, ...`。
- **已知限制**：上传加进插件开关或恢复版本的改动集时，提交说明仍然是"Plugin settings: …"或"Restore to …"，上传的文件只在差异里可见。这和对话加入这类改动集时的现有问题相同，一起放进第 7 节的独立任务。
- **拒绝**：上传的文件随改动集一起丢弃，网站文件夹不受影响。
- **和恢复的关系**：上传过文件的改动集不为空，这时再恢复版本，按现有规则返回 `change.open_exists`。

### 4.5 拍摄位置（只检测 JPEG，只提示）

手机照片常常带拍摄地点，发布后谁都能看到。v1 只检测和提示，不改用户的文件。

- **检测**：只看 JPEG 的 APP1 段，包括 EXIF 的 GPS IFD（tag `0x8825`）和标准 XMP 包里的 `GPSLatitude`（`exif:GPSLatitude` 也包含它）。标记前允许有任意个 `0xFF` 填充字节。只解析元数据，不解码图片。
- **不检测**：PNG、WebP、GIF、PDF，以及 JPEG 的扩展 XMP 分段。使用说明里提醒这些情况。
- **提示**：`location` 为真时，在文件旁边显示"这张照片带有拍摄位置，发布后所有人都能看到。不想公开的话，请先用相册或其他工具去掉位置信息，再上传替换"。文件照常写入，审核时可以拒绝。

### 4.6 AI 一侧

- **`site_info`**：在 `agent/site-tools.ts` 里返回 `{ ...summarizeConfig(config), media }`，不改 `ConfigSummary`（配置面板也在用它）。
  - `media` 包含上传目录和文件列表，每个文件有 `name`、`size`、`mime`、`url` 和 `viewable`，最多 200 个。
  - 列表跳过以 `.` 开头的文件、符号链接和子目录。
  - pdf 的 `viewable` 为假：Pi 的读工具会把它当文本读出一堆乱码。png、jpeg、gif、webp 能作为图片交给模型。
  - `site.yaml` 解析不了时，`media` 只返回错误原因。
- **技能文档** `skills/bukitjalil/site-editing/SKILL.md`：替换现在那句 "Images and other binary files are added by the user"，写明：
  - 正文和 front matter 用 `media[].url`，模板用 `{{ site.base_url }}/uploads/<文件名>`；
  - 文件名从 `site_info` 取，不要猜；图片要写有意义的 `alt`；
  - 不要移动、改名或删除上传目录里的文件；
  - 换主题或改 `site.baseUrl` 前提醒用户，已有的素材引用会失效；
  - `viewable` 为假的文件不要打开；
  - 缺图时请用户上传。
- 权限闸门不变：AI 仍然不能写二进制文件。

### 4.7 界面

- **上传组件**：
  - 使用 `<input type="file" multiple>` 加拖放区域。
  - 按队列逐个上传，每个文件显示"等待中"、"上传中"、结果和错误，失败的可以重试。
  - 网站被别的操作锁住（`site.busy`）时，当前文件报错、队列暂停，其余文件保持"等待中"；点一次重试就从停下的位置继续。
  - 超过 10 MiB 或扩展名不对的文件，在浏览器里直接拦下。
- **重名**：询问"替换 / 跳过"，对话框显示服务器返回的已有文件名（不是这次上传的原始名字）。选替换时带 `replace: true` 重新上传。
- **改动面板**：选中图片时，用现有的 `GET /api/sites/:siteId/file?ref=change&path=…&as=raw` 显示预览（已有 CSP 沙盒和 `nosniff`）。PDF 用现有的 `as=download` 下载。已删除的文件不显示预览。
- **部署设置表单**：在 `site.baseUrl` 下加固定提示："上传素材的网址包含这个路径，修改后正文里已有的素材引用会失效。"
- **桌面版**：页面在整个窗口的 `dragover` 和 `drop` 上调用 `preventDefault`。主进程的 `will-navigate` 已经能拦住"拖进来的文件被当成页面打开"。
- 新文案和新错误码都要有中英文两份。

### 4.8 格式识别

`sniffMedia` 放在 `server/src/media/sniff.ts`，复用 `panels/service.ts` 现有的 `imageMime`（png、jpeg、gif、webp），另外认出以 `%PDF-` 开头的 pdf。`imageMime` 和 `ImageMime` 类型都不用改。PDF 可以带脚本，所以 `as=raw` 继续拒绝它，只能下载。

## 5. 安全

文件内容、文件名、目录、写入和审核的安全规则见 4.1–4.5、4.8。另外两点：

- **跨站伪造上传**：沿用 `/api` 的全部规则，包括会话 Cookie、精确的 Origin、JSON 和自定义请求头。
- **Git LFS 仓库**：这类网站已经整体只读，上传返回 `site.read_only`；界面上的上传入口同时禁用。

## 6. 实施计划

每层按 实现 → 审计 → 修复 → 复查 → 提交推送 的顺序做。

### 6.1 第 1 层：Bukit 行为测试（0.25 天）

在 `packages/server/test/bukit-behavior.test.ts` 里加 3 条检查。CI 每次推送用固定版本跑，`bukit-latest.yml` 每天用最新正式版跑：

1. 主题 `static/uploads/a.png` 没被引用，也会输出到 `uploads/a.png`。
2. `site.baseUrl: /blog/` 时，正文 `/uploads/a.png` 原样输出；`/blog/uploads/a.png` 和模板 `{{ base_url }}/uploads/a.png` 都输出 `/blog/uploads/a.png`。
3. 多语言网站：`uploads/a.png` 同时出现在根目录和 `/<语言>/` 下。

结果和 2.2 不一致时，先改本文，再进入第 2 层。

### 6.2 第 2 层：服务端（0.75 天）

- `shared`：
  - 新增 `MediaUploadRequest`、`MediaUploadResult`；
  - 新增错误码 `media.empty`、`media.too_large`、`media.bad_name`、`media.unsupported_type`、`media.type_mismatch`、`media.config_invalid`、`media.dir_unsafe`、`media.exists`、`request.too_large`；
  - `apiError` 的状态码类型加 413。
- `server/src/media/`：
  - `sniff.ts`（4.8）；
  - `names.ts`（`normalizeMediaName`）；
  - `dir.ts`（2.1、4.2 第 7、8 条）；
  - `location.ts`（4.5）；
  - `service.ts`（4.3）。
- `changes/service.ts`：`beginUserChange` 改为公开。
- `api/media.ts`：路由，挂 14 MiB 的 `bodyLimit`。
- `test/media.test.ts`：
  - 5 种格式各上传一次；SVG、HTML、改了扩展名的文件、空文件、10 MiB + 1 字节、非法 base64 都被拒绝；格式不对的上传不会新建改动集。
  - 文件名整理：中文、只差大小写、`..`、`/`、`\`、NUL、没有扩展名、`con.png`、`con.tar.png`；生成名有 8 位十六进制；整理两次结果不变。
  - 上传目录：`theme.static` 缺失、`static`、`Static`、`static/`、自定义值、空字符串；`theme.name` 带 `..`；主题目录不存在；`site.yaml` 解析不了；目录被忽略、在受保护路径下、经过符号链接、路径上有 `.env*`。
  - 新建和加入改动集；重名返回 409；`replace` 生效；只差大小写的替换落盘名和接口返回的 `path` 一致；`site.baseUrl` 从默认分支读取；快照失败时新文件被删除、旧文件恢复；本次新建的改动集在失败时关闭。
  - 对话运行中、有消息排队、网站只读、网站被锁住时都拒绝。
  - JPEG 位置信息：EXIF GPS 和 XMP 都能检测到，标记前有 `0xFF` 填充字节也能；没有位置信息、扩展 XMP 和非 JPEG 都返回 `location: false`；写入的文件和上传的字节完全相同。样本由脚本生成，不用真实照片。
  - 只有上传的改动集应用后，作者是用户，说明来自 `diffSummary`；拒绝后网站文件夹里没有这些文件。
  - 请求体超限返回 413；13.3 MiB 的请求能收下。

### 6.3 第 3 层：AI 一侧（0.25 天）

- `agent/site-tools.ts`：`site_info` 返回 `media`（4.6）。
- 技能文档：按 4.6 改写。
- `agent/fake-model.ts`：加一个 `#media` 场景，引用 `site_info` 里的第一张图。
- 测试：
  - `site-tools.test.ts` 检查 `media`、`url` 带 `site.baseUrl`、`viewable`；
  - 用假模型走一遍"上传 → 引用 → 检查通过 → 输出里有这个文件"。

### 6.4 第 4 层：界面（0.5 天）

- `web/src/features/media/`：上传组件、重名对话框、位置提示。
- 三个入口，以及对话运行时的禁用状态；改动面板的图片预览和 PDF 下载；部署设置的提示；桌面版拖放。
- 中英文文案（`i18n.test.ts` 会检查错误码是否齐全）。
- `e2e/media.spec.ts`（chromium、firefox、webkit）：
  - 两张图里有一张重名，选"替换"后改动面板显示新图；
  - 在 `/blog/` 网站里，假模型引用图片，预览能看到；
  - 上传 SVG 被拒绝；
  - 带位置的 JPEG 出现提示；
  - 对话运行时上传按钮不可用。

### 6.5 第 5 层：文档和验收（0.25 天）

- `docs/user-guide.md` 新增"添加图片和文件"一节：
  - 支持的格式和大小限制；
  - 引用写法；
  - 素材跟着主题走；
  - 改 `site.baseUrl` 后旧引用会失效；
  - 哪些格式不检测拍摄位置。
- 开发计划：待定问题第 2 条标为已完成，9.1 的接口表加上新接口，写入实现说明。
- `docs/acceptance/media-upload.md`：用桌面版和内置 Bukit 走一遍完整流程，附截图：拖放上传 → AI 把 Logo 放到页头 → 审核 → 应用 → 发布到 `/<仓库名>/` 测试仓库，确认图片网址带子路径。

## 7. 风险和移出的事项

| 事项 | 处理 |
|---|---|
| 引用写错不会让构建失败，只出现坏图 | AI 从 `site_info` 取网址；审核时看预览（预览用真实的 `baseUrl`）。改 `site.baseUrl` 的影响见 2.1 |
| 升级 Bukit 后静态目录的处理变了 | 6.1 的行为测试会失败 |
| base64 让请求变大，仓库体积增长 | 本机服务可以接受；v1 只限制单个文件大小 |

移到 AGENTS.md 待开发任务、不随本功能实施的事项：

1. 改动集作者统一按 `aiJoined` 判断（`apply` 和 `applyPartial`），以及用户写的说明在对话加入后的处理。
2. 所有 `/api` 接口的全局请求体上限。
3. 上传网址的发布前检查。v3.4 的设计（扫描输出的 HTML，核对 `uploads/` 引用的前缀）见 git 提交 `ea1c896`。

## 8. 修订记录

- **v4.1（2026-11-16）**：
  - 删掉删除拍摄位置的功能（只检测和提示）和"两个都保留"；
  - 改正 e2e 里"假模型引用后作者是用户"的矛盾：有对话参与时作者是 AI；
  - 删去安全表、风险表和"v1 不做"里的重复内容。
- **v4（2026-11-16）**：按定下的范围重写，从 554 行精简到约 300 行。
  - 删除：avif、PNG/WebP 位置信息处理、"之前 / 之后"对比、列表缩略图、字节进度条、`BukitJalil-Uploads` 尾注、上传自己写的说明。
  - 移出（第 7 节）：作者规则修改、全局请求体上限、发布前前缀检查。
  - 网址规则、路径安全、写入回滚和 Bukit 2.2.3 的实测依据保留。
- **v1–v3.4（2026-11-12 到 11-16）**：四轮审计的过程见 git 历史（最后一版是提交 `ea1c896`）。
