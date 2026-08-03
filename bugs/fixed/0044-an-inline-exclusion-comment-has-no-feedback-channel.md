# Bug 0044: an inline exclusion comment has no feedback channel

**Reported:** 2026-08-01 · **Fixed:** 2026-08-03, unreleased — the stale half
**Found in:** v0.36.3, by the customer review of the 0041/0042 branch
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
- [Bug 0039](./0039-an-undocumented-exclusion-comment-suppresses-and-only-warns.md) — the
  reason-free directive.
- `src/core/comment-suppression.ts` — the half that shipped.

## Fix as shipped — option 2, the `doctor` surface

`orphanExclusions(rules)` reports every inline directive naming a rule id **no rule declares**, and
`doctor` calls it. That is the rename case, which is the common one and the only one that is silent
_forever_: a misplaced comment at least fails to suppress the finding you were looking at, whereas a
renamed id goes inert and stays inert.

ADR-008 rule 1's migration corollary decided the surface: _"a warning is something you hope is read;
a command is something someone ran."_ It cannot be a check-time finding without parsing every file
in scope on every run — the exact cost the `result.length > 0` gate exists to avoid.

### It must see every rule, and that is pinned as a footgun

The declared-id set is the **union across rule files**. `doctor` diagnoses one file at a time, so a
per-file check would report a directive naming a rule from a sibling file as an orphan — a false
positive on the commonest multi-file layout, and a diagnostic that cries wolf is one nobody runs.

So this is deliberately **not** part of `diagnose()`. `doctor` calls it once, after the load loop,
with everything. And the footgun has its own test: called with a subset, it _does_ report false
orphans, asserted so nobody folds it back into `diagnose()` without noticing.

### One refusal worth stating

When **no** rule declares an id at all, it reports **nothing** rather than everything. A caller in
that state has misconfigured the call, not discovered a hundred orphans — inline comments need a
rule id to function at all. A wall of false orphans is the fastest way to make a diagnostic ignored.

## Sabotage — 5 of 5, and the fifth was the one that mattered

| Revert                                  | Result                 |
| --------------------------------------- | ---------------------- |
| G1 — never report                       | CAUGHT                 |
| G2 — report every directive             | CAUGHT                 |
| G3 — remove the no-declared-ids refusal | CAUGHT                 |
| G4 — **`doctor` stops calling it**      | **GREEN**, then CAUGHT |
| G5 — report it under the wrong `kind`   | CAUGHT                 |

**G4 is the recurring gap.** The unit tests pass whether or not anything calls the function — the
same shape the comment-suppression disclosure had in v0.37.0, where a module worked and was
unreached. A module that works and a module that is _reached_ are two claims, and only one of them
was tested. There is now a `runDoctor` row asserting the orphan reaches the JSON document, with a
control that the declared id does not.

`HAS_GLOB` in `doctor.ts` is a `Record` over every finding kind precisely so a new one fails `tsc`
until someone decides how it renders — it did, which is the type system doing the job a review
otherwise has to.

## Still not covered: the misplaced comment

A directive whose rule id is **correct** but whose placement is wrong. That is option 1, and it needs
the enforcement path to know which violations a comment failed to cover — a parse per file per rule.
Not filed as a follow-up bug, because the trade is recorded here and the cost is the reason the gate
exists. If it becomes worth paying, this is the section to argue with.

The placement rules themselves are documented as of v0.37.0 (`docs/violation-reporting.md`), which is
the cheap half of that problem.

## Review follow-ups (v0.43.2)

A post-release review found a **shipped rule-2 defect** and two silent losses. All fixed.

### The false positive the design claimed to prevent was reachable

`doctor a.rules.ts` — the single-file form `docs/cli.md` itself shows — sees a subset of a
multi-file project's rules, so a directive naming a rule declared in `b.rules.ts` was reported as
an orphan. The advice then said **"delete the comment"** on a comment that was doing its job, and
deleting it un-waives a real violation.

The footgun was pinned on the _function_ and that was mistaken for a guard on the _command_.
`doctor` now passes its scope, and the advice leads with the caveat when the view is partial:
_"Checked against 1 rule file only — if this id is declared in a rule file that was not inspected,
this report is a false positive and the comment is working."_ No caveat when the caller vouches for
full coverage, or it becomes noise on every run.

### Two silent losses from one `catch`

`fs.readFileSync` threw for an in-memory project and for an unreadable file, and the
`catch { continue }` ate both — a diagnostic whose whole subject is _"this silently does nothing"_
doing exactly that, on a **published export**. `sourceFile.getFullText()` replaces it: the text is
already in memory, there is no second I/O, and the catch's stated cause disappears with it.

### Silence when nothing declares an id was the rule 1 failure

The first behaviour returned `[]`, reasoning that a wall of false orphans is worse. But without any
declared id **every** inline exclusion really is inert, so those were all real orphans and the
diagnostic said nothing about any of them. Now **one** aggregate finding naming the cause — neither
noise nor silence — with a vacuity control that it does not fire on a project with no directives.

### Two of the wiring row's three assertions did nothing

`toContain('arch/renamed-away')` was satisfied by the advice **prose**, not the `rule` field, so
changing `rule: orphan.ruleId` to `orphan.file` left the whole suite green. And the negative row was
vacuous in its own fixture — no `arch/live` directive existed for "report everything" to reveal. Now
asserted on the parsed object, with a declared-id directive in the fixture so the negative row can
fail.

### Also corrected

- `ruleFile` carried a **source** path for this kind, giving JSON consumers two different things
  under one name. New `sourceFile` field.
- The terminal format printed neither file nor line, while the changelog claimed _"names the file
  and line"_. It renders `source:line` now.
- The workspace comment named the wrong mechanism: `workspace()` builds a single ts-morph project,
  so the case `seen` actually protects is two separate `project()` calls with overlapping globs.

### Seven reverts that shipped unguarded, now caught

`rule` field identity · hardcoded `line` · dedupe key collapse · `sourceFile` dropped · `line`
dropped · aggregate finding removed · scope caveat silenced.

### One review claim that does NOT reproduce

The review reported the orphan pass costing 3.6x (2076ms → 671ms on this repository) and proposed
a fast-path reject. **Measured here, it is ~1.0x**: 567 files with a planted orphan asserted found
on every run, five runs each — 100/102/100/95/100ms with the reject, 100/104/101/96/105ms without.
The reviewer flagged that other processes were competing for the box and said to trust the ratio;
the ratio does not hold either.

The reject is **kept on soundness** — the parse only ever removes directives, so a file without the
literal text cannot hold one — and the code comment says that instead of quoting a saving it does
not deliver. Worth recording that my _first_ attempt at this measurement was itself vacuous
(`findings=0`, equally consistent with scanning nothing), which is why the final one plants an
orphan and throws if it is not found.
