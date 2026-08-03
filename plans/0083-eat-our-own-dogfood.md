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

### The number, and why it is not a work list

Derived from source — every exported function in `src/conditions/`, `src/predicates/`, `src/rules/`
and `src/smells/`, which is the enforceable surface, the primitives you point at code:

|                                                |                                                          |
| ---------------------------------------------- | -------------------------------------------------------- |
| Enforceable primitives                         | **166**                                                  |
| Applied to our own `src/` in `tests/archunit/` | **41** (25%)                                             |
| Not applied                                    | **125** — of which only **8** are JSX- or GraphQL-shaped |

**Do not treat 125 as a backlog.** [Plan 0079](./completed/0079-triage-the-cardinality-only-assertions.md)
paid for exactly that mistake: a heuristic upper bound published as work. An earlier cut of this
audit said "197 of 252 public exports unused", which was worse — it counted `TerminalBuilder`,
`RuleBuilder` and `STANDARD_HTML_TAGS`, none of which is a thing you apply to source.

The real obstacle is not effort. It is that **most of the 125 would be dishonest rules here.**
`beAsync()` applied to our source is not an architectural constraint we believe in; it is a rule
written to make a coverage number move. A rule nobody believes in is its own kind of lie — it gets
`.excluding()`d at the first inconvenience, and then it is a dead check counted as coverage, which
is the thing ADR-008 exists to prevent. **Adding rules to raise this number would be the failure
mode, not the fix.**

So the question this plan has to answer first is not "how do we apply 125 primitives" but **"what
does dogfooding mean for a feature whose architecture we do not have?"**

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

**A second measurement, independent of the classification** (rule 5 — my own reading of 166 items is
one derivation, and its bias would be invisible in a re-read): for each of the ~30 rules in
`tests/archunit/arch-rules.test.ts`, delete it and confirm the suite reds. A rule that can be
deleted with the suite green is enforcing nothing, and that is a class-A entry that is really class
B. This is cheap and it audits the 41 rather than the 125 — the direction nobody looks.

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
