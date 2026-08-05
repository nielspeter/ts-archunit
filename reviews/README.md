# Reviews

One file per work item — a bug or a plan — named for the branch that carried it.

```
branch  fix/0059-notdependon-misses-a-dynamic-import
record  reviews/fix-0059-notdependon-misses-a-dynamic-import.md
```

The workflow these belong to is: **a bug or a plan → a branch → code → review → PR.**

`.claude/hooks/gate-workflow.sh` reads these at the two events that are hard to undo:

| Event                                          | What must be true                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `gh pr create`                                 | `reviews/<branch>.md` names every commit on the branch, by short sha                                          |
| `git tag v*` · `git push … v*` · `npm publish` | the packed artifact changed since the last tag, **and** every commit in the range appears in some record here |

That is the whole mechanism: the record has to account for each commit, so an unreviewed change means
writing down shas nobody read rather than forgetting a step.

## Why the gate exists

This repository merged **26 pull requests**, the last on 2026-07-30. Then it stopped — not by decision:
**224 commits, 64 local merges and 51 releases** followed with no PR at all, and the branches shrank to
one commit apiece with merge messages duplicating the commit's own subject. A branch that lives ninety
seconds is a string match on "make a branch", not a review surface.

Two of those releases — v0.55.2 and v0.55.3 — changed nothing an adopter can import: no `src/` diff, so
the tarball differed only by a version number, the second citing the first as precedent. Neither had
been reviewed by anyone but its author. When two reviewers finally read one small change, they measured
**five false greens and four false claims** that a green 3129-test suite and the author's own read had
both passed.

The release skill already said "docs/test/chore only: no release needed", in those words, and that did
not stop either one. So it is a gate, and it fails closed. That is the argument this library makes about
architecture rules, turned inward: a convention nothing enforces is not enforced.

## Format

No template to fill in — a filled-in template is what this repo calls coverage theatre. The gate needs
the sha list; a reader needs the verdicts. Both, briefly:

```markdown
# Review — fix/0059-notdependon-misses-a-dynamic-import

**Range:** main..HEAD · **Reviewers:** reviewer-testing, reviewer-architect · **Date:** 2026-08-05

**Commits reviewed**

- `abc1234` fix(0059): the kind set follows the question, not the caller
- `def5678` test(0059): both families answer the same on one dynamic import

**Findings**

| #   | Reviewer  | Finding                                       | Verdict                         |
| --- | --------- | --------------------------------------------- | ------------------------------- |
| 1   | testing   | the vacuity floor passes on an empty walk     | Fixed in `def5678`              |
| 2   | architect | `PairCondition` excluded for no stated reason | Rejected — it is stated, at L47 |
| 3   | testing   | no guard on the identity of the population    | Filed as plan 0094              |
```

Three rules about the verdict column, all learned the hard way:

- **The author decides, not the reviewer.** Reviewers report; acting on a finding, rejecting it with a
  reason, or filing it is the author's call.
- **No deferred tasks.** A finding that is not fixed now becomes a plan or a bug report, with its number
  in the verdict. "Later" is not a verdict.
- **A rejected finding needs the reason, not the word "rejected".** Six months on, the reason is the only
  part worth having.

## Older records

`v0.55.3.md` is named for a version rather than a branch, because it is the release that created this
directory by skipping the review. It is left as it is; the naming changed with the gate that followed it.

## The escape hatch, stated

There is no override flag in the hook, deliberately — an env var would restore the convention it
replaces, since whoever is blocked can set it in the same breath as being told to. A human can act from
their own terminal outside Claude Code, or disable the hook in `.claude/settings.json`. Both are visible
acts.
