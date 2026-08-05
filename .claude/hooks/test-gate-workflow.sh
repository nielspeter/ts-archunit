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

# Commit with a pinned, increasing date. A lightweight tag has no date of its own, so
# `git tag --sort=creatordate` falls back to the commit's — and when two land in the same second the
# tie breaks on refname, which silently pointed the release rows at the wrong baseline on a fast
# machine. Measured by review: the flake turned Gate 1's row into a Gate 2 row.
TS=1000000000
c() {
  TS=$((TS + 60))
  GIT_AUTHOR_DATE="$TS +0000" GIT_COMMITTER_DATE="$TS +0000" git commit -qm "$1"
}
printf '{"name":"x","version":"1.0.0","files":["dist"]}\n' >package.json
echo 'export const a = 1' >src/a.ts; echo '# r' >README.md
git add -A && c 'initial'
git tag v1.0.0

export CLAUDE_PROJECT_DIR="$T"
FAILS=0

row() {
  local desc="$1" cmd="$2" want="$3"
  CMD="$cmd" python3 -c 'import json,os,sys
sys.stdout.write(json.dumps({"tool_input": {"command": os.environ["CMD"]}}))' >"$SP/p.json"
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
git add -A && c 'fix(0059): the real change'
SHA=$(git log -1 --format=%h)
row "no review record" "gh pr create --fill" 2
grep -q "$SHA" "$SP/e.txt" && echo "        (names the unreviewed sha)" || { echo "        FAIL: sha not named"; FAILS=$((FAILS+1)); }
grep -q "reviews/fix-0059-a-bug.md" "$SP/e.txt" && echo "        (names the record it wants)" || { echo "        FAIL: record path not named"; FAILS=$((FAILS+1)); }

printf '# Review\n\n- `%s` fix(0059): the real change\n' "$SHA" >reviews/fix-0059-a-bug.md
git add -A && c 'docs: the review record'
row "record covers the code commit; the record commit is exempt" "gh pr create --fill" 0

# The exemption is by CONTENT, not by message: a code change cannot ride in under a docs label.
echo 'export const sneaky = 1' >src/sneaky.ts
git add -A && c 'docs: review record'
row "code smuggled under a docs message" "gh pr create --fill" 2
git reset -q --hard HEAD~1

row "record covers every commit" "gh pr create --fill" 0

echo "--- the release gates ---"
git checkout -q main
git merge -q --no-ff fix/0059-a-bug -m 'merge fix/0059'
printf '{"name":"x","version":"1.0.1","files":["dist"]}\n' >package.json
git add -A && c 'chore: release v1.0.1'
row "artifact changed + reviewed" "git tag v1.0.1" 0
git tag v1.0.1   # the hook does not create tags; the harness must, or the next baseline is HEAD
row "and the push after it" "git push origin v1.0.1" 0

git checkout -q -b chore/docs-only
echo 'docs' >notes.md
git add -A && c 'docs: internal only'
git checkout -q main && git merge -q --no-ff chore/docs-only -m 'merge docs'
printf '{"name":"x","version":"1.0.2","files":["dist"]}\n' >package.json
git add -A && c 'chore: release v1.0.2'
row "no src/ change since v1.0.1" "git tag v1.0.2" 2
grep -q "packed artifact is unchanged" "$SP/e.txt" && echo "        (Gate 1's message)" || { echo "        FAIL: wrong gate"; FAILS=$((FAILS+1)); }

echo 'export const c = 3' >src/c.ts
git add -A && c 'feat: a real change nobody reviewed'
row "artifact changed, commit unreviewed" "git tag v1.0.2" 2
grep -q "no review record" "$SP/e.txt" && echo "        (Gate 2's message)" || { echo "        FAIL: wrong gate"; FAILS=$((FAILS+1)); }

echo "--- the five holes a devops review measured on 2026-08-05 ---"
# Each of these exited 0 before the fix. They are rows now so they cannot come back.

# 1. The release exemption trusted the SUBJECT LINE, and `chore: release` is the one subject this repo
#    writes at every release. Content-scoped now: version bookkeeping only.
git checkout -q -b chore/smuggle
echo 'export const evil = 1' >src/evil.ts
git add -A && c 'chore: release v1.0.3 and rewrite the auth layer'
row "code under a 'chore: release' subject" "gh pr create --fill" 2
git checkout -q main && git branch -qD chore/smuggle

# 2. The fast path used literal single spaces while the parser uses \s+, so one extra space or a tab
#    turned the whole mechanism off.
git checkout -q -b fix/0060-unreviewed
echo 'export const d = 4' >src/d.ts
git add -A && c 'fix(0060): unreviewed on purpose'
row "two spaces: git  tag" "git  tag v1.0.9" 2
row "two spaces: gh pr  create" "gh pr  create --fill" 2
row "a tab before publish" "$(printf 'npm\tpublish')" 2

# 3. An annotated tag is still a tag.
row "git tag -a" "git tag -a v1.0.9 -m 'release'" 2

# 4. Stripping single-quoted spans first let two apostrophes in ordinary English erase the command
#    between them.
row "apostrophes around a real command" "git commit -m \"don't\" && gh pr create --title \"won't\"" 2

# 5. Gate 1 keyed its baseline to package.json rather than to the tag being created, so tagging ahead
#    of the version bump compared against the wrong predecessor.
git checkout -q main && git merge -q --no-ff fix/0060-unreviewed -m 'merge 0060'
{
  printf -- '- `%s` fix(0060)\n' "$(git log -1 --format=%h fix/0060-unreviewed)"
  # Every earlier row left commits behind; this row is about Gate 1's BASELINE, so clear Gate 2 first
  # or it blocks for an unrelated reason and the row proves nothing. The harness builds state
  # incrementally, which is cheap but means each row must state what it depends on.
  git log --no-merges --format='- `%h` %s' v1.0.0..HEAD
} >reviews/fix-0060-unreviewed.md
git add -A && c 'docs: record for 0060'
row "tag named ahead of the version bump" "git tag v1.0.9" 0

echo
echo "failures: $FAILS"
# Exit non-zero when any row failed. This printed "failures: 1" and exited 0 until the run that added
# this line — a harness whose verdict is only in its prose is a harness no caller can trust, which is
# the same defect it exists to catch in the hook.
[ "$FAILS" -eq 0 ] || exit 1
