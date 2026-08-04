# Release reviews

One file per released version, `v<version>.md`, recording the review round that ran **before** the tag.

`.claude/hooks/gate-release.sh` reads these. It blocks `git tag v*`, `git push … v*` and `npm publish`
until the file for the pending version names every commit in `<previous tag>..HEAD` by its short sha.
That is the whole mechanism: the record has to account for each commit, so an unreviewed release means
writing down shas nobody read rather than forgetting a step.

## Why the gate exists

On 2026-08-04 this repository shipped **eighteen tags in one day**. Two of them — v0.55.2 and v0.55.3 —
changed nothing an adopter can import: no `src/` diff, so the tarball differed only by a version number,
and the second cited the first as precedent. Neither had been through a review round. The release skill
already said "docs/test/chore only: no release needed", in those words, and that did not stop either one.

That is the argument this library makes about architecture rules, turned inward: a convention nothing
enforces is not enforced. So it is a gate, and it fails closed.

## Format

No template to fill in — a filled-in template is the thing this repo calls coverage theatre. What the
gate needs is the sha list; what a reader needs is the verdict. Both, briefly:

```markdown
# Review — v0.56.0

**Range:** v0.55.3..HEAD · **Reviewers:** reviewer-testing, reviewer-architect · **Date:** 2026-08-05

**Commits reviewed**

- `abc1234` feat(0088): waivers name an edge, not a component
- `def5678` test(0088): the waiver cannot absorb a new edge

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

## The escape hatch, stated

There is no override flag in the hook, deliberately — an env var would restore the convention it
replaces, since whoever is blocked can set it in the same breath as being told to. A human can tag from
their own terminal outside Claude Code, or disable the hook in `.claude/settings.json`. Both are visible
acts.
