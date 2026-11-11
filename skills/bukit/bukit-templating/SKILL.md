---
name: bukit-templating
description: Use for Scriban templates, page/list models, layout directives, and render failures.
---

> **In BukitJalil:** you cannot run commands. Use the `bukit_check` tool for `bukit config check`
> and `bukit doctor`, `bukit_build` for `bukit build`, and `bukit_schema` for `bukit config schema`.
> Previews, the dev server, cleaning, audits, deploys, plugins and Labs are handled by BukitJalil;
> do not try them. Also read the `site-editing` skill.

# Bukit Templating

Templates use Scriban. Core model objects are `site`, `page`, `pages`, `items`,
`pagination`, `collection`, `taxonomy`, and `filter`.

`SiteModel`, `PageInfo`, and `ListPageModel` are the source of truth. Layout
directives are parsed before rendering and `{{ content }}` receives child body
content.

Named data sources remain available as arrays under `site.data.<source>`.
Sources configured with `dataIndex` additionally expose scalar values through
`site.data_index.<source>.<scope>.<key>`.

The resolved layouts directory can declare capabilities in
`bukit.templates.yaml`. Manifest decisions use a current content fingerprint;
root/include/layout static analysis is scoped to the next resolver/build call.
Do not recommend deleting `.cache` as the normal way to make template changes
visible, and do not promise instantaneous watcher delivery.
