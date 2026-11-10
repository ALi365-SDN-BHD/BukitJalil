---
name: bukit-theme
description: Use for local filesystem themes, theme.yaml, components, sections, assets, static files, SCSS, and image optimization.
---

> **In BukitJalil:** you cannot run commands. Use the `bukit_check` tool for `bukit config check`
> and `bukit doctor`, `bukit_build` for `bukit build`, and `bukit_schema` for `bukit config schema`.
> Previews, the dev server, cleaning, audits, deploys, plugins and Labs are handled by BukitJalil;
> do not try them. Also read the `site-editing` skill.

# Bukit Theme

Core themes are local filesystem themes. `theme.name` resolves
`themes/<name>/layouts`, `assets`, and `static` by default.

`theme.yaml` is validated strictly. Theme runtime covers manifests, components,
sections, tokens, SCSS, image variants, assets, and static files.
