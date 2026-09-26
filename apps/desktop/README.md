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

尚未接入 AI、通用可视化编辑、任意主题导入、云端服务、发布部署、签名安装包或自动更新。
