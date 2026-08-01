# Bug 0044: an inline exclusion comment has no feedback channel

**Reported:** 2026-08-01 · **Found in:** v0.36.3, by the customer review of the 0041/0042 branch
**Severity:** Medium. Two silences with one cause. Partly mitigated in v0.37.0, which added
suppression disclosure — what remains is the other direction: a comment that does _nothing_.

## Description

`.excluding()` warns when a pattern matches zero violations (`execute-rule.ts`). An inline
comment has no equivalent, and **structurally cannot have one on the current path**: comments
are only parsed in files that already produced a violation
(`if (ctx.metadata?.id && result.length > 0)`). A comment in a currently-clean file is never
read, so nothing can observe that it matched nothing.

Two consequences:

**1. A misplaced comment is silent.** The placement rule is unobvious — a single-line directive
covers exactly `comment.line + 1`, and the line that counts is the one the _finding_ reports.
Measured on a class-level condition: the message says "at line 3", the location says `:1`, the
code frame highlights 1, and the exclusion mechanism uses 1 — three different line signals in
one finding, and the one that governs is the only one the text never names. A user puts the
comment above the offending `console.log`, gets nothing, and concludes the feature is broken.
That is the experience bug 0041 was fixed to end.

Worse for file-level conditions: `conditions/exports.ts` reports at a hardcoded `line: 1`
(`:24`, `:54`, `:96`), so **no single-line comment can ever cover one** — it would need to sit
on line 0. Only the block form works. Measured while writing 0041's guard.

**2. A stale comment is silent forever.** Rename a rule id and every comment naming the old id
goes inert, with no signal. `docs/violation-reporting.md` used to advertise the inline form as
_better_ than `.excluding()` because it "survives renames" — the opposite of the truth, and
that claim was retracted in v0.37.0.

## What v0.37.0 already fixed

The _positive_ direction is now disclosed: a run that suppresses findings prints the rule and
file for each, and `check --format json` carries `commentSuppressed`. So a reader can see what
went quiet. They still cannot see what failed to.

## Fix

The blocker is the `result.length > 0` gate. Options:

1. **Parse comments for every file in scope**, not only files with findings, and warn on a
   directive that matched nothing. Costs a read per file per rule; the gate exists precisely to
   avoid that, so measure before committing.
2. **A `doctor` surface.** `doctor` never executes rules, so it cannot know what a comment would
   have matched — but it _can_ report every directive it finds together with whether the rule id
   exists at all, which catches the rename case, the commonest one. Cheaper and it fits the
   diagnostic-first shape ADR-008 rule 1's corollary prefers.
3. **Both**, with (2) first.

Option 2 is the recommendation: it catches renames, needs no per-rule work, and puts the signal
on a command someone ran rather than in output nobody reads.

## Guard

- a directive naming a rule id that exists nowhere in the suite is reported;
- a directive naming a real rule id, correctly placed, is **not** reported (the control);
- a directive on the wrong line for a real finding is reported;
- vacuity: the fixture's rule genuinely fires with no comment present.

## Related

- [Bug 0043](./0043-an-exclusion-directive-inside-a-string-literal-suppresses.md) — a directive
  that should not count at all but does.
- [Bug 0039](./fixed/0039-an-undocumented-exclusion-comment-suppresses-and-only-warns.md) — the
  reason-free directive.
- `src/core/comment-suppression.ts` — the half that shipped.
