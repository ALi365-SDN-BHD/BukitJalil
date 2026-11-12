# 素材上传：设计与实施计划

> 日期：2026-11-12 · 版本：v3（第二次审计后修订，见第 9 节） · 状态：功能设计已确认；素材位置在 v3 改为主题的静态目录，待确认后实施 · 对应：开发计划"16. 待定问题"第 2 条 · 估算：约 2 个工作日

## 1. 背景

AI 的写工具只能写 1 MB 以内的文本文件，不能写图片等二进制文件（开发计划 6.3）。这条规则是对的：AI 不应该凭空产生二进制内容，也不应该从外部下载文件。但它带来一个缺口：用户没有办法往网站里加图片、PDF，只能在 BukitJalil 之外手动复制进网站文件夹再提交。

开发计划把这件事列为待定问题："加一个上传到素材目录的受控入口，这是唯一的用户直接写入，需要确认是否接受。"2026-11-12 确认接受，按本文实施。

## 2. 目标与范围

### 2.1 目标

1. 用户在网站主页、对话界面和改动面板上传图片和 PDF，可以多选，也可以拖进来。
2. 上传的文件进入改动集，和 AI 的修改一样要经过审核，应用后才会写进网站文件夹。**上传不绕过审核。**
3. 改动面板里能直接预览上传的图片。
4. AI 知道有哪些已上传的文件，能在内容或主题模板里引用它们。比如用户上传 Logo 后说"放到页头"，AI 就改主题模板引用它。png、jpg、gif、webp 的画面内容 AI 能看到；avif 和 pdf 只知道文件名和网址（5.6）。
5. 改动集里没有 AI 参与时（只有上传，或只有恢复版本），提交作者是用户本人；有对话参与过，作者是 AI。

### 2.2 不在本次范围

- **SVG**：文件里可以带脚本，发布后在访客的浏览器里执行。要支持就得先清理里面的脚本，留到以后。
- 删除、重命名、移动已经在网站里的素材。v1 只能新增或替换；要删除，可以让 AI 去掉引用，再手动删文件。
- 图片裁剪、压缩、生成缩略图。
- 子目录。v1 所有上传文件都放在上传目录的第一层。
- 视频、音频、字体、压缩包。
- 素材管理页面（浏览、搜索全部素材）。现在只能通过"文件"面板查看。
- 换主题时自动搬运素材（3.1 第 3 点）。
- 检查内容里有没有引用不存在的素材（8 节）。
- 让 AI 的读工具拒绝读取识别不出的二进制文件（5.6），这是权限闸门的改动，记为后续事项。
- avif 的位置信息检测（5.3）。

## 3. 素材放在哪里

### 3.1 结论

上传的文件放在**当前主题的静态目录**下的 `uploads/` 子目录，发布后的网址是 `/uploads/<文件名>`：

| | 默认情况 | 说明 |
|---|---|---|
| 上传目录 | `themes/<theme.name>/static/uploads/` | `site.yaml` 的 `theme.static` 是默认值 `static` 时 |
| | `<theme.static>/uploads/` | `theme.static` 是别的值时，按相对网站根目录的路径解析 |
| 网址 | `/uploads/<文件名>` | 静态目录原样复制到输出的根目录 |

BukitJalil 从改动集快照里的 `site.yaml` 读取 `theme.name` 和 `theme.static`，规则和 Bukit 的 `BuildPathUtils` 一致。解析出的目录不在检出目录里时拒绝上传（例如主题来自网站之外的主题包）。

对产品有影响的四点：

1. **所有上传的文件都会发布**，不管有没有被引用。用户不会遇到"上传了却不在网站上"的情况。
2. **内容和主题模板都能引用。** 正文、front matter 字段、页头 Logo 都用同一个网址。
3. **素材跟着主题走。** 换主题后，旧主题目录里的素材不再发布。v1 在使用说明里写明这一点，并在换主题时由 AI 提醒（技能文档）；自动搬运不在本次范围。
4. **引用写错不会让构建失败**，只会在页面上显示一张坏图。所以 AI 必须从 `site_info` 取文件名，审核时要看预览（8 节）。

### 3.2 依据（Bukit `v2.0.12` 标签）

- **网站根目录的 `assets/` 和 `static/` 都不会被复制。** `src/Bukit-Core/Bukit.Engine.Primitives/BuildPathUtils.cs`：`theme.assets` 和 `theme.static` 是默认值时，解析到 `themes/<name>/assets` 和 `themes/<name>/static`；只有改成别的值，才按相对网站根目录的路径解析。
- **主题静态目录原样复制到输出根目录。** `src/Bukit-Core/Bukit.Engine/AssetOutputPlan.cs`：`ParentStaticDir` 和 `StaticDir` 复制到输出根目录（前缀为空）；`AssetsDir` 复制到 `assets/`。
- **Bukit 的媒体目录不能用。** `src/Bukit-Core/Bukit.Engine/ContentProviderFactory.cs` 的 `BuildEffectiveMediaConfig`：`content.media.downloadDir` 为空或是默认值 `assets/uploads` 时，实际目录换成缓存目录，也就是 `<网站根>/.cache/media`（`BuildPlanner.cs`、`BuildTransaction.cs`）。而 `.cache` 是 BukitJalil 的构建目录（`server/src/sites/exclude.ts` 的 `BUILD_DIRS`），既不进快照，AI 也不能写。

### 3.3 考虑过、没有采用的方案

| 方案 | 不采用的原因 |
|---|---|
| 网站根目录的 `assets/uploads/`（v1、v2 的设计） | 那不是 Bukit 的媒体目录（见 3.2），Bukit 也不复制网站根目录的 `assets/`。文件发布不出去，被引用时还会让构建失败 |
| 在 `site.yaml` 里把 `content.media.downloadDir` 改成别的目录（如 `media`） | 上传要改用户的 `site.yaml`；远程图片本地化下载的文件也会改落到仓库里；只发布被引用的文件，主题模板里的引用会让构建失败（`ContentMediaOutput.ValidateOutputs`） |
| 网站根目录的 `static/` | Bukit 不复制它（见 3.2） |
| 把 `theme.static` 改到网站根目录下 | 会替换掉主题自带的静态文件（如 `robots.txt`），而且同样要改 `site.yaml` |

## 4. 用户流程

```
用户选择或拖入文件
  → 浏览器先检查大小和扩展名，再逐个上传（一个文件一个请求，显示进度）
  → 服务端校验，写进 AI 工作副本的上传目录，生成快照
  → 改动集更新（没有就新建一个），改动面板出现新文件和图片预览
  → 用户可以接着让 AI 在内容或页面里引用这些文件
  → 审核：预览、检查构建，然后"应用"或"拒绝"
```

上传入口：

1. **网站主页**："开始新对话"旁边加"上传素材"按钮。
2. **对话界面**：输入框左侧加回形针按钮；把文件拖到对话区域也能上传。上传完成后，输入框里自动插入一句提示，例如"已上传 logo.png（/uploads/logo.png）"。用户可以接着写要求再发送，也可以删掉。
3. **改动面板**：顶部加"上传素材"按钮，方便审核时补充文件。

对话正在运行或有消息排队时，三个入口都不可用，并说明原因（5.2）。

## 5. 设计

### 5.1 接口

```
POST /api/sites/:siteId/media
Content-Type: application/json
X-BukitJalil: 1

{ "name": "Logo 最终版.PNG", "data": "<base64>", "replace": false, "stripLocation": false }
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | 原始文件名，最长 255 个字符；服务端会整理（5.2） |
| `data` | 是 | 文件内容的标准 base64（`A–Z a–z 0–9 + /`，可带 `=` 补位），不接受其他字符 |
| `replace` | 否 | 为 `true` 时允许替换同名文件 |
| `stripLocation` | 否 | 为 `true` 时先去掉位置信息再写入（5.3） |

- **用 JSON 和 base64，不用 multipart。** 现有防跨站规则要求所有写请求都是 `application/json`，并带自定义请求头 `x-bukitjalil`（开发计划 11，`security/guard.ts`）。用 JSON 就不需要给上传开例外。代价是体积大约多三分之一：10 MiB 的文件，请求体约 13.3 MiB。会话 Cookie 和精确 Origin 的检查照旧。
- **严格解码 base64**：Node 的 `Buffer.from(s, "base64")` 会悄悄跳过非法字符，所以先用正则检查格式和长度，不合格返回 `request.invalid_body`。
- **一次一个文件**：浏览器按顺序逐个上传，进度和出错都按文件显示，服务端也不用处理批量回滚。
- **请求体大小限制**：
  - 这个接口 14 MiB，其他 `/api` 接口统一 1 MiB。用 Hono 的 `bodyLimit`，放在读取请求体之前。全局的 1 MiB 限制要跳过这个接口的路径，再由路由自己的 14 MiB 限制接手，否则上传会先被 1 MiB 拦下。
  - 超限返回 413，错误码是新增的 `request.too_large`。
  - 现在没有全局限制，这次一起补上。现有请求体里最大的是对话消息：`MAX_MESSAGE_CHARS` 是 10 万个字符（按 UTF-16 计）。最坏情况是全部为需要转义的控制字符，每个在 JSON 里占 6 字节，约 600 KB，仍在 1 MiB 以内。

成功返回 `201`：

```json
{
  "path": "themes/starter/static/uploads/logo.png",
  "url": "/uploads/logo.png",
  "size": 48213,
  "mime": "image/png",
  "replaced": false,
  "location": false,
  "changeId": "…"
}
```

- `location`：写入的文件里仍然带位置信息（5.3）。
- 改动集的变化照常通过现有的 SSE 事件推送（`type: "change"`，由 `events/bridge.ts` 发出），界面不用另外刷新。

重名时返回 409 `media.exists`，参数里带：
- `name`：已存在的文件名；
- `suggestion`：服务端算出的、当前不重名的新名字，例如 `logo-2.png`。

浏览器看不到工作副本里有哪些文件，所以"两个都保留"用的新名字由服务端给。

### 5.2 校验

| # | 检查 | 规则 | 错误码 |
|---|---|---|---|
| 1 | 网站状态 | 不是只读网站；没有正在运行或排队的对话（`agent.busy`，和恢复版本相同）；拿得到网站操作锁 | `site.read_only` / `site.busy` |
| 2 | 请求体 | `data` 是合法的 base64 | `request.invalid_body` |
| 3 | 大小 | 解码后 1 字节到 10 MiB | `media.empty` / `media.too_large` |
| 4 | 文件名 | 原始文件名有扩展名，长度不超过 255，不含控制字符；整理规则见下 | `media.bad_name` |
| 5 | 格式 | 按文件头识别：png、jpeg、gif、webp、avif、pdf。其他一律拒绝，包括 SVG 和 HTML | `media.unsupported_type` |
| 6 | 扩展名 | 必须和识别出的格式一致（`.jpg` 和 `.jpeg` 都算 jpeg）；改过扩展名的文件拒绝 | `media.type_mismatch` |
| 7 | 网站配置 | 改动集快照里的 `site.yaml` 能解析，并且有 `theme.name` | `media.config_invalid` |
| 8 | 上传目录 | 在检出目录内；不在受保护路径下（`dist`、`.cache`、`plugins` 等，开发计划 6.3）；不被 `.gitignore` 忽略，否则快照会丢掉文件（用 `git check-ignore` 检查）；路径上没有符号链接 | `media.dir_unsafe` |
| 9 | 重名 | AI 工作副本的上传目录里已有同名文件（用 `foldName` 比较，见下），而请求里 `replace` 不是 `true` | `media.exists`（409，带 `name` 和 `suggestion`） |

第 2–6 条只看请求本身，在打开改动集之前做完。这样格式不对的上传不会顺带新建一个空改动集，也不会重置 AI 工作副本（5.4）。

**文件名整理**（`normalizeMediaName`）：

1. Unicode NFKC 规范化，转小写。
2. 扩展名统一：`jpeg` → `jpg`。
3. 主名部分：不属于 `a-z0-9._-` 的字符替换成 `-`，合并连续的 `-`，去掉首尾的 `-` 和 `.`，最长 80 个字符。
4. 整理后主名为空（比如全是中文）时，改用 `upload-<YYYYMMDD>-<4 位随机十六进制>`。
5. 主名是 Windows 保留名（`con`、`prn`、`aux`、`nul`、`com1`–`com9`、`lpt1`–`lpt9`）时，在后面加 `-file`，否则仓库在 Windows 上无法检出。
6. 和目录里已有文件比较时，用 `foldName`（`server/src/names.ts`）做不区分大小写的比较。只差大小写也算重名，避免在 macOS 和 Windows 上冲突。

例子：`Logo 最终版.PNG` → `logo.png`；`首页横幅.jpeg` → `upload-20261112-a3f9.jpg`；`CON.png` → `con-file.png`。

整理后的名字一定是 `主名.扩展名`、只含 `a-z0-9._-`，所以不会有目录分隔符、`..` 或空名字。整理是幂等的：已经整理过的名字再整理一次不变，"去掉位置信息"重新上传时依赖这一点。

出现重名时，界面询问"替换"、"两个都保留"还是"跳过"。选"两个都保留"时，用 409 返回的 `suggestion` 作为新名字重新上传；服务端照样做全部校验，如果这期间又重名了，就再返回一个新的 `suggestion`。

### 5.3 位置信息（GPS）

手机拍的照片常常带拍摄地点，发布后谁都能看到。v1 的处理：

- **检测**（只解析元数据结构，不解码图片）：

  | 格式 | 检查位置 |
  |---|---|
  | jpeg | APP1 里的 EXIF GPS 信息（tag `0x8825`）、XMP 里的 `exif:GPSLatitude` |
  | png | `eXIf` 块、`iTXt` 里的 XMP |
  | webp | `EXIF` 块、`XMP ` 块 |

- **不检测**：avif（EXIF 藏在 ISOBMFF 的 item 里，解析成本高）、gif、pdf。使用说明里提醒这几种格式。
- **提示**：返回 `location: true` 时，界面在这个文件旁边显示"这张照片带有拍摄位置，发布后所有人都能看到"，并提供"去掉位置信息"按钮。
- **去掉**：浏览器手里还有原文件，用整理后的文件名重新上传，带上 `replace: true, stripLocation: true`。服务端删掉整个 EXIF 块和 XMP 块再写入（`server/src/media/location.ts`）。
  - 只删元数据，不重新编码图片，画质不变。
  - 副作用：EXIF 里的旋转方向也会一起丢掉，手机竖拍的照片可能显示成横的。提示里要说明这一点。

默认不自动删除，因为摄影类网站可能需要保留 EXIF。

### 5.4 写入流程（`MediaService.upload`）

全程持有网站操作锁 `media`，和应用、恢复、构建、AI 运行互斥：

1. 检查网站状态（5.2 第 1 条）。
2. 检查请求本身（5.2 第 2–6 条）。
3. 取得或新建改动集：
   - 已有改动集：沿用它，用 `aiWorktree(siteId, snapshotCommit, { reset: false })` 取得 AI 工作副本（工作副本丢了会恢复到快照）。
   - 没有：从默认分支的最新提交新建一个，`sessionId` 为空（和恢复版本一样），并重置 AI 工作副本。
   - 为此要从 `ChangeService.begin` 里抽出一个不需要会话的 `openOrCreate(siteId)`；`begin` 改为先调用它，再记录会话。
   - 后面的检查失败时，新建的改动集仍然为空。空改动集和对话开始后什么都没改的情况一样，按现有逻辑处理。
4. 读取改动集快照里的 `site.yaml`，解析出上传目录（3.1），做 5.2 第 7–9 条检查。
5. 写文件：
   - 先写到工作副本**外面**的临时目录 `worktrees/<siteId>/.upload-tmp/`，再改名到目标位置。临时目录和 AI 工作副本 `worktrees/<siteId>/ai/` 在同一个磁盘分区上，所以改名是原子操作；删除网站时整个 `worktrees/<siteId>/` 一起删掉（`sites/service.ts`）。
   - 临时文件不能放在工作副本里：快照用的是 `git add -A`（`changes/snapshot.ts`），`.` 开头的文件也会被收进去，进程中途崩溃留下的半个文件就会进入改动。
   - 每次上传开始前清空临时目录。
   - 上传目录不存在时自动创建。创建目录和写入最终路径都要过 `PathGate.check(abs, "write")`，`PathGate` 用和 AI 相同的根目录。
6. 调用 `ChangeService.snapshot(siteId, cwd)` 生成快照。改动集、它的 ref 和 SSE 事件都由现有逻辑处理。
7. 维护说明：
   - 改动集**没有 AI 参与**（`aiJoined` 为假）时，由上传维护说明：没有说明时写"上传素材：logo.png"；已有说明（上传写的，或恢复版本写的）就把文件名追加到后面。
   - 有 AI 参与后不再改动，说明交给 AI 的 `summarize_changes`。
   - 现有数据里分不清说明是谁写的，所以用 `aiJoined` 判断。

### 5.5 改动集、作者和历史

- **作者**：
  - 现在的规则：纯恢复（`restoreCommit` 不为空且 `aiJoined` 为假）时作者是用户，其余情况是 AI。
  - 改为：**只要 `aiJoined` 为假，作者就是用户。** 这样同时覆盖"纯恢复"和"纯上传"；有对话参与过的改动集，作者仍然是 AI。
  - `aiJoined` 在迁移 005 里已经有了，不需要新迁移。注意：对话一开始就会把 `aiJoined` 设为真，哪怕这次对话没改任何文件，所以"有对话参与"指的是"开过对话"，不是"AI 改过文件"。
  - 历史里的 `byAi` 按作者邮箱判断（`changes/history.ts`），所以纯上传的版本会自动显示为用户提交，不用另外改。
- **提交尾注**：只上传、没有恢复也没有 AI 参与的改动集，加一行 `BukitJalil-Uploads: <改动的文件数>`，方便在历史里辨认。文件数就是这个改动集的改动文件数，因为里面只有上传。其他情况不加这行，因为分不清哪些文件是上传的，又不想为此新增数据库字段。
- **拒绝**：拒绝改动集时，上传的文件跟着一起丢弃，网站文件夹不受影响。工作副本在下一个改动集打开时重置（现有逻辑）。
- **和恢复版本的关系**：
  - 在恢复版本产生的改动集里可以继续上传。作者仍然是用户，提交带 `BukitJalil-Restore` 尾注，说明里会追加上传的文件名。
  - 反过来，上传过文件的改动集不为空，这时再恢复版本会按现有规则返回 `change.open_exists`。

### 5.6 AI 一侧

- `site_info` 工具的返回值增加 `media` 一项：
  - 上传目录、网址前缀（`/uploads`）；
  - 目录里的文件列表，每个文件包括文件名、大小、类型、网址和 `viewable`，最多 200 个。
  - `site.yaml` 解析不了时，`media` 只返回错误原因。
- 建站技能 `skills/bukitjalil/site-editing/SKILL.md` 补充：
  - 用户上传的素材用 `/uploads/<文件名>` 引用（`site.baseUrl` 不是 `/` 时的写法，按第 1 层实测结果写），内容和主题模板里都可以用；图片一定要写有意义的 `alt` 文字；
  - 文件名从 `site_info` 取，不要自己猜，因为写错不会让构建失败，只会出现坏图；
  - 不要移动、改名或删除上传目录里的文件；换主题前提醒用户：素材在旧主题目录里，需要重新上传；
  - `viewable` 为假的文件（avif、pdf）不要用读工具打开；
  - AI 不能自己添加或修改图片，缺图时请用户上传。
- AI 的读工具是 Pi 的 read。`agent/tools.ts` 给它接了 `detectSupportedImageMimeTypeFromFile`，能把 jpeg、png（不含动画 png）、gif、webp 作为图片交给模型，所以 AI 能看到这些图片，写出准确的 `alt` 文字。
- Pi 的 read 不判断二进制，识别不出的文件按 UTF-8 文本读出（`core/tools/read.js`），avif 和 pdf 会变成一堆乱码，所以 `site_info` 把它们标为 `viewable: false`。动画 png 也识别不出来，但 v1 不解析 png 动画块，只按格式标记；动画 png 很少见，接受这个误差。
- AI 仍然不能写二进制文件，权限闸门不变。

### 5.7 界面

- **上传组件** `MediaUpload`：
  - 隐藏的 `<input type="file" multiple accept="…">` 加拖放区域；
  - 队列逐个上传，每个文件显示进度条、结果和错误，可以重试；
  - 超过 10 MiB 或扩展名不在 6 种格式里的文件，在浏览器里就先拦下，不发请求（服务端照样校验）。
- **重名对话框**：替换 / 两个都保留 / 跳过；可以勾选"后面的文件都这样处理"。
- **位置信息提示**：见 5.3。
- **改动面板**：
  - 文件列表里，图片显示缩略图；
  - 选中图片时，右侧显示大图预览，以及尺寸和大小。预览复用现有的 `GET /api/sites/:siteId/file?ref=change&path=…&as=raw`，已经带 CSP 沙盒和 `nosniff`；
  - 被替换的文件左右并排显示"之前 / 之后"，"之前"用 `ref=main`；
  - PDF 显示图标和"下载"，复用现有的 `as=download`，它返回 `Content-Disposition: attachment`。
- **文件面板**：现有的图片预览加上 avif；pdf 走现有的下载。
- **桌面版拖放**：主进程的 `will-navigate` 已经拦下"把拖进来的文件当页面打开"（`packages/desktop/src/main.ts`）。页面还要在整个窗口的 `dragover` 和 `drop` 上调用 `preventDefault`，拖到上传区域外时显示"拖到这里上传"的提示，而不是没有反应。
- 所有文字中英文各一份（`web/src/i18n/zh-CN.ts`、`en.ts`），新增的错误码都要有对应文案。

### 5.8 格式识别

`panels/service.ts` 的 `imageMime` 现在识别 png、jpeg、gif、webp。把文件头判断抽到 `server/src/media/sniff.ts`，导出两个函数：

| 函数 | 用途 | 识别范围 |
|---|---|---|
| `sniffMedia` | 上传校验 | png、jpeg、gif、webp、avif、pdf |
| `imageMime` | 面板 `as=raw` 预览 | png、jpeg、gif、webp、avif（不含 pdf） |

- avif：偏移 4 处是 `ftyp`，主品牌或兼容品牌里有 `avif` 或 `avis`。
- pdf：以 `%PDF-` 开头。PDF 可以带脚本（见 `panels/service.ts` 注释），所以 `as=raw` 继续拒绝它，只走 `as=download`。

## 6. 安全

| 风险 | 处理 |
|---|---|
| 上传带脚本的文件，在访客或管理界面里执行 | 只收 6 种格式，按文件头识别并和扩展名对照；SVG、HTML 一律拒绝。管理界面预览走现有的 CSP 沙盒和 `nosniff`；PDF 只能下载 |
| 通过文件名写到工作副本外，或写进受保护路径 | 整理后的文件名只含 `a-z0-9._-`；最终路径再过 `PathGate` 的写入检查（检出目录内、不经过符号链接、不在受保护路径） |
| `site.yaml` 的 `theme.name` 或 `theme.static` 指向检出目录外、受保护或被忽略的位置 | 上传前检查（5.2 第 8 条）；Bukit 自己也要求 `theme.static` 在网站根目录内（`enforceWithinRoot`） |
| 用 `theme.name` 拼路径时带 `..` | 解析出的上传目录必须在检出目录内（5.2 第 8 条），带 `..` 跑出去的路径被拒绝 |
| 跨站请求伪造上传 | 沿用 `/api` 的全部规则：会话 Cookie、精确的 Origin、JSON、自定义请求头，不允许预检 |
| 畸形 base64 被悄悄接受 | 先用正则严格检查（5.1） |
| 大文件或大量上传占满内存或磁盘 | 请求体 14 MiB 上限（其他接口 1 MiB），解码后 10 MiB，一次一个文件；磁盘写满时返回现有的 `fs.disk_full` |
| 崩溃留下半个文件进入改动 | 临时文件写在工作副本外面，改名是原子操作（5.4 第 5 步） |
| 照片泄露拍摄位置 | 检测并提示，可以一键去掉（5.3） |
| 绕过审核直接改网站 | 上传只写 AI 工作副本，进改动集，应用前不碰网站文件夹 |
| Git LFS 仓库 | 已经整体只读（开发计划 7.3），上传返回 `site.read_only` |

## 7. 实施计划

按项目的分层流程执行：每层 实现 → 审计 → 修复 → 复查 → 提交并推送 → 下一层。

### 7.1 第 1 层：用真实 Bukit 核对（约 0.25 天）

用 CI 同款脚本取得 Bukit 2.0.12（`packages/server/scripts/fetch-bukit.ts`），用 starter 模板在临时目录里建网站实测，结果记进第 3 节：

1. `themes/starter/static/uploads/a.png` 没被任何地方引用，确认构建后输出里有 `uploads/a.png`。
2. 分别从正文（`![](/uploads/a.png)`）、front matter 字段（`image: /uploads/a.png`）、主题模板引用，确认构建通过、页面显示正常。
3. `site.baseUrl` 改成 `/blog/`：静态文件输出到哪里；正文和模板里写 `/uploads/a.png` 时，生成的链接会不会带上 `/blog/`。不会的话，记下正确写法（例如模板里用 Bukit 的网址函数），写进技能文档。
4. 多语言网站（每种语言单独输出）：确认静态文件的输出位置和网址。
5. 内容里有一个网址是 `/uploads/` 的页面时，是否和静态目录冲突（`renderedStaticCopyDestinations`）。
6. 引用一个不存在的 `/uploads/missing.png`：确认构建是否报错、`bukit check` 是否报出坏链接。会报的话，8 节"引用写错"的风险就降低了。
7. avif、pdf 和以 `.` 开头的文件能否正常复制。
8. 确认网站根目录 `assets/uploads/a.png` 被引用时构建失败，记下错误信息。这一条证实 3.2，作为 v1、v2 设计不可行的证据。

**决策点**：
- 实测和第 3 节一致：进入第 2 层。
- 第 3 条里 `/uploads/...` 在子路径网站下不能用：设计不变，把正确写法写进技能文档；没有可用写法时，先修改本文再继续。
- 其他不一致：先修改本文的设计，再进入第 2 层。

### 7.2 第 2 层：服务端上传（约 0.5 天）

- `shared`：
  - 接口类型 `MediaUploadRequest` / `MediaUploadResult`；
  - 新增错误码 `media.empty`、`media.too_large`、`media.bad_name`、`media.unsupported_type`、`media.type_mismatch`、`media.config_invalid`、`media.dir_unsafe`、`media.exists`、`request.too_large`。
- `server/src/media/sniff.ts`：`sniffMedia`、`imageMime`（5.8）；`panels/service.ts` 改为从这里导入 `imageMime`。
- `server/src/media/names.ts`：`normalizeMediaName`、Windows 保留名、`suggestName`。
- `server/src/media/location.ts`：位置信息检测，删除 EXIF 和 XMP 块（5.3）。
- `server/src/media/dir.ts`：从 `site.yaml` 解析上传目录（3.1），和 Bukit 的 `BuildPathUtils` 规则一致。
- `server/src/media/service.ts`：`MediaService.upload`（5.4）。
- `server/src/changes/service.ts`：从 `begin` 抽出 `openOrCreate`；作者规则改为 `!aiJoined`；纯上传尾注（5.5）。
- `server/src/api/media.ts`：路由、14 MiB 请求体限制、`agent.busy` 检查；`app.ts` 加全局 1 MiB 请求体限制，并让它跳过上传路径。
- 测试 `test/media.test.ts`：
  - 6 种格式各上传一次；SVG、HTML、改了扩展名、空文件、10 MiB + 1 字节、非法 base64 都被拒绝；
  - 文件名整理：中文、大小写重名、`..`、`/`、`\`、NUL 字符、没有扩展名、`con.png` 这类 Windows 保留名；整理两次结果不变；
  - 上传目录解析：默认 `theme.static`、自定义 `theme.static`、`theme.name` 带 `..`、主题在检出目录外、`site.yaml` 解析不了；
  - 没有改动集时新建、有改动集时加入；格式不对的上传不会新建改动集；重名返回 409 并带 `suggestion`；`replace` 后替换成功；
  - 模拟写入中途失败：工作副本里没有残留文件，下一次快照也不会收进临时文件；
  - 上传目录被忽略、在受保护路径下、经过符号链接时返回 `media.dir_unsafe`；
  - 对话运行中、有消息排队、网站只读、网站被锁住时都被拒绝；
  - 位置信息检测和删除，覆盖 EXIF 和 XMP 两种写法。样本放在 `test/fixtures/media/`，由脚本生成，不用真实照片；
  - 纯上传的改动集应用后：作者和提交者都是用户，带 `BukitJalil-Uploads` 尾注，历史里 `byAi` 为假；
  - 上传后又有对话参与：作者是 AI，不带上传尾注，说明不再被上传改动；
  - 在恢复版本的改动集里上传：作者是用户，带 `BukitJalil-Restore`，说明里有上传的文件名；
  - 拒绝改动集后，网站文件夹里没有上传的文件；
  - 请求体超限返回 413 `request.too_large`；上传接口能收 13.3 MiB 的请求；10 万字符的对话消息在 1 MiB 限制下照常发送。

### 7.3 第 3 层：AI 一侧（约 0.25 天）

- `agent/site-tools.ts`：`site_info` 返回 `media`（5.6），工具描述里也提到素材列表。
- `skills/bukitjalil/site-editing/SKILL.md`：补充素材说明，替换现在那句"Images and other binary files are added by the user"。
- `agent/fake-model.ts`：加一个 `#media` 场景：读取 `site_info` 里的媒体列表，在页面里引用第一张图，供端到端测试使用。
- 测试：`site-tools.test.ts` 检查 `media` 字段和 `viewable`；会话测试里用假模型走一遍"上传 → 引用 → 检查构建通过 → 输出里有这个文件"。

### 7.4 第 4 层：界面（约 0.75 天）

- `web/src/features/media/`：`MediaUpload`、重名对话框、位置信息提示、上传队列（TanStack Query 的 mutation 加本地队列状态）。
- 三个上传入口（第 4 节），以及对话运行时的禁用状态。
- 改动面板和文件面板的图片预览、PDF 下载（5.7）。
- 桌面版拖放的 `preventDefault`（5.7）。
- 中英文文案。
- 端到端测试 `e2e/media.spec.ts`（chromium / firefox / webkit）：
  - 上传两张图，其中一张重名，选"两个都保留"：改动面板出现两个文件和预览；
  - 假模型引用图片，预览网站里能看到这张图；应用后网站文件夹里有文件，历史里作者是用户（没有对话参与时）；
  - 上传 SVG 被拒绝，并显示原因；
  - 带位置信息的照片出现提示，"去掉位置信息"后提示消失；
  - 对话运行中上传按钮不可用，并说明原因。

### 7.5 第 5 层：文档和验收（约 0.25 天）

- 使用说明 `docs/user-guide.md`：新增"添加图片和文件"一节，覆盖上传、引用写法、素材跟着主题走、审核、位置信息（含 avif/gif/pdf 不检测的提醒）、支持的格式和限制。
- 开发计划：
  - 待定问题第 2 条标为已完成；
  - 9.1 的接口表加上新接口；
  - 写入实现说明。
- 验收记录 `docs/acceptance/media-upload.md`：用真实 Bukit 和桌面版走一遍完整流程（上传 → AI 引用 → 审核 → 应用 → 构建 → 预览），附截图；包括在桌面版里拖放文件，以及把 Logo 放到页头。

### 7.6 估算

| 层 | 内容 | 估算 |
|---|---|---|
| 1 | 真实 Bukit 核对 | 0.25 天 |
| 2 | 服务端上传 | 0.5 天 |
| 3 | AI 一侧 | 0.25 天 |
| 4 | 界面 | 0.75 天 |
| 5 | 文档和验收 | 0.25 天 |
| 合计 | | 约 2 天 |

## 8. 风险和待确认

| 事项 | 影响 | 处理 |
|---|---|---|
| 子路径网站（`baseUrl` 不是 `/`）里 `/uploads/...` 可能指错地方 | 部署到 GitHub Pages 项目站点时图片显示不出来 | 第 1 层第 3 条实测；把正确写法写进技能文档 |
| 引用写错不会让构建失败 | 页面上出现坏图 | 技能文档要求 AI 从 `site_info` 取文件名；审核时看预览；第 1 层第 6 条看 `bukit check` 能否报出 |
| 素材跟着主题走 | 换主题后素材不再发布 | 使用说明写明；技能文档要求 AI 在换主题前提醒；自动搬运另开任务 |
| AI 读 avif、pdf 会得到乱码 | 浪费上下文，模型可能误判 | `site_info` 标出 `viewable`，技能文档要求不读；读工具拒绝二进制文件记为后续事项 |
| base64 让请求体变大 | 10 MiB 文件约 13.3 MiB 请求 | 本机服务，可以接受；以后有需要再改成流式上传 |
| 仓库体积增长 | 大量图片会让 git 仓库变大 | v1 只有单个文件上限；以后可以在设置里显示上传目录的总大小 |
| 去掉位置信息后照片方向可能不对 | 竖拍的照片可能显示成横的 | 提示里说明；以后可以只删 GPS 字段、保留方向 |

## 9. 修订记录

### v3（2026-11-12，第二次审计后修订）

第二次审计重点核对了 v2 依赖的 Bukit 行为，发现素材位置本身不可行，于是改了设计：

| # | v2 的问题 | 依据 | 改动 |
|---|---|---|---|
| 1 | **素材放在网站根目录的 `assets/uploads/`，以为那就是 Bukit 的媒体目录。** 实际上 `downloadDir` 是默认值 `assets/uploads` 时，Bukit 改用 `<网站根>/.cache/media`；网站根目录的 `assets/` 也不会被复制。按 v2 实施，上传的文件发布不出去，被引用时构建失败 | `ContentProviderFactory.BuildEffectiveMediaConfig`、`BuildPlanner.cs`、`BuildTransaction.cs`、`BuildPathUtils.cs`、`AssetOutputPlan.cs` | 改放到主题静态目录的 `uploads/`，网址 `/uploads/`（3.1）；列出没有采用的方案（3.3）；第 1 层第 8 条留证据 |
| 2 | v2 说"远程图片本地化下载的图片也放在这里" | 同上：默认下载到 `.cache/media` | 删掉这个理由 |
| 3 | v2 的"只发布被引用的文件"、`referencedOnly`、"主题模板不能引用"都建立在第 1 条的错误前提上 | — | 一并删除；新位置下所有文件都发布，内容和模板都能引用 |
| 4 | 没有校验 base64，`Buffer.from` 会悄悄跳过非法字符 | Node 的 base64 解码行为 | 5.1 要求严格检查，5.2 第 2 条 |
| 5 | 全局 1 MiB 限制会先把上传拦下 | Hono 中间件按注册顺序执行 | 5.1 写明全局限制跳过上传路径 |
| 6 | 对话消息最大体积写成约 400 KB | 控制字符在 JSON 里转义成 6 字节 | 改为约 600 KB |
| 7 | 格式不对的上传也会新建改动集、重置 AI 工作副本 | v2 的 5.4 先开改动集再校验 | 只看请求本身的检查提到打开改动集之前（5.2、5.4） |
| 8 | `site.yaml` 解析不了时怎么办没写 | — | 新增 `media.config_invalid`（5.2 第 7 条） |
| 9 | 重名检查说的是"快照里"，文件名比较说的是"目录里" | — | 统一为 AI 工作副本的上传目录 |
| 10 | 没写 `aiJoined` 在开对话时就会置为真 | `changes/store.ts` 的 `addSession` | 5.5 写明"有对话参与"的含义 |
| 11 | 2.2 说"Bukit 主题自己有图片变体功能"，没有核对 | — | 删掉 |
| 12 | 文件名整理没说是幂等的，"去掉位置信息"的重新上传依赖这一点 | — | 5.2 写明，并加测试 |

核对过、没有问题的说法（在 v2 核对的基础上补充）：

- Pi 的 read 不判断二进制，识别不出的文件按 UTF-8 读出（`core/tools/read.js`）；
- Hono 4.13.17 自带 `bodyLimit` 中间件；
- 删除网站时整个 `worktrees/<siteId>/` 一起删掉，临时目录不会留下；
- `.cache` 在 `BUILD_DIRS` 里；
- starter 模板的 `theme.static` 是 `static`，主题静态目录里现在只有 `robots.txt`。

### v2（2026-11-12，第一次审计后修订）

初稿逐条对照了 BukitJalil 代码、Pi 1.5.2 和 Bukit v2.0.12 源码，改正的问题：

| # | 初稿的问题 | 改动 |
|---|---|---|
| 1 | 说"按语言变体构建时才只发布被引用的素材" | 改为看 `downloadToLocal`（v3 第 3 条又整体删除） |
| 2 | 没考虑从主题模板引用素材 | 加实测和风险（v3 第 3 条又整体删除） |
| 3 | 临时文件以 `.` 开头放在工作副本里，说会被快照跳过 | 改放到工作副本外的 `worktrees/<siteId>/.upload-tmp/` |
| 4 | 说 AI 能看到所有上传的图片 | 只有 jpeg、png、gif、webp；`site_info` 加 `viewable` |
| 5 | "去掉位置信息"没有对应的接口 | 加 `stripLocation`；检测范围加上 XMP |
| 6 | "两个都保留"的新名字由浏览器算 | 409 返回 `suggestion` |
| 7 | 文件名整理没处理 Windows 保留名 | 加第 5 步 |
| 8 | 改动集说明"AI 写过就不再改"，但数据里分不清谁写的 | 改用 `aiJoined` 判断 |
| 9 | SSE 事件名写成 `change.updated` | 改为 `type: "change"` |
| 10 | 脚本路径写错 | 改为 `packages/server/scripts/fetch-bukit.ts` |
| 11 | 路径字段检查写成开发计划 8.2 | 改为 8.5 |
| 12 | 打算新写 PDF 下载 | 复用 `as=download` |
| 13 | base64 后的大小写成 13.4 MiB | 改为 13.3 MiB |
| 14 | 没写恢复版本和上传叠加时的规则 | 5.5 补上 |
| 15 | 桌面版拖放的说法前后矛盾 | 5.7 要求页面调用 `preventDefault` |
| 16 | 界面要读 AI 的 `site_info` | 上传结果加字段（v3 随第 3 条删除） |
| 17 | 请求体超限没有错误码 | 新增 `request.too_large` |
| 18 | `media.bad_name` 不可能触发 | 改为检查原始文件名 |
| 19 | 恢复加上传时上传文件数算不出来 | 只在纯上传的改动集加尾注 |
| 20 | `byAi` 要不要改没写清楚 | 写明按作者邮箱判断 |
| 21–24 | 示例矛盾、格式识别说明分散、缺决策点、范围外事项分散 | 整理 |

### v1（2026-11-12）

初稿。
