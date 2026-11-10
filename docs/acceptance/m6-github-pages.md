# M6 真实发布验收：发布到 GitHub Pages

- 日期：2026-11-11
- 分支：`pi-harness-ui`（发布时的代码到 13d7b55）
- 目标仓库：[`3721-my/3721-my.github.io`](https://github.com/3721-my/3721-my.github.io)，分支 `gh-pages`，用户站点
- 网站：M5 验收做的双语网站"恒信专业服务"（中文默认 zh-CN，英文 en-US）
- Bukit：2.0.12（osx-arm64 官方包），git 2.39.5，macOS arm64
- 应用：本机开发服务器（`pnpm start` 同一套代码）
- GitHub token：用户自己在设置里填写，验收过程中没有读取或输出；发布记录里只出现变量名 `BUKIT_DEPLOY_TOKEN`

## 过程

1. **设置发布目标**：在网站 `site.yaml` 加 `deploy`（`provider: github-pages`、`repo: 3721-my/3721-my.github.io`、`branch: gh-pages`），作为一个新版本提交到 main。这次用的开发服务器接的是假模型，所以这一步直接用 git 提交，没有走 AI 审核。网站页的"发布"一栏随即显示仓库、分支和网站地址 `https://3721-my.github.io/`
2. **填 token**：用户在设置里填 GitHub token。设置窗口在矮窗口里滑不到底，当场修复（见下文"发现的问题"）
3. **前三次发布：推送被拒**（403，`Permission to 3721-my/3721-my.github.io.git denied to ClrsDream`）。检查、doctor、构建、发布审计都通过，只有推送失败。界面显示"失败 · 推送"，报告里有 GitHub 的原因和 Bukit 的提示（token 需要 Contents 读写）。原因是 token 属于另一个账号 ClrsDream，对这个仓库没有写权限。用户调整权限后第四次推送成功
4. **第四次发布：成功，但网站地址 404**。`gh-pages` 分支上只有 `zh-CN/`、`en-US/`、`.nojekyll`、`llms.txt` 等，根目录没有 `index.html`。当场修复后重新发布
5. **第五次发布：成功**（`dep_cfc00da7d49be2bf`，约 4.7 秒）
   - 六步全部通过：安全检查 45 ms、配置检查 26 ms、doctor 58 ms、构建 533 ms、发布审计 13 ms、推送 4.0 s
   - 发布审计：12 个页面，0 个错误，32 个警告（多语言网站的 sitemap / RSS / 搜索"缺少路由"警告，见 M6 第 5 层说明）
   - `gh-pages` 分支上的提交是 `e37d07e`（"bukit deploy"），在上一次的 `783c410` 之上；分支里有 `.nojekyll` 和根目录跳转页，没有 `.bukit/`
   - 提交的作者和提交者都是设置里的身份。这个开发环境设的是测试身份 `Test Owner <owner@example.com>`，所以公开仓库里的两个提交署这个名字
6. **线上检查**：用户在仓库的 Settings → Pages 里选了 `gh-pages` 分支，大约一分钟后网站可以访问
   - `https://3721-my.github.io/` 返回跳转页，转到 `zh-CN/`，中文首页正常，见 [`m6/live-zh.png`](m6/live-zh.png)
   - `https://3721-my.github.io/en-US/about/` 英文页标题和页脚都是英文，见 [`m6/live-en-about.png`](m6/live-en-about.png)
   - 导航和语言切换用的是站内相对地址（`/en-US/`、`/zh-CN/about/`），在 GitHub Pages 上都能点
   - 界面的发布记录见 [`m6/publish-section.jpg`](m6/publish-section.jpg)

7. **改 `site.url` 后再发布**：`site.url` 和组织信息里的地址从占位的 `https://hengxin.example.com` 改成 `https://3721-my.github.io`，提交为新版本 `6b7973c` 后发布（`dep_dbf1810f34e6075e`，成功，审计 0 个错误）。`gh-pages` 新提交 `89a64a2`。线上 canonical 和 hreflang 都是 `https://3721-my.github.io/...`，页面里不再出现 example.com

## 发现的问题和处理

| 问题 | 原因 | 处理 |
| --- | --- | --- |
| 多语言网站发布后网站地址 404 | Bukit 2.0.12 多语言构建只输出 `/<lang>/`，根目录没有首页（M5 时预览用 302 处理过，发布没有） | 发布审计之后、推送之前，如果输出根目录没有首页，按和预览相同的规则写一个跳转页（`noindex`，`meta refresh` 到相对地址 `<lang>/`）。Bukit 自己生成了根首页时不动（13d7b55） |
| 设置窗口在矮窗口里滑不到底 | 弹框外框限制最大高度，并且把超出的部分藏起来 | 弹框外框改成可以滚动，设置表单在标题下滚动（3732c20） |
| token 没有目标仓库的写权限 | fine-grained token 只能访问自己账号下的仓库，ClrsDream 的 token 推不到 3721-my 的仓库 | 程序行为正确：推送失败时界面显示原因。使用说明里已经写了"在拥有仓库的账号下建 token，Contents 读写" |

## 遗留

- Bukit 推送后提示"publication not verified"，它只负责推送。GitHub Pages 是否打开、多久生效，要用户在 GitHub 上看，使用说明里已有说明
