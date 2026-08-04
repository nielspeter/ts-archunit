# Plan 0086 — a remedy that names the folder the rule selects

**Status:** Open, not started. Filed 2026-08-04 from
[plan 0084](./completed/0084-cycle-detection-that-ignores-type-only-imports.md)'s sabotage matrix, where
reverting a fixed remedy to its broken original was **caught by nothing**.
**Priority:** Medium. It is a detector for the one class of broken remedy that is mechanically
detectable, and [ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 2 currently has no automated
enforcement of any kind.
**Effort:** Small-medium. One condition over rule metadata, plus the question of where it runs.
**Blast radius:** **An internal check over a corpus we control** — our own rules and our own presets —
_if_ it ships as a test. It becomes published API the moment it is exported as a rule for users to run
on their own rules, which is Phase 3 and a different row. Per rule 6: prove the detector fires on each
shape and stop; do not chase it further while it is only pointed at us.

## Problem

ADR-008 rule 2 says every failure carries a remedy **verified to remediate**, not merely to read well.
Nothing checks this. It is honoured by review, and review missed this one for months:

```ts
modules(p)
  .that()
  .resideInFolder('**/src/helpers/**')
  .should()
  .notImportFromCondition('**/src/builders/**')
  .rule({
    id: 'arch/helpers-no-builders',
    suggestion: 'Move the shared logic to src/helpers/ or src/core/',
  })
```

The violating file is **in `src/helpers/`**. Half that remedy instructs the reader to move the code
where it already is. An agent following it produces a no-op commit and re-runs into the same failure —
and an agent is the primary consumer this ADR was written for.

It survived because there is no way for it to fail. Fixed by hand in plan 0084; sabotage then showed
that restoring the broken text keeps all 3009 tests green, so the _class_ is unguarded even though the
_instance_ is fixed. That distinction is rule 5.

## The general problem is not solvable; this slice is

"Does this prose remedy actually fix this violation" is not decidable, and a plan that claims otherwise
should be rejected. But one shape is mechanical and it is the one that bit us:

> **A remedy must not tell the reader to move code into a location the rule's own predicate selects.**

If the predicate selects `**/src/helpers/**`, then every element the rule can possibly report is
already in `src/helpers/`, so "move it to `src/helpers/`" is provably a no-op **for every violation the
rule can produce**. No prose understanding required — the folder the rule selects is in the rule, and
the folder the remedy names is a path-shaped substring.

That is a narrow claim, and narrow is the point: it is the difference between a detector that fires on
a real defect and a linter for English.

## Phase 1 — extract the locations a remedy names

Given a `suggestion` string, find the path-like tokens: slash-containing, non-whitespace, optionally
trailing-slashed — `src/core/`, `src/helpers/`, `../models/foo.js`. Ignore bare identifiers and prose.

Test this in isolation before using it. The failure mode of a scanner like this is that it silently
finds nothing and the whole check becomes a rule that cannot fail — the exact shape this repo keeps
finding. So a row asserting the extractor returns **non-empty** for each remedy in our own suite is not
optional; it is the vacuity guard, and per ADR-008 rule 4 it should assert _which_ tokens, not how many.

## Phase 2 — compare against the rule's own glob sites

`diagnose()` already reaches every rule's globs through `globs()` / `GlobNode`, which is how the dead-glob
check works — reuse it rather than re-deriving the selection. For each rule: if a location named in the
`suggestion` is inside a folder the rule's **selecting** predicate matches, that is the finding.

Two distinctions to get right, and both are where a naive version produces false positives:

- **Selecting vs. asserting globs.** `resideInFolder('**/src/helpers/**')` selects; the
  `notImportFromCondition('**/src/builders/**')` argument is the _forbidden target_. A remedy naming
  `src/builders/` in a rule that forbids importing from `src/builders/` is not necessarily wrong — it
  may be telling the reader to move the file _there_, which is exactly the advice bug 0054 wants. Only
  the selection makes a remedy a no-op. `isFaultPosition` in `src/core/glob-site.ts` already draws a
  distinction of this kind; check whether it is the one needed here before inventing another.
- **Naming a folder for context is not the same as naming it as a destination.** "Helpers may not import
  builders" mentions both and instructs nothing. The check is about a _move target_, so it needs the
  verb, and that pushes back toward prose. Simplest defensible cut: flag only when the selected folder
  appears in the remedy **at all**, accept the false positives, and let each be silenced by rewriting
  the remedy — which is an improvement either way. Decide this deliberately; do not discover it.

## Phase 3 — where it runs, and whether users get it

Three options, and the choice matters more than the implementation:

1. **A test in `tests/archunit/`** over `BUILT`. Cheapest, guards our own 37 rules, ships nothing. It is
   what the sabotage row asked for and it is enough to close this plan.
2. **Inside `diagnose()`**, so `npx ts-archunit doctor` reports it for a user's own rules. More valuable
   and a bigger commitment: it becomes published behaviour, and a false positive is then _our_ bug in
   _their_ build.
3. **An exported condition** so a team can assert it over their own rule set. Most general, and the
   Lego-brick shape this project prefers — but only worth it if the false-positive rate from Phase 2 is
   low enough to gate a build on, which is unknown until Phase 1 and 2 are measured.

**Recommendation: ship 1, measure the false positives on our own corpus, and only then decide between 2
and 3.** Do not build 3 first on the theory that generality is free — a detector for broken remedies
that itself produces unactionable findings is a joke this repo would deserve.

## Test inventory

1. **The historical defect, verbatim.** `arch/helpers-no-builders` with
   `'Move the shared logic to src/helpers/ or src/core/'` and a `**/src/helpers/**` selection → one
   finding, naming `src/helpers/`. This row is the plan; it must red against the pre-0084 text.
2. **The fixed remedy passes.** The text shipped in 0084 names `src/core/` and `src/builders/`, neither
   selected → no finding. Proves the check discriminates rather than firing on any path.
3. **A remedy naming the forbidden target is not a finding** — the selecting/asserting distinction, and
   the row a naive implementation fails.
4. **Every rule in our own suite**, as the end-to-end row. It must currently be clean, which also makes
   it the vacuity control: if it reports nothing _and_ row 1 passes, the check works.
5. **VACUITY: the path extractor returns the expected tokens** for each remedy in `BUILT`, by identity.
   Without it the whole check passes over an empty token set forever.
6. **A rule with no `suggestion` is skipped, not crashed** — most rules carry only `because`.

## Out of scope

- **Judging whether a non-path remedy is correct.** Undecidable, and pretending otherwise is worse than
  the gap.
- **Verifying `because` texts.** Different claim: `because` states a reason, not an action, so
  "unapplicable" does not apply to it.
- **Rewriting the remedies this finds.** Each is its own small fix, and each needs the judgement of
  someone who knows the rule.

## Related

- [Plan 0084](./completed/0084-cycle-detection-that-ignores-type-only-imports.md) — fixed the instance; its
  sabotage matrix proved the class was unguarded.
- [ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 2 — the rule with no enforcement, and
  rule 6, which is why this starts as a test over our own rules rather than as published API.
- `src/core/diagnose.ts`, `src/core/glob-site.ts` — the glob-site machinery to reuse.
