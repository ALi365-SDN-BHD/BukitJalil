---
name: multilingual
description: Adding or keeping multiple languages on a Bukit site in BukitJalil - site.languages, matching content per language, and checks before building.
---

# Multilingual sites

Read `bukit-i18n` and `bukit-config` first; ask `bukit_schema` for the `site`
section to see the exact language fields of this Bukit version.

## Rules

- Languages are set in `site.languages` with `site.defaultLanguage`. Use the
  language codes the site already uses (for example `en-US`, `ms-MY`,
  `zh-CN`).
- Before adding content, look at how this site already separates languages
  (folders, sources or front matter) with `site_info` and `list_content`, and
  follow the same pattern for every language.
- Every page in the default language should exist in each other language with
  the same slug or the same translation key the site uses, so language links
  and sitemaps line up.
- Translate meaning, not word by word. Keep names, addresses, prices and
  product names as the user wrote them; ask when unsure.
- Each language is built under its own folder (for example `/zh-CN/`,
  `/en-US/`). Language switch links must be site paths such as
  `/en-US/about/`, not `page.seo.alternates[].href`: with `site.url` set those
  are absolute addresses and leave BukitJalil's preview. Take the path part of
  the alternate address, or build it from the language and the page's slug.
- Localize the shared parts too: the page title in `<title>`, the brand, the
  navigation and the footer text should follow the page's language.
- Do not machine-translate legal text (terms, privacy policy); add the page
  and ask the user to provide or approve the text.

## Checking

Multilingual builds use the committed state of the working copy, which
`bukit_check` and `bukit_build` take care of. Run both after adding a language
and fix every reported missing or mismatched page. Mention any language that is
still incomplete in `summarize_changes`.
