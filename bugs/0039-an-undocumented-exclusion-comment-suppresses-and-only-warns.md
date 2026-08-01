# Bug 0039: an undocumented exclusion comment suppresses the finding and only warns

**Reported:** 2026-08-01 · **Verified:** 2026-08-01, all four parse paths run behaviourally
**Found in:** v0.36.3, by the ADR-008 compliance audit
**Severity:** Medium, and genuinely arguable — the ceiling on any fix is one round of friction,
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
   [bug 0041](./fixed/0041-an-exclusion-comment-is-a-no-op-for-most-conditions.md): the exclusion
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

## Why "undocumented" is the interesting row

Not because agents are careless — that is an unevidenced behavioural claim, and it fails on
row 2 anyway, where a nested `-start` is exactly what an agent produces. The checkable version:

**The other three are malformed syntax no author intends. Omitting a reason is well-formed, is
the shortest form that works, and the parser's own grammar comment sanctions it** —
`src/core/exclusion-comments.ts:44` documents `// ts-archunit-exclude <rule-id>` without a
reason as supported, while `docs/violation-reporting.md:255` says "Requires a reason". The
source and the docs disagree. That is a fact about the repository, and it carries the argument
better than a claim about behaviour.

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

- [ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 1, and rule 3's corollary on markers.
- [Bug 0041](./fixed/0041-an-exclusion-comment-is-a-no-op-for-most-conditions.md) — the ordering defect
  that gates this one. Fix first.
- [Plan 0072](../plans/0072-a-denylist-glob-that-cannot-match.md) — the _unused_ exclusion
  (`execute-rule.ts:93`) is a different fault in the same area, already deliberated there.
- Bug 0024 is **not** the argument. It was fixed in v0.26.0 and its fix is the very
  `writeStderr` this path uses; the warning is delivered. The argument is that a delivered
  warning still never reaches the exit code.
