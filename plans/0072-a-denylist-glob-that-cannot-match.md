# Plan 0072 — A denylist glob that cannot match anything

**Status:** **REFUTED, 2026-07-30.** Two mechanisms were proposed and both died on
measurement, and the question was already settled correctly in
[plan 0069](./completed/0069-no-rule-may-certify-nothing.md)'s decision table before this plan
re-opened it. What survives is a successor with a different shape — an **author-declared
expectation**, not a diagnosis — specified in "What is actually left" below.
**Prerequisite for anything here:** [plan 0073](./completed/0073-conditions-declare-their-globs.md),
**done 2026-07-30**. Condition globs now reach the diagnosis machinery stamped
`position: 'condition'` — a defect fixed on its own terms, and still _not_ a route to this
fault, since the machinery deliberately skips that position.

## The fault, which is real

`notImportFrom('**/legcay/**')` reports zero violations forever, and that is
indistinguishable from a ban being respected. Measured on
`tests/fixtures/module-edge-conditions`, a real glob against a one-character typo:

| condition                    | real glob | typo'd glob | verdict    |
| ---------------------------- | --------- | ----------- | ---------- |
| `notImportFrom`              | 13        | **0**       | **silent** |
| `onlyHaveTypeImportsFrom`    | 9         | **0**       | **silent** |
| `onlyImportFrom`             | 3         | 16          | loud       |
| `dependOn`                   | 8         | 15          | loud       |
| `onlyBeImportedVia`          | 5         | 11          | loud       |
| `resideInFile` (condition)   | 0         | 2           | loud       |
| `resideInFolder` (condition) | 0         | 2           | loud       |

**Two conditions, not one.** Draft 1 named only the denylist. `onlyHaveTypeImportsFrom`
has the identical shape — its glob _scopes_ which imports must be type-only, so a glob
matching nothing puts no import in scope and the rule cannot fire. Any successor must
cover both.

`onlyBeImportedVia`'s row needed a second measurement to establish: with a glob that
genuinely matches some importers it reports 5, with a typo 11, with `**/*` zero. The first
attempt used a glob matching nothing either way and produced 11 twice, which proved
nothing.

## Why the static mechanism cannot work

Draft 1 proposed: report a condition-position glob that is **unsatisfiable against the
path universe**, scoped to path-shaped `import-target` globs so bare package specifiers
stay exempt. Measured against this repository's 514 files and 95 directories:

```
**/src/cli/**              matchesProject=true
**/infra/**                matchesProject=true
**/bannned/**              matchesProject=false   <- correctly flagged
**/legacy/**               matchesProject=false   <- FALSE POSITIVE
**/node_modules/**         matchesProject=false   <- FALSE POSITIVE
fastify, @scope/pkg        package-shaped, correctly exempt
```

Two false-positive classes, and the second is fatal:

1. **Targets outside the project.** `notImportFrom('**/node_modules/**')` is a good rule
   and would be reported dead, because resolved import paths legitimately leave the
   project. This one is avoidable with more exclusions, and doing so is a treadmill.
2. **The pre-emptive ban.** `notImportFrom('**/legacy/**')` in a repository with no
   `legacy/` folder is a **legitimate armed tripwire** — and `docs/modules.md:38` teaches
   that exact glob as the canonical example. Nothing static distinguishes it from a
   misspelling, because there is nothing to distinguish: the two are the same string in
   the same position with the same match count.

**0069 had already reached this conclusion**, in its own table:

| position    | polarity | Unsatisfiable ⇒                                         |
| ----------- | -------- | ------------------------------------------------------- |
| `condition` | negative | **no fault** — indistinguishable from an armed tripwire |

and in `src/core/diagnose.ts:165-168`, which says the same thing in code. Draft 1 claimed
satisfiability breaks that tie. It does not. Satisfiability only breaks the tie for globs
that could never match anything _anywhere_ — syntactically impossible ones — and
`syntacticFault` already handles those.

## Why the runtime mechanism cannot work either

0069's first record of this fault stated it as a **glob-exercise tally**: "a glob that can
match but matched no edge in this run". Measured: for `notImportFrom('**/legcay/**')` every
edge _is_ tested against the glob, so tested > 0 and matched == 0 — byte-for-byte what a
respected ban produces. A tally distinguishes nothing. That correction is recorded in 0069.

So both mechanisms are refuted, by the same underlying fact from two directions: **the
information needed is not in the code.** It is in the author's head.

## Three structural blockers, measured, that matter for 0073 rather than here

Recorded because draft 1 asserted the opposite of each, and whoever reads 0073 needs them:

1. **`GlobSite.polarity` does not carry the denylist/allowlist distinction.**
   `negateGlobs` (`src/core/glob-site.ts:236`) is its only writer, so it tracks `not()`
   combinator negation. `notImportFrom`'s sites are polarity **positive**.
2. **There was no condition-position glob site to un-skip** — fixed by 0073, and the
   measurement is preserved because it is what made the rest of this section true. Before
   0073 a `notImportFrom` rule exposed **0** glob trees through the `diagnose()` interface;
   with a `.that()` it exposed **1** — the selector. It is **2** now. `Condition<T>` (`src/core/condition.ts:47`) declares `description`
   and `evaluate` and nothing about globs; only _predicates_ declare them. So
   `diagnose.ts:169`'s `position === 'condition'` skip is skipping **predicate-derived**
   sites, and the conditions' own globs never reach `globSitesOf` at all.
3. **`viewsFor` gives `import-target` no views**, deliberately (`path-universe.ts:72`),
   because a bare specifier legitimately matches no project path — which is what
   [bug 0014](../bugs/fixed/0014-bare-package-import-globs-match-nothing.md) was
   fixed to support.

## What is actually left: an author-declared expectation

The only thing that separates a typo from a pre-emptive ban is **intent**, and this
project already has the shape for that — `.expectNonEmpty()`
(`src/core/rule-builder.ts:119`), shipped in 0.18.0 for exactly the analogous selector
case. The author says "I expect this to match", and the finding exists because they said
so, not because a heuristic guessed.

```ts
// Today: silent forever if the glob is wrong, and correct if the ban is pre-emptive.
modules(p).that().resideInFolder('**/src/**').should().notImportFrom('**/legacy/**')

// The successor: the author declares the ban is live, so a glob that matches nothing
// is a fault BY DECLARATION rather than by inference.
modules(p)
  .that()
  .resideInFolder('**/src/**')
  .should()
  .notImportFrom('**/legacy/**')
  .expectGlobsMatch()
```

**An opt-IN, and that direction is not negotiable.** 0069's appendix already rejected the
opt-out: _"`.allowEmpty()` — one word, silent forever, typo or not, and nothing revisits
it"_, and _"no opt-out at all — purest, but fails 0.18.1's own criterion and tells users to
delete legitimate tripwires"_. An opt-in inverts both objections: the default keeps working
for pre-emptive bans, and the declaration is the thing a reviewer can see.

Design constraints, all inherited rather than invented:

- **It must fail, not warn** (ADR-008 rule 1). Once the author has declared the
  expectation, the remedy is not optional — fix the glob or drop the declaration — so this
  is a configuration finding: `bypassFilters: true`, forced to `error` by `severityFor`,
  refused by `.excluding()`, skipped by diff and baseline. Identical treatment to every
  other "this rule cannot fire" finding.
- **The remedy must be per-cause** (ADR-008 rule 2). A denylist glob matching nothing has
  two likely causes and they need opposite actions: a **misspelling**, where the fix is the
  glob; and **the banned code was already deleted**, where the fix is to delete the rule.
  0069's generic dead-glob remedy offers "append `/**`", which is right for a selector and
  wrong here.
- **It must say there is no escape hatch** (ADR-008 rule 3), the sentence 0.23.0 added to
  every configuration finding.
- **It must cover both silent conditions** — `notImportFrom` and
  `onlyHaveTypeImportsFrom` — and must **not** fire for the five loud ones, which need no
  declaration because a typo there is already maximally loud.

Whether this earns API surface is a genuine product question and not settled here. The
honest case against: a rule author who mistypes a glob is unlikely to have also remembered
to add `.expectGlobsMatch()`, so the opt-in may protect exactly the people who did not need
protecting. That is the same objection `.expectNonEmpty()` faces, and it shipped — but
selector emptiness is a much commoner mistake than a denylist typo, so the analogy is not
free. **Decide that before building it.**

## Out of scope

- **Condition-declared globs** — [plan 0073](./completed/0073-conditions-declare-their-globs.md).
  The prerequisite for any of this, and worth doing on its own merits.
- **[Bug 0015](../bugs/fixed/0015-allowlist-conditions-pass-vacuously-on-edgeless-subjects.md)** —
  the `only*` family passing on an edgeless subject. 0069 records it as a known exposure at
  line 205; it is a different fault with a different owner.
- **0069's R3b** — the _selector_ glob guard, designed and gated on an adopting codebase's
  `doctor` pre-flight. Unaffected by any of this.
