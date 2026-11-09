#!/usr/bin/env bash
# M1 spike: actual Bukit exit codes per command and error class, plus Notion without a token.
# Usage: BUKIT=/path/to/bukit BUKIT_SRC=/path/to/Bukit/clone ./bukit-exit-codes.sh
set -uo pipefail
BUKIT=${BUKIT:?set BUKIT}
BUKIT_SRC=${BUKIT_SRC:?set BUKIT_SRC}
WORK=$(mktemp -d "${TMPDIR:-/tmp}/bj-exit-XXXXXX")
mkdir -p "$WORK/home" "$WORK/tmp"

# Single-language copy of the i18n fixture, so builds don't need git.
make_site() { # name
  local d=$WORK/$1
  mkdir -p "$d"
  (cd "$BUKIT_SRC" && git archive "${FIXTURE_TAG:-v2.0.11}" tests/fixtures/i18n-site) | tar -x -C "$d"
  mv "$d/tests/fixtures/i18n-site/"* "$d/" && rm -rf "$d/tests"
  rm -rf "$d/content/zh"; mv "$d/content/en/"* "$d/content/" && rmdir "$d/content/en"
  python3 - "$d/site.yaml" <<'EOF'
import sys,re
p=sys.argv[1]; s=open(p).read()
s=s.replace("  languages:\n    - en\n    - zh-CN\n  defaultLanguage: en\n","")
s=s.replace("  sitemapMode: merged\n  search:\n    mode: merged\n","")
open(p,'w').write(s)
EOF
  echo "$d"
}
bk() { (cd "$1" && shift && env -i PATH="$PATH" HOME="$WORK/home" LANG=C TMPDIR="$WORK/tmp/" "$BUKIT" "$@" 2>&1); }

run_all() { # label dir
  local label=$1 dir=$2 rc_c rc_d rc_b out_c out_d out_b
  out_c=$(bk "$dir" config check --config site.yaml); rc_c=$?
  out_d=$(bk "$dir" doctor --config site.yaml); rc_d=$?
  out_b=$(bk "$dir" build --config site.yaml --output .bukitjalil-build/x --no-clean); rc_b=$?
  printf '%-28s check=%s doctor=%s build=%s\n' "$label" "$rc_c" "$rc_d" "$rc_b"
  if [ -n "${VERBOSE:-}" ] || [ "$label" != ok ]; then
    printf '    check : %s\n    doctor: %s\n    build : %s\n' \
      "$(echo "$out_c" | grep -iE 'error|✖|fail|required' | head -1)" \
      "$(echo "$out_d" | grep -iE 'error|✖|fail|required' | head -1)" \
      "$(echo "$out_b" | grep -iE 'error|✖|fail|required' | head -1)"
  fi
}

echo "bukit: $("$BUKIT" version | head -1)"; echo

ok=$(make_site ok);                run_all ok "$ok"

cfg=$(make_site config-unknown-field)
printf 'unknownTopLevel: 1\n' >>"$cfg/site.yaml";            run_all "config: unknown field" "$cfg"

yml=$(make_site config-bad-yaml)
printf 'site: [unclosed\n' >"$yml/site.yaml";               run_all "config: invalid YAML" "$yml"

cnt=$(make_site content-bad-frontmatter)
printf -- '---\ntitle: [broken\n---\nbody\n' >"$cnt/content/bad.md"; run_all "content: bad frontmatter" "$cnt"

tpl=$(make_site render-bad-template)
printf '{{ if }}\n' >"$tpl/layouts/pages/page.html";        run_all "render: bad template" "$tpl"

tpl2=$(make_site render-missing-template)
rm "$tpl2/layouts/pages/page.html";                          run_all "render: missing template" "$tpl2"

nt=$(make_site notion-no-token)
python3 - "$nt/site.yaml" <<'EOF'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("content:\n  sources:\n","content:\n  sources:\n    - type: notion\n      name: blog\n      collection: page\n      notion:\n        databaseId: 00000000000000000000000000000000\n        cacheMode: readonly\n")
open(p,'w').write(s)
EOF
run_all "notion (readonly cache), no token" "$nt"

echo; echo "work dir: $WORK"
