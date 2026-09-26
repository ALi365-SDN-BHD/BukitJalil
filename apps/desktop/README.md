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

1. 创建项目，输入名称，使用系统对话框选择一个**尚不存在的目录**。或打开本应用创建的项目目录。
2. 应用 Canopy 1.0.0 样例主题；主题文件复制进当前项目，不共享可变引用。
3. 点击“构建预览”，等待真实 Bukit 构建完成。首页、关于页、窄屏预览都可查看。
4. 编辑右侧“首页标题”，检查变更摘要，点击“保存为新版本”，再点击“构建预览”。
5. 在“历史”中恢复一个旧版本，再次构建。较新的版本仍然保留。
6. 退出并重开，自动恢复最近项目和最后一次成功构建的预览。其他项目可从最近列表或目录打开。

未保存文字会阻止切换项目或恢复版本；可以保存，或明确放弃未保存修改。构建失败或取消时，已有成功预览保持运行，并标出它与当前版本的区别。底部日志显示真实进程输出及退出错误。关闭应用会取消正在进行的构建并关闭预览服务。

## 文件与版本

- `项目/bukitjalil.json`：项目名称、当前版本、不可变版本快照、主题副本、最后构建记录。临时文件写入并同步后原子替换；检测到外部修改时拒绝覆盖。
- `项目/.bukitjalil/builds/<构建 UUID>/input/`：由快照生成的完整 `site.yaml`、Markdown、主题文件，以及 Bukit 缓存。
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

IPC 只暴露明确操作，验证主窗口、主 frame 与应用 URL。项目路径来自系统文件对话框或已保存的最近项目；文件操作拒绝路径穿越、符号链接、硬链接和特殊文件。构建配置由应用生成，仅使用本地 Markdown 和固定主题路径，不运行项目提供的任意 CLI 参数。

主窗口启用 context isolation 和 renderer sandbox，禁用 Node integration、webview、下载、新窗口和权限申请。预览是无脚本的 sandboxed iframe，无 preload / 文件 / 进程 API；网络只允许当前 loopback 预览来源。预览响应额外限制 CSP，禁止脚本、连接、表单和对象。采用 [Electron 官方安全建议](https://www.electronjs.org/docs/latest/tutorial/security) 中的 IPC 来源检查、上下文隔离和进程沙箱措施。

Bukit 本身是用户选择的可信本机程序，以当前用户权限运行；本实现没有给构建器增加操作系统级文件沙箱，也不能防止其他本机进程恶意并发替换文件。只打开可信的本地项目。当前支持本应用格式的项目，不导入任意既有 Bukit 站点。

历史暂以嵌入式快照保存，上限 500 个版本 / 8 MB；构建目录保留用于诊断，没有自动清理。多个项目操作串行，应用只有一个实例；不承诺多个独立程序同时编辑同一项目。未保存的输入不是持久化版本。正常退出和取消有清理保障；强制杀死主进程 / 系统崩溃不能保证遗留子进程自动退出，重开时会把未完成构建标记为中断。

## 验证

```sh
npm test                     # 项目、失败、取消、退出、路径边界、主题隔离和恢复
npm run build                # TypeScript 检查与应用打包
BUKIT_BIN=/absolute/path/to/bukit npm run test:real
BUKIT_BIN=/absolute/path/to/bukit npm run test:electron
```

真实引擎测试只使用自动创建的临时站点，不触碰已有网站或 Bukit 仓库。Electron 测试启动实际应用、通过界面完成闭环，并检查预览无法访问 Node / preload / 父页面；仅系统文件选择的返回值由测试提供。截图在 `test-results/`。未提供 `BUKIT_BIN` 时真实引擎测试会显示跳过；Electron 测试改用明确标注的模拟构建器，不代表真实 Bukit 验收。

尚未接入 AI 生成文件 / 差异审阅 / 应用修改、通用可视化编辑、任意主题导入、发布部署、签名安装包或自动更新。

## Codex 对话（阶段一）

打开项目后切换右侧“对话”，点击“连接 Codex”。程序检测 PATH 和官方 macOS 应用中的 Codex；也可用 BUKITJALIL_CODEX_BIN 指定已安装的本机可执行文件。当前接入接受 0.155.x，实际无模型连接验证版本为 0.155.0-alpha.16.4；其他版本会显示不兼容，不自动安装或升级。

账户状态来自 account/read。未登录时，“在官方页面登录”调用 account/login/start，并在系统浏览器打开经主进程检查的官方 HTTPS 地址。登录完成 / 取消由协议通知更新。账户和认证存储由原生 Codex 管理，本应用不读取、复制或保存令牌文件，不要求填写 API Key。真实登录浏览器闭环仍需人工验收。

发送消息会使用本机 Codex 已登录账户的模型服务与额度。每次发送附带当前已保存版本的项目名称、版本 ID、site.yaml、关于页和当前主题副本，不扫描目录，也不附带旧版本、构建日志或其他项目内容。输入上限 8000 字、消息与项目快照合计上限 80000 字符。项目快照作为数据提供给模型，网站预览始终留在隔离 iframe 内。

每个项目的规范路径绑定一段原生会话；切换项目只改变显示内容，后台回复和取消状态仍属于原项目，未发送草稿按项目保留。重开应用自动恢复已有会话。断线或请求超时标为“需要核对”，点击“核对并恢复会话”读取 / 恢复原生记录，绝不自动重发原消息。“中断回复”调用真实 turn/interrupt，收到最终通知后才显示已中断。

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
