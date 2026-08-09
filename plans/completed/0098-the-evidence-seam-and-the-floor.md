# Plan 0098 — the evidence seam every family is born with

**Status:** **DONE 2026-08-08.** Shipped in **v0.59.0** (PR #47). Filed 2026-08-07, split out of
plan 0095's Phase 2a/2b/2d. See **Outcome** below.
**Amended 2026-08-08 — narrowed to the seam.** The floor moved to
[0099](./0099-the-floor-no-family-can-be-born-below.md); the preset gap this amendment measured is
[0100](../0100-a-preset-that-constructs-nothing.md). See **Amendment** below for the measurement that
forced it. Everything from "Convert at the root" onward now belongs to 0099 and is kept here only as
the design 0099 inherits.
**Depends on:** [0096](./0096-evidence-at-every-seam.md) (families must produce the evidence before the
seam can require it), [0097](./0097-the-declared-empty-grammar.md) (the floor reads the mint it lifts),
[0089](./0089-presets-forward-their-options.md) (preset declarations need somewhere to be threaded), and
**ADR-010 ratified** — Phase 2a retypes its rule 1 contract member.
**Carries** the fix for [bug 0066](../../bugs/fixed/0066-a-smell-detector-over-zero-files-passes.md), deliberately:
ADR-009 requires the seam change and the smell-family fix to land in **one red event**, so they ship in
one release even though they are separate PRs.
**Priority:** High. This is the plan that makes vacuity unrepresentable; the others prepare for it.
**Effort:** Medium.
**Blast radius:** **Published API — top row** of [ADR-008](../../adr/008-agent-first-failure-surfaces.md)
rule 6. Every entry point, plus an extension-contract break. Guard the guard: adversarial review of the
seam, sabotage per detector, and the 0095 matrix as the independent behavioural check.

## Amendment — two things measured on 2026-08-08, before any code

**1. This cannot be one PR, and the house rule is that a plan completes in the one it was built in.**
The retype has one consumer (`terminal-builder.ts:338`) and **eight producers** — a good shape. But
only three of the eight can answer today (`correspondence`, both graphql builders). The other five
need their examined unit **designed, not threaded**: what is the examined unit of a `tsconfig` check,
of a `crossLayer` rule, of the whole `RuleBuilder<T>` family? And `SmellBuilder` — the class that
actually implements the seam — cannot see its own detectors' `examinedUnits()`, because that hook was
added to the detector subclasses and `collectViolations()` delegates through `detect()`. Five
definitions plus a floor plus ten documentation files is two plans wearing one number.

**2. The floor cannot empty `KNOWN_FAIL_OPEN`, and this plan claimed it would.** Measured against the
matrix's own recipes on its own empty fixture:

| entry                         | rules constructed | a per-rule floor reaches it |
| ----------------------------- | ----------------- | --------------------------- |
| `smells.duplicateBodies`      | 1                 | yes                         |
| `smells.inconsistentSiblings` | 1                 | yes                         |
| `presets:agentGuardrails`     | 1                 | yes                         |
| `presets:strictBoundaries`    | 2                 | yes                         |
| `presets:dataLayerIsolation`  | **0**             | **no — nothing to floor**   |
| `graphql:schema`              | —                 | already fails CLOSED        |

**Two** of the five published presets construct zero rules at their minimal type-correct call
(`agentGuardrails({ src })` and `dataLayerIsolation({ repositories })`) — the matrix caught one of them
only because that recipe happened to pass fewer options. A preset that constructs zero rules has no
`collectViolations()` to floor, so
the invariant this programme is built on stops one level short of it: ∀ over ∅ at the **preset** seam
rather than the rule seam. That is ADR-009's own Context table repeating — four waves each closed
their enumeration and the next family was outside it — and this plan's enumeration was "families
implementing the seam". A preset is not one. Filed as [0100](../0100-a-preset-that-constructs-nothing.md)
rather than absorbed, because the mechanism is different: nothing about `CollectResult` reaches a
function that returned `[]`.

## Problem

Every component ADR-009 needs already exists — the terminal root, the configuration-finding machinery,
both declared-empty mints, the empty-project diagnosis — and the smell family failed open on the day all
of them existed, because nothing makes the components **unavoidable**. Guards are things you can forget
to add. An invariant is not.

## The work

**Retype the seam** (`src/core/terminal-builder.ts`, ADR-010's process):

```ts
export interface CollectResult {
  violations: ArchViolation[]
  /** Units this family's own semantics examined — subjects, bodies, keys. Never file counts. */
  examined: number
}
protected abstract collectViolations(): CollectResult
```

**Convert at the root — a floor beneath the families, not a replacement for them:**

```ts
const { violations, examined } = this.collectViolations()
if (violations.length === 0 && examined === 0) {
  const project = this.getProject()
  if (project && loadedNothing(project)) return [this.emptyProjectViolation(project)]
  if (!this.declaresEmpty()) return [this.zeroSubjectsViolation()]
}
if (examined > 0 && this._expectEmpty)
  return [this.expiredDeclarationViolation(examined), ...violations]
return violations
```

Four rulings that are not obvious from the code and must not be re-derived by whoever implements it:

- **A family that produced any finding passes through untouched.** The root fires only where a family
  produced _nothing_ from _nothing_ — the bug-0066 shape. The rule family's own empty-selection block
  stays as its better-attributed implementation; its **remedy text delegates to the 2d producers**, or a
  coupling test asserts the shared sentence, because two texts for one state is the plan-0070 drift shape.
- **The expiry half is the root's alone.** `rule-builder.ts:588` already covers that exact state, so
  keeping both double-reports one fault — caught in the sketch before implementation. Its message content
  moves to the shared producer, and a test asserts a declared-empty rule that gains a subject produces
  **exactly one** finding. Note the branch reads `_expectEmpty`, not `declaresEmpty()`: `.notExist()`
  over a non-empty selection is the condition doing its job, never an expired declaration.
- **`getProject()` may be undefined** — correspondence discards its project by documented design, and
  every ADR-010 foreign dialect over a non-TypeScript element type has none. The instrument level is
  skipped honestly; the zero-subjects floor still holds.
- **An empty project outranks every declaration.** A declaration asserts a fact about a loaded corpus;
  over zero loaded files it asserts nothing, and the expiry that justifies `.expectEmpty()` never engages
  — so on a solution-style tsconfig an agent's one-line `.expectEmpty()` would restore bug 0066's 401
  findings-reported-clean **forever**, through the sanctioned door. This supersedes the precedence bug
  0066's root-cause note endorsed: that ordering stays correct at **selection** level and is now wrong at
  **instrument** level.

**Per-cause remedies** (ADR-009 part 4). Three causes, three remedies, and rule 2 forbids naming one as
universal: empty project → point at the tsconfig holding the sources, and **never** offer `.expectEmpty()`;
dead selector glob → fix the glob; filters excluded everything → the one judgment call, and the message
names the **actual excluder including internal defaults** ("N bodies found, all below `minLines(5)`"),
because "fix your filters" to a user who wrote none sends an agent looking for filters that do not exist.
When the rule id begins `preset/`, the remedy is preset-shaped — a preset user cannot write
`.expectEmpty()`.

**Empty `KNOWN_FAIL_OPEN`** in the same commit as the retype, and update the graphql reference
implementation and `docs/graphql.md` (ADR-010 rule 2). The break gets a **programmatic `tsc` run whose
non-zero exit is the assertion** against an old-signature subclass — the external dialect's upgrade
experience, simulated. ADR-010's own fixture and eess's bump gate remain the real thing.

## The examined unit, settled per producer

Review asked whether this plan is READY or PROPOSED — whether the five producers that cannot answer
today need their unit **designed** or merely **threaded**. Measured by reading each `collectViolations()`.
**All five are mechanical; none needs a decision, so READY stands.** Recorded here so an implementer
reads the answer instead of re-deriving it, which is the only thing the label is worth:

| producer            | examined unit                            | why that is the family's own seam                                            |
| ------------------- | ---------------------------------------- | ---------------------------------------------------------------------------- |
| `RuleBuilder<T>`    | filtered subjects                        | `evaluate()` already narrows to exactly the set the conditions receive       |
| `SliceRuleBuilder`  | slices holding at least one file         | its own empty-discovery rule is already "every slice has no files"           |
| `CrossLayerBuilder` | `pairs.length`                           | `condition.evaluate(this.pairs, ctx)` — the pairs ARE the examined set       |
| `TsconfigBuilder`   | `Object.keys(this._requirements).length` | it iterates declared requirements; zero means `{}`, a rule asserting nothing |
| `SmellBuilder`      | delegated to the detector                | one abstract declaration; both detectors already implement the hook          |

Two findings that make this **smaller** than the amendment estimated:

- **`SliceRuleBuilder` already fails closed.** `collectViolations()` returns `emptyDiscoveryViolation()`
  — a config-level meta-finding that bypasses baseline — when no slice holds a file. It is not a gap to
  fill but a **working precedent for 0099's floor**, shipped and proven, and it is why slices never
  appear in `KNOWN_FAIL_OPEN`. 0099 should be written as generalising this, not as inventing it.
- **`SmellBuilder` is one declaration, not a redesign.** It delegates straight to `detect()`, and both
  detectors already implement `examinedUnits()` from 0096. The amendment's "cannot see its own detectors'
  hook" is real but costs a single abstract member on the base class.

## Files changed

**Source and tests only.** `src/core/terminal-builder.ts` (the seam and its one consumer),
`src/core/rule-builder.ts`, `src/builders/slice-rule-builder.ts`, `src/builders/cross-layer-builder.ts`,
`src/builders/correspondence-builder.ts`, `src/tsconfig/tsconfig-builder.ts`, `src/smells/smell-builder.ts`,
both graphql builders, `tests/core/evidence-at-every-seam.test.ts` (the classification census gains the
three producers 0096 could not reach), `docs/graphql.md` + `src/graphql/schema-rule-builder.ts` (ADR-010
rule 2: the reference implementation changes in the same commit as the contract).

**Deliberately NOT here**, because this plan changes no behaviour and review caught the earlier list
claiming them: no `CHANGELOG.md` version heading, no `docs/upgrading.md` / `troubleshooting.md` /
`api-reference.md` / `smell-detection.md` / `presets.md` / `recipes.md`, and **not** the
`bugs/0066-*.md` → `bugs/fixed/` move. All belong to [0099](./0099-the-floor-no-family-can-be-born-below.md),
which is the commit that makes them true. `docs.yml` deploys on push to `main` rather than on tag, so
shipping those files here would publish a claim the released artifact does not yet honour.

## Test inventory

- **`.expectEmpty()` is EFFECTIVE, not merely reachable** — moved here from 0097, whose hoist made it
  callable on every family while nothing read the flag. A smell detector that declares empty over a
  zero-subject corpus passes; one that declares empty and then examines something fails. And
  `CorrespondenceBuilder.declaresEmpty()` is overridden per side, so a rule whose every side is
  declared does **not** red at the floor asking the author to declare — ADR-008 rule 2's loop, which
  the base implementation would produce because that class refuses the whole-rule form.
- **Per family, the triple-route shape**: the zero-units finding asserted through `violations()` **and**
  `check()` **and** `.warn()`, with `bypassFilters` read off the `violations()` result. That is the row
  that catches the two non-equivalent mis-wirings — the floor inside one terminal only, or the finding
  shipping without the flag. (Below-filter placement is an **equivalence**, recorded so nobody invents a
  guard for it: every drop channel refuses `bypassFilters`.)
- **Precedence**: empty project + `.expectEmpty()` → still the empty-project finding; empty project +
  `.notExist()` → same; loaded project + `.notExist()` + zero matches → passes.
- **Expiry**: exactly one finding, and applying the stated remedy clears it.
- **Remedy-remediates per cause**, including the preset-context row; negative assertion that the
  empty-project message never names `.expectEmpty()`.
- **Tripwire regression**: a condition-glob tripwire iterating N subjects and matching none still passes
  — 0.34.0's carve-out asserted across the flip.
- **Sabotage at top-row depth**, verdicts **per test**: the family evidence wires are one row each, the
  floor and expiry branches are two rows, patches asserted to apply non-trivially, caught-by-nothing
  reported as a number, green baseline first, exclusive tree.

## Release

**This plan ships no release of its own.** It is behaviour-neutral and merges to `main` ahead of
[0099](./0099-the-floor-no-family-can-be-born-below.md); the tag is cut after 0099, and 0099's Release
section owns the note. The paragraph that stood here predated the split and still said "ships with 0097"
— which had already merged — while carrying the terminal claim this plan alone does not deliver.

**Do not tag between this merge and 0099's.** The intermediate commit retypes `collectViolations()`,
which ADR-010 rule 1 names as contract, so a release cut from it ships a foreign-dialect compile break
with **zero** behaviour change. Nothing in CI prevents that: `publish.yml` is tag-triggered, the matrix
still records its pre-floor verdicts, and the expiry gate is silent below `0.62.0` — every check would
pass an intermediate tag. The constraint is social, so it is written down in both plans.

## Out of scope

The CLI beyond what the root conversion reaches (0095 measures it; a fix beyond that gets its own
number). Bug 0056's fail-open half. `defineCondition` internal vacuity. ADR-010's contract fixture.

## Outcome

**DONE.** Eight producers, one consumer, behaviour-neutral at `check()`.

**The compiler enumerated the work.** Changing the abstract return type produced an error per producer —
the enumeration came from the type system rather than from a list someone wrote, which is the whole
argument for doing it this way. The in-repo fixture subclass in `assertion-gate.test.ts` failed to compile
too, and updating it **is** the upgrade an ADR-010 foreign dialect performs: a compile error naming the
member, not a silent drift.

**All five "needs designing?" units were mechanical, as the plan predicted — and one was already solved.**
`SliceRuleBuilder` has failed closed since 0067 with a config-level meta-finding on exactly the condition
that makes its count zero, so 0099's floor generalises a shipped precedent instead of inventing one.

**Each family defines its unit ONCE, in a public `examinedUnits()` that the seam calls.** Not two
expressions of one number: the count the gate carries and the count the preview reads are the same call,
so they cannot drift. The consequence is that `diagnose()` now previews four more families, which is a
behaviour change this plan did not set out to make and is the right one — the preview was scoped to five
families only because those were the five that had the accessor.

**Extending the preview immediately found two things, one of them a defect in this plan.**

- **This repo's own 53-rule suite went red**, on `api/no-single-glob-predicates`. Not a vacuous rule: it
  ends in `.should().notExist()`, where zero subjects is the assertion **succeeding**. The gate has
  exempted that since 0.34.0 via `assertsCardinality()`, but the preview could not see it — the method was
  `protected`, and until this plan no rule-builder family reported evidence, so the two could not disagree.
  Made public, declared on `DiagnosableRule`, consulted by the evidence check. Deliberately **not** folded
  into `declaresEmpty()`: 0099's expiry branch reads the declaration flag alone, because `.notExist()` over
  a selection that has grown is the condition doing its job, not a declaration that expired.
- **Three `diagnose()` tests were pinning glob behaviour through rules that examined nothing** — the same
  shape 0096 found twice. Fixed at the fixture, not the assertion, so every row keeps `toEqual([])`. One is
  worth naming: a row proving a path glob works asserted non-vacuity with `modules(p)` while diagnosing a
  rule built from `classes(p)`, and the fixture has modules in that folder but no classes. The control had
  always been proving a different builder than the row it guarded.

### Sabotage: seven rows, six caught, one recorded

Verdicts by exit code, green baseline both ends, every patch asserted to apply **and to typecheck** —
0096's matrix scored a false CAUGHT on a patch that did not parse, so a non-compiling sabotage is VOID here
by construction. Caught: `RuleBuilder` → constant, `RuleBuilder` → pre-predicate, `Slice` → slices declared
rather than slices with files, `Tsconfig` → constant, `crossLayer` → layers instead of pairs, `diagnose`
drops the `.notExist()` exemption.

**Two harness faults, both self-caught, both worth recording.** The `Tsconfig` row first scored NOT CAUGHT
because its target string was a **prefix of `assertsSomething()`'s body** — the patch turned that method
into `return 1 > 0`, which compiles, and left `examinedUnits()` untouched. The `Slice` row first scored NOT
CAUGHT because the test used `matching()` on a dead glob, which yields **no slices at all**, so both the
right and wrong definitions answer 0; `assignedFrom()` is the discriminating shape, because it returns one
slice per key whether or not anything matched. A sabotage row is only a measurement if the patch lands
where you think and the fixture can tell the two answers apart.

### The equivalence this plan ships, and when it expires

**The WIRING between `examinedUnits()` and `CollectResult.examined` is unguarded, for every family.**
`examined` is produced here and discarded by the one consumer, so rewriting any `collectViolations()` to
`examined: 0` while leaving the accessor correct leaves the whole suite green — measured for the smell
family and for `RuleBuilder`. No instrument in this release can observe it, and inventing one would be a
guard built for a single sabotage rather than for a reader.

Recorded under ADR-008 rule 5's split-row corollary, **with its expiry named**: plan 0099 reads `examined`
at the floor, and the commit that gives a claim its first reader is the commit that must retire it. This
repo has already had a recorded equivalence outlive its truth by exactly one commit
(`CorrespondenceBuilder.declaresEmpty`, plan 0096), so a wiring sabotage row belongs in 0099's matrix on
day one rather than in its review.
