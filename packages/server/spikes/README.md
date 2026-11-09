# M1 技术验证脚本

开发方案第 14 节 M1 的验证脚本，不属于应用代码。结论写在 [开发方案](../../../docs/development-plan.md) 的 6.6、7.2、7.3、8.2、8.4、8.5 和 M1 小节。

| 脚本 | 验证内容 | 运行 |
| --- | --- | --- |
| `bukit-git.sh` | 快照式工作副本里的多语言构建；Bukit 启动的 git 是否遵守 `GIT_CONFIG_*` 加固 | `BUKIT=<bukit 路径> BUKIT_SRC=<Bukit 源码仓库> ./bukit-git.sh` |
| `bukit-exit-codes.sh` | 各命令在各类错误下的实际退出码；Notion 源没有 token 时的行为 | 同上 |
| `pi-gate.mjs` | 在 Pi 工具的 `operations` 里实现路径闸门；`tools` 白名单与自定义工具 | `npm install && node pi-gate.mjs` |
| `pi-session.mjs` | 用 Pi 的 faux 假模型跑完整会话：不联网、技能、`tool_call` 阻止、顺序执行、事件字段、会话文件和分叉 | `npm install && node pi-session.mjs` |
| `pi-session-reset.mjs` | 工作副本重置后继续用同一个会话：旧内容的 `edit` 失败、重新读后能改、从文件重新打开 | `npm install && node pi-session-reset.mjs` |
| `git-worktrees.sh` | ai/、main/ 两个分离 HEAD 工作树的创建、重置、清理；排除规则；`--show-scope --includes` | `./git-worktrees.sh` |
| `make-starter.sh` | 从 Bukit 内嵌的 StarterTheme 生成 starter 博客网站（M2 模板的草稿） | `BUKIT_SRC=<Bukit 源码仓库> ./make-starter.sh <目录> [语言…]` |
| `check-base-url.py` | 列出构建输出里不在 `--base-url` 前缀下的根路径链接 | `python3 check-base-url.py <输出目录> <前缀>` |
| `bukit-safety.py` | 外部插件、路径字段、符号链接、`sass` 等外部程序、内网图片下载 | `BUKIT=<bukit 路径> BUKIT_SRC=<Bukit 源码仓库> python3 bukit-safety.py`（需要能监听本机端口） |
| `preview-isolation.mjs` | 预览端口的 CSP 沙箱、Host 校验和管理端防跨站规则 | `node preview-isolation.mjs`，浏览器打开 `http://127.0.0.1:47881/evil.html`，再看 `http://127.0.0.1:47880/api/state` |
| `preview-isolation-browsers.mjs` | 用 Playwright 在 Chromium、Firefox、WebKit 里跑上面的测试页：预览嵌在管理界面里、`<img>` 是否带 Cookie、预览能否嵌入管理界面 | `npm install && PLAYWRIGHT_BROWSERS_PATH=<目录> npx playwright install chromium firefox webkit`，再 `PLAYWRIGHT_BROWSERS_PATH=<目录> node preview-isolation-browsers.mjs` |

- `BUKIT_SRC` 用来取 Bukit 标签里的 `tests/fixtures/i18n-site` 作为测试网站，默认 `v2.0.11`，可用 `FIXTURE_TAG` 改
- 脚本都在 `$TMPDIR` 下新建临时目录，不改动本仓库，结束后保留临时目录方便检查
- Pi SDK 固定为 1.5.0、Playwright 固定为 1.65.0（`package.json`，和开发方案第 2 节一致）；三种浏览器解压后约 1.2 GB，建议用 `PLAYWRIGHT_BROWSERS_PATH` 放到临时目录；这里暂时用 npm，正式工程在 M0 改为 pnpm workspace
