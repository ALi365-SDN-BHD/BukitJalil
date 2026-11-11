---
name: using-bukit
description: Gateway skill for stable Bukit Core tasks; route to narrower Core skills.
---

> **In BukitJalil:** you cannot run commands. Use the `bukit_check` tool for `bukit config check`
> and `bukit doctor`, `bukit_build` for `bukit build`, and `bukit_schema` for `bukit config schema`.
> Previews, the dev server, cleaning, audits, deploys, plugins and Labs are handled by BukitJalil;
> do not try them. Also read the `site-editing` skill.

# Using Bukit Core

Use this gateway when the task is about Bukit Core. Load only the narrow skill
needed for the surface:

- CLI commands: `bukit-cli-reference`.
- `site.yaml`: `bukit-config`.
- content sources: `bukit-content`.
- routes and lists: `bukit-routing`.
- templates: `bukit-templating`.
- local themes: `bukit-theme`.
- language variants: `bukit-i18n`.
- SEO or GEO: `bukit-seo` or `bukit-geo`.
- troubleshooting: `bukit-debug`.

Stable Core commands are `build`, `doctor`, `config`, `preview`, `dev`,
`clean`, `version`, `completion`, `seo`, `geo`, `publish`, and `deploy`.
