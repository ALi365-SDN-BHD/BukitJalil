# M7 验收：macOS 桌面版

- 日期：2026-11-11
- 分支：`pi-harness-ui`（代码到 d90d436）
- 环境：macOS（Apple 芯片），git 2.39.5，Electron 45.2.3（自带 Node 24.22.2）
- 安装包：`pnpm package:desktop` 生成的 `BukitJalil-0.0.0-mac-arm64.zip`（176 MB，解压后 445 MB），临时签名，没有 Apple 开发者签名

## 过程

1. **打包**：`pnpm package:desktop` 构建网页界面、桌面壳和 server，生成 `BukitJalil.app` 并压缩。`codesign --verify --deep --strict` 通过，签名标识 `my.ali365.bukitjalil`；`spctl` 拒绝（没有 Developer ID），符合预期
2. **从 Launch Services 打开**：把 zip 解压到一个新目录，用 `open -n` 打开 `BukitJalil.app`（和在 Finder 里双击相同：系统 PATH、不带终端的环境），用 `--env` 指定一个临时数据目录，不碰本机的 `~/.bukitjalil`
   - 几秒内 server 在应用的 helper 进程里启动，写入 `server.lock`；`/api/health` 不带会话时回 `auth.required`（API 正常、要求登录）
   - 日志里有 `server.listening`（`desktop: true`）和紧接着的 `auth.login`：窗口自动登录
3. **退出**：向应用发送"退出"（和 ⌘Q 相同）。server 走正常关闭流程，`server.lock` 删除，server 和应用进程都退出
4. **窗口截图**（Playwright 启动同一个打包后的应用，只给系统 PATH）
   - 主窗口：已登录，"开始使用"清单显示 git 已就绪、Bukit 待安装，见 [`m7/app-window.png`](m7/app-window.png)
   - 新建网站：位置一栏是路径输入框加"选择文件夹…"按钮，没有网页里的文件夹列表，见 [`m7/new-site-folder.png`](m7/new-site-folder.png)
5. **自动测试**（`pnpm e2e:desktop`，7 个全部通过）
   - 开发运行的桌面版：自动登录且只暴露桥接对象；退出后 server 结束并释放锁；外部链接交给系统浏览器、窗口不离开应用、通知权限被拒；第二次打开交给已运行的应用；server 被杀后显示原因并能重新启动；数据目录被占时说明原因；系统文件夹选择框从当前路径打开，选中的文件夹填进输入框
   - 打包后的应用：只给系统 PATH 启动，用应用里的 starter 模板创建网站并提交（git），能开始对话（找到 AI 技能），Pi 的模型目录能读出（依赖完整），退出后释放锁

## 发现的问题和处理

| 问题 | 原因 | 处理 |
| --- | --- | --- |
| 开发运行时 server 一启动就退出 | Electron 的 utility process 不处理 `--import tsx`，Node 24 自带的类型擦除不支持参数属性 | `static/dev-server.mjs` 先注册 tsx 再导入 `main.ts`（第 2 层） |
| 应用一度有 1.0 GB | packager 把 pnpm 的符号链接复制成完整副本 | `pnpm deploy` 用 hoisted 布局，去掉 tsx 和已打包的包（第 4 层） |
| 打包后签名失效 | Electron 自带的临时签名不再匹配应用内容，下载的副本会被说成"已损坏" | 打包后对整个应用重新临时签名并严格验证（第 4 层） |
| 两个窗口同时请求时可能启动两个 server | 启动进行中 `running` 仍为 false | 进行中的启动共用同一次（第 2 层） |

## 没有验证的

- **下载后第一次打开**：通过浏览器下载的 zip 带隔离属性，macOS 会拦下没有开发者签名的应用，要在"隐私与安全性"里点"仍要打开"（使用说明已写）。这一步需要在界面上手动确认，这次没有走
- 在桌面版里用真实模型对话和发布：桌面版运行的是同一个 server 和界面，M5、M6 已用真实模型和真实 GitHub 仓库验收；这次只确认了对话能开始、模型目录能读出

## 遗留

- 没有 Apple 开发者签名和公证，因此也没有自动更新；Electron fuses（关闭 `RunAsNode` 等）等签名时一起做
- 应用图标用的是 Electron 默认图标
- 只有 macOS arm64；Linux 和 Windows 安装包没有做
