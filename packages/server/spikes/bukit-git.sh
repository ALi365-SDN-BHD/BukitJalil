#!/usr/bin/env bash
# M1 spike: Bukit's own git calls and multi-language builds in a snapshot worktree.
# Usage: BUKIT=/path/to/bukit BUKIT_SRC=/path/to/Bukit/clone ./bukit-git.sh
set -uo pipefail

BUKIT=${BUKIT:?set BUKIT to the bukit binary}
BUKIT_SRC=${BUKIT_SRC:?set BUKIT_SRC to a Bukit source clone (for the i18n fixture)}
GIT=$(command -v git)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/bj-spike-XXXXXX")
SITE=$WORK/site
AI=$WORK/worktrees/ai
EMPTY=$WORK/empty-gitconfig
HOOKS=$WORK/empty-hooks
MARK=$WORK/markers
mkdir -p "$SITE" "$HOOKS" "$MARK" "$WORK/home" "$WORK/tmp"
: >"$EMPTY"

pass=0; fail=0
check() { # name, condition-exit-code
  if [ "$2" -eq 0 ]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; fail=$((fail+1)); fi
}

# Hardened git, as git/run.ts would call it.
hg() {
  env -i PATH="$PATH" HOME="$WORK/home" LANG=C \
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL="$EMPTY" GIT_TERMINAL_PROMPT=0 \
    "$GIT" -c core.fsmonitor=false -c core.hooksPath="$HOOKS" -c core.untrackedCache=false \
    -c core.attributesFile="$EMPTY" -c core.excludesFile="$EMPTY" -c protocol.allow=never \
    -c commit.gpgSign=false -c tag.gpgSign=false -c log.showSignature=false "$@"
}

# Same hardening passed to Bukit through the environment.
HARDEN_KEYS=(core.fsmonitor core.hooksPath core.untrackedCache core.attributesFile core.excludesFile protocol.allow commit.gpgSign tag.gpgSign log.showSignature)
HARDEN_VALS=(false "$HOOKS" false "$EMPTY" "$EMPTY" never false false false)
hardened_env() {
  local i
  echo "GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=$EMPTY GIT_TERMINAL_PROMPT=0 GIT_CONFIG_COUNT=${#HARDEN_KEYS[@]}"
  for i in "${!HARDEN_KEYS[@]}"; do
    echo "GIT_CONFIG_KEY_$i=${HARDEN_KEYS[$i]} GIT_CONFIG_VALUE_$i=${HARDEN_VALS[$i]}"
  done
}
bukit_hardened() { # cwd, args...
  local cwd=$1; shift
  # shellcheck disable=SC2046
  (cd "$cwd" && env -i PATH="$PATH" HOME="$WORK/home" LANG=C TMPDIR="$WORK/tmp/" $(hardened_env) "$BUKIT" "$@")
}
bukit_plain() { # cwd, args... (minimal env, no git hardening)
  local cwd=$1; shift
  (cd "$cwd" && env -i PATH="$PATH" HOME="$WORK/home" LANG=C TMPDIR="$WORK/tmp/" "$BUKIT" "$@")
}

echo "work dir: $WORK"
echo "bukit:    $("$BUKIT" version | head -1)"
echo "git:      $("$GIT" --version)"
echo

# --- create the site repo from the i18n fixture --------------------------------
(cd "$BUKIT_SRC" && "$GIT" archive "${FIXTURE_TAG:-v2.0.11}" tests/fixtures/i18n-site) | tar -x -C "$WORK"
cp -R "$WORK/tests/fixtures/i18n-site/." "$SITE/"
hg -C "$SITE" init -q -b main
printf '# BukitJalil begin\ndist/\n.bukit/\n.cache/\n.bukitjalil-build/\n# BukitJalil end\n' >>"$SITE/.git/info/exclude"
hg -C "$SITE" add -A
hg -C "$SITE" -c user.name=spike -c user.email=spike@local commit -q -m init
check "git init -b main gives refs/heads/main" "$([ "$(hg -C "$SITE" symbolic-ref HEAD)" = refs/heads/main ]; echo $?)"

# --- AI worktree, detached ------------------------------------------------------
MAIN_OID=$(hg -C "$SITE" rev-parse --verify --end-of-options refs/heads/main^{commit})
hg -C "$SITE" worktree add -q --detach "$AI" "$MAIN_OID"

# AI edits: change a page, add a new untracked file.
printf '\nEdited by AI.\n' >>"$AI/content/en/index.md"
printf -- '---\ntitle: FAQ\n---\n\nFAQ body.\n' >"$AI/content/en/faq.md"

# 1) Without a snapshot, a multi-language build should be refused (dirty tree).
out=$(bukit_hardened "$AI" build --config site.yaml --output .bukitjalil-build/b0 --no-clean 2>&1); rc=$?
echo "$out" | grep -q "i18n-worktree-dirty"; check "dirty i18n build is refused with i18n-worktree-dirty (rc=$rc)" $?

# 2) Snapshot: add -A, write-tree, commit-tree, update HEAD and the change ref.
hg -C "$AI" add -A
TREE=$(hg -C "$AI" write-tree)
SNAP=$(hg -C "$AI" -c author.name="BukitJalil AI" -c author.email=ai@bukitjalil.local \
  -c committer.name=spike -c committer.email=spike@local commit-tree "$TREE" -p "$MAIN_OID" -m snapshot)
hg -C "$AI" update-ref --no-deref HEAD "$SNAP"
hg -C "$SITE" update-ref refs/bukitjalil/changes/c1 "$SNAP"
check "worktree is clean after snapshot" "$([ -z "$(hg -C "$AI" status --porcelain)" ]; echo $?)"
check "author and committer differ" "$([ "$(hg -C "$SITE" log -1 --format='%an|%cn' "$SNAP")" = "BukitJalil AI|spike" ]; echo $?)"

out=$(bukit_hardened "$AI" build --config site.yaml --output .bukitjalil-build/b1 --no-clean --base-url /preview/s/b1/ 2>&1); rc=$?
[ $rc -eq 0 ]; check "i18n build succeeds after snapshot (rc=$rc)" $?
[ $rc -ne 0 ] && echo "$out" | tail -20
ls "$AI/.bukitjalil-build/b1" >/dev/null 2>&1; check "build output written to .bukitjalil-build/b1" $?
find "$AI/.bukitjalil-build/b1" -path '*faq*' | grep -q .; check "snapshot content (new faq page) is in the output" $?
check "worktree still clean after build" "$([ -z "$(hg -C "$AI" status --porcelain)" ]; echo $?)"

echo "  refs after build:";     hg -C "$SITE" for-each-ref --format='    %(refname)'
echo "  worktrees after build:"; hg -C "$SITE" worktree list --porcelain | grep '^worktree' | sed 's/^/    /'
echo "  Bukit temp dir after build:"; find "$WORK/tmp" -maxdepth 3 | sed 's/^/    /'

# 3) Does Bukit's own git honor repo-level fsmonitor / hooks without hardening?
cat >"$WORK/fsmon.sh" <<EOF
#!/bin/sh
echo ran >>"$MARK/fsmonitor"
exit 1
EOF
chmod +x "$WORK/fsmon.sh"
for h in post-checkout reference-transaction; do
  printf '#!/bin/sh\necho %s >>"%s/hook"\n' "$h" "$MARK" >"$SITE/.git/hooks/$h"; chmod +x "$SITE/.git/hooks/$h"
done
hg -C "$SITE" config core.fsmonitor "$WORK/fsmon.sh"

rm -f "$MARK"/*
bukit_plain "$AI" build --config site.yaml --output .bukitjalil-build/b2 --no-clean >/dev/null 2>&1; rc=$?
plain_fs=$([ -f "$MARK/fsmonitor" ] && echo yes || echo no)
plain_hk=$([ -f "$MARK/hook" ] && echo yes || echo no)
echo "  without env hardening: rc=$rc fsmonitor ran=$plain_fs hooks ran=$plain_hk"
check "control: Bukit's git runs repo fsmonitor/hooks without hardening" "$([ "$plain_fs" = yes ] || [ "$plain_hk" = yes ]; echo $?)"

rm -f "$MARK"/*
bukit_hardened "$AI" build --config site.yaml --output .bukitjalil-build/b3 --no-clean >/dev/null 2>&1; rc=$?
[ $rc -eq 0 ]; check "hardened i18n build still succeeds (rc=$rc)" $?
check "GIT_CONFIG_* env stops fsmonitor and hooks in Bukit's git" "$([ ! -e "$MARK/fsmonitor" ] && [ ! -e "$MARK/hook" ]; echo $?)"

echo
echo "passed: $pass  failed: $fail"
echo "(work dir kept for inspection: $WORK)"
[ $fail -eq 0 ]
