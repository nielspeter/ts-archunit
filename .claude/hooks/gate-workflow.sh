#!/usr/bin/env bash
#
# ADR-008, applied to this repository's own workflow.
#
# The workflow is: **a bug or a plan → a branch → code → review → PR.** It is what this repo did for
# twenty-six pull requests, up to #27 on 2026-07-30. Then it stopped, without anyone deciding to: 224
# commits, 64 local `--no-ff` merges and 51 releases followed with no PR at all, and the branches
# shrank to one commit each with a merge message duplicating the commit's own subject. A branch that
# lives ninety seconds is a string match on "make a branch", not a review surface.
#
# So the gates below are placed at the two events that are hard to undo, and the review gate sits where
# the workflow puts it — **before the PR**, not before the tag. That ordering matters: an earlier
# version of this hook gated only `git tag`, and then the release rule correctly stopped tagging
# internal work — which quietly meant internal work met no gate at all. Moving it to `gh pr create`
# closes the hole the other rule opened.
#
#   PR gate       `gh pr create` requires `reviews/<branch>.md` to name every commit on the branch.
#                 Not a checkbox: the record has to account for each commit by sha, so skipping the
#                 review means writing down shas nobody read.
#
#   Release gate  A tag or publish requires (1) the packed artifact to have changed since the previous
#                 tag, and (2) every commit in the range to appear in SOME record under `reviews/`.
#                 v0.55.2 and v0.55.3 both shipped a tarball identical to their predecessor except for
#                 the version number, the second citing the first as precedent.
#
# **There is deliberately no override flag.** An env var would restore the convention it replaces —
# whoever is blocked can set it in the same breath as being told to. The escape hatch belongs to the
# human instead, and it is stated (ADR-008 rule 3): act from your own terminal outside Claude Code, or
# disable the hook in `.claude/settings.json`. Both are visible acts; an env var is not.
#
# Exit 2 blocks the tool call and returns stderr to the agent as the reason.
set -uo pipefail

payload=$(cat)

# Fast path first: this hook runs on EVERY Bash call, and spawning python3 to parse a payload that
# cannot possibly be a release or a PR is a tax on every command in the session. If none of the four
# verbs appear anywhere in the raw payload, there is nothing to gate. Correctness is unaffected — the
# precise, quote-stripping parser below still decides whether a match is an invocation or a mention.
if ! printf '%s' "$payload" | grep -Eq 'git tag|git push|npm publish|gh pr create'; then
  exit 0
fi

command=$(
  printf '%s' "$payload" |
    python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' \
      2>/dev/null
)
if [ $? -ne 0 ]; then
  # **The one fail-open worth arguing about.** Without python3 the payload cannot be parsed, and a gate
  # that opens whenever its parser is missing is a gate that vanishes on the machine you least expect.
  # It cannot fail closed for everything — that would block every Bash call on such a machine — so it
  # degrades to a coarse match over the RAW payload: over-broad (a commit message mentioning the words
  # trips it) but loud, rare, and in the safe direction.
  if printf '%s' "$payload" | grep -Eq 'git tag v[0-9]|git push[^"]*--tags|npm publish|gh pr create'; then
    echo "GATE UNAVAILABLE — python3 is missing, so this hook cannot parse the command." >&2
    echo "Blocking anything that looks like a PR or a release. Install python3, or act yourself." >&2
    exit 2
  fi
  exit 0
fi

# Classify the command, over a quote-stripped copy at a command position.
#
# Both halves of that were bought the hard way: the first version grepped the raw string and blocked
# `git commit -m "...blocks git tag / npm publish..."` — the commit that was installing this hook. A
# detector that fires on a mention rather than on the act is the same defect this repo files bugs about
# in its own rules, and it fails in the direction that gets a gate deleted.
#
# A pattern hidden inside a heredoc body still trips it. Stated limit, not an oversight: stripping
# heredocs needs a shell parser, and the failure mode is a false block with a readable reason.
action=$(
  printf '%s' "$command" | python3 -c '
import re, sys

text = sys.stdin.read()
text = re.sub(r"\x27[^\x27]*\x27", " ", text)
text = re.sub(r"\"(?:[^\"\\\\]|\\\\.)*\"", " ", text)
head = r"(?:^|[\n;&|(]|&&|\|\|)\s*"
if re.search(head + r"gh\s+pr\s+create\b", text):
    print("pr")
elif re.search(head + r"git\s+tag\s+v[0-9]", text) or re.search(
    head + r"git\s+push\b[^\n;&|]*(?:--tags|\sv[0-9])", text
) or re.search(head + r"npm\s+publish\b", text):
    print("release")
'
)
[ -n "$action" ] || exit 0

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
[ -f package.json ] || exit 0

# Commits in a range that no review record accounts for.
#
# Three exemptions, each because the commit cannot exist when the review runs. Stated rather than
# silent, and each as narrow as it can be:
#
#   merges                  created by the merge itself
#   `chore: release`        created after the review, by the release
#   reviews/-only commits   **the record cannot name its own sha** — writing the sha into the file
#                           changes the file, which changes the sha. Found by a test row that expected
#                           green: without this the workflow is unsatisfiable, and the first thing a
#                           blocked author would do is delete the hook.
#
# The third is scoped by CONTENT, not by message: a commit touching anything outside `reviews/` is not
# exempt, so "docs: review record" cannot be used as a label to smuggle code past the gate.
unreviewed_in() {
  local range="$1" record="$2" out=""
  while read -r sha subject; do
    [ -n "$sha" ] || continue
    case "$subject" in
      'chore: release'*) continue ;;
    esac
    if [ -z "$(git show --name-only --format='' "$sha" | grep -v '^reviews/' | grep -v '^$')" ]; then
      continue
    fi
    if [ -n "$record" ]; then
      grep -q -- "$sha" "$record" 2>/dev/null || out="${out}  ${sha} ${subject}"$'\n'
    else
      grep -rq -- "$sha" reviews/ 2>/dev/null || out="${out}  ${sha} ${subject}"$'\n'
    fi
  done < <(git log --no-merges --format='%h %s' "$range" 2>/dev/null)
  printf '%s' "$out"
}

# ── The PR gate ───────────────────────────────────────────────────────────────────────────────────
if [ "$action" = "pr" ]; then
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
  [ -n "$branch" ] && [ "$branch" != "main" ] || exit 0
  base=$(git merge-base main HEAD 2>/dev/null) || exit 0
  # `reviews/<branch>.md`, with slashes flattened: the record is named for the work item, because the
  # unit of work here is a bug or a plan, not a version.
  record="reviews/$(printf '%s' "$branch" | tr '/' '-').md"
  unreviewed=$(unreviewed_in "$base..HEAD" "$record")
  if [ -n "$unreviewed" ]; then
    cat >&2 <<EOF
PR BLOCKED — these commits are not accounted for in ${record}:

${unreviewed}
The workflow is: a bug or a plan → a branch → code → REVIEW → PR. This is the review step, and
self-review by the author who just wrote the code does not satisfy it — that is the failure mode, not
the check. Two reviewers over one small change on 2026-08-04 measured five false greens and four false
claims that a green 3129-test suite and the author's own read had both passed.

REMEDY, in order:
  1. Review ${base}..HEAD — /review, or the personas whose domain the change touches
     (reviewer-testing and reviewer-architect at minimum for library code).
  2. Decide what to act on. Reviewers report; the author decides — acted on, rejected with a reason,
     or filed as a plan or bug report. No deferred tasks.
  3. Write ${record}: the verdict per finding, and every sha above listed so this gate can see it.
  4. Then open the PR.

See reviews/README.md for the format.
EOF
    exit 2
  fi
  exit 0
fi

# ── The release gates ─────────────────────────────────────────────────────────────────────────────
version=$(node -p "require('./package.json').version" 2>/dev/null) || exit 0
[ -n "$version" ] || exit 0

# The tag being created may already exist locally (a `git push origin vX` after `git tag vX`), so the
# baseline is the newest tag that is NOT the one under release. Without this the diff below compares
# HEAD to itself and Gate 1 blocks every push.
prev=$(git tag --sort=-creatordate | grep -v "^v${version}\$" | head -1)
# First release ever: nothing to compare against, and nothing to review against either.
[ -n "$prev" ] || exit 0

# Gate 1 — `git diff --quiet` exits 0 when there is NO difference, which is the case that blocks.
if git diff --quiet "$prev"..HEAD -- src/ README.md; then
  cat >&2 <<EOF
RELEASE BLOCKED — the packed artifact is unchanged since ${prev}.

  git diff --stat ${prev}..HEAD -- src/ README.md   →   (empty)

package.json packs dist, README.md, CHANGELOG.md, LICENSE. With no change under src/ or in README.md,
this release ships a tarball that differs from ${prev} only by its version number, and every adopter
gets a bump whose docs/upgrading.md row reads "No action".

REMEDY: do not tag. Merge the PR — that is a complete outcome for test-only, plan-only or
in-repo-docs-only work, and the CHANGELOG entry rides along in the next release that changes behaviour.

If the user has explicitly asked for a release anyway, they can tag from their own terminal.
EOF
  exit 2
fi

# Gate 2 — every commit in the release range appears in SOME record under `reviews/`.
unreviewed=$(unreviewed_in "${prev}..HEAD" "")
if [ -n "$unreviewed" ]; then
  cat >&2 <<EOF
RELEASE BLOCKED — no review record under reviews/ accounts for these commits:

${unreviewed}
Each should already be covered by the record written for its branch before its PR. If a commit reached
main without one, review it now and write the record — a release is the wrong moment to discover that
a change was never read.
EOF
  exit 2
fi

exit 0
