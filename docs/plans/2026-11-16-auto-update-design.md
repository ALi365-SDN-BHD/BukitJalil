# 应用更新设计（无 Developer ID）

> 日期：2026-11-16 · 状态：开发/测试阶段已实现（仅手动安装） · 范围：桌面版的应用更新

## 1. 决定

macOS 安装包没有 Developer ID，不能使用 Squirrel.Mac 自动安装更新。第一版按“没有 Developer ID”实现：

- 检查 GitHub Releases，提示新版本。
- 用户点“下载安装包”后才开始后台下载。
- 下载到应用数据目录，校验 `SHA256SUMS.txt` 里的 SHA-256。
- 下载完成后由桌面版打开对应平台的安装程序：macOS 是 dmg，Windows 是 NSIS exe，Linux 是 AppImage 或 deb。
- 用户按系统安装程序完成安装；不在应用内替换 `.app`，不绕过 Gatekeeper。
- Windows/Linux 这一版也走手动安装。零点击自动安装是下一阶段：Windows NSIS 和 Linux AppImage 可以用 `electron-updater`，Linux deb 仍要包管理器；Windows 还受预览版限制。

以后有 Developer ID + 公证后，把 macOS 的“打开安装包”换成 `electron-updater` 的 `quitAndInstall`，检查、提示、下载和界面都可以保留。

## 2. 版本号

- 根 `package.json` 是唯一来源；子包不写版本。
- 发布标签去掉 `v` 后必须等于根 `package.json` 的版本，release workflow 会检查。
- 准备发布时单独提交改版本，发布后保持这个版本，不再改回 `0.0.x`。
- 开发时服务端和桌面版都读根版本，所以左下角显示的是同一个版本。
- 要造旧版本测试包时用 `BUKITJALIL_VERSION` 覆盖，不改 `package.json`。

## 3. 流程

```text
启动后 1.5 秒、每 6 小时、手动
        ↓
GET GitHub Releases
        ↓ 有适合当前平台的新版本
按钮显示“更新”+ 圆点
        ↓ 用户点按钮
对话框：新版本、大小、测试版、更新内容
        ↓ 用户点“下载安装包”
后台下载 + 进度 + 取消
        ↓
校验 SHA-256
        ↓ 通过
“打开安装包”
        ↓
系统打开 dmg / exe / AppImage
用户手动安装，重新打开 BukitJalil
```

- 不自动下载；点“下载安装包”才下载。
- 下载中可以继续使用应用，也可以关闭对话框；进度保留在按钮和对话框里。
- 下载失败保留“下载安装包”重试；校验失败删除文件并报错。
- 状态：`idle` / `checking` / `available` / `downloading` / `verifying` / `downloaded` / `error`。

## 4. 接口

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/update` | 当前版本、上次检查时间、状态 |
| POST | `/api/update/check` | 强制检查 GitHub Releases |
| POST | `/api/update/download` | 开始下载已发现的版本 |
| POST | `/api/update/cancel` | 取消下载 |
| POST | `/api/update/open` | 让桌面版打开已下载的安装包 |

服务端不接收客户端给的网址或文件名；版本、资产、SHA-256 都来自 GitHub API 和 `SHA256SUMS.txt`。打开文件通过桌面通道发给主进程，主进程只允许打开 `~/.bukitjalil/updates/` 下的普通文件。

## 5. 平台

| 平台 | 资产 | 安装方式 |
| --- | --- | --- |
| macOS arm64 | `*-mac-arm64.dmg` | 打开 dmg，拖进“应用程序” |
| Windows x64 | `*-win-x64.exe` | 运行 NSIS 安装程序 |
| Linux AppImage | `*-linux-x86_64.AppImage` | 替换运行中的 AppImage，设置执行权限并重启 |
| Linux deb | `*-linux-amd64.deb` | 用软件中心或包管理器安装 |

Linux 按启动方式选资产：`APPIMAGE` 环境变量存在时选 AppImage，否则选 deb。没有适合当前平台的资产时显示“这个版本没有适合当前平台的安装包”，不提供下载。

## 6. 安全

- 只查 `ALi365-SDN-BHD/BukitJalil` 的公开 Releases；不传 token。
- 资产和 `SHA256SUMS.txt` 只接受 HTTPS 的 GitHub 域名；下载后必须校验 SHA-256。**注意：校验值与资产来自同一个 Release，没有独立签名；这只防损坏，不防发布源被攻破。当前只在开发/测试阶段接受，见第 10 节。**
- 文件写到 `~/.bukitjalil/updates/<版本>/`（目录 0700，文件 0600），先写 `.part` 再改名。
- 主进程用 `realpath` 校验路径在 updates 目录内，拒绝符号链接和目录外的文件。
- 不做自动安装、不写替换 `.app` 的更新器、不允许降级。
- `BUKITJALIL_OFFLINE=1` 时不检查、不下载。

## 7. 代码位置

- `packages/shared/src/updates.ts`：状态和接口类型。
- `packages/server/src/updates/service.ts`：GitHub 查询、版本选择、下载、校验。
- `packages/server/src/api/updates.ts`：接口。
- `packages/server/src/desktop.ts`、`packages/desktop/src/server.ts`、`main.ts`：打开下载好的安装包。
- `packages/web/src/features/updates/UpdateButton.tsx`：左下角按钮和对话框。
- `.github/workflows/release.yml`：标签和 `package.json` 版本一致性检查。

## 8. 测试

- 单元：版本选择（beta / stable）、草稿过滤、平台资产选择、缺少校验值、下载校验、校验失败删除、离线。
- 手工验收：用 `BUKITJALIL_VERSION=0.1.0-beta.3` 启动，能发现 beta.4、下载 dmg、校验通过、打开 dmg。
- 以后有 Developer ID 时，再补 Squirrel.Mac 的自动安装验收。

## 9. 后续

有 Developer ID 后：

1. 用 Developer ID Application 签名，公证 dmg/zip。
2. 加 `electron-updater`，`autoDownload=false`，`autoInstallOnAppQuit=false`。
3. 下载完成后的“打开安装包”换成“安装并重启”；安装前检查 AI 会话、构建和发布任务。
4. 上传 `latest*.yml` 和 blockmap；按版本后缀区分 beta / stable。

在那之前，macOS 只能手动安装；这是平台限制，不是代码可以绕过的。

## 10. 风险记录：更新链没有独立签名（2026-11-16）

**决定**：目前属于开发/测试阶段，先记录这个风险，不阻塞当前实现。对外发布（正式用户、正式网站）前必须处理。

**风险**：

- 安装包和 `SHA256SUMS.txt` 来自同一个 GitHub Release。能改 Release 的人也能改校验值。
- 没有独立签名，没有代码签名（macOS 无 Developer ID，Windows 未签 Authenticode，Linux AppImage/deb 无系统签名）。
- GitHub 维护者账号、CI 的 `contents: write` token 或 Release 流程被攻破，就能让所有客户端下载并打开恶意安装包。
- 应用内下载的文件没有 macOS quarantine，也没有 Windows Mark-of-the-Web，可能绕过 Gatekeeper / SmartScreen 的用户提示。
- 下载完成后到点击“打开安装包”之间，本地文件被替换的话，当前不会再次校验。

**发布前必须选一个方案**：

1. **删掉应用内下载/打开**：更新按钮只做“检查 → 提示 → 打开 GitHub Release 页面”，让浏览器下载。最小、最安全，同时消掉打开失败、Windows 运行中安装、AppImage 不替换、`.part` 残留等问题。
2. **保留应用内下载，加独立签名**：离线私钥签 `latest.json`（版本、平台、架构、格式、文件名、大小、SHA-256），应用内置公钥，下载前验签，打开前再校验一次。私钥不进 GitHub Secrets/CI，由人在发布草稿检查后离线签名（选这个方案时，release workflow 要改回只留草稿：2026-11-20 起它直接发布）。

**同时要修**（审计记录）：打开安装包失败被报成成功、Windows 在应用运行时安装、Linux AppImage 没有真正替换、旧 `.part` 文件清理。Windows/Linux 目前也还没有实机安装验证。

在这些完成之前，不把更新器称为“安全”或“完整”，不对外承诺自动更新。

## 11. 除第 1 项外的修复（2026-11-16）

> 状态：2026-11-16 已实现；单元测试、类型检查、macOS 手动更新流程复查通过。Windows/Linux 实机安装仍未验证。

第 1 项（无独立签名）按第 10 节暂缓；其余审计项按最小改动修：

- **#2 打开失败**：桌面通道增加请求/响应；`shell.openPath` 的错误返回给服务端；界面只在成功后显示“已打开”。
- **#3 Windows**：在 Windows 支持前隐藏更新按钮；`openUpdate` 成功打开 exe 后退出应用。
- **#4 Linux AppImage**：有 `APPIMAGE` 时把新文件替换到运行中的 AppImage，设置执行权限并重启；deb 仍用包管理器。
- **#5 `.part`**：启动时清理 updates 目录里的 `*.part` 和没有完整安装包的空版本目录。
- **#6 beta 发布**：发布检查里写明 beta tag 必须是 GitHub prerelease，发布后核对。2026-11-16 已把现有的 `v0.1.0-beta.3`、`v0.1.0-beta.4` 标为 prerelease。
- **#7 版本绑定**：安装包文件名必须包含 Release 版本，否则不提供该资产。
- **#8 校验值错误**：404 报“没有校验值”，429/5xx/网络报“检查失败”。
- **#9 磁盘/权限**：`ENOSPC` 报磁盘满，`EACCES`/`EPERM` 报权限错误。
- **#10 旧版本**：只从 `available` 或带 release 的 `error` 开始下载，检查中不允许。
- **#11 格式**：共享资产增加 `format`（dmg/zip/exe/appimage/deb），界面不再按扩展名猜。
- **#12 测试**：增加打开失败、校验值 5xx、磁盘满、`.part` 清理、AppImage 替换的测试。
- **#13 Windows 按钮**：preload 暴露平台，Windows 不显示更新按钮。
- **#14 版本读取**：不再向文件系统根目录走，明确读仓库根或 `Resources/app/package.json`。
- **#15 精简**：`UPDATE_CACHE_MS` 不再导出；去掉 30 秒轮询，只在下载中轮询。
- **#16 复用安装包**：校验后写 `.sha256` 边车；再次下载直接比对边车，不重新哈希 166 MB。

**发布检查（beta）**：

1. 标签去掉 `v` 后等于根 `package.json` 版本（release workflow 已检查）。
2. 发布后运行 `gh release view <tag> --json isDraft,isPrerelease`：`isDraft` 必须是 `false`；带 `-` 的 tag 的 `isPrerelease` 必须是 `true`。
3. 如果是 `false`，在 GitHub 上编辑这个 Release，勾选 “Set as a pre-release” 后再让用户更新。
