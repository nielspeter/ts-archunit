# Bug 0015: `onlyImportFrom` passes on a file with no imports, however broken the allowlist

**Reported:** 2026-07-25
**Fixed:** 2026-07-31 — **not yet released.** Option 2, as this file decided.
**Found in:** all versions through v0.19.0
**Severity:** Medium — the allowlist family is silent exactly where an allowlist matters most, and one of the two affected conditions documents the behaviour without treating it as a defect.

## Description

The `only*` family constrains **edges**, not subjects. Each iterates a subject's
imports (or importers) and reports a violation per edge that falls outside the
allowlist. A subject with **zero edges** therefore has nothing to violate and
passes, no matter what the allowlist says — including when the allowlist is a
typo that matches nothing.

Measured against a single file containing no imports at all:

```
subjects selected                                     1
onlyImportFrom('**/nowhere/**')  (broken allowlist)   0 violations
```

Affected:

| Site                                       | Note                                                                                   |
| ------------------------------------------ | -------------------------------------------------------------------------------------- |
| `src/conditions/dependency.ts:63`          | `onlyImportFrom` — iterates `sf.getImportDeclarations()`                               |
| `src/conditions/dependency.ts:233`         | `onlyHaveTypeImportsFrom` — same shape                                                 |
| `src/conditions/reverse-dependency.ts:146` | `onlyBeImportedVia` — **documents it**: _"Modules with zero importers pass vacuously"_ |

## Why it matters more than the count suggests

The shape it fails on is not an edge case, it is the target case. In a layered
architecture the **innermost layer** — domain, entities, core — is the one an
allowlist is written to protect, and it is characteristically the layer with the
fewest outbound imports. A `domain/` module with no imports yet passes
`onlyImportFrom(...)` unconditionally, so the rule certifies nothing precisely
where the architecture most depends on it.

The existing comment at `reverse-dependency.ts:146` is honest about the mechanism
and silent about the consequence: passing vacuously is recorded as behaviour, not
as a gap.

## Why plan 0069 does not close it

[Plan 0069](../../plans/completed/0069-no-rule-may-certify-nothing.md) guards globs that cannot
match the project. This is a different failure: the glob may be perfectly
satisfiable and the rule still certifies nothing, because the **subject has no
edges to test**. A typo'd allowlist glob is the loud case — every import falls
outside it, so every import violates. The silent case is the edgeless subject,
which no glob check can see.

Filed separately, at review's insistence, so it does not live only inside a plan
that eventually moves to `plans/completed/`.

## Suggested fix

Two candidates, both needing a decision rather than just code:

1. **An edge-count assertion**, symmetric with `.expectNonEmpty()` for subjects —
   opt-in, so a genuinely import-free module stays green when that is intended.
2. **Report the edgeless subject count** in `explain` / `--format json`, so a
   reader can see that a rule ran over N subjects and tested 0 edges. Diagnostic
   rather than gate; cheaper, and it composes with plan 0069's reporting.

Option 1 is the enforcement answer and repeats the opt-in mistake plan 0069
exists to correct. Option 2 is honest but does not fail. Deciding between them
should wait until 0069's reporting surface exists, so this bug does not invent a
third mechanism.

## Consequence for plan 0069's claims

R3's changelog must scope its claim to **path globs**. "Rules that enforce
nothing now fail" would be false while this is open, and the counter-example
sits in the canonical layered-architecture rule.

## Option 1 is refuted — measured, 2026-07-29

This bug filed two options and said the choice should wait for plan 0069's reporting surface.
That deciding is done: **option 1 (fail on an edgeless subject) is refuted, and so is a
rule-level version of it.** The evidence lives here rather than in
[plan 0071](../../plans/completed/0071-one-definition-of-a-module-edge.md), which designed and then withdrew
it — plans move to `completed/`, and this bug was filed separately precisely so its reasoning
would not live only inside one.

**Per-subject failure has no statable remedy.** 14 of this repo's 138 `src/` files have zero
static imports and 10 are pure leaf modules — `tarjan.ts`, `ansi.ts`, `code-frame.ts`,
`stderr.ts`, `shallow-clone.ts` and siblings. `tarjan.ts` is a dependency-free algorithm, the
ideal innermost-layer citizen, and would fail `layered/innermost-isolation` at **error**
severity. Ask ADR-008 rule 2 for the remedy: add an import (harmful, and what an agent picks),
exclude a working rule, narrow the selector, or delete the rule. None improve anything, because
nothing is wrong with the code. For the `only*` family **zero edges is maximal compliance**, not
absent evidence.

**The rule-level version fails too, three ways:**

1. **Preset multiplication.** Six boundaries and one dependency-free `src/shared/constants.ts`:
   `strictBoundaries` generates 13 rules, **12** of which have subjects and zero edges.
   `applySharedIsolation` emits one rule per (sharedGlob × boundaryFolder), so one legitimate
   file yields one finding per boundary.
2. **A real layered demo.** A pure-entity innermost layer: 2 subjects, 0 edges → unsuppressible
   error. An i18n loader whose locales import nothing: 3 subjects, 0 edges.
3. **The `ignoreTypeImports` inversion.** Counting edges _after_ the filter — which the design
   required — means a layer whose only dependency is `import type` counts zero and fires on the
   **best possible** outcome, under the very option the docs recommend for layer isolation.

The ROADMAP already records the precedent: the slice discovery guards were **built and withdrawn
from 0.18.1 because they fire on legitimate projects with no opt-out**, and their stated price of
readmission is an opt-out on the model of `correspondence().allowEmpty()`.

It also could not have shipped as designed. `collectWithAssertionGuard`
(`src/core/terminal-builder.ts`) is element-type-agnostic and cannot count edges, and
`Condition<T>` is a **public exported type** backing the documented `defineCondition()`, so
extending it is a public API change.

## Option 2 is the remedy, and it is this bug's own mechanism

Report the edgeless-subject count on the reporting surface (`explain`, `--format json`,
`diagnose()`), where the reader can judge it — ADR-008 rule 1's discriminator, since an edge-free
population is legitimate.

**Do not confuse this with a never-exercised glob.** Plan 0071 draft 2 briefly re-aimed this bug
at "a denylist glob that matched no edge", which is a glob-declaration fault and belongs to
[plan 0069](../../plans/completed/0069-no-rule-may-certify-nothing.md) R3b — this bug's own "Why plan 0069
does not close it" section says exactly that the two mechanisms differ. Two diagnostics, two
owners:

| Fault                                                             | Owner         |
| ----------------------------------------------------------------- | ------------- |
| A subject set with no edges, so the allowlist was never exercised | **this bug**  |
| A glob that is satisfiable but matched no edge                    | plan 0069 R3b |

Two prerequisites for either, so the implementer is not surprised: `diagnose()` currently
promises to report _"without running any of them"_ and a glob-exercise tally requires running;
and `doctor` cannot load a rule file that imports vitest, which is the authoring shape this bug
is about.

**And one caution measured while refuting option 1:** `onlyImportFrom('**/nowhere/**')` over 19
edge-bearing subjects produces **96 violations** — maximally loud. The allowlist typo this bug
cites as motivation is already caught by the rule firing on every edge. The silent case is the
**denylist**.

## Fixed 2026-07-31, by reporting rather than failing

Option 2, exactly as this file's own analysis concluded, and no third mechanism.
`src/core/edge-coverage.ts` tallies what each `only*` condition actually had to work with,
and a rule that had **subjects but tested zero edges** is named on the reporting surface:

- `--format json` gains a top-level `untestedAllowlists` array — always present, empty when
  every allowlist was exercised, so a consumer can tell "none" from "this version does not
  report it". An agent parses stdout, so a stderr-only notice would have been invisible to the
  reader this project is built for.
- Every other format gets one stderr footnote after the report, **naming the rules** rather than
  counting them (ADR-008 rule 4) and stating why it might be fine.

The canonical case from this file's Description now reads:

```
[ts-archunit] 1 allowlist rule passed without testing a single edge:
  - that reside in folder matching "**/src/domain/**" should only import from "**/nowhere/**" (1 subject, 0 edges)
  An allowlist constrains edges, so a subject with none cannot violate it. This is correct for a
  genuinely dependency-free module and means the rule certified nothing otherwise — only you can
  tell which.
```

### What the implementation had to get right

- **It discriminates.** A tally that reported every rule would be noise, and noise is how a real
  signal gets ignored. The edge-bearing rule in the same run is not named.
- **Not `ConditionContext`.** That type is public and backs `defineCondition()`; this file already
  records that extending `Condition<T>` was one reason the failing design could not ship. The
  tally follows `diff-disclosure.ts`'s run-scoped module-state precedent instead, with the same
  test reset, and `runCheck` resets per run so a watch loop does not inherit the previous one.
- **Counted after the same filters the check applies**, including `ignoreTypeImports` — an edge
  the rule skips is an edge it did not test.
- **`onlyHaveTypeImportsFrom` counts an edge as tested only when the allowlist matched it**, since
  an edge the glob does not name is one the rule never had an opinion about.

### Guards

`tests/core/edge-coverage.test.ts`, 11 tests, **8 of 8 sabotages caught** — but only after three
gaps that the first matrix found and that are worth recording, because two of them are the shape
this bug is about:

1. **The two other conditions' tests could not fail.** They asserted only that a vacuous rule
   _is_ reported — which a counter that never increments also produces. Both now have a
   discriminator: a subject that genuinely has importers, and an import the allowlist genuinely
   scopes in.
2. **The empty-selector test was vacuous.** Measured: the builder short-circuits and never calls
   `evaluate` on an empty subject set, so nothing was recorded either way and removing the
   `subjects > 0` filter left it green. It now pins that mechanism, and the filter is tested
   where it is reachable.
