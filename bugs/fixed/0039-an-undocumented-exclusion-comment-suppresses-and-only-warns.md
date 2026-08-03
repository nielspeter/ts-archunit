# Bug 0039: an undocumented exclusion comment suppresses the finding and only warns

**Reported:** 2026-08-01 · **Fixed:** 2026-08-01, unreleased — **both halves**
**Verified:** all four parse paths run behaviourally, before and after
**Found in:** v0.36.3, by the ADR-008 compliance audit
**Severity:** High. Filed as Medium, re-rated after v0.37.0 widened its reach, and genuinely arguable — the ceiling on any fix is one round of friction,
and the scope is narrowed by three gates (see "How narrow this actually is"). Against Low: it
is a silent green on a constraint the docs call required.

## Description

`// ts-archunit-exclude arch/no-cycles` — a directive with no reason — emits a warning and then
applies the exclusion anyway. `src/core/exclusion-comments.ts:168-182` (`handleSingleLine`):

```ts
const { ruleIds, reason } = parseRuleIdsAndReason(content)

if (reason === '') {
  warnUndocumented(warnings, ruleIds, 'ts-archunit-exclude', filePath, lineNum)
}

for (const ruleId of ruleIds) {
  exclusions.push({ ruleId, reason, file: filePath, line: lineNum, isBlock: false })
}
```

The block form has the same shape at `handleBlockStart:142`, where the push is
`openBlocks.set(ruleId, { …, isBlock: true })` at `:146-154`. Both were measured; both fail open.

The warning reaches stderr via `execute-rule.ts:109`. The build is green.

Measured, including the remedy the warning itself recommends:

```
no reason            → violations [], green, + Undocumented warning
trailing colon only  → violations [], green, + Undocumented warning
`: needed`           → violations [], green, + NO warning
block form, no reason → violations [], green, + Undocumented warning
```

Vacuity controls: no comment at all → 1 violation, `check()` throws. Documented exclusion →
0 violations, green. So the fixture yields a real finding and the feature genuinely works on it.

`: needed` is the part worth staring at. Following the warning's own `Fix:` line gets you to
**green and silent** in one step.

## Not "exclusion parsing is warn-only" — the four paths differ

The first draft of this bug claimed three of four paths fail closed. **Row 2 is wrong**, and it
is the row that matters most.

| Warning                                    | Exclusion created?             | Result                          |
| ------------------------------------------ | ------------------------------ | ------------------------------- |
| `-end` without a matching `-start` (`:88`) | No                             | Violation fires, red            |
| **Nested `-start` (`:132`)**               | **Yes — outer block survives** | **Suppressed inside the range** |
| Unclosed `-start` at EOF (`:227`)          | No                             | Violation fires, red            |
| **Undocumented directive (`:112`)**        | **Yes**                        | **Suppressed, green**           |

Two fail closed, one fails open, one is mixed.

**Nested `-start`, measured.** Outer documented `-start`, class A, nested documented `-start`,
class B, `-end`, class C — each with a `console.log`:

```
surviving violations at lines: [14]        ← class C only; A and B suppressed
check() threw (build red):     true
warning: Nested ts-archunit-exclude-start — close existing block first
```

`exclusion-comments.ts:131-138` returns before touching `openBlocks`, so the outer block stays
open and the first `-end` closes it at `:96-100` over the whole outer+nested region. What the
early return discards is only the nested directive's own rule IDs — and when it names the same
rule as the outer, which is what an agent adding a second exclusion inside an existing block
produces, it discards nothing. Net effect: **the block silently ends early at the first
`-end`.**

This is invisible today because `tests/helpers/exclusion-comments.test.ts:77-90` asserts only
that a `Nested` warning exists. It never inspects `result.exclusions`, and the fixture produces
a live `rule-a` exclusion with `endLine: 5` that nothing asserts.

**Unclosed `-start` cannot suppress before EOF**, for two independent reasons:
`parseExclusionComments` completes a full pass at `execute-rule.ts:107` before any filtering at
`:127`, and the EOF loop at `:226-232` pushes only warnings; `commentCoversViolation:250` also
requires `endLine !== undefined`.

## How narrow this actually is

Three gates, all measured. The bug is materially narrower than "an agent can stamp any file":

1. **The rule must carry an `id`** — `execute-rule.ts:102`. Without `.rule({ id })` an
   undocumented comment produces no suppression _and no warning at all_.
2. **A violation must already survive in that file** — `result.length > 0`, same line. A comment
   in a currently-clean file is never parsed. The warning only ever appears alongside the
   finding it is about to suppress.
3. **The producing condition must stamp `ruleId` itself.** This is a separate defect, filed as
   [bug 0041](./0041-an-exclusion-comment-is-a-no-op-for-most-conditions.md): the exclusion
   feature is a **no-op** for the library's most-used conditions. So the fail-open above reaches
   only `createViolation`-based conditions — `classes()`, and the others listed in 0041.

Gate 3 shrinks this bug and enlarges the problem. Fix 0041 first, or fixing this one closes a
hole in a feature that mostly does not fire.

## What a fix can and cannot buy

State this before writing code, because the obvious fix is weaker than it looks. **A required
reason is prose**: failing on `reason === ''` buys `: needed`, measured above, and an agent
writes it on the first retry. Rule 3's corollary is explicit that the marker is the problem,
not its metadata.

Four options, on different axes:

1. **Fail on an undocumented exclusion.** Changes the verdict. Cheap, consistent with rule 1,
   buys one round of friction plus a reason string a human reviewer can read. Ship it only with
   the release note saying it raises the cost of a suppression and does not prevent one.
2. **Report every applied exclusion as a finding.** Changes what is _reported_, not what is
   suppressed. Note the consequence before choosing it: such a finding has an **optional**
   remedy by rule 1's own discriminator, so `warn` is its correct level — which lands it on the
   carve-out ADR-008's own Notes flag as weaker than the rule assumes.
3. **Remove the inline-comment hatch**, relying on `.excluding()` and the baseline, which live
   in the rule file rather than in the code being judged. The rule-3-corollary answer. Breaking
   on **two** surfaces: a documented convention (`docs/violation-reporting.md:223-255`, three
   worked examples; `docs/what-to-check.md:531`) and public API (`src/index.ts:294-295` exports
   `parseExclusionComments`, `isExcludedByComment`, and the `ExclusionComment` /
   `ExclusionWarning` / `ParseResult` types; `docs/api-reference.md:70`).
4. **Keep the hatch, make the reason machine-checkable** — a ticket reference some other check
   resolves, rather than prose. Not breaking, and it reaches the rule-3-corollary goal that
   option 3 pays a break for.

## Re-rated High, and the reason is on this branch

Two paragraphs of this document became false the moment
[bug 0041](./0041-an-exclusion-comment-is-a-no-op-for-most-conditions.md) landed, which
was **the same branch**:

- _"the fail-open above reaches only `createViolation`-based conditions"_ — false. It reaches
  every family.
- _"Gate 3 shrinks this bug and enlarges the problem. Fix 0041 first."_ — that has happened.

Measured against a `main` worktree, `modules().notImportFrom()`, control at 1 on both sides:
a reason-free directive suppressed 0 findings before and suppresses all of them now. One
un-reasoned line is a build-green kill switch for any rule id, on the families an adopting team
reaches for first. That is High.

The guard advice below is stale for the same reason: a guard written against
`modules().notImportFrom()` no longer shows "not suppressed" for both cases.

## This document is two bugs, and the wrong one is in the title

**Split before working it.**

- **The nested `-start` half** (below) is a correctness defect with a bounded fix and no policy
  question beyond "error or nest properly". Medium-High. Worth doing.
- **The undocumented-reason half** — the title — is a four-option policy question whose own best
  argument is against fixing it: `: needed` reaches green **and silent** in one step, measured.
  Either close it won't-fix-as-specified with that measurement as the reason, or reduce it to a
  one-line decision. Do not carry four options indefinitely.

## Correction: the docs do not contradict the source

The first draft called this its strongest argument. It is wrong.
`docs/violation-reporting.md:255` read _"Requires a reason -- undocumented exclusions are
flagged as warnings"_ — the same sentence states the enforcement level, so the docs described
shipped behaviour accurately. "Requires" was loose, and v0.37.0 rewrote it to _"a reason is
expected; an undocumented exclusion still applies and emits a warning."_ No contradiction
remains to argue from.

## Why "undocumented" is the interesting row

Not because agents are careless — that is an unevidenced behavioural claim, and it fails on
row 2 anyway, where a nested `-start` is exactly what an agent produces. The checkable version:

**The other three are malformed syntax no author intends. Omitting a reason is well-formed, is
the shortest form that works, and the parser's own grammar comment sanctions it** —
`src/core/exclusion-comments.ts:44` documents `// ts-archunit-exclude <rule-id>` without a
reason as supported. That is the argument; the docs-contradiction version of it was wrong and is
retracted above.

## Guard

Behavioural, on a fixture whose rule genuinely finds a violation with no comment present at all
(the vacuity control).

**The builder choice is load-bearing and must be stated.** Because of bug 0041's `ruleId`
ordering, a guard written against `modules().notImportFrom()` shows "not suppressed" for the
documented case _and_ the undocumented case, every row passes, and the fix looks shipped while
doing nothing. Use a `createViolation`-based condition — `classes().should().notContain(...)` —
and say why in the test.

Rows:

- documented exclusion suppresses — the control; must stay green or the fix broke the feature;
- undocumented exclusion does not suppress, or fails, per whichever option lands;
- **the same two rows for the block form** (`:142`), which is a second fail-open site;
- `-end` without start, and unclosed `-start`, still fail closed;
- **nested `-start` behaves as decided** — today it suppresses through the outer block, so
  whatever the fix chooses, pin it. The first draft's row asserted "still fails closed", which
  would fail against current code.

## Related

- [ADR-008](../../adr/008-agent-first-failure-surfaces.md) rule 1, and rule 3's corollary on markers.
- [Bug 0041](./0041-an-exclusion-comment-is-a-no-op-for-most-conditions.md) — the ordering defect
  that gates this one. Fix first.
- [Plan 0072](../../plans/0072-a-denylist-glob-that-cannot-match.md) — the _unused_ exclusion
  (`execute-rule.ts:93`) is a different fault in the same area, already deliberated there.
- Bug 0024 is **not** the argument. It was fixed in v0.26.0 and its fix is the very
  `writeStderr` this path uses; the warning is delivered. The argument is that a delivered
  warning still never reaches the exit code.

## Fix as shipped

Both halves, and they needed different answers — which is why this document said to split it.

### The undocumented directive now fails

A reason-free directive produces an unsuppressable configuration finding. **The exemption still
applies**, and that is deliberate: refusing to apply it would make the stated remedy ("add a
reason") trade one failure for another — the violation itself — which is a remedy that does not
remediate. Add the reason and the finding clears while the exclusion keeps working. Measured.

The message does not overclaim, per the analysis above that survived review:

> Add a reason: `// ts-archunit-exclude <id>: <why>`. A reason is prose and nothing verifies it,
> so this raises the cost of a suppression rather than preventing one — the audience is the
> reviewer reading the diff. If the exemption is not justifiable, delete it and fix the finding
> instead.

`ExclusionWarning` gained a `kind` so the three **malformed** shapes keep their stderr line.
That distinction is load-bearing: two of the three decline to create the exclusion at all, so
the original violation still fires and the build is already red. A finding there would be noise
about a failure the reader can already see.

### Nested blocks nest

Block state moved from `Map<string, ExclusionComment>` to a **stack of frames** — one frame per
`-start` line, one `-end` closes one frame. Every currently-valid input behaves identically;
what changes is that nesting works instead of mangling both regions.

The old code refused _any_ nested `-start`, including one for a different rule, then let the
inner `-end` close the outer block. So exempting `arch/no-cycles` across a module and
`arch/no-any` across one function inside it produced two wrong results at once: the inner never
applied, and the outer stopped early at the inner's `-end`. Re-opening a rule that is _already_
open still warns — the likeliest cause is a missing `-end` — but now applies, because refusing
it is what produced the early close.

## Sabotage — 6 rows, 5 caught here, 1 caught elsewhere

Enumerated from `git diff`, verdicts from exit codes, each patch asserted to apply, baseline
asserted green first.

| Revert                                                  | Result                         |
| ------------------------------------------------------- | ------------------------------ |
| S1 — stop emitting the finding                          | CAUGHT                         |
| S3 — `bypassFilters: false` (suppressable)              | CAUGHT                         |
| S4 — `-end` closes the OUTERmost frame                  | CAUGHT                         |
| S5 — `-end` closes every open frame (the old behaviour) | CAUGHT                         |
| S6 — an unclosed frame goes unreported                  | CAUGHT                         |
| S2 — downgrade the finding to `severity: 'warn'`        | **GREEN — the field was dead** |

**S2 is the useful row.** The explicit `severity: 'error'` never did anything: `bypassFilters`
already forces `error` through `severityFor`, which every consumer path runs
(`terminal-builder.ts:229`, `executeCheck`, `executeWarn`). The line was removed rather than
left reading load-bearing. Sabotaging the **real** mechanism instead — making `severityFor` stop
forcing — is green against this bug's own tests and **red** against
`tests/core/unsuppressable-sentence.test.ts`, so the guarantee is guarded, one file over.

## What this does not fix

The ceiling stated when this was filed, unchanged and now shipped against: **`: needed` reaches
green in one step.** This buys a reason string in the diff for a human reviewer and one round of
friction. It does not prevent a determined suppression, and the release note says so.

Two related defects stay open: [bug 0043](./0043-an-exclusion-directive-inside-a-string-literal-suppresses.md)
(a directive inside a string literal counts) and
[bug 0044](../0044-an-inline-exclusion-comment-has-no-feedback-channel.md) (nothing reports a
comment that matched nothing). The rule-3-corollary answer — exclusion by construction — remains
unexplored.

## Two stale claims retracted

The "source and docs disagree" argument was wrong and is retracted above; v0.37.0 rewrote the
docs sentence anyway. And two tests that pinned the nested-block defect —
`exclusion-comments.test.ts:77` and `coverage-gaps.test.ts:1198` — asserted a warning existed
and **never inspected `result.exclusions`**, which is precisely how the real behaviour stayed
invisible. Both now assert the exclusions.
