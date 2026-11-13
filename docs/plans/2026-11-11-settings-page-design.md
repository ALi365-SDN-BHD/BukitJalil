# 设置页改版设计

> 日期：2026-11-11 · 状态：已实现（2026-11-11） · 范围：仅前端界面与交互，不改服务端 API 和设置存储

## 1. 背景

当前设置是一个模态框 `SettingsDialog`：

- 入口在顶栏右侧的齿轮按钮，另外首页引导和网站主页的发布区也会打开它。
- 顶栏同时放有界面语言、外观（主题）两个下拉框，以及快捷键入口。
- 应用没有账号体系，只有“提交身份”（`commitName` / `commitEmail`）；应用版本由 `GET /api/health` 返回（桌面版发布时注入，开发环境为 `0.0.0`）。

这次改版参考 OpenCode Desktop 和 Claude Desktop 的设置界面，把设置从弹窗改成独立页面，并整理入口位置。

## 2. 目标与范围

### 2.1 目标

1. 设置改为独立页面，左侧分类导航、右侧内容，支持直接访问和深链接。
2. 界面语言和主题从顶栏移入设置页。
3. 设置入口移到左侧网站栏左下角，显示版本号、齿轮和“设置”。

### 2.2 不在本次范围

- 账号、套餐、头像下拉菜单（参考截图里的“老板 · Max”和箭头）。当前没有账号体系，不新增。
- 快捷键列表迁移到设置页；仍由顶栏按钮和 `?` 键打开现有弹窗。
- 服务端 API、设置字段、数据库结构。
- 每个网站独立设置、设置项分组折叠。

## 3. 页面与路由

### 3.1 路由

```
/settings                 默认打开“通用”
/settings?section=general
/settings?section=model
/settings?section=identity
/settings?section=environment
/settings?section=github
```

- 新增顶层路由 `/settings`，渲染整页设置，不保留主界面的网站三栏和会话区。
- 未知的 `section` 值回落到 `general`。
- 左侧导航切换使用 `replace` 更新查询参数，避免每个分类都进浏览器历史。
- 右上角关闭按钮：优先回到进入设置前的应用内页面（链接通过 `state.from` 传入），直接打开或没有来源时回 `/`。

### 3.2 桌面布局

```
┌ 设置 ────────────────────────────────────── ✕ ┐
│ 搜索…                │ 通用                    │
│                      │ 界面语言      [中文 ▾]  │
│ 偏好                 │ ────────────────────── │
│   通用               │ 外观       [ ▣  ☀  ☾ ]  │
│   AI 模型            │                        │
│   提交身份           │                        │
│ 此电脑               │                        │
│   环境               │                        │
│   GitHub 发布        │                        │
└────────────────────────────────────────────────┘
```

- 整体是一个内嵌的圆角面板，桌面端四周留出背景；顶部左侧标题“设置”，右上角关闭按钮。
- 左侧导航固定宽度（约 16rem）：顶部搜索框，下面按“偏好 / 此电脑”分组；右侧内容区独立滚动。
- 右侧内容按“分区标题 + 行”排列，每行左侧是名称和说明，右侧是下拉框、输入框或按钮，行与行之间用细分隔线。
- 内容区最大宽度约 `max-w-3xl`，左右留白，避免宽屏下表单拉得过长。
- 分类顺序固定：通用、AI 模型、提交身份、环境、GitHub 发布。

### 3.3 窄屏布局

- 断点沿用主界面的 `md`（768px）。
- 面板铺满屏幕，导航改为标题下方的纵向列表（搜索框 + 分组 + 分类），内容区在下方单列滚动。
- 不产生整页横向溢出。

### 3.4 分类内容

| 分类 | 内容 | 保存方式 |
| --- | --- | --- |
| 通用 | 界面语言、外观（跟随系统/浅色/深色） | 即时保存 |
| AI 模型 | 现有 `ModelSection`：服务商、模型、思考程度、API Key、测试连接 | 即时保存（现状） |
| 发布 | 提交身份；GitHub token；后续发布平台加在这里 | 身份用“保存”；token 即时保存 |
| 数据源 | Notion token；后续数据源平台加在这里 | 即时保存 |
| 环境 | Bukit 已安装/最新版本、安装/更新、Bukit 安装路径；ripgrep 已安装/最新版本、安装/更新 | Bukit 路径用“保存”；安装即时（现状） |

说明：

- 现在身份和自定义 Bukit 路径共用一个表单和一个保存按钮；拆成两个分类后各自独立保存，只提交本分类字段。
- “环境”里的 Bukit 路径保存成功后仍需失效 `keys.bukit` 查询，行为和现在一致。
- API Key、GitHub token 仍然只显示末四位，不回显完整值。

## 4. 需求明细

### 4.1 设置改为独立页面

- 删除 `SettingsDialog` 的模态框展示，保留并复用其内部的设置分区组件。
- 页面自身负责加载设置、显示加载/错误状态。
- 模型、身份、环境、token 的原有测试标识保持不变：
  - `model-section`、`model-current`、`model-provider`、`model-id`、`model-test`、`model-use`
  - `bukit-section`、`bukit-state`、`bukit-install`
  - `rg-section`、`rg-state`、`rg-install`
  - `github-token-section`、`github-token-status`、`github-token-input`、`github-token-remove`
  - `commit-name`、`commit-email`、`bukit-path`
- “通用”内的语言选择器保留 `locale-select`；外观改为图标分段控件，测试标识为 `appearance-system` / `appearance-light` / `appearance-dark`，用 `aria-pressed` 表示当前选择。

### 4.2 语言和主题移入设置页

- 顶栏删除：地球图标、语言下拉、太阳/月亮图标、外观下拉。
- 顶栏保留：应用名、当前网站名称与构建状态、git 健康状态、连接状态、快捷键按钮。
- “通用”内修改语言或外观后立即生效并写入设置；不再需要点保存。
- 外观用“跟随系统 / 浅色 / 深色”的图标分段控件，和参考界面的主题切换一致。
- 保存失败时，在“通用”区域内显示错误（沿用 `m.settings.saveFailed`），不回写界面选择。
- 外观切换仍先立即上色，保存失败再恢复原值，保持现在的体验。
- 删除顶栏的 `save-error` 提示，避免错误离开设置页后无处可看。

### 4.3 设置入口移到左下角

左侧网站栏底部新增固定 footer，网站列表滚动时保持可见：

```
┌─────────────────────────┐
│ 网站列表（可滚动）       │
├─────────────────────────┤
│ BukitJalil v0.1.0  ⚙ 设置│
└─────────────────────────┘
```

- 左侧显示 `BukitJalil` 和应用版本；`/api/health` 返回 `0.0.0` 或空时不显示版本号。
- 右侧是齿轮 + “设置”按钮，点击进入 `/settings`。
- 按钮保留 `data-testid="open-settings"`，方便现有 e2e 继续定位。
- 窄屏下网站栏作为一个标签页时，footer 同样保留。
- 进入设置时通过 `state.from` 记录来源，供右上角关闭按钮使用。

## 5. 入口跳转

| 位置 | 现在 | 改后 |
| --- | --- | --- |
| 左下角 footer | — | `/settings`（默认通用） |
| 首页引导 · Bukit | 打开设置弹窗 | `/settings?section=environment` |
| 首页引导 · 提交身份 | 打开设置弹窗 | `/settings?section=identity` |
| 首页引导 · AI 模型 | 打开设置弹窗 | `/settings?section=model` |
| 网站主页 · 发布区“打开设置” | 打开设置弹窗 | `/settings?section=github` |

- `SetupGuide` 和 `DeploySection` 改为自行用 `useNavigate` 跳转，不再通过 `onOpenSettings` 一层层传回调。
- `Welcome`、`SiteHome` 中只用于传设置回调的 prop 一并删除。

## 6. 代码影响

| 文件 | 改动 |
| --- | --- |
| `packages/web/src/App.tsx` | 设置查询、语言、主题、`I18nProvider` 提到顶层；新增 `/settings` 路由；顶栏删除语言/外观/设置按钮和保存错误 |
| `packages/web/src/features/settings/SettingsDialog.tsx` | 删除，改为 `SettingsPage.tsx`：内嵌面板、标题/关闭按钮、搜索、分组导航、深链接 |
| `packages/web/src/features/settings/SettingsLayout.tsx` | 新增 `SettingsSection` / `SettingsRow`，统一“分区标题 + 行”的布局 |
| `packages/web/src/features/settings/useOpenSettings.ts` | 新增设置入口跳转和分类参数校验，记录来源供关闭按钮返回 |
| `packages/web/src/features/settings/` | 新增“通用”“提交身份”“环境”分区；`ModelSection`、`GitHubTokenSection` 改为行式布局 |
| `packages/web/src/features/sites/SiteList.tsx` | 底部 footer：版本、齿轮、设置入口 |
| `packages/web/src/features/sites/SetupGuide.tsx` | 按钮改为按分类跳转 |
| `packages/web/src/features/deploys/DeploySection.tsx` | “打开设置”跳到 GitHub 分类 |
| `packages/web/src/i18n/zh-CN.ts`、`en.ts` | 增加分类名称、分组、搜索、当前模型等文案 |
| `e2e/*.spec.ts` | 适配页面化后的交互和选择器位置 |
| `docs/user-guide.md` | “顶栏右侧齿轮”改为“左下角设置” |

不需要改动的部分：`packages/server`、`packages/shared`、设置 API、数据库迁移。

## 7. 测试与验收

### 7.1 手工验收

1. 直接打开 `/settings`、`/settings?section=model` 均能正确渲染；刷新不丢失分类。
2. 设置页没有主界面三栏；右上角关闭按钮回到进入前的页面，直接打开时回首页。
3. 在“通用”切换语言和主题立即生效；刷新后保持；断网或保存失败时显示错误，界面选择不错误地保留。
4. 顶栏不再出现语言、主题和齿轮。
5. 左下角 footer 在长网站列表滚动时固定可见；版本号正确，开发环境不显示 `0.0.0`。
6. 身份、Bukit 路径分别保存且互不影响；Bukit/ripgrep 安装、模型测试连接、API Key、GitHub token 行为不变。
7. 首页引导和发布区按钮跳到正确的分类。
8. 窄屏（375px）下导航纵向排列，内容区可滚动，页面无横向溢出。
9. 左侧搜索框按名称过滤分类；没有匹配时显示提示。

### 7.2 自动化测试调整

| 文件 | 调整 |
| --- | --- |
| `e2e/app.spec.ts` | 语言切换、保存失败：先进入 `/settings`，再操作 `locale-select` |
| `e2e/layout.spec.ts` | 外观切换改为点击 `appearance-dark` / `appearance-light` / `appearance-system`，用 `aria-pressed` 断言；原先用 `locale-select` 验证“表单内不触发 Alt+数字”，改为在页面内注入一个临时输入框验证 |
| `e2e/sites.spec.ts` | 设置断言改为 URL `/settings` 和页面可见；Escape 不再关闭设置，点 `settings-close` 返回主界面后再操作新建网站 |
| `e2e/models.spec.ts` | 打开设置后操作模型；点 `settings-close` 回到网站页再开始对话 |
| `e2e/setup.spec.ts` | “打开设置”断言从 `role=dialog` 改为 URL 和对应分类 |
| `e2e/deploy.spec.ts` | 发布区“打开设置”跳到 `?section=github`，关闭后回到网站页；未配置时不显示打开设置的断言仍保留 |

验证命令：

```sh
pnpm typecheck
pnpm check
pnpm e2e            # 或只跑受影响的 spec
```

## 8. 已确认的决策

- 左下角显示：版本号 + 齿轮 + “设置”，不做头像和账号菜单。
- 设置分类：5 组——通用 / AI 模型 / 提交身份 / 环境 / GitHub 发布。
- 布局参考 Claude Desktop：内嵌圆角面板、右上角关闭、左侧搜索和分组导航、右侧“标题 + 行”的内容，行与行用分隔线。
- 主题使用“跟随系统 / 浅色 / 深色”的图标分段控件；语言使用右侧下拉框。
- 语言、主题保持即时保存；身份和环境路径保留显式保存。
- 不迁移快捷键入口，不新增服务端能力。

## 9. 风险与注意

- `I18nProvider` 上移后，设置页和主界面必须共享同一份设置查询缓存，否则在设置页切换语言不会立即生效。
- 设置页是独立路由，登录失效时仍要显示 `errors["auth.required"]`，不能变成空白页。
- 设置分类切换会更新查询参数；必须把 `location.state` 一起传给导航，否则来源信息丢失，关闭按钮会回到首页而不是来源页。
- 版本号来源是服务端注入的 `BUKITJALIL_VERSION`；开发和测试环境为 `0.0.0`，显示逻辑必须处理该值，避免界面出现 `v0.0.0`。

## 10. 实现结果（2026-11-11）

已按本文实现：

- `pnpm check`：通过（仅剩两条原有的服务端 lint 警告）。
- `pnpm test`：36 个测试文件、468 个测试通过，9 个跳过。
- e2e：Chromium 全量 40 个通过；Firefox 和 WebKit 的受影响 66 个测试通过。
- 桌面端：macOS arm64 打包为 0.1.0，安装到 `/Applications/BukitJalil.app`；`pnpm e2e:desktop` 7 个测试通过。安装后的应用实测 footer 显示 `BukitJalil v0.1.0`，发布/数据源/环境设置、Notion token、版本检查、Bukit 路径、模型 OAuth 入口和本地部署入口均正常。
- 手工检查了桌面端、窄屏、深色模式和搜索过滤的界面截图。

## 11. 后续需求（2026-11-11）

- 设置分类调整为：**通用 / AI 模型 / 发布 / 数据源 / 环境**。
  - “发布”合并提交身份和发布账号；发布账号可以保存多个 GitHub token，网站部署时选择其中一个。
  - “数据源”：Markdown 和 Notion 改为可保存的数据源；Markdown 是默认平台，可多选；每个 Notion 数据源有自己的 token，一个网站最多选一个 Notion 数据源。
  - 左侧导航分组：偏好（通用、AI 模型）、集成（发布、数据源）、此电脑（环境）。
- Bukit 显示已安装版本和最新版本；设置页打开时自动从 GitHub 获取 latest release，缓存 10 分钟；右上角“检查全部更新”可强制刷新。未安装或有新版本时显示下载按钮。
- 获取失败时回退到内置的 2.0.15 校验和；安装成功后会删除旧的 `bukit-<version>` 目录。
- “自定义 Bukit 路径”改名为 **“Bukit 安装路径”**，放在 Bukit 这一行内；留空表示使用应用安装的或 PATH 里的 Bukit。
- ripgrep 同样显示已安装/最新版本，未安装或校验不一致时显示下载按钮。
- 旧的全局 Notion token 和 `BUKITJALIL_NOTION_TOKEN` 不再使用；Notion token 按数据源保存在 `data-source-tokens.json`（权限 600），接口只返回是否已配置和末四位。
- 新建网站时列出 Markdown 数据源（默认全选）和 Notion 数据源（最多一个）；选中 Notion 后调用 Notion API 列出该 token 可访问的数据库，再选一个写入 `site.yaml`。用户必须先在 Notion 中把数据库共享给对应的 integration。
- 数据源有名称和 id；id 仅存在于应用数据库和列表里，不写入 `site.yaml`（Bukit 会拒绝未知字段）。

## 12. AI 模型页面与 OAuth 账号登录（2026-11-11）

- AI 模型改成 Trae 风格的两步布局：
  - 服务商卡片网格（两列），显示平台品牌 logo、模型数量、是否已配置凭据；当前模型所在服务商高亮。未知平台使用通用图标，不再用首字母。
  - 点击服务商进入添加/编辑表单：账号、模型、思考程度、上下文窗口（只读）、API Key（适用时）、“测试连接”和“使用这个模型”。
- 保留 API Key 配置，同时接入 Pi 原生 OAuth 登录：
  - 支持 Anthropic Claude Pro/Max、GitHub Copilot、Kimi For Coding、OpenRouter、xAI、Radius、OpenAI Codex（ChatGPT）等 Pi 提供了 `auth.oauth` 的服务商。
  - 有 OAuth 的服务商显示“使用 ... 登录”，无需 API Key；浏览器授权、设备代码和手动授权码都由设置页提示。
  - 登录成功后显示已登录状态，可退出登录；Pi 把凭据写入 `~/.bukitjalil/pi/auth.json`，界面不显示凭据。
  - OpenAI ChatGPT 登录使用保存在 Pi 目录的稳定安装 ID（`device-id`，权限 600）。
- 服务端新增登录 API：启动、轮询、提交提示、取消、退出；登录任务 10 分钟超时，完成后保留 5 分钟供页面读取。
- 新增“本地部署与自定义后端”：
  - 预设 Ollama（11434）、LM Studio（1234）、vLLM（8000）、llama.cpp（8080）和自定义。
  - API 格式支持 OpenAI Completions、OpenAI Responses 和 Anthropic Messages。
  - 可配置请求地址、服务商名称、模型 ID、显示名称、API Key（可选）、上下文窗口、最大输出和是否支持思考程度。
  - 配置保存在 `~/.bukitjalil/pi/custom-models.json`（权限 600），启动时和保存后注册进 Pi 运行时；在服务商网格中出现，可编辑和删除。
  - API Key 只保存在本机，接口只返回是否已配置，不返回密钥。
- 未包含 Trae 的 temperature、工具调用轮数等采样高级项；自动联网刷新 Pi 内置模型目录也尚未开启，新增内置模型仍需升级 Pi 依赖并重新打包应用。

## 13. 环境页 Pi 版本与更新检查（2026-11-11）

- 环境页新增 Pi 一行：显示应用内置的 Pi 版本（`pi-coding-agent` 的 `VERSION`）和 npm 上最新版本。
- 新增 `GET /api/pi`：打开设置页时自动检查，结果缓存 10 分钟；“检查全部更新”按钮同时刷新 Bukit、ripgrep、Pi 和 Git。
- 离线（`BUKITJALIL_OFFLINE=1`）或网络失败时，最新版本显示“未知”，不影响内置 Pi 的使用。
- Pi 是随应用打包的依赖，不能在运行时安全替换：有更新时显示“下载新版本”，链接到 BukitJalil 的最新发布页，由用户更新整个应用；不修改应用签名或 Pi 源码。
- Pi 依赖锁定为 1.5.2（`@earendil-works/pi-ai` 和 `pi-coding-agent` 均为 1.5.2）。

## 14. 数据源（2026-11-11）

- Markdown 是内置默认数据源：新建网站不选数据源时直接使用 starter 的 Markdown 内容源，并创建 `content/posts`、`content/pages`、`data` 下的示例文件。
- 设置 → 数据源保存可选的 Notion 数据源：
  - 每个数据源有名称和 id，名称不区分大小写唯一；token 保存在 `~/.bukitjalil/data-source-tokens.json`（权限 600），接口只返回是否配置和末四位。
  - 一个 Notion 数据源可以供多个网站使用；每个网站最多选择一个 Notion 数据源。
- 新建网站时选择 Notion 数据源后，服务端调用 Notion API 列出该 token 能访问的数据库；可以勾选多个，每个选择用途（文章 / 页面 / 数据），分别写成 `content.sources[]` 里的 notion 源。用户必须先在 Notion 中把数据库共享给 integration。
- 应用数据库新增 `data_sources` 表；`sites` 记录创建时使用的 Notion 数据源 id，供正式构建取 token。导入的 Notion 网站没有这条记录时，如果只有一个 Notion 数据源就临时使用它。
- 旧的全局 Notion token、设置页的 Notion token 表单和 `BUKITJALIL_NOTION_TOKEN` 环境变量移除。

## 15. 发布账号与网站部署设置（2026-11-12）

- GitHub token 从全局设置改为可保存的“发布账号”：
  - 平台目前只有 GitHub；每个账号有名称和 id，名称不区分大小写唯一。
  - 每个账号保存自己的 token（`~/.bukitjalil/publish-account-tokens.json`，权限 600），接口只返回是否配置和末四位；一个账号可以供多个网站使用。
  - 设置 → 发布 → 发布账号可以添加、编辑、删除；仍被网站使用的账号不能删除。
- 网站发布区新增“部署设置”对话框：
  - 选择发布账号，填写仓库（`owner/name`）、分支（默认 `gh-pages`）、可选自定义域名。
  - 保存时服务端用 GitHub API 检查 token 对目标仓库是否有 Contents 写权限（离线模式跳过检查），然后把 `deploy` 段、`site.url`、`site.baseUrl` 写入 `site.yaml` 并提交到默认分支。
  - 每个网站记录所选账号 id；发布开始时再次检查仓库权限，并用该账号的 token 推送到目标仓库。
- 旧的全局 GitHub token、设置页的 token 表单、`secrets.json` 读取和 `BUKITJALIL_GITHUB_TOKEN` 环境变量移除；`secrets.json` 文件保留但不读取。
- 测试覆盖账号增删改、token 不泄露、名称去重、仓库权限检查、网站占用阻止删除、部署设置写入 site.yaml、脏工作区和非法配置拒绝，以及发布时使用所选账号。

## 16. Git 安装与更新（2026-11-12）

- 环境页的 Git 行从只读版本改为可安装/更新：
  - `GET /api/git` 返回已安装版本、Git 官方最新版本、来源、状态和是否可安装/更新；`?refresh=1` 强制刷新最新版本（缓存 10 分钟）。
  - 没有找到本地或全局 Git 时显示“安装 Git”；有新版时显示“更新到 x.y.z”；已是最新或离线未知时显示对应状态。每行有刷新按钮，环境页顶部的“检查全部更新”也会同时刷新 Git。
  - macOS/Linux 有 Homebrew 时通过 `brew install git` / `brew upgrade git` 安装或更新，不需要管理员权限；Windows 从 Git for Windows 官方发布页下载 MinGit。都有确认对话框，后台运行并轮询进度。
  - 成功后服务端重新解析 Git 路径并切换运行中的 GitRunner，不需要重启；手动安装到其他路径后仍建议重启。
  - 没有 Homebrew 时按当前平台检测包管理器（macOS 的 Xcode、Linux 的 apt/dnf/pacman/zypper/apk、Windows 的 winget/Chocolatey）并显示对应命令，支持复制；没有检测到时提示手动安装。
  - Bukit 和 ripgrep 继续按平台表判断可安装性；没有官方包的平台显示自行安装提示，不显示下载按钮。
- Git 最新版本从官方发布目录（kernel.org）读取；Windows 的自动安装从 Git for Windows 官方 releases 下载 MinGit，校验 SHA-256 后解压到应用数据目录；macOS/Linux 使用 Homebrew，其他系统包管理器只显示命令。
- `resolveGitPath` 优先使用 Homebrew 的 Git；Windows 还会查找应用数据目录下的 Git，`GitRunner.usePath` 支持运行时切换。
- Bukit 增加 Windows x64 的官方 zip 安装包，使用严格的 ZIP 读取和文件白名单安装。
- 测试覆盖状态（缺失、损坏、过旧、最新、离线）、最新版本缓存、brew 安装成功/失败、无 Homebrew 拒绝安装，以及 API 返回；真实 brew 安装没有在测试中执行。

## 17. 网站行的操作菜单（2026-11-12）

- “归档 / 取消归档”和“移除”从网站主页的操作按钮移到左侧网站行右侧的“更多”下拉菜单。
- 网站主页只保留构建和重新检查；下拉菜单中的移除仍先显示确认对话框，说明只删除应用工作副本和记录、不删除网站文件夹。
- 下拉菜单使用 Radix DropdownMenu；选中的网站背景覆盖整行（包括菜单按钮），会话列表仍显示在网站行下方。

## 18. 会话自动命名与左侧会话菜单（2026-11-12）

- 第一条用户消息会自动生成会话标题（去掉 Markdown 标记、截断到 40 个字符）；没有模型调用，手动重命名优先。
- 手动重命名和删除都移到左侧会话行的“…”下拉菜单；对话顶部的工具栏移除，会话标题和状态只在左侧显示。
- 会话行高度增大（`text-sm`、更大的上下内边距）；网站项目行进一步增大字号（`text-base`）和高度。
- 下拉菜单使用 `text-xs` 和 3.5 号图标，比选项栏文字更小；菜单最小宽度收窄。
- 自动标题在消息被接受时写入，即使这次发送随后因未配置模型而失败，也能在列表里识别会话。

## 19. 新建网站的多语言选项（2026-11-12）

- 新建网站对话框增加“多语言网站”复选框；默认语言仍是单选项。
- 勾选后创建网站时同时创建一个会话：有可用模型时自动发送引导消息，让 AI 先询问除默认语言外还需要哪些语言；没有模型或发送失败时把同样的引导消息放进输入框，用户发送后再继续。
- 引导消息要求 AI 先不要改文件，等用户回答语言后再更新 `site.languages`、`defaultLanguage` 和各语言内容，沿用现有的多语言 skill 和审核流程。

## 20. 待审核改动面板折叠（2026-11-12）

- `ReviewCard` 标题行右侧增加折叠按钮；折叠后只保留“待审核的改动 · 改了 N 个文件”和“查看差异”，隐藏改动说明、文件列表、应用/拒绝按钮和提示。
- 折叠只影响审核卡片自身高度，会话消息和输入框继续可用；再次点击展开恢复完整内容。
- e2e 覆盖折叠后摘要行仍可见、详细内容和操作隐藏、输入框可用，以及展开后内容恢复。

## 21. 新建网站时多选 Notion 数据库（2026-11-12）

- Notion 数据源下面的数据库列表改为复选框；勾选后每个数据库旁选择用途：文章（`collection: post`）、页面（`collection: page`）或数据（`mode: data`）。
- 每个勾选的数据库生成一个 `content.sources[]` notion 源；源名取数据库标题里的 ASCII 部分并去重（例如“菜单 Menu” → `menu`），没有 ASCII 时用 `notion`、`notion_2`（2026-11-13 起用下划线，名称以字母开头，符合 Bukit 对源名称的要求）。
- 创建请求用 `notionDatabases: [{ databaseId, title, use }]` 代替单个 `notionDatabaseId`；服务端仍然只允许选择一个已保存的 Notion 数据源（token 来源）。
- 至少勾选一个数据库才能创建；之前自动选中第一个数据库的行为移除，由用户明确选择。
