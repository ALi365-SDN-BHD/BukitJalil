# M5 真实模型验收：专业服务公司双语官网

- 日期：2026-11-10
- 分支：`pi-harness-ui`
- 模型：Anthropic `claude-sonnet-5-5`，思考程度 medium（用户自己的 API Key，保存在应用的 `pi/auth.json`，验收过程中没有读取或输出）
- Bukit：2.0.12（osx-arm64 官方包），git 2.39.5，macOS arm64
- 应用：本机开发服务器（`pnpm start` 同一套代码），全新创建的网站

## 过程

1. **新建网站**：界面里新建"恒信专业服务"（简体中文），starter 模板提交为第一个版本并自动构建成功
2. **第一轮对话**（约 4 分钟）：一条消息说明公司信息、五个页面、中英双语（中文默认）、导航切换语言、网址、常见问题加 GEO
   - AI 先读 `multilingual`、`bukit-i18n`、`bukit-content`、`bukit-config`、`bukit-templating`、`bukit-geo`、`content-writing` 技能，再看 `site.yaml`、主题模板和现有页面
   - 修改 14 个文件：`site.yaml` 加 `languages` / `defaultLanguage`、`site.url`、组织信息和 GEO；中英文页面各 4 个（关于、服务、联系、常见问题），两个内容源分开；首页、导航模板改成按语言显示；示例文章设为草稿
   - 期间 `bukit_check` 5 次、`bukit_build` 9 次，按构建结果和 `seoGeo` 摘要调整（例如给页面加 `i18nKey`、处理重复 ID），最后检查通过、构建成功（14 页），写了改动说明
   - AI 用 `find` 搜工作副本以外的 `/Users/ali/mydev/Git/Github` 被闸门拒绝（"outside the site's working copy"）；`grep` 因为这个应用目录没装 ripgrep 而不可用，AI 改用 `find` / `read`
3. **审核和应用**：用户在审核卡片里看了说明和差异后应用。网站目录多一个提交，作者 BukitJalil AI、提交者是设置里的身份，带 `BukitJalil-Sessions` 说明；正式预览自动重新构建
4. **检查预览**（Playwright + 本机 Chrome）：中英文首页排版正常、导航和服务卡片都对，见 [`m5/zh-home.png`](m5/zh-home.png)、[`m5/en-home.png`](m5/en-home.png)。发现三个内容问题：英文页的 `<title>` 和页脚仍是中文；语言切换链接用 `page.seo.alternates[].href`，有 `site.url` 后是 `https://hengxin.example.com/...`，在预览里一点就离开预览
5. **第二轮对话**（约 2 分钟）：把三个问题告诉 AI。AI 改 `base.html`、`footer.html`、`header.html` 三个文件，检查和构建通过。在"改动中"预览里核对：根地址进中文首页，点 English 到 `/en-US/about/`、点中文回到 `/zh-CN/about/`，英文页标题和页脚是英文，见 [`m5/en-about-change.png`](m5/en-about-change.png)。应用后正式预览同样正确

整个对话：35 条模型回复，输出约 2 万 token，工具调用 87 次（edit 33、read 18、write 11、bukit_build 9、bukit_check 5、bukit_schema 3 等）。

## 结论

真实模型能在 BukitJalil 里从零完成一个双语官网：只改工作副本、每轮都检查和构建、写清改动说明，经用户审核后应用；越界的读取被拒绝。验收通过。

## 验收中发现并修复的 BukitJalil 问题

| 问题 | 原因 | 修复 |
| --- | --- | --- |
| 多语言网站的预览一片空白 | Bukit 2.0.12 多语言构建只输出 `/zh-CN/`、`/en-US/`，根目录没有 `index.html`，预览端口的 `/` 返回空的 404 | 构建成功时，如果输出根目录没有首页，就按 `site.defaultLanguage`（没有则 `site.language`，再没有则第一个有首页的目录）记下入口，写进构建报告的 `entry`；预览端口收到 `/` 时 302 到这个入口 |
| 版本历史里的提交标题是一整段话 | 改动说明原样作为提交说明，真实模型写成一段几百字、没有换行 | `summarize_changes` 要求先写不超过 72 个字符的标题行；应用时第一行仍然过长就取第一句话（最多 72 个字符）作标题，完整说明放在正文 |
| AI 的语言切换链接在预览里跳到正式网址 | 技能没有说明 `alternates` 在设置 `site.url` 后是绝对地址 | `multilingual` 技能补充：切换链接用站内路径；标题、品牌、导航和页脚也要跟随页面语言 |

## 记录但没有处理的问题

- **24 条"缺少路由"警告**（`publish.sitemap_missing_route`、`publish.rss_missing_route`、`publish.search_missing_route` 各 8 条）：多语言网站默认 `sitemapMode: split`，每种语言输出自己的 `sitemap.xml`、`rss.xml`、`search.json`，里面都有这些页面，根目录没有合并的版本。Bukit 的发布审计看的似乎是根目录，所以报缺少。属于 Bukit 的审计口径，可以设 `site.sitemapMode: merged` 试，留到 M6 发布审计时再定
- **8 条 `publish.time_missing`**：starter 主题的页面模板没有可见的 `<time datetime>` 元素（M4 第 7 层已记录）
- **内置浏览器里预览没有样式**：Claude 桌面应用的内置浏览器拦下了预览端口的样式表请求（`ERR_BLOCKED_BY_CLIENT`），本机 Chrome 正常，不是 BukitJalil 的问题
- AI 不能自己打开预览，两轮都在说明里请用户核对效果，符合设计
