# 素材上传验收

- 日期：2026-11-16
- 分支：`feat/media-upload`
- 设计：[docs/plans/2026-11-12-media-upload-design.md](../plans/2026-11-12-media-upload-design.md) v4.1
- 自动化提交：`6432dd4`（Bukit 行为测试）、`227d946`（服务端）、`3a5f9ca`（符号链接路径修复）、`710fddc`（AI 一侧）、`a3f1940`（界面）

## 自动验收（已完成）

在 macOS（Apple 芯片）上运行：

| 检查 | 结果 |
| --- | --- |
| `BUKIT_BIN="$PWD/vendor/bukit-2.2.3/bukit" pnpm vitest run packages/server/test/bukit-behavior.test.ts` | 9 passed |
| `pnpm vitest run packages/server/test/media.test.ts` | 23 passed |
| `pnpm vitest run packages/server/test/site-tools.test.ts` | 21 passed，1 skipped（平台相关） |
| `pnpm vitest run` | 616 passed，17 skipped |
| `pnpm vitest run packages/web` | 21 passed |
| `pnpm exec playwright test e2e/media.spec.ts` | 15 passed（Chromium、Firefox、WebKit） |
| `pnpm e2e:desktop` | 10 passed；桌面版用内置真实 Bukit 完成拖放上传和改动面板预览 |
| `pnpm check` | 通过（只有已有的 lint warning） |
| `pnpm build` | 通过 |

覆盖的流程：

- 内置 Bukit 2.2.3 的静态目录复制、子路径正文/模板写法、多语言根目录和语言目录复制。
- 5 种格式上传；SVG、HTML、改扩展名、空文件、超过 10 MiB、非法 base64 被拒绝。
- 文件名整理、`theme.static` 的缺失/`static`/`Static`/`static/`/自定义值/空字符串、主题目录和符号链接检查、`.gitignore` 和 `.env*` 受保护路径。
- 重名 409、替换、只差大小写的替换、快照失败回滚、新建改动集失败时关闭、只读/忙碌/锁。
- JPEG EXIF/XMP 位置检测；不修改上传字节；扩展 XMP 和非 JPEG 不检测。
- 只有上传的改动集应用后作者是用户，说明来自 `diffSummary`；拒绝后网站文件夹没有文件。
- `site_info.media` 的 URL、MIME、`viewable`、跳过隐藏文件/符号链接/子目录。
- 界面：上传、重名替换、SVG 拒绝、位置提示、子路径 `/blog/uploads/...` 引用、对话运行时禁用上传。
- 桌面版：真实拖放事件上传、队列完成、改动面板图片预览，使用应用内置的 Bukit 2.2.3。
- 请求体 14 MiB 上限和 13.3 MiB 请求接收。

## 未完成的手动验收

桌面版的拖放上传和改动面板预览已经由 `pnpm e2e:desktop` 自动覆盖，使用的是应用内置的真实 Bukit。下面两项仍需要人工或发布环境：

1. 在桌面版里让 AI 把 Logo 放到页头，并人工看一次页面效果（脚本模型只覆盖在页面里引用图片，不覆盖页头布局）。
2. 用一个 `site.baseUrl` 为 `/<仓库名>/` 的网站发布到真实的 GitHub Pages 测试仓库，确认发布后的页面能加载图片；构建输出里的 `/repo/uploads/...` 已由真实 Bukit 行为测试覆盖，缺的是托管环境这一跳。

自动化 e2e 里的网页测试使用项目里的 Bukit 替身和真实浏览器界面；真实 Bukit 2.2.3 的静态目录、子路径和多语言行为由 `bukit-behavior.test.ts` 覆盖。真实 GitHub Pages 测试仓库需要外部账号和 token，不在本次自动化环境中。

## 结论

服务端、AI 一侧、界面和自动验收已完成；上面两项手动验收保留为发布前的环境检查。
