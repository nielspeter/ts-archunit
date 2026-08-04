# Plan 0084 — cycle detection that can be turned on

**Status:** Open, not started. Filed 2026-08-04 from
[plan 0083](./0083-eat-our-own-dogfood.md) Phase 1, which found our own cycle rule cannot fail and our
own source has a cycle.
**Priority:** Medium-high. This is not an internal gap: `beFreeOfCycles()` is a documented, exported
condition, and today it is unusable at `error` severity on any codebase that uses `import type` —
which in TypeScript is most of them.
**Effort:** Small-medium. The type-only detection already exists and is already used elsewhere; the
work is threading it into one graph builder plus deciding the API shape.
**Blast radius:** **Published API and a severity-affecting behaviour change.** Rules that pass today
under `.warn()` may start reporting fewer cycles (a good change) — and anyone who has
`beFreeOfCycles()` in a baseline will see entries move, because fewer edges means different cycle
membership and therefore different violation identities. Per
[ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 6 that is the top row: the option's
default is the decision that needs proving, and the migration needs a stated, tested remedy.

## Problem

Our own architecture rule reads:

```ts
slices(p).assignedFrom({ core: '**/src/core/**', builders: '**/src/builders/**', … })
  .should().beFreeOfCycles()
  .rule({ id: 'arch/no-cycles', … })
).warn() // type-only imports create false-positive cycles; switch to .check() when beFreeOfCycles ignores import type
```

Two things follow from that one line, and both were measured on a clean tree:

1. **The rule cannot fail.** `.warn()` prints and does not throw, so no change to our architecture
   can ever red this rule. It is _visible_ — [bug 0024](../bugs/fixed/0024-warn-terminal-is-invisible-inside-a-test-runner.md)
   fixed the silent case in v0.26.0, and the cycle line does appear in the run output — but under
   ADR-008 rule 1 an actionable finding must **fail**, and a cycle is actionable. Visible-and-ignored
   is the state that rule exists to forbid: a check counted as coverage that cannot go red.

   _(An earlier draft of this plan said the finding "reaches nobody" and cited bug 0024 as the live
   shape. Wrong on both counts — 0024 is fixed and the output is produced. The defect is the severity
   choice, not the reporting channel.)_

2. **Our source has a cycle right now**, reported and ignored:

   ```
   Cycle detected: builders → helpers → models → core → conditions → predicates → builders
   ```

The comment is honest about why, and the reason is real: `beFreeOfCycles()` builds its graph from
`buildSliceDependencyGraph` (`src/helpers/slice-graph.ts:73-79`), which walks every file's edges with
no type-only filter. A `import type { Layer } from '../models/cross-layer.js'` is erased at compile
time and creates no runtime dependency — but it is an edge in that graph, so a codebase that uses
type-only imports for exactly the reason they exist gets cycles that do not exist at runtime.

**The machinery to fix it is already in the repo and already used.** `src/core/module-edges.ts:3`
imports `isTypeOnlyImport` and `isTypeOnlyReExport`, and `ImportOptions.ignoreTypeImports` is a
shipped, documented option on `dependOn`, `importFrom`, `notImportFrom` and `onlyImportFrom`. Cycle
detection is the one consumer that cannot ask for it.

So the feature is not broken — it is **un-turn-on-able**, which is worse in one specific way: an
adopter who tries it, sees false positives, and sets `.warn()` has silently converted a gate into a
log line, exactly as we did.

## Phase 1 — thread the option through

`beFreeOfCycles(options?: ImportOptions)`, reusing the existing type rather than inventing a second
options shape (ADR-003, and the `.excluding()`/`not()` duplication lesson). It reaches
`buildSliceDependencyGraph`, which reaches `collectEdgesFromFile`.

**The default is the decision, and it needs an argument either way:**

- `ignoreTypeImports: false` (today's behaviour) is backward-compatible and leaves the feature
  unusable by default — the status quo that produced this plan.
- `ignoreTypeImports: true` by default matches what a user means by "cycle" — a runtime dependency
  cycle — and makes the feature turn-on-able out of the box. It is also a behaviour change on a
  published condition, so it needs the upgrade note and the baseline migration.

**Recommendation: default `true`, because the current default is the bug.** A type-only edge is not a
dependency in any sense the remedy can act on — "extract shared code to a lower-level module" is not
something you do about an `import type`. A finding whose remedy does not apply is ADR-008 rule 2's
failure, and that is what the current default manufactures.

## Phase 2 — turn our own rule on, and fix or record what it finds

`.warn()` → `.check()` in `tests/archunit/arch-rules.test.ts`, which is the whole point.

Then the cycle above either disappears (it was type-only, and the fix is the fix) or it is real, and
**it is not this plan's job to fix our architecture** — it is this plan's job to stop hiding it. If a
real cycle survives, file it separately with the measurement, and keep the rule at `.check()` with a
documented `.excluding()` naming the edge and the plan that owns it. An exclusion that names its
reason is the sanctioned escape hatch; a blanket `.warn()` is not.

**Do not** resolve a surviving real cycle by returning to `.warn()`. That is how this arrived.

## Test inventory

1. **A type-only cycle is not a cycle.** Two slices importing each other with `import type` only →
   zero findings. The motivating case.
2. **A runtime cycle still is.** Same two slices with a value import → one finding, asserted by
   identity (which slices, not how many).
3. ~~**A mixed cycle is a cycle.** A → B by value, B → A by type: still a runtime cycle in one
   direction, and the finding must name it.~~ **This row was wrong and the implementation was
   right.** "A runtime cycle in one direction" is not a thing — a cycle needs both directions, and
   with `B → A` erased, `B` depends on nothing. Measured: no finding, correctly. What the row was
   groping for is covered by the _partially_ type-only case: `import { type X, y }` keeps a runtime
   binding for `y`, so it IS an edge, and `isTypeOnlyImport` requires **every** named specifier to be
   type-only. That is now its own test.
4. **A re-export cycle**, since `isTypeOnlyReExport` exists separately — `export type { X } from` is
   erased too, and if the fix handles `import type` but not that, half the feature is still broken.
5. **`ignoreTypeImports: false` still reports the type-only cycle**, so the option is proven to do
   something in both positions rather than being permanently on.
6. **Our own suite at `.check()`**, which is Phase 2 and the only end-to-end proof.
7. **Baseline migration:** a `beFreeOfCycles()` violation's identity before and after, asserted — so
   the upgrade note is a measured fact rather than a hope. This is the row plan 0082 promised and
   omitted, and its absence is how a wrong migration note shipped in v0.46.0.

## Out of scope

- **The reporting channel.** Already fixed
  ([bug 0024](../bugs/fixed/0024-warn-terminal-is-invisible-inside-a-test-runner.md), v0.26.0) — and
  worth noting what that fix did and did not buy. Since v0.26.0 the cycle has been **printed on every
  run of our own suite** and nobody acted on it, which is the argument for rule 1 rather than against
  it: visibility is not enforcement. A line in passing output is indistinguishable from noise.
- **Fixing whatever real cycle survives Phase 1.** Separate plan, if there is one.
- **Cycle detection at file granularity** rather than slice granularity. Different feature.

## Related

- [Plan 0083](./0083-eat-our-own-dogfood.md) Phase 1 — found it, and note _how_: the deletion audit
  that plan originally specified would have found nothing, because deleting a `.warn()` rule from a
  green suite is invisible twice over.
- `src/core/import-options.ts` — `ImportOptions`, the type to reuse.
- `src/core/module-edges.ts` — `isTypeOnlyImport` / `isTypeOnlyReExport`, already written.
- `src/helpers/slice-graph.ts:73` — `buildSliceDependencyGraph`, the one place the filter is missing.
