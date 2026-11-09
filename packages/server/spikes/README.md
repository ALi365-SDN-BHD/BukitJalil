# M1 技术验证脚本

开发方案第 14 节 M1 的验证脚本，不属于应用代码。结论写在 [开发方案](../../../docs/development-plan.md) 的 6.6、8.2 和 M1 小节。

| 脚本 | 验证内容 | 运行 |
| --- | --- | --- |
| `bukit-git.sh` | 快照式工作副本里的多语言构建；Bukit 启动的 git 是否遵守 `GIT_CONFIG_*` 加固 | `BUKIT=<bukit 路径> BUKIT_SRC=<Bukit 源码仓库> ./bukit-git.sh` |
| `bukit-exit-codes.sh` | 各命令在各类错误下的实际退出码；Notion 源没有 token 时的行为 | 同上 |
| `pi-gate.mjs` | 在 Pi 工具的 `operations` 里实现路径闸门；`tools` 白名单与自定义工具 | `npm install && node pi-gate.mjs` |

- `BUKIT_SRC` 用来取 Bukit 标签里的 `tests/fixtures/i18n-site` 作为测试网站，默认 `v2.0.11`，可用 `FIXTURE_TAG` 改
- 脚本都在 `$TMPDIR` 下新建临时目录，不改动本仓库，结束后保留临时目录方便检查
- Pi SDK 固定为 1.5.0（`package.json`）；这里暂时用 npm，正式工程在 M0 改为 pnpm workspace
