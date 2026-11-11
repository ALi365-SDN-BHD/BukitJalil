---
name: bukit-i18n
description: Use for Bukit language variants, default language behavior, per-language outputs, and merged indexes.
---

> **In BukitJalil:** you cannot run commands. Use the `bukit_check` tool for `bukit config check`
> and `bukit doctor`, `bukit_build` for `bukit build`, and `bukit_schema` for `bukit config schema`.
> Previews, the dev server, cleaning, audits, deploys, plugins and Labs are handled by BukitJalil;
> do not try them. Also read the `site-editing` skill.

# Bukit i18n

Set `site.languages` and `site.defaultLanguage` for multi-language builds.
Each language variant builds independently, then root outputs are merged
according to sitemap, feed, and search modes.
