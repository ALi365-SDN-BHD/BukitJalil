---
name: bukit-debug
description: Use for focused Bukit troubleshooting, metrics, reports, and small validation loops.
---

> **In BukitJalil:** you cannot run commands. Use the `bukit_check` tool for `bukit config check`
> and `bukit doctor`, `bukit_build` for `bukit build`, and `bukit_schema` for `bukit config schema`.
> Previews, the dev server, cleaning, audits, deploys, plugins and Labs are handled by BukitJalil;
> do not try them. Also read the `site-editing` skill.

# Bukit Debug

Start with the smallest failing command: `config check`, `doctor`, `build`,
then audit commands. Use `--metrics` for build timing and `.bukit` reports for
route, SEO, publish, and security evidence.

Common reliability diagnostics:

| Symptom | Check |
|---|---|
| Clean is refused | Use a dedicated project output; do not manufacture a marker for unrelated files. |
| Build fails before commit | Formal output and managed caches are preserved; fix the cause and retry. Do not recommend deleting the last successful build. |
| Commit rollback fails | Preserve the reported backup paths for manual recovery. A backup-cleanup warning after successful commit does not undo the new output. |
| `BuildAssetOutputCollision` | Find duplicate or file/descendant destinations across routes, static, assets, media, and generated tokens; case-only differences collide on case-insensitive volumes. |
| Symlinked files are absent | Default publication scanners skip directory links; `followSymlinks` is limited to supported copy paths. |
| Template decision looks stale | Confirm the file is under resolved layouts and run the next build; manifest/root/include/layout decisions are content-sensitive. |
| Search content is truncated | Inspect `site.search.maxContentLength`; only record `content` is capped. |
| Media host rate-limits | Lower `content.media.maxConcurrency`; it limits active localization downloads, not render jobs. |
| Build report differs from audit reports | Build counts are build log events; SEO/publish/security issue totals are separate. `generatedFiles` contains public output only. |

Bare `clean` selects `dist` without reading `site.yaml`. Use `clean --config
site.yaml` for the configured output; successful cleanup also deletes `.cache`
and `.bukit` under the selected root. Build transactions coordinate target
exchanges, not a multi-directory atomic rename or crash recovery. In BukitJalil,
cleaning and recovery are handled for you.
