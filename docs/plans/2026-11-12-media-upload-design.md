# 素材上传：设计与实施计划

> 日期：2026-11-12 · 版本：v2（审计后修订，见第 9 节） · 状态：设计已确认，待实施 · 对应：开发计划"16. 待定问题"第 2 条 · 估算：约 2 个工作日

## 1. 背景

AI 的写工具只能写 1 MB 以内的文本文件，不能写图片等二进制文件（开发计划 6.3）。这条规则是对的：AI 不应该凭空产生二进制内容，也不应该从外部下载文件。但它带来一个缺口：用户没有办法往网站里加图片、PDF，只能在 BukitJalil 之外手动复制进网站文件夹再提交。

开发计划把这件事列为待定问题："加一个上传到素材目录的受控入口，这是唯一的用户直接写入，需要确认是否接受。"2026-11-12 确认接受，按本文实施。

## 2. 目标与范围

### 2.1 目标

1. 用户在网站主页、对话界面和改动面板上传图片和 PDF，可以多选，也可以拖进来。
2. 上传的文件进入改动集，和 AI 的修改一样要经过审核，应用后才会写进网站文件夹。**上传不绕过审核。**
3. 改动面板里能直接预览上传的图片。
4. AI 知道有哪些已上传的文件，并能在内容里引用。比如用户上传一张产品图后说"放到首页"，AI 就在首页内容里引用它。png、jpg、gif、webp 的画面内容 AI 能看到；avif 和 pdf 只知道文件名和网址（5.6）。
5. 改动集里没有 AI 参与时（只有上传，或只有恢复版本），提交作者是用户本人；有对话参与过，作者是 AI。

### 2.2 不在本次范围

- **SVG**：文件里可以带脚本，发布后在访客的浏览器里执行。要支持就得先清理里面的脚本，留到以后。
- 删除、重命名、移动已经在网站里的素材。v1 只能新增或替换；要删除，可以让 AI 去掉引用，再手动删文件。
- 图片裁剪、压缩、生成缩略图（Bukit 主题自己有图片变体功能）。
- 子目录。v1 所有上传文件都放在媒体目录的第一层。
- 视频、音频、字体、压缩包。
- 素材管理页面（浏览、搜索全部素材）。现在只能通过"文件"面板查看。
- 给主题加 Logo 配置项。如果第 1 层实测证明主题模板不能引用媒体文件（3.2），另开任务处理。
- 让 AI 的读工具拒绝读取识别不出的二进制文件（5.6），这是权限闸门的改动，记为后续事项。
- avif 的位置信息检测（5.3）。

## 3. 素材放在哪里，Bukit 怎么发布

### 3.1 结论

原先的提议是放在 `content/media/`。核对 Bukit 2.0.12 源码后，改为放在 **Bukit 自己的媒体目录**：

| 配置项 | 默认值 | 作用 |
|---|---|---|
| `content.media.downloadDir` | `assets/uploads` | 媒体目录，相对网站根目录 |
| `content.media.urlBase` | `/assets/uploads` | 媒体目录发布后的网址前缀 |
| `content.media.downloadToLocal` | `true` | 为 `true` 时只发布被引用的媒体文件 |

BukitJalil 从改动集快照里的 `site.yaml` 读取这三项，没写就用默认值。

选这个目录的理由：

- Bukit 原生就会发布它，不用改 `site.yaml`，也不用改主题。
- 远程图片本地化下载的图片也放在这里，两类素材在同一个位置，引用方式一样。
- `content.media.downloadDir` 已经在构建前检查的路径字段清单里（开发计划 8.5），保证在检出目录内、不经过符号链接。
- 引用写错时构建会失败，错误在审核前就能暴露出来。

对产品有影响的三点：

1. **默认只发布被引用的文件。** 上传了但内容里没用到的文件不会出现在网站上。这个行为和网站是不是多语言无关，界面要说清楚（5.7）。
2. **引用要写在内容里**，也就是正文或 front matter 字段（例如 `image:`）。只在主题模板或 `site.yaml` 里引用媒体文件，很可能让构建失败（3.2）。具体哪些写法可行，以第 1 层实测为准（7.1），结果写进技能文档（5.6）。
3. **引用不存在的文件会让构建失败**，所以 AI 必须从 `site_info` 取文件名，不能猜（5.6）。

### 3.2 依据（Bukit `v2.0.12` 标签）

- `src/Bukit-Core/Bukit.Config/SiteDefaultsApplier.Content.cs`：三项的默认值（`AppConfig.cs` 里 `DownloadToLocal` 也默认为 `true`）。
- `src/Bukit-Core/Bukit.Engine/VariantBuildPipeline.cs`：`downloadToLocal` 为 `true` 时创建 `ContentMediaOutput`，由它决定发布哪些媒体文件；只有为 `false` 时，`AssetOutputPlan.cs` 才把整个媒体目录复制到输出（跳过 `.` 开头的文件，不跟随符号链接）。
- `src/Bukit-Core/Bukit.Engine/ContentMediaOutput.cs`：
  - 发布清单从这几处收集引用：内容正文、front matter 自定义字段、内容的媒体记录、索引页字段。
  - 被引用的文件不存在，构建失败：`Referenced localized media is missing or unsafe`。
  - 构建最后，`ValidateOutputs` 会扫描生成的整页 HTML。网址前缀下有引用、但不在发布清单里的文件，同样会让构建失败：`Referenced localized media output is missing`。主题模板里写的引用会出现在整页 HTML 里，却不在发布清单里，因此推断会失败。这是看源码得出的推断，需要第 1 层实测确认。

## 4. 用户流程

```
用户选择或拖入文件
  → 浏览器先检查大小和扩展名，再逐个上传（一个文件一个请求，显示进度）
  → 服务端校验，写进 AI 工作副本的媒体目录，生成快照
  → 改动集更新（没有就新建一个），改动面板出现新文件和图片预览
  → 用户可以接着让 AI 在内容里引用这些文件
  → 审核：预览、检查构建，然后"应用"或"拒绝"
```

上传入口：

1. **网站主页**："开始新对话"旁边加"上传素材"按钮。
2. **对话界面**：输入框左侧加回形针按钮；把文件拖到对话区域也能上传。上传完成后，输入框里自动插入一句提示，例如"已上传 product.jpg（/assets/uploads/product.jpg）"。用户可以接着写要求再发送，也可以删掉。
3. **改动面板**：顶部加"上传素材"按钮，方便审核时补充文件。

对话正在运行或有消息排队时，三个入口都不可用，并说明原因（5.2）。

## 5. 设计

### 5.1 接口

```
POST /api/sites/:siteId/media
Content-Type: application/json
X-BukitJalil: 1

{ "name": "Product 最终版.JPG", "data": "<base64>", "replace": false, "stripLocation": false }
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | 原始文件名，最长 255 个字符；服务端会整理（5.2） |
| `data` | 是 | 文件内容的 base64 |
| `replace` | 否 | 为 `true` 时允许替换同名文件 |
| `stripLocation` | 否 | 为 `true` 时先去掉位置信息再写入（5.3） |

- **用 JSON 和 base64，不用 multipart。** 现有防跨站规则要求所有写请求都是 `application/json`，并带自定义请求头 `x-bukitjalil`（开发计划 11，`security/guard.ts`）。用 JSON 就不需要给上传开例外。代价是体积大约多三分之一：10 MiB 的文件，请求体约 13.3 MiB。会话 Cookie 和精确 Origin 的检查照旧。
- **一次一个文件**：浏览器按顺序逐个上传，进度和出错都按文件显示，服务端也不用处理批量回滚。
- **请求体大小限制**：
  - 这个接口单独放宽到 14 MiB，其他接口统一限制为 1 MiB。用 Hono 的 `bodyLimit` 实现，放在读取请求体之前。
  - 超限返回 413，错误码是新增的 `request.too_large`。
  - 现在没有全局限制，这次一起补上。现有请求体里最大的是对话消息：`MAX_MESSAGE_CHARS` 是 10 万字符，UTF-8 编码后最多约 400 KB，在 1 MiB 以内。

成功返回 `201`：

```json
{
  "path": "assets/uploads/product.jpg",
  "url": "/assets/uploads/product.jpg",
  "size": 48213,
  "mime": "image/jpeg",
  "replaced": false,
  "location": false,
  "referencedOnly": true,
  "changeId": "…"
}
```

- `location`：写入的文件里仍然带位置信息（5.3）。
- `referencedOnly`：这个网站只发布被引用的文件（即 `downloadToLocal`），界面据此显示发布提示（5.7）。
- 改动集的变化照常通过现有的 SSE 事件推送（`type: "change"`，由 `events/bridge.ts` 发出），界面不用另外刷新。

重名时返回 409 `media.exists`，参数里带：
- `name`：已存在的文件名；
- `suggestion`：服务端算出的、当前不重名的新名字，例如 `product-2.jpg`。

浏览器看不到工作副本里有哪些文件，所以"两个都保留"用的新名字由服务端给。

### 5.2 校验

按顺序执行，任何一步失败都不写文件：

| # | 检查 | 规则 | 错误码 |
|---|---|---|---|
| 1 | 网站状态 | 不是只读网站；没有正在运行或排队的对话（`agent.busy`，和恢复版本相同）；拿得到网站操作锁 | `site.read_only` / `site.busy` |
| 2 | 大小 | 解码后 1 字节到 10 MiB | `media.empty` / `media.too_large` |
| 3 | 文件名 | 原始文件名有扩展名，长度不超过 255，不含控制字符；整理规则见下 | `media.bad_name` |
| 4 | 格式 | 按文件头识别：png、jpeg、gif、webp、avif、pdf。其他一律拒绝，包括 SVG 和 HTML | `media.unsupported_type` |
| 5 | 扩展名 | 必须和识别出的格式一致（`.jpg` 和 `.jpeg` 都算 jpeg）；改过扩展名的文件拒绝 | `media.type_mismatch` |
| 6 | 媒体目录 | 不能是受保护路径（`dist`、`.bukit`、`plugins` 等，开发计划 6.3）；不能被 `.gitignore` 忽略，否则快照会丢掉文件（用 `git check-ignore` 检查）；路径上不能有符号链接 | `media.dir_unsafe` |
| 7 | 重名 | 目标文件已经在改动集快照里，而请求里 `replace` 不是 `true` | `media.exists`（409，带 `name` 和 `suggestion`） |

**文件名整理**（`normalizeMediaName`）：

1. Unicode NFKC 规范化，转小写。
2. 扩展名统一：`jpeg` → `jpg`。
3. 主名部分：不属于 `a-z0-9._-` 的字符替换成 `-`，合并连续的 `-`，去掉首尾的 `-` 和 `.`，最长 80 个字符。
4. 整理后主名为空（比如全是中文）时，改用 `upload-<YYYYMMDD>-<4 位随机十六进制>`。
5. 主名是 Windows 保留名（`con`、`prn`、`aux`、`nul`、`com1`–`com9`、`lpt1`–`lpt9`）时，在后面加 `-file`，否则仓库在 Windows 上无法检出。
6. 和目录里已有文件比较时，用 `foldName`（`server/src/names.ts`）做不区分大小写的比较。只差大小写也算重名，避免在 macOS 和 Windows 上冲突。

例子：`Product 最终版.JPG` → `product.jpg`；`首页横幅.jpeg` → `upload-20261112-a3f9.jpg`；`CON.png` → `con-file.png`。

整理后的名字一定是 `主名.扩展名`、只含 `a-z0-9._-`，所以不会有目录分隔符、`..` 或空名字。

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
- **去掉**：浏览器手里还有原文件，用同一个文件名重新上传，带上 `replace: true, stripLocation: true`。服务端删掉整个 EXIF 块和 XMP 块再写入（`server/src/media/location.ts`）。
  - 只删元数据，不重新编码图片，画质不变。
  - 副作用：EXIF 里的旋转方向也会一起丢掉，手机竖拍的照片可能显示成横的。提示里要说明这一点。

默认不自动删除，因为摄影类网站可能需要保留 EXIF。

### 5.4 写入流程（`MediaService.upload`）

全程持有网站操作锁 `media`，和应用、恢复、构建、AI 运行互斥：

1. 检查网站状态（5.2 第 1 条）。
2. 取得或新建改动集：
   - 已有改动集：沿用它，用 `aiWorktree(siteId, snapshotCommit, { reset: false })` 取得 AI 工作副本（工作副本丢了会恢复到快照）。
   - 没有：从默认分支的最新提交新建一个，`sessionId` 为空（和恢复版本一样），并重置 AI 工作副本。
   - 为此要从 `ChangeService.begin` 里抽出一个不需要会话的 `openOrCreate(siteId)`；`begin` 改为先调用它，再记录会话。
3. 读取改动集快照里的 `site.yaml`，得到 3.1 的三项配置。
4. 依次做 5.2 的第 2–7 条检查。
5. 写文件：
   - 先写到工作副本**外面**的临时目录 `worktrees/<siteId>/.upload-tmp/`，再改名到目标位置。临时目录和 AI 工作副本 `worktrees/<siteId>/ai/` 在同一个磁盘分区上，所以改名是原子操作。
   - 临时文件不能放在工作副本里：快照用的是 `git add -A`（`changes/snapshot.ts`），`.` 开头的文件也会被收进去，进程中途崩溃留下的半个文件就会进入改动。
   - 每次上传开始前清空临时目录。
   - 媒体目录不存在时自动创建。创建目录和写入最终路径都要过 `PathGate.check(abs, "write")`，`PathGate` 用和 AI 相同的根目录和只读目录。
6. 调用 `ChangeService.snapshot(siteId, cwd)` 生成快照。改动集、它的 ref 和 SSE 事件都由现有逻辑处理。
7. 维护说明：
   - 改动集**没有 AI 参与**（`aiJoined` 为假）时，由上传维护说明：没有说明时写"上传素材：product.jpg"；已有说明（上传写的，或恢复版本写的）就把文件名追加到后面。
   - 有 AI 参与后不再改动，说明交给 AI 的 `summarize_changes`。
   - 现有数据里分不清说明是谁写的，所以用 `aiJoined` 判断。

### 5.5 改动集、作者和历史

- **作者**：
  - 现在的规则：纯恢复（`restoreCommit` 不为空且 `aiJoined` 为假）时作者是用户，其余情况是 AI。
  - 改为：**只要 `aiJoined` 为假，作者就是用户。** 这样同时覆盖"纯恢复"和"纯上传"；有对话参与过的改动集，作者仍然是 AI。
  - `aiJoined` 在迁移 005 里已经有了，不需要新迁移。
  - 历史里的 `byAi` 按作者邮箱判断（`changes/history.ts`），所以纯上传的版本会自动显示为用户提交，不用另外改。
- **提交尾注**：只上传、没有恢复也没有 AI 参与的改动集，加一行 `BukitJalil-Uploads: <改动的文件数>`，方便在历史里辨认。文件数就是这个改动集的改动文件数，因为里面只有上传。其他情况不加这行，因为分不清哪些文件是上传的，又不想为此新增数据库字段。
- **拒绝**：拒绝改动集时，上传的文件跟着一起丢弃，网站文件夹不受影响。工作副本在下一个改动集打开时重置（现有逻辑）。
- **和恢复版本的关系**：
  - 在恢复版本产生的改动集里可以继续上传。作者仍然是用户，提交带 `BukitJalil-Restore` 尾注，说明里会追加上传的文件名。
  - 反过来，上传过文件的改动集不为空，这时再恢复版本会按现有规则返回 `change.open_exists`。

### 5.6 AI 一侧

- `site_info` 工具的返回值增加 `media` 一项：
  - 媒体目录、网址前缀、`referencedOnly`；
  - 目录里的文件列表，每个文件包括文件名、大小、类型、网址和 `viewable`，最多 200 个。
- 建站技能 `skills/bukitjalil/site-editing/SKILL.md` 补充：
  - 用户上传的素材在媒体目录里，用网址前缀加文件名引用，例如 `![产品照片](/assets/uploads/product.jpg)`，一定要写有意义的 `alt` 文字；
  - 文件名从 `site_info` 取，不要自己猜；
  - 只在内容里引用（正文或 front matter 字段），不要写进主题模板。具体写法按第 1 层实测结果写（3.1 第 2 点）；
  - `viewable` 为假的文件（avif、pdf）不要用读工具打开；
  - AI 不能自己添加或修改图片，缺图时请用户上传。
- AI 的读工具是 Pi 的 read。`agent/tools.ts` 给它接了 `detectSupportedImageMimeTypeFromFile`，能把 jpeg、png（不含动画 png）、gif、webp 作为图片交给模型，所以 AI 能看到这些图片，写出准确的 `alt` 文字。
- avif 和 pdf 识别不出来，会被当成文本读出一堆乱码，所以 `site_info` 把它们标为 `viewable: false`。动画 png 也识别不出来，但 v1 不解析 png 动画块，只按格式标记；动画 png 很少见，接受这个误差。
- AI 仍然不能写二进制文件，权限闸门不变。

### 5.7 界面

- **上传组件** `MediaUpload`：
  - 隐藏的 `<input type="file" multiple accept="…">` 加拖放区域；
  - 队列逐个上传，每个文件显示进度条、结果和错误，可以重试；
  - 超过 10 MiB 或扩展名不在 6 种格式里的文件，在浏览器里就先拦下，不发请求（服务端照样校验）。
- **重名对话框**：替换 / 两个都保留 / 跳过；可以勾选"后面的文件都这样处理"。
- **位置信息提示**：见 5.3。
- **发布提示**：`referencedOnly` 为真时，上传完成后提示"只有页面里用到的素材才会发布到网站上"。
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
| `site.yaml` 把媒体目录指向受保护或被忽略的位置 | 上传前检查（5.2 第 6 条）；构建前检查也继续检查这个路径字段 |
| 跨站请求伪造上传 | 沿用 `/api` 的全部规则：会话 Cookie、精确的 Origin、JSON、自定义请求头，不允许预检 |
| 大文件或大量上传占满内存或磁盘 | 请求体 14 MiB 上限（其他接口 1 MiB），解码后 10 MiB，一次一个文件；磁盘写满时返回现有的 `fs.disk_full` |
| 崩溃留下半个文件进入改动 | 临时文件写在工作副本外面，改名是原子操作（5.4 第 5 步） |
| 照片泄露拍摄位置 | 检测并提示，可以一键去掉（5.3） |
| 绕过审核直接改网站 | 上传只写 AI 工作副本，进改动集，应用前不碰网站文件夹 |
| Git LFS 仓库 | 已经整体只读（开发计划 7.3），上传返回 `site.read_only` |

## 7. 实施计划

按项目的分层流程执行：每层 实现 → 审计 → 修复 → 复查 → 提交并推送 → 下一层。

### 7.1 第 1 层：用真实 Bukit 核对（约 0.25 天）

用 CI 同款脚本取得 Bukit 2.0.12（`packages/server/scripts/fetch-bukit.ts`），在临时目录里建网站实测，结果记进第 3 节：

1. 单语言网站，默认配置：`assets/uploads/a.png` 在正文里被引用、`b.png` 没被引用，确认只发布 `a.png`。
2. 同一个网站改成 `downloadToLocal: false`，确认两个文件都发布。多语言网站重复第 1 条。
3. **从正文以外的地方引用**，分别记下能否发布、还是构建失败：
   - front matter 字段（如 `image:`）；
   - `site.yaml` 里的配置值；
   - 主题模板里直接写 `/assets/uploads/logo.png`。
4. 引用一个不存在的 `/assets/uploads/missing.png`：确认构建失败，记下错误信息，供界面翻译。
5. `site.baseUrl` 不是 `/` 时（例如 `/blog/`），Markdown 里写 `/assets/uploads/a.png`，输出的链接是否带上前缀。
6. 主题自己的 `assets/` 目录里也有 `uploads/` 时，是否报 `BuildAssetOutputCollision`。
7. avif 和 pdf 能否正常发布；pdf 用 Markdown 链接引用时，是否也算作被引用。

**决策点**：
- 实测和第 3 节一致：进入第 2 层。
- 第 3 条里主题模板引用失败：设计不变，把可行的写法写进技能文档和使用说明，给主题加 Logo 配置项另开任务。
- 其他不一致：先修改本文的设计，再进入第 2 层。

### 7.2 第 2 层：服务端上传（约 0.5 天）

- `shared`：
  - 接口类型 `MediaUploadRequest` / `MediaUploadResult`；
  - 新增错误码 `media.empty`、`media.too_large`、`media.bad_name`、`media.unsupported_type`、`media.type_mismatch`、`media.dir_unsafe`、`media.exists`、`request.too_large`。
- `server/src/media/sniff.ts`：`sniffMedia`、`imageMime`（5.8）；`panels/service.ts` 改为从这里导入 `imageMime`。
- `server/src/media/names.ts`：`normalizeMediaName`、Windows 保留名、`suggestName`。
- `server/src/media/location.ts`：位置信息检测，删除 EXIF 和 XMP 块（5.3）。
- `server/src/media/service.ts`：`MediaService.upload`（5.4）、读取媒体配置、检查目录。
- `server/src/changes/service.ts`：从 `begin` 抽出 `openOrCreate`；作者规则改为 `!aiJoined`；纯上传尾注（5.5）。
- `server/src/api/media.ts`：路由、14 MiB 请求体限制、`agent.busy` 检查；`app.ts` 加全局 1 MiB 请求体限制。
- 测试 `test/media.test.ts`：
  - 6 种格式各上传一次；SVG、HTML、改了扩展名、空文件、10 MiB + 1 字节都被拒绝；
  - 文件名整理：中文、大小写重名、`..`、`/`、`\`、NUL 字符、没有扩展名、`con.png` 这类 Windows 保留名；
  - 没有改动集时新建、有改动集时加入；重名返回 409 并带 `suggestion`；`replace` 后替换成功；
  - 模拟写入中途失败：工作副本里没有残留文件，下一次快照也不会收进临时文件；
  - 媒体目录被忽略、是受保护路径、经过符号链接时返回 `media.dir_unsafe`；
  - 对话运行中、有消息排队、网站只读、网站被锁住时都被拒绝；
  - 位置信息检测和删除，覆盖 EXIF 和 XMP 两种写法。样本放在 `test/fixtures/media/`，由脚本生成，不用真实照片；
  - 纯上传的改动集应用后：作者和提交者都是用户，带 `BukitJalil-Uploads` 尾注，历史里 `byAi` 为假；
  - 上传后又有对话参与：作者是 AI，不带上传尾注，说明不再被上传改动；
  - 在恢复版本的改动集里上传：作者是用户，带 `BukitJalil-Restore`，说明里有上传的文件名；
  - 拒绝改动集后，网站文件夹里没有上传的文件；
  - 请求体超限返回 413 `request.too_large`；10 万字符的对话消息在 1 MiB 限制下照常发送。

### 7.3 第 3 层：AI 一侧（约 0.25 天）

- `agent/site-tools.ts`：`site_info` 返回 `media`（5.6），工具描述里也提到素材列表。
- `skills/bukitjalil/site-editing/SKILL.md`：补充素材说明，替换现在那句"Images and other binary files are added by the user"。
- `agent/fake-model.ts`：加一个 `#media` 场景：读取 `site_info` 里的媒体列表，在页面里引用第一张图，供端到端测试使用。
- 测试：`site-tools.test.ts` 检查 `media` 字段和 `viewable`；会话测试里用假模型走一遍"上传 → 引用 → 检查构建通过"。

### 7.4 第 4 层：界面（约 0.75 天）

- `web/src/features/media/`：`MediaUpload`、重名对话框、位置信息提示、上传队列（TanStack Query 的 mutation 加本地队列状态）。
- 三个上传入口（第 4 节），以及对话运行时的禁用状态。
- 改动面板和文件面板的图片预览、PDF 下载、发布提示（5.7）。
- 桌面版拖放的 `preventDefault`（5.7）。
- 中英文文案。
- 端到端测试 `e2e/media.spec.ts`（chromium / firefox / webkit）：
  - 上传两张图，其中一张重名，选"两个都保留"：改动面板出现两个文件和预览；
  - 假模型引用图片，预览网站里能看到这张图；应用后网站文件夹里有文件，历史里作者是用户（没有对话参与时）；
  - 上传 SVG 被拒绝，并显示原因；
  - 带位置信息的照片出现提示，"去掉位置信息"后提示消失；
  - 对话运行中上传按钮不可用，并说明原因。

### 7.5 第 5 层：文档和验收（约 0.25 天）

- 使用说明 `docs/user-guide.md`：新增"添加图片和文件"一节，覆盖上传、引用、只发布被引用的文件、审核、位置信息（含 avif/gif/pdf 不检测的提醒）、支持的格式和限制。
- 开发计划：
  - 待定问题第 2 条标为已完成；
  - 9.1 的接口表加上新接口；
  - 写入实现说明。
- 验收记录 `docs/acceptance/media-upload.md`：用真实 Bukit 和桌面版走一遍完整流程（上传 → AI 引用 → 审核 → 应用 → 构建 → 预览），附截图；包括在桌面版里拖放文件。

### 7.6 估算

| 层 | 内容 | 估算 |
|---|---|---|
| 1 | 真实 Bukit 核对 | 0.25 天 |
| 2 | 服务端上传 | 0.5 天 |
| 3 | AI 一侧 | 0.25 天 |
| 4 | 界面 | 0.75 天 |
| 5 | 文档和验收 | 0.25 天 |
| 合计 | | 约 2 天 |

如果第 1 层发现主题模板不能引用媒体文件，"给主题加 Logo 配置项"另行估算，不算在这 2 天里。

## 8. 风险和待确认

| 事项 | 影响 | 处理 |
|---|---|---|
| 从主题模板或 `site.yaml` 引用素材可能让构建失败 | 用户最常见的需求之一"把 Logo 放到页头"可能做不到 | 第 1 层第 3 条最先实测；做不到时，把可行的写法写进技能文档和使用说明，Logo 配置项另开任务 |
| 默认只发布被引用的素材 | 上传了但没引用的文件不在网站上，用户可能以为上传失败 | 上传后显示发布提示（5.7）；第 1 层实测后定措辞 |
| 引用不存在的素材会让构建失败 | AI 写错文件名时检查不通过 | 错误在审核前暴露；技能文档要求 AI 从 `site_info` 取文件名 |
| AI 读 avif、pdf 会得到乱码 | 浪费上下文，模型可能误判 | `site_info` 标出 `viewable`，技能文档要求不读；读工具拒绝二进制文件记为后续事项 |
| base64 让请求体变大 | 10 MiB 文件约 13.3 MiB 请求 | 本机服务，可以接受；以后有需要再改成流式上传 |
| 仓库体积增长 | 大量图片会让 git 仓库变大 | v1 只有单个文件上限；以后可以在设置里显示媒体目录的总大小 |
| 去掉位置信息后照片方向可能不对 | 竖拍的照片可能显示成横的 | 提示里说明；以后可以只删 GPS 字段、保留方向 |

## 9. 修订记录

### v2（2026-11-12，审计后修订）

初稿逐条对照了 BukitJalil 代码、Pi 1.5.2 和 Bukit v2.0.12 源码，改正了下面这些问题，然后把整篇文档重新整理了一遍：

| # | 初稿的问题 | 依据 | 改动 |
|---|---|---|---|
| 1 | 说"按语言变体构建时才只发布被引用的素材" | `VariantBuildPipeline.cs` 只看 `downloadToLocal`（默认 `true`） | 3.1 改为默认所有网站都只发布被引用的素材 |
| 2 | 没考虑从主题模板或 `site.yaml` 引用素材 | `ContentMediaOutput.ValidateOutputs` 会扫描整页 HTML | 3.1、3.2 写明；7.1 第 3 条实测并设决策点；风险表第一条 |
| 3 | 临时文件以 `.` 开头放在工作副本里，说会被快照跳过 | `changes/snapshot.ts` 用 `git add -A`，`.` 开头的文件也会收进去 | 临时文件改放到工作副本外的 `worktrees/<siteId>/.upload-tmp/` |
| 4 | 说 AI 能看到所有上传的图片 | Pi `utils/mime.js` 只识别 jpeg、png（不含动画）、gif、webp、bmp | 2.1、5.6 改写；`site_info` 加 `viewable` |
| 5 | "去掉位置信息"没有对应的接口 | — | 加 `stripLocation`；检测范围加上 XMP；写明 avif 不检测 |
| 6 | "两个都保留"的新名字由浏览器算，但浏览器看不到已有文件 | — | 409 返回 `suggestion` |
| 7 | 文件名整理没处理 Windows 保留名 | — | 加第 5 步 |
| 8 | 改动集说明"AI 写过就不再改"，但数据里分不清谁写的 | `change_sets` 只有 `summary` | 改用 `aiJoined` 判断 |
| 9 | SSE 事件名写成 `change.updated` | `events/bridge.ts` 发的是 `type: "change"` | 已改 |
| 10 | 脚本路径写成 `scripts/fetch-bukit.ts` | 实际在 `packages/server/scripts/` | 已改 |
| 11 | 路径字段检查写成开发计划 8.2 | 在 8.5 | 已改 |
| 12 | 打算新写 PDF 下载 | 面板已有 `as=download`（带 `attachment`） | 改为复用 |
| 13 | base64 后的大小写成 13.4 MiB | 10 MiB × 4/3 ≈ 13.3 MiB | 已改；补充 1 MiB 全局限制对对话消息的影响 |
| 14 | 没写恢复版本和上传叠加时的规则 | `restore` 在改动集不为空时返回 `change.open_exists` | 5.5 补上 |
| 15 | 桌面版拖放的说法不准确，风险表和实施计划互相矛盾 | `main.ts` 的 `will-navigate` 已经拦下跳转 | 5.7 要求页面调用 `preventDefault`；删掉风险表里那一行 |

整理时另外补上的：

| # | 问题 | 改动 |
|---|---|---|
| 16 | 发布提示要读 `site_info`，但那是 AI 的工具，界面调不到 | 上传结果加 `referencedOnly` |
| 17 | 请求体超限没有错误码 | 新增 `request.too_large`（413） |
| 18 | `media.bad_name` 的触发条件不清楚：整理后不可能为空 | 改为检查原始文件名：要有扩展名、长度不超过 255、不含控制字符；校验顺序调整为先查文件名再识别格式 |
| 19 | 恢复版本加上传时，`BukitJalil-Uploads` 的文件数算不出来（分不清哪些文件是上传的） | 只在纯上传的改动集加这个尾注，不新增数据库字段 |
| 20 | `byAi` 要不要改没写清楚 | 写明 `byAi` 按作者邮箱判断（`changes/history.ts`），作者规则改了就自动正确 |
| 21 | 示例用"Logo 放到首页顶部"，和 3.1 第 2 点矛盾 | 示例改为产品图放进首页内容 |
| 22 | 面板 `imageMime` 加 avif 的说法分散在两处 | 5.8 用表格列清两个函数的识别范围 |
| 23 | 第 1 层实测不通过时怎么办没写 | 7.1 加决策点；7.6 写明 Logo 配置项另行估算 |
| 24 | 不在范围的事项分散在正文里 | 收进 2.2 |

核对过、没有问题的说法：

- 错误码 `site.read_only` 和 `site.busy` 都存在；
- 网站锁遇到占用时立刻返回 `site.busy`；
- `agent.busy` 把排队中的消息也算在内；
- 面板的 `ref` 只有 `main` 和 `change` 两个值，`as=raw` 只放行位图；
- `foldName` 在 `server/src/names.ts`；
- 作者规则需要的 `aiJoined` 已由迁移 005 加上；
- Bukit 源码的文件路径和报错文字都对得上。

### v1（2026-11-12）

初稿。
