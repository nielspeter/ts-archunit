#!/usr/bin/env bash
#
# ADR-008, applied to this repository's own release process.
#
# Two gates on the irreversible action. Both exist because both were violated on 2026-08-04, in a
# session that pushed eighteen tags in one day — and the release skill ALREADY said "docs/test/chore
# only: no release needed". A category note in a checklist did not stop it twice. This is the same
# argument the library makes about architecture rules: a convention nothing enforces is not enforced.
#
#   Gate 1  The packed artifact must have changed. package.json's `files` is
#           `dist, README.md, CHANGELOG.md, LICENSE`, so when `src/` and `README.md` are untouched the
#           tarball differs only by a version number. v0.55.2 and v0.55.3 were both that, and the
#           second cited the first as precedent.
#
#   Gate 2  Every commit being tagged must appear in `reviews/v<version>.md`. Not a checkbox: the
#           record has to account for each commit by sha, so skipping the review means writing down
#           shas nobody read rather than forgetting a step.
#
# **There is deliberately no override flag.** An env var would restore the convention it replaces —
# whoever is blocked can set it in the same breath as being told to. The escape hatch belongs to the
# human instead, and it is stated (ADR-008 rule 3): tag from your own terminal outside Claude Code, or
# disable the hook in `.claude/settings.json`. Both are visible acts; an env var is not.
#
# Exit 2 blocks the tool call and returns stderr to the agent as the reason.
set -uo pipefail

payload=$(cat)
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
  if printf '%s' "$payload" | grep -Eq 'git tag v[0-9]|git push[^"]*--tags|npm publish'; then
    echo "RELEASE GATE UNAVAILABLE — python3 is missing, so this hook cannot parse the command." >&2
    echo "Blocking anything that looks like a release. Install python3, or run the tag yourself." >&2
    exit 2
  fi
  exit 0
fi

# The remaining early exits below are deliberate and are NOT this case: they mean the command is not a
# release, or this is not the package, or there is no previous tag to compare against.

# Only the actions that cannot be undone: creating a release tag, pushing one, publishing directly.
# `git tag` with no version and `git tag --sort=...` are listings and are not gated.
#
# The match is over COMMAND POSITIONS in a quote-stripped copy, and both halves of that were bought
# the hard way: the first version grepped the raw string and blocked
# `git commit -m "...blocks git tag / npm publish..."` — the commit that was installing this hook.
# A detector that fires on a mention rather than on the act is the same defect this repo files bugs
# about in its own rules, and it fails in the direction that gets a gate deleted.
#
# A pattern hidden inside a heredoc body still trips it. That is a stated limit, not an oversight:
# stripping heredocs needs a shell parser, and the failure mode is a false block with a readable
# reason rather than a silent pass.
if ! printf '%s' "$command" | python3 -c '
import re, sys

text = sys.stdin.read()
# Drop quoted spans, so a pattern inside a commit message or an echo is not an invocation.
text = re.sub(r"\x27[^\x27]*\x27", " ", text)
text = re.sub(r"\"(?:[^\"\\\\]|\\\\.)*\"", " ", text)
# Then require a command position: start, or after a separator.
head = r"(?:^|[\n;&|(]|&&|\|\|)\s*"
gated = [
    head + r"git\s+tag\s+v[0-9]",
    head + r"git\s+push\b[^\n;&|]*(?:--tags|\sv[0-9])",
    head + r"npm\s+publish\b",
]
sys.exit(0 if any(re.search(p, text) for p in gated) else 1)
'; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
version=$(node -p "require('./package.json').version" 2>/dev/null) || exit 0
[ -n "$version" ] || exit 0

# The tag being created may already exist locally (a `git push origin vX` after `git tag vX`), so the
# baseline is the newest tag that is NOT the one under release. Without this the diff below compares
# HEAD to itself and Gate 1 blocks every push.
prev=$(git tag --sort=-creatordate | grep -v "^v${version}\$" | head -1)
# First release ever: nothing to compare against, and nothing to review against either.
[ -n "$prev" ] || exit 0

# ── Gate 1 ────────────────────────────────────────────────────────────────────────────────────────
# `git diff --quiet` exits 0 when there is NO difference, which is the case that blocks.
if git diff --quiet "$prev"..HEAD -- src/ README.md; then
  cat >&2 <<EOF
RELEASE BLOCKED — the packed artifact is unchanged since ${prev}.

  git diff --stat ${prev}..HEAD -- src/ README.md   →   (empty)

package.json packs dist, README.md, CHANGELOG.md, LICENSE. With no change under src/ or in README.md,
this release ships a tarball that differs from ${prev} only by its version number, and every adopter
gets a bump whose docs/upgrading.md row reads "No action".

REMEDY: do not tag. Commit and push to main — that is a complete outcome for test-only, plan-only or
in-repo-docs-only work, and the CHANGELOG entry rides along in the next release that changes behaviour.

If the user has explicitly asked for a release anyway, they can tag from their own terminal.
EOF
  exit 2
fi

# ── Gate 2 ────────────────────────────────────────────────────────────────────────────────────────
record="reviews/v${version}.md"
unreviewed=""
while read -r sha subject; do
  # The release commit itself and merge commits do not exist when the review runs, so requiring them
  # would make the gate unsatisfiable. Stated rather than silent, and narrow: `chore: release` only.
  case "$subject" in
    'chore: release'*) continue ;;
  esac
  if ! grep -q "$sha" "$record" 2>/dev/null; then
    unreviewed="${unreviewed}  ${sha} ${subject}"$'\n'
  fi
done < <(git log --no-merges --format='%h %s' "$prev"..HEAD)

if [ -n "$unreviewed" ]; then
  cat >&2 <<EOF
RELEASE BLOCKED — these commits are not accounted for in ${record}:

${unreviewed}
A review round means reviewers other than the author of the code. Self-review by the model that just
wrote it is the failure mode, not the check: a five-persona pass over this repo has repeatedly found
shipped-behaviour defects that a green 3000-test suite did not, and npm has no undo.

REMEDY, in order:
  1. Run the review over ${prev}..HEAD — /review --branch, or the personas whose domain the change
     touches (reviewer-testing and reviewer-architect at minimum for library code).
  2. Decide what to act on. The reviewers report; the author decides — findings acted on, findings
     rejected with a reason, and findings filed as a plan or bug report. No deferred tasks.
  3. Write ${record}: the verdict per finding, and every sha above listed so this gate can see it.
  4. Then tag.

See reviews/README.md for the format.
EOF
  exit 2
fi

exit 0
