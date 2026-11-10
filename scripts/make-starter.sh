#!/usr/bin/env bash
# Regenerate templates/starter/ (plan 5.2) from the StarterTheme resources embedded in Bukit's CLI source.
# Bukit has no "new site" command; its starter theme only exists as CLI resources (MIT).
# Run again when Bukit is upgraded, then build the result with the real Bukit (see templates/README.md).
#
# Usage: BUKIT_SRC=/path/to/Bukit/clone [BUKIT_TAG=v2.0.12] scripts/make-starter.sh
set -euo pipefail
BUKIT_SRC=${BUKIT_SRC:?set BUKIT_SRC to a clone of github.com/ALi365-SDN-BHD/Bukit}
TAG=${BUKIT_TAG:-v2.0.12}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=$ROOT/templates/starter
RES=src/Bukit-Core/Bukit.Cli/Resources/StarterTheme

src_git() { git -C "$BUKIT_SRC" -c core.fsmonitor=false -c core.hooksPath=/dev/null "$@"; }
COMMIT=$(src_git rev-parse --verify "$TAG^{commit}")
res() { src_git show "$COMMIT:$RES/$1"; }
# Fill the {{-- bukit:name --}} placeholders the way Bukit Labs does.
fill() { sed -e 's/{{--[[:space:]]*bukit:primary-color[[:space:]]*--}}/#0b5fff/g' \
             -e 's/{{--[[:space:]]*bukit:accent-color[[:space:]]*--}}/#0f7b6c/g' \
             -e 's/{{--[[:space:]]*bukit:brand[[:space:]]*--}}//g'; }
# Site settings are plain text: escape them like <title> does, so "Tom & Jerry" or "<3" renders as written.
escape() { sed -E 's/\{\{ (site\.title|site\.params\.[a-z_]+) \}\}/{{ \1 | html.escape }}/g'; }

rm -rf "$OUT"
T=$OUT/themes/starter
mkdir -p "$T/assets" "$T/static" "$T/layouts/layouts" "$T/layouts/partials" "$T/layouts/pages"

res StyleCss.css             | fill >"$T/assets/style.css"
res BaseLayout.html          | fill | escape >"$T/layouts/layouts/base.html"
res SeoPartial.html                 >"$T/layouts/partials/seo.html"
res HeaderPartial.html       | fill | escape >"$T/layouts/partials/header.html"
res FooterPartial.html       | fill | escape >"$T/layouts/partials/footer.html"
res ListCardPartial.html            >"$T/layouts/partials/list-card.html"
res PaginationNavPartial.html       >"$T/layouts/partials/pagination-nav.html"
res PageTemplate.html               >"$T/layouts/pages/page.html"
res PostTemplate.html               >"$T/layouts/pages/post.html"
res IndexTemplate.html       | escape >"$T/layouts/pages/index.html"
res ListTemplate.html               >"$T/layouts/pages/list.html"
res PaginationTemplate.html         >"$T/layouts/pages/pagination.html"
res TaxonomyIndexTemplate.html      >"$T/layouts/pages/taxonomy-index.html"
res TaxonomyTermTemplate.html       >"$T/layouts/pages/taxonomy-term.html"
res SearchTemplate.html             >"$T/layouts/pages/search.html"
res TemplateCapabilities.yaml       >"$T/layouts/bukit.templates.yaml"
res ThemeYaml.yaml                  >"$T/theme.yaml"
src_git show "$COMMIT:LICENSE"      >"$T/LICENSE"
# Plain 1200x630 PNG in the primary color as the default social image (the size previews expect)
python3 -I -c '
import struct, sys, zlib
w, h, rgb = 1200, 630, bytes((0x0b, 0x5f, 0xff))
row = b"\0" + rgb * w
def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
sys.stdout.buffer.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
  + chunk(b"IDAT", zlib.compress(row * h, 9)) + chunk(b"IEND", b""))
' >"$T/assets/og-default.png"
printf 'User-agent: *\nAllow: /\n' >"$T/static/robots.txt"

mkdir -p "$OUT/content/posts" "$OUT/content/pages" "$OUT/data"
cat >"$OUT/content/posts/welcome.md" <<'EOF'
---
collection: post
title: Welcome
slug: welcome
publishAt: "2026-01-01T00:00:00Z"
updatedAt: "2026-01-01T00:00:00Z"
summary: A first post you can replace with your own writing.
tags: [intro]
categories: [news]
---

# Welcome

This site was created by BukitJalil. Ask the assistant to change anything: the layout, the colors,
this post, or the [about page](../../../../pages/about/).
EOF
cat >"$OUT/content/pages/about.md" <<'EOF'
---
collection: page
title: About
slug: about
updatedAt: "2026-01-01T00:00:00Z"
summary: A short page about this site.
---

# About

Replace this page with your story.
EOF
cat >"$OUT/data/features-10.md" <<'EOF'
---
type: features
title: Start writing
order: 10
enabled: true
desc: Draft posts in Markdown and publish them with clean archive, feed, and taxonomy pages.
---

EOF

# site.name, site.title, site.language and theme.params.brand / footer_text are replaced on creation.
# site.url is left out on purpose: Bukit then warns that absolute SEO URLs need it, instead of every
# site silently pointing canonical links and feeds at a placeholder domain.
cat >"$OUT/site.yaml" <<'EOF'
site:
  name: my-site
  title: My Site
  baseUrl: /
  seo:
    defaultImage: /assets/og-default.png
  language: en-US
  timezone: UTC
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
        dir: content/posts
    - type: markdown
      name: pages
      mode: content
      collection: page
      markdown:
        dir: content/pages
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
    brand: My Site
    footer_text: My Site
    latest_heading: Latest posts

logging:
  level: info
EOF
printf 'dist/\n.bukit/\n.cache/\n' >"$OUT/.gitignore"

# Source record plus a SHA-256 per generated file; a test fails when the template is edited by hand.
python3 -I - "$OUT" "$ROOT/templates/starter.source.json" "$TAG" "$COMMIT" "$RES" <<'PY'
import hashlib, json, os, sys
out, dest, tag, commit, res = sys.argv[1:]
files = {}
for dirpath, dirnames, filenames in os.walk(out):
    for name in filenames:
        full = os.path.join(dirpath, name)
        rel = os.path.relpath(full, out).replace(os.sep, "/")
        with open(full, "rb") as f:
            files[rel] = hashlib.sha256(f.read()).hexdigest()
record = {"repository": "https://github.com/ALi365-SDN-BHD/Bukit", "tag": tag, "commit": commit,
          "path": res, "license": "MIT", "files": dict(sorted(files.items()))}
with open(dest, "w") as f:
    json.dump(record, f, indent=2)
    f.write("\n")
PY
echo "templates/starter from Bukit $TAG ($COMMIT)"
