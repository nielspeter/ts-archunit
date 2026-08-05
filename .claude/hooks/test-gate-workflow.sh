#!/usr/bin/env bash
#
# Every branch of `gate-workflow.sh`, exercised against a synthetic repository.
#
# Committed rather than run once and quoted, for the same reason as
# `tests/tools/scan-cardinality-assertions.ts`: the first version of the release gate was proven by a
# harness in a scratch directory, which is the exact failure plan 0083 Phase 0 exists to fix.
#
# Not wired into CI: it drives `git init` and a dozen commits, and the mechanism it guards is local
# tooling rather than shipped behaviour — ADR-008 rule 6's floor for an internal check is to prove each
# detector fires and stop. Run it by hand after editing the hook:
#
#     bash .claude/hooks/test-gate-workflow.sh
#
# Two rows exist because a test that expected GREEN went red and found real defects: the record commit
# cannot name its own sha (an unsatisfiable workflow), and the exemption for it must be scoped by
# content so a code change cannot ride in under a "docs:" message.
set -u
HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/gate-workflow.sh"
SP="$(mktemp -d)"
T="$SP/repo"
trap 'rm -rf "$SP"' EXIT
mkdir -p "$T/src" "$T/reviews"
cd "$T" || exit 1
git init -q -b main . && git config user.email t@t && git config user.name t
printf '{"name":"x","version":"1.0.0","files":["dist"]}\n' >package.json
echo 'export const a = 1' >src/a.ts; echo '# r' >README.md
git add -A && git commit -qm 'initial'
git tag v1.0.0

export CLAUDE_PROJECT_DIR="$T"
FAILS=0
row() {
  local desc="$1" cmd="$2" want="$3"
  printf '%s' "{\"tool_input\":{\"command\":\"$cmd\"}}" >"$SP/p.json"
  bash "$HOOK" <"$SP/p.json" >"$SP/o.txt" 2>"$SP/e.txt"
  local got=$?
  if [ "$got" = "$want" ]; then
    printf 'ok    exit %s  %s\n' "$got" "$desc"
  else
    printf 'FAIL  exit %s (wanted %s)  %s\n' "$got" "$want" "$desc"
    head -2 "$SP/e.txt" | sed 's/^/        /'
    FAILS=$((FAILS + 1))
  fi
}

echo "--- the fast path: nothing to gate ---"
row "unrelated command" "npm run validate" 0
row "listing tags" "git tag --sort=-creatordate" 0
row "a mention in a message" "git commit -m 'then gh pr create and git tag v1.0.1'" 0

echo "--- the PR gate ---"
git checkout -q -b fix/0059-a-bug
echo 'export const b = 2' >src/b.ts
git add -A && git commit -qm 'fix(0059): the real change'
SHA=$(git log -1 --format=%h)
row "no review record" "gh pr create --fill" 2
grep -q "$SHA" "$SP/e.txt" && echo "        (names the unreviewed sha)" || { echo "        FAIL: sha not named"; FAILS=$((FAILS+1)); }
grep -q "reviews/fix-0059-a-bug.md" "$SP/e.txt" && echo "        (names the record it wants)" || { echo "        FAIL: record path not named"; FAILS=$((FAILS+1)); }

printf '# Review\n\n- `%s` fix(0059): the real change\n' "$SHA" >reviews/fix-0059-a-bug.md
git add -A && git commit -qm 'docs: the review record'
row "record covers the code commit; the record commit is exempt" "gh pr create --fill" 0

# The exemption is by CONTENT, not by message: a code change cannot ride in under a docs label.
echo 'export const sneaky = 1' >src/sneaky.ts
git add -A && git commit -qm 'docs: review record'
row "code smuggled under a docs message" "gh pr create --fill" 2
git reset -q --hard HEAD~1

row "record covers every commit" "gh pr create --fill" 0

echo "--- the release gates ---"
git checkout -q main
git merge -q --no-ff fix/0059-a-bug -m 'merge fix/0059'
printf '{"name":"x","version":"1.0.1","files":["dist"]}\n' >package.json
git add -A && git commit -qm 'chore: release v1.0.1'
row "artifact changed + reviewed" "git tag v1.0.1" 0
row "and the push after it" "git push origin v1.0.1" 0

git checkout -q -b chore/docs-only
echo 'docs' >notes.md
git add -A && git commit -qm 'docs: internal only'
git checkout -q main && git merge -q --no-ff chore/docs-only -m 'merge docs'
printf '{"name":"x","version":"1.0.2","files":["dist"]}\n' >package.json
git add -A && git commit -qm 'chore: release v1.0.2'
git tag v1.0.1 2>/dev/null
row "no src/ change since v1.0.1" "git tag v1.0.2" 2
grep -q "packed artifact is unchanged" "$SP/e.txt" && echo "        (Gate 1's message)" || { echo "        FAIL: wrong gate"; FAILS=$((FAILS+1)); }

echo 'export const c = 3' >src/c.ts
git add -A && git commit -qm 'feat: a real change nobody reviewed'
row "artifact changed, commit unreviewed" "git tag v1.0.2" 2
grep -q "no review record" "$SP/e.txt" && echo "        (Gate 2's message)" || { echo "        FAIL: wrong gate"; FAILS=$((FAILS+1)); }

echo
echo "failures: $FAILS"
