# BukitJalil desktop

首个本地建站闭环：Electron + React + TypeScript，Bukit 作为独立进程。此实现不依赖历史 MAUI 应用。

## 运行

需要 macOS、Node.js 22.12+，以及已经安装的 Bukit 原生可执行文件。不会构建或修改 Bukit 源码仓库。

```sh
cd apps/desktop
npm ci
BUKIT_BIN=/absolute/path/to/bukit npm start
```

也可以直接 `npm start`，然后在右上角“选择 Bukit 引擎”中选取可执行文件。首次安装会通过 Electron 官方安装器下载当前锁定版本的桌面运行时。引擎路径会在本机保存，不接受渲染页面提供的任意命令或参数。

## 操作

1. 启动先进入独立项目首页，不自动打开最近项目。列表显示项目名称、磁盘位置和最近打开时间；点击项目进入工作台。也可新建项目，输入名称后选择一个**尚不存在的目录**，或打开本应用创建的项目目录。
2. 应用 Canopy 1.0.0 样例主题；主题文件复制进当前项目，不共享可变引用。
3. 点击“构建预览”，等待真实 Bukit 构建完成。首页、关于页、窄屏预览都可查看。
4. 左侧编辑网站标题、简介并保存为新版本；“高级设置”会用系统默认编辑器打开项目根目录的 `site.yaml`。右侧“页面 / 历史”切换显示页面列表或版本记录；历史可查看当前版本到所选版本的实际文件差异，再决定是否恢复。
5. 中间保留项目对话和生成审核。统一输入框按 Enter 发送、Shift+Enter 换行；普通问题由 Codex 回答，明确的网站修改请求转入待审核副本，含糊请求先追问。顶部“保存”打开待确认修改的差异审核；在聊天中独立发送“保存这些修改”会直接应用当前待审核副本，两种入口共用相同的基线与哈希校验。顶部“构建预览”或聊天中独立发送“预览一下”会打开预览窗口；待审核时优先构建隔离副本，拒绝或应用后即清理。
6. 点击顶部面包屑中的“项目”返回列表，当前预览进程随之关闭。退出并重开仍先显示首页；主动打开项目后恢复其保存版本和最后一次成功预览。
7. 在首页重命名项目，只更新显示名称，不移动目录、不改网站标题或版本。移除入口只更新本机索引，绝不删除磁盘项目，可通过“打开项目”重新加入。缺失目录或项目文件会明确提示，仍允许移除入口。

首页的“全局设置”可选择 Bukit、Codex 可执行文件，并查看检测版本、连接与登录状态。连接 Codex 后，模型和推理强度来自本机 App Server 的可用列表；不选择时沿用 Codex 的有效默认值。设置只保存在应用数据目录：Bukit 路径沿用 `session.json`，Codex 路径及模型偏好保存在 `codex-settings.json`。更改在之后的新一轮讨论和生成生效，保留已有会话历史，不自动重发；运行中的回复、构建、生成或待审核副本会阻止引擎切换。路径或连接验证失败时保留原有可用配置。

项目列表保留最近打开的 20 项。旧索引没有时间时显示“尚未记录”，第一次主动打开后记录时间；重命名或返回首页不会刷新打开时间。读取列表仅检查目录及项目文件状态，不自动构建或改写项目。

未保存文字会阻止返回首页、切换项目或恢复版本；可以保存，或明确放弃未保存修改。构建失败或取消时，已有成功预览保持运行，并标出它与当前版本的区别。生成、构建和待审核期间也禁止返回首页。只读对话沿用后台运行语义，首页显示状态并可中断，正在回复的项目不能移除。底部日志显示真实进程输出及退出错误。关闭应用会取消正在进行的构建并关闭预览服务。

## 文件与版本

正式受管理源文件保存在 `bukitjalil.json` 版本快照内；项目根目录同时保有可直接编辑的 `site.yaml`。旧格式 1 项目仍可打开，首次打开会补齐缺失的项目级配置；外部有效修改在打开或构建时导入为新版本，不会覆盖原文件。配置格式错误或与应用固定的内容来源、路由、主题及安全构建路径冲突时，导入与构建失败，上次成功预览保留。第一次写入完整 `sourceFiles` 快照时升级为格式 2；旧版应用会拒绝格式 2，避免忽略新字段而丢失修改。

- `项目/bukitjalil.json`：项目名称、当前版本、不可变版本快照、主题副本、最后构建记录。临时文件写入并同步后原子替换；检测到外部修改时拒绝覆盖。
- `项目/site.yaml`：当前版本的持久 Bukit 配置。内部保存、历史恢复及生成应用会核对磁盘基线；若编辑器在此期间改动了它，操作会拒绝覆盖并要求重新导入与审核。
- `项目/.bukitjalil/builds/<构建 UUID>/input/`：由快照生成的完整 `site.yaml`、Markdown、主题文件，以及 Bukit 缓存。
- 应用数据目录 `generation-previews/<审核 UUID>/`：待确认修改的临时副本构建和预览；不成为正式构建记录，审核结束时清理。
- `项目/.bukitjalil/builds/<构建 UUID>/input/dist/`：此次真实构建产物。只有成功构建可成为预览目标，失败产物不会替代旧预览。
- 应用数据目录中的 `session.json`：最近项目与本机引擎路径。可用 `BUKITJALIL_DATA_DIR=/absolute/path` 隔离测试会话。

应用使用以下经源码与真实二进制验证的契约（工作目录是本次 `input`）：

```sh
bukit build --config /absolute/input/site.yaml --output dist --cache-dir .cache --no-incremental --clean
bukit preview --dir /absolute/input/dist --config /absolute/input/site.yaml --host 127.0.0.1 --port auto
```

`--output` 必须使用相对路径。主题模板位于 `themes/canopy/layouts/pages/`，布局位于 `themes/canopy/layouts/layouts/`，与 Bukit 的模板根目录约定一致。

主题库目前是随应用提供的只读 Canopy 1.0.0。项目内的副本不会回写主题库或自动升级；本次没有“另存主题版本”界面，未来必须由用户主动另存才能写入主题库。

## 边界

IPC 只暴露明确操作，验证主窗口、主 frame 与应用 URL。项目路径来自系统文件对话框或已保存的最近项目；文件操作拒绝路径穿越、符号链接、硬链接和特殊文件。项目级 `site.yaml` 可在默认编辑器中修改，但应用仍固定本地 Markdown 来源、页面路由、Canopy 主题及安全构建路径；不会运行项目提供的任意 CLI 参数。

主窗口启用 context isolation 和 renderer sandbox，禁用 Node integration、webview、下载、新窗口和权限申请。预览是无脚本的 sandboxed iframe，无 preload / 文件 / 进程 API；网络只允许当前 loopback 预览来源。预览响应额外限制 CSP，禁止脚本、连接、表单和对象。采用 [Electron 官方安全建议](https://www.electronjs.org/docs/latest/tutorial/security) 中的 IPC 来源检查、上下文隔离和进程沙箱措施。

Bukit 本身是用户选择的可信本机程序，以当前用户权限运行；本实现没有给构建器增加操作系统级文件沙箱，也不能防止其他本机进程恶意并发替换文件。只打开可信的本地项目。当前支持本应用格式的项目，不导入任意既有 Bukit 站点。

历史暂以嵌入式快照保存，上限 500 个版本 / 8 MB；构建目录保留用于诊断，没有自动清理。多个项目操作串行，应用只有一个实例；不承诺多个独立程序同时编辑同一项目。未保存的输入不是持久化版本。正常退出和取消有清理保障；强制杀死主进程 / 系统崩溃不能保证遗留子进程自动退出，主动打开项目时会把未完成构建标记为中断。

## 验证

```sh
npm test                     # 项目、失败、取消、退出、路径边界、主题隔离和恢复
npm run build                # TypeScript 检查与应用打包
BUKIT_BIN=/absolute/path/to/bukit npm run test:real
BUKIT_BIN=/absolute/path/to/bukit npm run test:electron
```

真实引擎测试只使用自动创建的临时站点，不触碰已有网站或 Bukit 仓库。Electron 测试启动实际应用、通过界面完成闭环，并检查预览无法访问 Node / preload / 父页面；仅系统文件选择的返回值由测试提供。截图在 `test-results/`。未提供 `BUKIT_BIN` 时真实引擎测试会显示跳过；Electron 测试改用明确标注的模拟构建器，不代表真实 Bukit 验收。

尚未实现通用可视化编辑、任意主题导入、发布部署、签名安装包或自动更新。

## Codex 对话（阶段一）

打开项目后切换右侧“对话”，点击“连接 Codex”。程序检测 PATH 和官方 macOS 应用中的 Codex；也可用 BUKITJALIL_CODEX_BIN 指定已安装的本机可执行文件。当前接入接受 0.155.x，实际无模型连接验证版本为 0.155.0-alpha.16.4；其他版本会显示不兼容，不自动安装或升级。

账户状态来自 account/read。未登录时，“在官方页面登录”调用 account/login/start，并在系统浏览器打开经主进程检查的官方 HTTPS 地址。登录完成 / 取消由协议通知更新。账户和认证存储由原生 Codex 管理，本应用不读取、复制或保存令牌文件，不要求填写 API Key。真实登录浏览器闭环仍需人工验收。

发送消息会使用本机 Codex 已登录账户的模型服务与额度。每次发送附带当前已保存版本的项目名称、版本 ID、site.yaml、关于页和当前主题副本，不扫描目录，也不附带旧版本、构建日志或其他项目内容。输入上限 8000 字、消息与项目快照合计上限 80000 字符。项目快照作为数据提供给模型，网站预览始终留在隔离 iframe 内。

输入框按 Enter 发送、Shift+Enter 换行；中文输入法选字的 Enter 不会发送。会话只提供无参数的修改请求工具，主进程使用本轮原始用户文字启动隔离副本生成；模型不能直接编辑正式项目或批准应用。普通问题由对话回答，含糊意图应追问。独立的“预览一下”或“保存这些修改”（可加“请”和句末句号/叹号）由应用处理，不发起模型轮次；带否定、引号或问号的句子不作为保存指令。待审核副本存在时可继续提问，新修改请求需先处理当前副本。

每个项目的规范路径绑定一段原生会话；切换项目只改变显示内容，后台回复和取消状态仍属于原项目，未发送草稿按项目保留。旧版无工具会话在首次新消息时开启受限新线程，保留旧线程供历史显示，不重发旧消息。重开应用自动恢复已有会话。断线或请求超时标为“需要核对”，点击“核对并恢复会话”读取 / 恢复原生记录，绝不自动重发原消息。输入框右侧只在执行时出现小方形“停止”按钮；回复中调用 turn/interrupt，副本生成中取消专属进程。状态在输入框上方靠右显示实际处理、回复、生成或停止，完成后收起；错误保留提示。

安全边界：
- React 只调用显式聊天 IPC；主窗口、主 frame、应用 URL 的来源检查继续适用。没有任意 RPC、命令、路径或工具接口；模型回复按纯文本显示。
- 主进程启动自己的 stdio app-server，使用独立的应用数据工作目录，不把网站目录设为 Codex cwd。沿用自有进程组清理；退出仅停止本次实例创建的 Codex、Bukit 构建和预览进程。
- 只读 sandbox + networkAccess:false + approval never，关闭 shell、执行、浏览器、代码执行、插件、连接器、记忆、主机技能发现与通知 hook。拒绝所有服务端工具 / 审批请求；不依赖提示词控制权限。
- 空配置会与原生配置深合并，因此连接时先读取有效配置，再用逐项 enabled=false 的进程参数禁用继承 MCP、插件及连接器，重启自有进程并核验有效值。发送前复查配置，创建 / 恢复线程时核验实际沙箱和 MCP 工具 / 资源暴露；不满足条件就拒绝发送。不会修改用户全局配置。
- 本机协议的 readOnly 没有新版 readableRoots；应用采用必要项目快照、执行工具关闭和 MCP 零工具暴露缩小上下文。原生 Codex 仍可能加载自身全局 AGENTS 指令。此版本没有宣称操作系统隔离整个宿主进程的读取范围。
- 应用数据目录 codex-chats.json 仅保存项目与原生 thread ID 绑定和待确认的用户问题；完整记录由原生 Codex 保存。索引损坏时保留原文件并拒绝覆盖。最多保留 200 个项目绑定，界面显示最近 200 条消息，单条回复显示上限 200000 字符；没有记录分页、搬迁后自动关联或多设备同步。

实现依据为 [Codex App Server 官方协议](https://learn.chatgpt.com/docs/app-server)、[原生认证说明](https://learn.chatgpt.com/docs/auth) 与本机 CLI 生成的实验协议 schema。整个连接过程不调用模型；只有明确发送消息才发起 turn/start。

### 对话验证

- npm test：原建站核心回归与模拟 App Server 协议测试；涵盖流式 UTF-8、双项目、取消、失败、重开、断线不重发、继承工具拒绝、登录地址校验、超时与损坏协议。
- npm run test:electron：真实 Electron 窗口与受控 IPC，使用明确标注的模拟 Codex，检查跨项目后台状态、草稿、恢复、取消、失败、预览隔离和项目文件未改写。没有真实模型调用。
- npm run test:codex：显式的本机无模型探测，只验证版本、握手、有效配置和账户类型。原生 Codex 可能更新自身运行数据库，但本应用不写认证配置，也不会启动 turn/start。

2026-09-26 的本机权限探测另以原生 ephemeral thread 确认 readOnly / networkAccess:false / approval never，4 个已禁用 MCP 记录均为零工具、零资源；在自有临时目录的 command/exec 写入探针被沙箱拒绝。此权限探测本身只证明本机协议与沙箱行为。同日在独立临时样例项目中，经真实 Electron 界面完成一次真实 Codex 模型轮次：观察到流式文本与 completed，重开后从原生记录恢复同一回复；样例网站文件摘要前后不变，自有 app-server 在两次关闭后均退出。本机验收报告与截图保存在 Git 忽略的 test-results/ 中。真实网页登录、生产站点和签名安装包仍未验收。

## 副本生成与审核（阶段二）

1. 应用样例主题、连接 Codex，在统一输入框按 Enter 发送明确修改需求。会话调用受限请求工具后，应用启动使用账户额度的独立副本生成轮次；普通问题仍由会话直接回答。
2. 应用记录正式项目文件的基线，将当前受管理源文件写入应用数据目录 `generation-copies/<UUID>/`。Codex 只得到这份源文件快照。
3. 生成结束并关闭专属 app-server 后，应用重新枚举副本中的真实新增、修改和删除文件，展示每个文件修改前后的完整文本。模型说明另列，不能作为文件差异的依据。
4. 顶部“保存”打开差异审核，由用户点击“确认应用并构建”；独立聊天指令“保存这些修改”是直接应用当前待审核副本的明确确认。两者都重新校验项目、任务 ID、正式 manifest、项目级 `site.yaml` 和审核副本 SHA-256；变化会使审批失效，必须重新生成审核。顶部“构建预览”与聊天指令“预览一下”都可在应用数据目录中构建待确认副本，不改变正式源文件、构建记录或上次成功预览。点击“拒绝修改”仅移除本轮自有副本和副本预览。
5. 应用先保存 `.bukitjalil/recovery/<生成 UUID>.json`，再将审核时冻结的源快照写入新版本，同时更新项目级 `site.yaml`。两个文件分别使用临时文件和原子替换，并在替换前复核基线；manifest 替换失败时尝试回滚配置，若其他程序并发修改配置则保留其改动并报告冲突。恢复点仍保留。
6. 应用后自动调用既有 Bukit 构建。失败时新源版本与历史保留，上一成功预览继续运行；界面标注当前源版本尚未构建成功。历史恢复仍可使用。页面列表随受管理 Markdown 页面增删更新。

### 生成权限与范围

沿用 [App Server 官方协议](https://learn.chatgpt.com/docs/app-server)，并以本机 `0.155.0-alpha.16.4` 生成的实验 schema 为准：`dynamicTools` 使用 `type: function`，客户端处理 `item/tool/call` 并返回 `contentItems/inputText`。官方新版的 `readableRoots` 在此本机协议中不存在，不能假设它有效。

原生生成会话仍使用 **readOnly / networkAccess:false / approval never**。shell、原生执行、浏览器、MCP、插件、apps、技能发现、memory、通知 hook 和提权保持禁用；逐项覆盖继承配置并复核，检查会话实际沙箱及外部工具列表。生成专属进程唯一提供的 `bukitjalil.edit_website_copy` 动态工具由主进程执行，只接受当前命名空间及 thread/turn 的文件列表；没有通用命令、宿主文件读取或任意路径接口。原生只读沙箱禁止其直接写正式项目，副本编辑能力来自主进程严格限定的文件工具。不会把正式项目作为 Codex 工作目录，也不修改全局认证/配置。

副本只支持当前 Canopy 网站的 UTF-8 文本：`site.yaml`（只允许标题变化）、`content/*.md`、`themes/canopy/layouts/{pages,layouts,partials}/*.html`、`themes/canopy/assets/*.css`。文件名采用小写字母、数字、连字符；固定主题清单及必需模板保留。限制为 64 个文件、单文件 256 KB、合计 1 MB。路径穿越、符号链接、硬链接、特殊文件、非法 UTF-8、未知类型和超限内容都会拒绝。图片、可执行脚本、插件、外部数据源及主题市场不在范围内。侧栏页面按简单 Markdown front matter 的 `title` / `slug` 显示；实际模板语法、页面语义由 Bukit 构建验证。

生成和审核期间，主进程串行约束项目切换、手动保存、恢复和另一轮生成；审核期间只允许隔离副本预览构建，仍可继续只读讨论。取消、失败、断线和超时均停止自有生成进程，禁止自动重发或自动应用。最长生成时间为 5 分钟。

副本是临时任务：拒绝、取消、失败、应用或正常退出后清理本轮创建的 UUID 目录；不扫描删除用户网站或其他任务内容。审核不跨应用重启恢复。强制杀死或系统崩溃留下的副本保留在应用数据目录，重开时不会自动读取、续跑或应用，也不会自动删除无法确认归属的旧目录。恢复点与构建历史继续保留。原生宿主读取范围、可信 Bukit 程序及其他本机程序恶意并发替换文件的边界，仍与上文一致；这不是完整宿主进程的 OS 隔离。

### 阶段二验证

```sh
npm test
npm run build
BUKIT_BIN=/absolute/path/to/bukit npm test
BUKIT_BIN=/absolute/path/to/bukit npm run test:electron
npm run test:codex-generation   # 显式原生探测：不调用 turn/start
```

模拟 Codex 会发出真实 `item/tool/call`，应用实际写入临时副本；覆盖增改删差异、拒绝不改正式项目、确认保存/构建/恢复、基线或审核内容变化（含 BOM）、取消/失败/断线、跨任务/提权拒绝、链接/非法类型/大小/编码，以及临时写入后原子替换失败。真实 Bukit 用例验证新增页面、删除页面、标题、成功预览与历史恢复。Electron 用例覆盖真实界面的差异审核、拒绝、确认、页面列表与重开恢复。

原生零模型探测创建 ephemeral thread，验证动态工具 schema 被接受、有效配置和外部工具为空，并用自有 canary 确认副本内外原生写入被拒绝、只读命令正常；不会读取秘密、改变登录或发起模型轮次。

2026-09-26 当前模型直接工具兼容性修复、真实应用闭环及真实拒绝闭环均已通过。第一次真实 gpt-6-astra 轮次 completed，但没有工具调用和文件差异，正式项目未变；该次调查保留在 `test-results/stage2-real-acceptance.json`。随后修复只调整专用工具的暴露方式，没有切换模型或更改全局配置。

本机 `0.155.0-alpha.16.4` 对应官方源码 `3853cf0c49daadcacaacceb2cbb732f512eaacdb`。[配置定义](https://github.com/openai/codex/blob/3853cf0c49daadcacaacceb2cbb732f512eaacdb/codex-rs/features/src/feature_configs.rs#L22) 与 [原生配置解析](https://github.com/openai/codex/blob/3853cf0c49daadcacaacceb2cbb732f512eaacdb/codex-rs/core/src/config/mod.rs#L2676) 确认受支持的入口是 `features.code_mode={enabled=false,direct_only_tool_namespaces=["bukitjalil"]}`；顶层 `code_mode.direct_only_tool_namespaces` 会被忽略。[对应工具规划器测试](https://github.com/openai/codex/blob/3853cf0c49daadcacaacceb2cbb732f512eaacdb/codex-rs/core/src/tools/spec_plan_tests.rs#L2605) 覆盖了 CodeModeOnly 下直接暴露指定动态命名空间。会话进程只注册无参数的 `request_website_edit`；生成专属进程只注册 `edit_website_copy`。两者均要求有效配置 enabled=false 且名单恰好只有 bukitjalil，否则拒绝发起轮次。工具请求的命名空间、工具名、thread、turn 必须全部匹配。统一路由目前仅通过合成协议测试，尚未用真实模型验收语义判断。

零模型探测确认有效配置的专有名单、无效类型拒绝、原生 code_mode / code_mode_host / code_mode_only 均关闭、外部工具为空、只读沙箱保持不变。仅有 schema 接受不算模型验证；修复后的 **1 次真实 gpt-6-astra 调用**已进一步确认专用动态工具实际请求和成功响应，实际新增 `content/verification.md` 并仅修改 `site.yaml` 标题。审核前正式 manifest / 源摘要完全未变。审核真实差异后，在临时网站确认应用，真实 Bukit 构建、新标题与新页面预览、关闭重开保留新版本、历史恢复和旧新增路由返回 404 全部通过。实际回复、工具参数/响应、差异和截图保存于 `test-results/live-stage2-1790416197168/`，汇总证据及源哈希在 `test-results/stage2-direct-tool-acceptance.json`。

本次修复回归为 23/23（含真实 Bukit）及 3/3 Electron GUI，通过构建、脚本独立类型检查和原生零模型权限探测。随后追加授权的 1 次真实拒绝验收，同样通过专用工具生成非空实际差异；审核后拒绝，正式 manifest / 源摘要 / 当前版本及原预览地址与版本全部未变，原预览仍返回 200，生成副本已移除。该证据与截图位于 `test-results/live-stage2-1790416595997/`。排查 1 次、应用闭环 1 次、拒绝闭环 1 次，阶段二真实调用合计 **3 次**，没有额外重试。两次修复后验收的临时网站、应用数据和自有进程均已清理。原生实验协议的跨版本稳定性、其他模型/任务质量、真实网页登录、生产网站和签名安装包未验收。

`scripts/accept-generation.mts` 是单轮临时网站验收脚本，记录实际回复与工具往返，在决策前停下等待差异审核；one-turn-apply 验证应用闭环，one-turn-reject 验证拒绝闭环。仅在明确授权消耗一次模型额度时运行；它不改变模型或登录，也不自动重试：

```sh
npm run build
BUKITJALIL_REAL_ACCEPT=one-turn-apply BUKITJALIL_CODEX_BIN=/absolute/path/to/codex BUKIT_BIN=/absolute/path/to/bukit npx tsx scripts/accept-generation.mts
```
