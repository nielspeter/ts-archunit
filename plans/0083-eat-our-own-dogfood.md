# Plan 0083 — eat our own dogfood

**Status:** Open, not started. Filed 2026-08-04, out of the question "are we dogfooding all the new
ADR-008 features?" — asked during the v0.46.0 review, and answered **no** by measurement within
minutes, with two live gaps found and closed on the spot.
**Priority:** High. Not for the count, but for what the two closed gaps demonstrate: both were
features **we built to fix our own bugs** and then never pointed at ourselves. The next one will be
too.
**Effort:** Medium, and deliberately staged. Phase 1 is a triage with a stop rule; Phases 2 and 3
only happen if Phase 1 says so.
**Blast radius:** Mixed, and that is the reason for the staging. Phase 1 is an internal audit over a
corpus we control. Phase 2 adds rules to our own suite — internal. **Phase 3 builds a reference
consumer project, which is the one that touches published behaviour**, because it exercises the
library the way an adopter does and will find things our fixtures cannot. Per
[ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 6, Phase 3's findings get the behavioural
treatment; Phases 1–2 stop at "prove each detector fires".

## Problem

We ship a library whose entire thesis is that architecture rules must be **executable and
enforced**, and we do not enforce most of ours on ourselves.

Two gaps were found by asking the question once, and both were the same shape — a feature built to
fix our own bug, then never aimed at us:

| Feature                        | Built for                                                                                                                                  | Self-applied before 2026-08-04?                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orphanExclusions`             | [Bug 0044](../bugs/fixed/0044-an-inline-exclusion-comment-has-no-feedback-channel.md) — a directive naming a renamed rule is inert forever | **No.** Exercised only in its own unit test — while v0.45.6 had just put two real waivers into `src/`. Renaming the rule would have silently voided both. |
| comment-suppression disclosure | [Bug 0041](../bugs/fixed/0041-an-exclusion-comment-is-a-no-op-for-most-conditions.md)                                                      | **No.** We built a channel to report what comments silenced, then never pointed it at ourselves.                                                          |

Both are now checked, and both checks were proven to fire. That is not the finding. **The finding is
that nothing was watching the watchers**, and the same audit that found two will find more.

### The number does not reproduce, and that is the first finding

The first draft of this plan said **166** enforceable primitives, "derived from source — every
exported function in `src/conditions/`, `src/predicates/`, `src/rules/` and `src/smells/`". A product
review re-ran exactly that and got **185**. Re-running it again got **187**.

Three numbers, one stated derivation, **no committed script.** So it is not a derivation; it is a
recollection with a method attached. This plan cites
[plan 0079](./completed/0079-triage-the-cardinality-only-assertions.md)'s lesson — _the filed number
came with no script, so it could not be reproduced or audited_ — and then repeated it one level up,
applying the discipline to the numerator's work list and not to the denominator.

Worse, the definition was already wrong on its own terms: the `src/smells/` entries it counted are
`buildFingerprint` and `computeSimilarity`, internal helpers, not primitives you point at code —
the same category error this plan rejects for `TerminalBuilder` and `STANDARD_HTML_TAGS`.

**The ratio is withdrawn**, including from `plans/ROADMAP.md`, and it is not to be requoted. What
survives is the qualitative finding, which needs no denominator: two features built to fix our own
bugs were never aimed at us, and nothing was watching the watchers.

### Phase 0 — a committed derivation, or no number at all

Before any triage: a script in the repo that produces the population, with the same standing as
`tests/tools/scan-cardinality-assertions.ts`. It must exclude internal helpers, and its output is the
input to Phase 1.

**If a defensible definition of "enforceable primitive" cannot be written, that is the answer** — the
plan proceeds on classification alone, with no ratio, and the absence of a clean definition is itself
recorded. A number nobody can reproduce is worse than no number: it invites exactly the coverage
chase the rest of this plan is written to avoid.

## Phase 1 — triage, with the stop rule written first

Classify all 166 into four classes, by reading. Same shape as 0079, including its discipline: the
threshold is fixed **before** looking.

| Class                                          | Meaning                                                                         | Action                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------- |
| **A — enforced**                               | Already applied to `src/` in `tests/archunit/`                                  | None. The 41.                                   |
| **B — a real constraint we are not enforcing** | This repo genuinely has this architectural property and no rule asserts it      | **Add the rule.** This is the actionable class. |
| **C — not our architecture**                   | The feature needs a shape we do not have (JSX, GraphQL, layers, a DI container) | Phase 3, or recorded as fixture-only            |
| **D — no honest rule exists here**             | Applying it would be a rule we do not believe                                   | Record the reason. Do **not** add.              |

**The stop rule, fixed now:** if class **B** is under ~10% of the 166, Phase 2 is the whole of the
remedial work and Phase 3 is judged on its own merits rather than as a coverage exercise. If B is
larger, we have been under-enforcing our own architecture and Phase 2 grows accordingly.

**A second measurement, independent of the classification** (rule 5 — one reader's judgement over
166 items is a single derivation, and its bias would be invisible in a re-read). The first draft got
the operator backwards, which is worth recording because the error was self-flattering:

> ~~for each of the ~30 rules, **delete it** and confirm the suite reds. A rule that can be deleted
> with the suite green is enforcing nothing.~~

**Deleting a passing check from a green suite leaves it green.** `src/` complies with all 37 rules
today, so "delete it and the suite reds" is false by construction for nearly every one — measured:
removing the `adr005/no-as-cast` rule entirely leaves 45 of 45 passing. The audit's answer was
pre-determined, and its stated inference would have reclassified essentially the whole of class A as
class B. A measurement that can only return one result is not a measurement.

The one exception proves the mechanism rather than the rule: deleting `adr005/no-as-cast-module` _does_
red, because the `orphanExclusions` check notices its two inline waivers going stale. So the deletion
audit measures **whether some other guard happens to name the rule's id** — 1 of 37.

**The correct operator is the one Phase 2 already prescribes: plant the violation the rule forbids and
watch it red.** Applied to the existing 37 that is genuinely independent of a reading-based
classification, and it is the operator that would have caught
[bug 0049](../bugs/fixed/0049-the-type-assertion-self-check-selected-classes.md) — a class-A rule
scoped to `classes` in a codebase of 19 class files and 128 function files, silent on 22 real casts.
Deleting that rule reds nothing; planting a cast in a function finds it instantly. Bug 0049 is this
plan's own closest precedent, and the audit as first written would have missed it.

**And there is a cheap route to most of it.** `tests/fixtures/` is a corpus built to _violate_ these
rules — `arch-rules.test.ts` records the measurement in a comment: scoping to `'**/src/**'` was chosen
because the fixture tree "reds 13 rules on 89 hits". Point each rule at the fixture tree and assert it
reds. Dirty corpus versus clean corpus is real independence in rule 5's sense, and it is nearly free
for at least a third of the 37.

**Run this first, standalone, before any classification.** It depends on nothing else, it is the
highest yield item in the plan, and if it finds another bug 0049 then **class A is not a safe bucket**
and the meaning of the whole triage changes. That is worth knowing before spending the reading budget.

**Also: it is 37 rules, not "~30".** The file itself carries 36, 39, 41 and 43 in four separate
comments — four hand-maintained counts of one population, in the file whose purpose is to distrust
hand-maintained claims. The audit derives the number; fixing those comments is a free side effect.

## Phase 2 — enforce class B

Add the rules, each with the same bar every other rule in that file meets: a real `because`, a
verified `suggestion`, and a scope guarded against vacuity. `arch-rules.test.ts` already carries the
non-vacuity apparatus (`BUILT`, the `edgesOf` control) — reuse it, do not invent a second one.

**Every added rule must be shown to fail.** Not "the suite is green with it" — that is the state
this plan exists to distrust. Introduce the violation it forbids, watch it red, revert.

## Phase 3 — a reference consumer, for what we cannot host

The honest answer for class C, and the part with real value beyond coverage.

A fixture project under `tests/reference/` shaped like an adopter's codebase — layers, a JSX
component tree, a GraphQL schema, a slice structure — with a rule file that turns on **every preset
we ship** plus the class-C primitives. Run it in CI. Assert on its findings **by identity**.

Two things this catches that unit fixtures cannot, and both have already bitten us:

- **A preset that is individually correct and collectively wrong.** Presets fan out; bug 0034's
  shape lives here.
- **A feature that works on a five-line fixture and not on a real file.** Every fixture in
  `tests/fixtures/` is written to exercise one condition. None is a _codebase_.

**Explicitly not a snapshot** (ADR-008 rule 4). Snapshotting the findings would produce a file
nobody reads that goes green on any change to it. Assert identities: which rules fire, on which
elements.

**The honest risk, recorded now:** a reference project is a fixture that looks like a codebase, and
it can rot into one that is written to satisfy the rules rather than to resemble a consumer. The
guard is that it must be **derived from a real shape** — model it on the structures the docs teach
in `docs/what-to-check.md`, so a divergence between what we document and what we can enforce shows
up as a failure here.

## Test inventory

1. Phase 1's classification is **recorded in the repo**, not in a plan write-up — a committed table,
   the same lesson as 0079's scan, which cited a script in a scratch directory that was never
   committed while claiming the numbers were auditable.
2. Every class-B rule added in Phase 2 demonstrated to fail on a planted violation.
3. The delete-each-rule audit run once, its result recorded, and any rule that survives deletion
   either fixed or reclassified.
4. Phase 3's reference project asserted by identity, with a vacuity floor — a reference project
   whose rule file selects nothing is the exact false green this library is named after.
5. A guard that the count does not silently regress: the same shape as
   `tests/tools/scan-cardinality-assertions.test.ts`'s ratchet, keyed on **which primitives** are
   enforced rather than how many.

## Out of scope

- **Raising the number for its own sake.** Stated twice on purpose. Class D exists so that "we
  deliberately do not enforce this, and here is why" is a recordable outcome rather than a gap.
- **Dogfooding the CLI in CI** (`doctor` as a build step). Worth doing, and a separate decision:
  `diagnose()` — doctor's engine — is already self-applied, so this is about the command surface,
  not the logic.
- **The 197-of-252 export figure.** Withdrawn as meaningless; recorded here only so it is not
  rediscovered and quoted.

## Related

- [Plan 0079](./completed/0079-triage-the-cardinality-only-assertions.md) — the template for a
  sample-and-stop-rule triage, and the source of the "do not publish a heuristic as a backlog"
  lesson.
- [Bug 0049](../bugs/fixed/0049-the-type-assertion-self-check-selected-classes.md) — the closest
  precedent: our own rule pointed at the wrong element kind, so it never fired on 22 real
  violations. A self-check that exists is not a self-check that works.
- [ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 6 — why Phase 3 is treated differently
  from Phases 1–2.
