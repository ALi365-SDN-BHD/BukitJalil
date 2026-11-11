#!/usr/bin/env bash
# Build a blog starter site from the StarterTheme resources embedded in Bukit's CLI source,
# following Bukit Labs' `init --template blog` layout. Draft of templates/starter/ (M2).
# Usage: BUKIT_SRC=/path/to/Bukit/clone ./make-starter.sh <target-dir> [lang...]
#   no languages -> single zh-CN site; "zh-CN en" -> bilingual site (content/<lang>/...)
set -euo pipefail
BUKIT_SRC=${BUKIT_SRC:?set BUKIT_SRC}
TAG=${BUKIT_TAG:-v2.0.11}
OUT=${1:?target dir}; shift
LANGS=("$@")
RES=src/Bukit-Core/Bukit.Cli/Resources/StarterTheme
T=$OUT/themes/starter
mkdir -p "$T/assets" "$T/static" "$T/layouts/layouts" "$T/layouts/partials" "$T/layouts/pages"

res() { (cd "$BUKIT_SRC" && git show "$TAG:$RES/$1"); }
# Same placeholder syntax as Bukit Labs: {{-- bukit:name --}}
fill() { sed -e 's/{{--[[:space:]]*bukit:primary-color[[:space:]]*--}}/#0b5fff/g' \
             -e 's/{{--[[:space:]]*bukit:accent-color[[:space:]]*--}}/#0f7b6c/g' \
             -e 's/{{--[[:space:]]*bukit:brand[[:space:]]*--}}/starter/g'; }

res StyleCss.css             | fill >"$T/assets/style.css"
res BaseLayout.html          | fill >"$T/layouts/layouts/base.html"
res SeoPartial.html                 >"$T/layouts/partials/seo.html"
res HeaderPartial.html       | fill >"$T/layouts/partials/header.html"
res FooterPartial.html       | fill >"$T/layouts/partials/footer.html"
res ListCardPartial.html            >"$T/layouts/partials/list-card.html"
res PaginationNavPartial.html       >"$T/layouts/partials/pagination-nav.html"
res PageTemplate.html               >"$T/layouts/pages/page.html"
res PostTemplate.html               >"$T/layouts/pages/post.html"
res IndexTemplate.html              >"$T/layouts/pages/index.html"
res ListTemplate.html               >"$T/layouts/pages/list.html"
res PaginationTemplate.html         >"$T/layouts/pages/pagination.html"
res TaxonomyIndexTemplate.html      >"$T/layouts/pages/taxonomy-index.html"
res TaxonomyTermTemplate.html       >"$T/layouts/pages/taxonomy-term.html"
res SearchTemplate.html             >"$T/layouts/pages/search.html"
res TemplateCapabilities.yaml       >"$T/layouts/bukit.templates.yaml"
res ThemeYaml.yaml                  >"$T/theme.yaml"
# 1x1 GIF used as the default OG image
printf 'GIF89a\x01\x00\x01\x00\x80\x00\x00\x1f\x29\x37\xf8\xfa\xfc\x2c\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02\x44\x01\x00\x3b' >"$T/assets/og-default.gif"
printf 'User-agent: *\nAllow: /\n' >"$T/static/robots.txt"

write_content() { # dir lang
  local d=$1 l=$2
  mkdir -p "$d/posts" "$d/pages"
  cat >"$d/posts/welcome.md" <<EOF
---
collection: post
title: Welcome ($l)
slug: welcome
publishAt: "2026-01-01T00:00:00Z"
author: Bukit Team
summary: A first post you can replace with your own writing.
tags: [intro, bukit]
categories: [news]
---

# Welcome ($l)

See the [about page](../../../../pages/about/) and this image: ![logo](/assets/og-default.gif)
EOF
  cat >"$d/pages/about.md" <<EOF
---
collection: page
title: About ($l)
slug: about
summary: A short page about this site.
---

# About ($l)

Replace this page with your story.
EOF
}

if [ ${#LANGS[@]} -le 1 ]; then
  LANG_YAML="  language: ${LANGS[0]:-zh-CN}"
  write_content "$OUT/content" "${LANGS[0]:-zh-CN}"
else
  LANG_YAML="  languages:"
  for l in "${LANGS[@]}"; do LANG_YAML+=$'\n'"    - $l"; write_content "$OUT/content/$l" "$l"; done
  LANG_YAML+=$'\n'"  defaultLanguage: ${LANGS[0]}"
fi
mkdir -p "$OUT/data"
cat >"$OUT/data/features-10.md" <<'EOF'
---
type: features
title: Start writing
order: 10
enabled: true
desc: Draft posts in Markdown and publish them with clean archive, feed, and taxonomy pages.
---

EOF

cat >"$OUT/site.yaml" <<EOF
site:
  name: my-site
  title: My Blog
  baseUrl: /
  url: https://example.com
  seo:
    defaultImage: /assets/og-default.gif
$LANG_YAML
  timezone: Asia/Shanghai
  collections:
    post:
      permalink: /blog/{year}/{month}/{slug}/
      listRoute: /blog/
      pagination:
        enabled: true
        pageSize: 10
        urlPattern: page/:num/
      output:
        rss: true
        archive: true
    page:
      permalink: /pages/{slug}/
      listRoute: /pages/

content:
  sources:
    - type: markdown
      name: posts
      mode: content
      collection: post
      markdown:
        dir: content
    - type: markdown
      name: modules
      mode: data
      markdown:
        dir: data
        defaultType: module

build:
  output: dist
  clean: false

theme:
  name: starter
  layouts: layouts
  assets: assets
  static: static
  params:
    brand: My Blog
    footer_text: My Blog
    latest_heading: Latest posts

logging:
  level: info
EOF
echo "$OUT"
