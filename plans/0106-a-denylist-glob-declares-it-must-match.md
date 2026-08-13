# Plan 0106 — a denylist glob declares it must match

**Status:** READY, not started. Scheduled 2026-08-13, split out of
[plan 0072](./0072-a-denylist-glob-that-cannot-match.md)'s "What is actually left" section — that
plan refuted two diagnosis mechanisms and left one open product question ("whether this earns API
surface") unanswered. That question is now answered: build it.
**Priority:** Medium. A real, measured false-green class (see Problem), but opt-in and — as of
0072's filing — never yet observed in the wild. Nothing else depends on this shipping.
**Effort:** Medium. Phase 1 is an investigation spike, not a known implementation — see "What
changed since 0072" below for why the obvious precedent (`.expectNonEmpty()`) turned out not to be
the right one to copy, and why the actual mechanism needs to be located before it can be built.
**Blast radius:** **Published API, on the condition/builder surface.** A new opt-in method reaching
two conditions (`notImportFrom`, `onlyHaveTypeImportsFrom`). Per
[ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 6's table, this is the top row —
"strangers depend on it, and we cannot fix it for them" — so it gets the full treatment: guard the
guard, adversarial review, sabotage-verify before shipping, not the lighter internal-corpus bar.

## The fault, which is real (carried forward from 0072, unchanged)

`notImportFrom('**/legcay/**')` reports zero violations forever, and that is indistinguishable
from a ban being respected. Measured on `tests/fixtures/module-edge-conditions`, a real glob
against a one-character typo:

| condition                    | real glob | typo'd glob | verdict    |
| ---------------------------- | --------- | ----------- | ---------- |
| `notImportFrom`              | 13        | **0**       | **silent** |
| `onlyHaveTypeImportsFrom`    | 9         | **0**       | **silent** |
| `onlyImportFrom`             | 3         | 16          | loud       |
| `dependOn`                   | 8         | 15          | loud       |
| `onlyBeImportedVia`          | 5         | 11          | loud       |
| `resideInFile` (condition)   | 0         | 2           | loud       |
| `resideInFolder` (condition) | 0         | 2           | loud       |

**Two conditions, not one.** `notImportFrom`'s glob is a denylist — a match is a violation.
`onlyHaveTypeImportsFrom`'s glob **scopes** which imports must be type-only — a glob matching
nothing puts no import in scope, so the rule cannot fire either. Any successor must cover both.

**Why neither a static nor a runtime diagnosis mechanism can work** — both refuted in 0072 by
measurement, not carried in detail here (see that plan for the full record):

- **Static (unsatisfiable-against-the-path-universe) fails on a real, legitimate case.**
  `notImportFrom('**/legacy/**')` in a repository with no `legacy/` folder yet is a correct,
  pre-emptive ban — this exact glob, in this exact condition position, is the condition's own
  JSDoc example (`src/conditions/dependency.ts:280`); `docs/modules.md`'s Conditions table
  (line 49) teaches the same shape with a different glob (`**/controllers/**`). Nothing static
  distinguishes "typo" from "armed tripwire": they are the same string, same position, same
  match count (zero), and 0069's own decision table already reached this conclusion before 0072
  re-opened it.
- **Runtime (a glob-exercise tally) distinguishes nothing either.** Every edge is tested against
  the glob whether or not the ban is respected — `tested > 0, matched == 0` is byte-for-byte what
  a respected ban produces.

**The only thing that separates a typo from a pre-emptive ban is intent**, which is not in the
code. It has to come from the author, as a declaration.

## What changed since 0072 (2026-07-30 → 2026-08-13) — why the precedent shifted

0072 modeled its sketch on `.expectNonEmpty()`, shipped in 0.18.0 as the **opt-in** escape from
selector-emptiness passing vacuously. That was the right analogy in July. It is stale now, for a
reason found while grounding this plan rather than assumed from 0072's text:

**Plan 0074 flipped selector emptiness to fail-CLOSED by default**, with `.expectEmpty()` as the
new opt-**out** (`src/core/rule-builder.ts:509`, `filtered.length === 0` is a fault unless
declared). `.expectNonEmpty()` is the polarity 0074 inverted away from — copying it now would be
modeling this plan on the mechanism the codebase has already moved past, not the current one.

**This does not change 0072's own conclusion that the denylist case must stay opt-IN** — that
argument was never "match `.expectNonEmpty()`'s polarity," it was "a denylist matching nothing is
legitimately correct far more often than a selector matching nothing is," and 0074 changing the
selector default doesn't touch that. What it changes is which existing mechanism is the live
precedent to build against. Two candidates, both newer than `.expectNonEmpty()`:

1. **The `assertEnabled()` / `declaredEmptyFindings()` / `overrideFindings()` family**
   (`src/presets/shared.ts`) — only `assertEnabled()` is plan 0100's own contribution;
   `declaredEmptyFindings()` is plan 0089's and `overrideFindings()` traces to bug 0038, though
   0100's own text discusses all three together as one established family. The freshest precedent
   for "manufacture a config-finding, `bypassFilters: true`, computed after the real run, only when
   nothing else already explains the state." Shape-compatible with this plan's own inherited
   constraints (see below) — but see Phase 1 item 3: the closer implementation-location precedent
   is `emptySelectionViolation()`, which (unlike this family) fires from a condition-adjacent
   pipeline step, not from pure construction-time facts.
2. **0073's condition-declared-globs** (`Condition<T>.globs`, already shipped) — gives every
   condition a declared glob surface `diagnose()` can see, but by 0072's own measurement this
   surface answers "is the glob syntactically dead" (which `syntacticFault` already covers), not
   "did this glob match anything during a REAL run" — a different question this plan still needs
   to answer at the evaluation layer, not the declaration layer.

**The harder question 0072 didn't reach, because it stopped at the design-constraints level:**
`notImportFrom`'s violations and its glob-matches are the **same event** — every match IS a
violation (`src/conditions/dependency.ts:283-326`, `matchedCandidate(...) !== undefined` pushes a
violation on the spot). So "the glob matched nothing across this run" and "this condition produced
zero violations across this run" are the identical fact, observed two ways.

**Corrected from an earlier draft of this plan, which claimed the condition's own `evaluate()`
"sees one subject at a time" — checked against the actual signature and it does not.**
`evaluate(sourceFiles: SourceFile[], context: ConditionContext)` receives the **entire** filtered
subject array in one call (`src/conditions/dependency.ts:304`), and `RuleBuilder`'s own loop calls
it exactly once per condition with the complete set (`condition.evaluate(filtered, context)`,
`src/core/rule-builder.ts:532-534`) — full within-run visibility already exists inside a single
`evaluate()` call. That is not why this can't live in the condition. The real reasons: (a)
`Condition<T>` is a plain, context-free object (`{ globs, description, evaluate }`) with no way to
know whether `.expectGlobsMatch()` was declared for it — that flag has to live on the builder,
where `.should()`/`.andShould()` already track state; and (b) manufacturing the actual
`bypassFilters: true` config-finding needs builder-level context (`_reason`, `_metadata`, severity
handling) that only `RuleBuilder`/`TerminalBuilder` carry, mirroring exactly how
`_expectEmpty`/`emptySelectionViolation()` already work (`rule-builder.ts:506-513`). So the
signal — did this specific, flagged condition produce zero violations — is trivially available
the moment `condition.evaluate(filtered, context)` returns inside the existing loop
(`rule-builder.ts:530-534`); what's missing is the flag itself and where to attach the manufactured
finding, not cross-subject aggregation machinery. Closer to `assertEnabled()`'s "compute after the
real run, append a manufactured finding" shape in outcome, though `assertEnabled()` itself fires
from pure construction-time facts (unknown override key, zero rules built) and never touches a
condition's `evaluate()` output — the analogy is to the finding-manufacture pattern, not to where
in the pipeline it fires.

## Design constraints (carried from 0072, unchanged — still correct)

- **An opt-IN, and that direction is not negotiable.** 0069's appendix already rejected the
  opt-out (silent forever, typo or not) and the no-opt-out-at-all option (deletes legitimate
  tripwires). An opt-in inverts both: the default keeps working for pre-emptive bans, and the
  declaration is the thing a reviewer can see.
- **It must fail, not warn** (ADR-008 rule 1). Once declared, the remedy is not optional — fix the
  glob or drop the declaration — so this is a configuration finding: `bypassFilters: true`, forced
  to `error` by `severityFor`, refused by `.excluding()`, skipped by diff and baseline. Identical
  treatment to every other "this rule cannot fire" finding.
- **The remedy must be per-cause** (ADR-008 rule 2). A denylist glob matching nothing has two
  likely causes needing opposite fixes: a **misspelling** (fix the glob) or **the banned code was
  already deleted** (drop the declaration/rule). 0069's generic dead-glob remedy ("append `/**`")
  is right for a selector and wrong here.
- **It must say there is no escape hatch** (ADR-008 rule 3), the sentence 0.23.0 added to every
  configuration finding.
- **It must cover both silent conditions** — `notImportFrom` and `onlyHaveTypeImportsFrom` — and
  must **not** fire for the five loud ones (see the table above), which need no declaration because
  a typo there is already maximally loud.

## Phase 1 — locate the mechanism (spike, not yet run)

Following this project's own precedent — [plan 0048](./0048-using-tagged-symbol-matcher.md) ran an
executed investigation (`tests/investigation/plan-0048-spike.test.ts`, against real ts-morph 27
behavior) before locking its implementation phases, and it corrected real API assumptions
(`getExportSymbolIfAlias` doesn't exist; only `getAliasedSymbol()` does). [Plan
0047](./0047-typescript-escape-hatch-matchers.md) is a related but different precedent — a
grounded source-reading review, not an executed spike — that caught its own real bug (class/function
traversal misses sibling type positions) by reading `body-traversal.ts` rather than running code.
This plan does not invent implementation code it hasn't verified. Before Phase 2 can be written for
real:

1. **Resolved while grounding this plan, not deferred to the spike:** `condition.evaluate(filtered,
context)` is called once per condition with the **entire** filtered subject array
   (`src/core/rule-builder.ts:532-534`), so a condition's own `evaluate()` already has full
   within-run visibility — "zero violations from this condition across the whole run" is available
   the moment that call returns inside `RuleBuilder`'s existing loop (`rule-builder.ts:530-534`), no
   new side-channel on `Condition<T>`'s return type needed. What Phase 1 still has to resolve is
   _not_ that signal — it's (a) where `.expectGlobsMatch()`'s declaration is stored so the loop
   knows WHICH condition instance it applies to, and (b) how that survives `.andShould()`'s
   multiple-condition case (scoped per-condition or per-rule).
2. Decide where the opt-in itself is declared. 0072's sketch chains it directly after the
   condition (`.should().notImportFrom(...).expectGlobsMatch()`), which reads as a
   `ModuleRuleBuilder` method, not a `Condition<T>` method (conditions are plain objects,
   `{ globs, description, evaluate }` — no fluent surface). Confirm that's still the right
   attachment point, and how it identifies which condition in an `.andShould()` chain it flags —
   the builder needs to associate the declaration with a specific condition instance, not just a
   boolean on the rule.
3. Confirm the manufactured finding's shape and attachment point against `emptySelectionViolation()`
   (`rule-builder.ts:453-487`) as the direct precedent — same `bypassFilters: true` shape, same
   `_reason`/`_metadata` access, same builder-level home — rather than `assertEnabled()`, which is
   the right shape-analogy but fires from construction-time facts, never from a condition's
   `evaluate()` output.
4. Re-verify the Problem section's table against current `src/conditions/dependency.ts` (the
   0072 measurement is 2 weeks old; confirm the two silent rows haven't changed shape under 0073's
   condition-declared-globs work).

**Only after this spike are Phases 2+ (implementation, tests, docs) written** — writing them now
would be inventing code against a mechanism not yet confirmed to exist at the seam this plan
currently guesses it's at.

## Out of scope

- **Condition-declared globs** — [plan 0073](./completed/0073-conditions-declare-their-globs.md).
  Already shipped; the prerequisite, not part of this plan.
- **[Bug 0015](../bugs/fixed/0015-allowlist-conditions-pass-vacuously-on-edgeless-subjects.md)** —
  the `only*` family passing on an edgeless subject. A different fault, different owner.
- **0069's R3b** — the _selector_ glob guard, gated on an adopting codebase's `doctor` pre-flight.
  Unaffected by any of this.
- **Whether `.expectGlobsMatch()` should exist at all beyond these two conditions** — e.g. a
  general per-condition "declare this must fire at least once" primitive. This plan is scoped to
  the two measured silent conditions; a generic version is a separate, larger product question.

## Related

- [Plan 0072](./0072-a-denylist-glob-that-cannot-match.md) — where this was measured, two
  mechanisms refuted, and this successor first sketched.
- [Plan 0069](./completed/0069-no-rule-may-certify-nothing.md) — the decision table this plan's
  refutations both trace back to.
- [Plan 0073](./completed/0073-conditions-declare-their-globs.md) — the prerequisite that gave
  conditions a glob-declaration surface (necessary but not sufficient for this plan, see "What
  changed since 0072").
- [Plan 0074](./completed/0074-r3b-the-selector-glob-flip.md) — flipped selector emptiness to
  fail-closed by default; the reason `.expectNonEmpty()` is not this plan's precedent anymore.
- [Plan 0100](./completed/0100-a-preset-that-constructs-nothing.md) — `assertEnabled()`'s
  "manufacture a config-finding after the real run, only when nothing else explains it" shape is
  this plan's closest current precedent.
