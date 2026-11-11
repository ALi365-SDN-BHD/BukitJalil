#!/usr/bin/env bash
# M1 spike: fixed ai/ and main/ worktrees, reset + clean between change sets, and config scopes.
# Usage: ./git-worktrees.sh
set -uo pipefail
GIT=$(command -v git)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/bj-wt-XXXXXX")
SITE=$WORK/site; AI=$WORK/worktrees/ai; MAIN=$WORK/worktrees/main
EMPTY=$WORK/empty; HOOKS=$WORK/hooks
mkdir -p "$SITE" "$HOOKS"; : >"$EMPTY"
pass=0; fail=0
check() { if [ "$2" -eq 0 ]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; fail=$((fail+1)); fi; }
hg() {
  env -i PATH=/usr/bin:/bin HOME="$WORK" LANG=C GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL="$EMPTY" GIT_TERMINAL_PROMPT=0 \
    "$GIT" -c core.fsmonitor=false -c core.hooksPath="$HOOKS" -c core.untrackedCache=false \
    -c core.attributesFile="$EMPTY" -c core.excludesFile="$EMPTY" -c protocol.allow=never \
    -c commit.gpgSign=false -c tag.gpgSign=false -c log.showSignature=false \
    -c user.name=spike -c user.email=spike@local "$@"
}

hg -C "$SITE" init -q -b main
printf '# BukitJalil begin\ndist/\n.bukit/\n.cache/\n.bukitjalil-build/\n# BukitJalil end\n' >>"$SITE/.git/info/exclude"
echo "v1" >"$SITE/index.md"; printf 'secret.local\n' >"$SITE/.gitignore"
hg -C "$SITE" add -A && hg -C "$SITE" commit -q -m v1
M1=$(hg -C "$SITE" rev-parse --verify --end-of-options refs/heads/main^{commit})

hg -C "$SITE" worktree add -q --detach "$AI" "$M1"
hg -C "$SITE" worktree add -q --detach "$MAIN" "$M1"
check "two detached worktrees (ai/, main/) on the same commit" "$([ "$(hg -C "$AI" rev-parse HEAD)" = "$M1" ] && [ "$(hg -C "$MAIN" rev-parse HEAD)" = "$M1" ]; echo $?)"
check "no branches created by worktrees" "$([ "$(hg -C "$SITE" for-each-ref --format='%(refname)' refs/heads)" = refs/heads/main ]; echo $?)"

# exclude block applies inside the worktrees
mkdir -p "$AI/.bukitjalil-build/x" "$AI/.bukit" "$AI/.cache"; echo o >"$AI/.bukitjalil-build/x/i.html"; echo c >"$AI/.cache/c"
check "info/exclude block applies in ai/ (status clean with build/cache dirs)" "$([ -z "$(hg -C "$AI" status --porcelain)" ]; echo $?)"

# AI work in a change set: edit, new file, an ignored file it hid via .gitignore
echo "v2" >"$AI/index.md"; echo new >"$AI/new.md"; echo hidden >"$AI/hidden.txt"; printf 'secret.local\nhidden.txt\n' >"$AI/.gitignore"
hg -C "$AI" add -A; T=$(hg -C "$AI" write-tree); S=$(hg -C "$AI" commit-tree "$T" -p "$M1" -m snap); hg -C "$AI" update-ref --no-deref HEAD "$S"
check "snapshot excludes the file AI hid via .gitignore" "$(hg -C "$SITE" ls-tree -r --name-only "$S" | grep -qx hidden.txt; [ $? -ne 0 ]; echo $?)"

# Next change set: reset to main and clean everything except the caches
hg -C "$AI" reset -q --hard "$M1"
hg -C "$AI" clean -q -fdx -e .bukit -e .cache
check "reset+clean removes new, hidden and build files" "$([ ! -e "$AI/new.md" ] && [ ! -e "$AI/hidden.txt" ] && [ ! -e "$AI/.bukitjalil-build" ]; echo $?)"
check "reset+clean keeps .bukit/ and .cache/" "$([ -e "$AI/.cache/c" ] && [ -d "$AI/.bukit" ]; echo $?)"
check "ai/ back at main content" "$([ "$(cat "$AI/index.md")" = v1 ] && [ -z "$(hg -C "$AI" status --porcelain)" ]; echo $?)"

# main/ worktree follows a new main commit
echo "v1.1" >"$SITE/index.md"; hg -C "$SITE" commit -q -am v1.1
M2=$(hg -C "$SITE" rev-parse --verify --end-of-options refs/heads/main^{commit})
hg -C "$MAIN" reset -q --hard "$M2" && hg -C "$MAIN" clean -q -fdx -e .bukit -e .cache
check "main/ reset to the new main commit" "$([ "$(cat "$MAIN/index.md")" = v1.1 ]; echo $?)"

# config scopes: worktree-level config is visible with --show-scope, not with --local
hg -C "$SITE" config extensions.worktreeConfig true
hg -C "$SITE" config --worktree core.fsmonitor "/tmp/evil"
scoped=$(hg -C "$SITE" config --list --show-scope --includes)
local_only=$(hg -C "$SITE" config --local --list)
check "--show-scope lists the worktree-scope key" "$(echo "$scoped" | grep -q $'^worktree\tcore.fsmonitor=/tmp/evil'; echo $?)"
check "--local --list does not show it (why --local is not enough)" "$(echo "$local_only" | grep -q 'core.fsmonitor'; [ $? -ne 0 ]; echo $?)"
# include.path pulls in another file, also visible with --includes
printf '[core]\n\tsshCommand = /tmp/evil\n' >"$WORK/inc.cfg"
hg -C "$SITE" config include.path "$WORK/inc.cfg"
check "--includes shows keys from include.path files" "$(hg -C "$SITE" config --list --show-scope --includes | grep -q 'core.sshcommand=/tmp/evil'; echo $?)"

hg -C "$SITE" worktree remove --force "$AI"; hg -C "$SITE" worktree remove --force "$MAIN"; hg -C "$SITE" worktree prune
check "worktree remove + prune leaves only the main worktree" "$([ "$(hg -C "$SITE" worktree list --porcelain | grep -c '^worktree')" = 1 ]; echo $?)"

echo; echo "passed: $pass  failed: $fail  (work dir: $WORK)"
[ $fail -eq 0 ]
