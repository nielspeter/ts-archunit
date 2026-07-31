# Plan 0075 — Collect elements once per project

**Status:** READY.
**Priority:** High. It is the largest measured win available that changes no behaviour, and it
is one of only two items in [proposal 021](../proposals/021-consumer-run-time-where-it-actually-goes.md)
whose value does not depend on how TypeScript 7 turns out.
**Effort:** ~1 day, including the benchmark fixture.
**Origin:** [Proposal 021](../proposals/021-consumer-run-time-where-it-actually-goes.md) Part 1,
from a consumer-reported slowdown. Everything below was re-measured against **this repository
(518 files)** rather than inherited from the proposal's 147-file consumer, so the numbers are
reproducible by anyone with the repo.

## Problem

`filterElements()` (`src/core/rule-builder.ts:407`) calls the abstract `getElements()` on every
rule execution, and each builder re-collects from the project from scratch:

```ts
// src/builders/call-rule-builder.ts:75
protected getElements(): ArchCall[] {
  return this.project.getSourceFiles().flatMap(collectCalls)
}
```

Nothing caches it. Measured on this repository, warm, counting `getDescendantsOfKind` on the
shared `Node` prototype:

| 5 × `calls()`, warm | `getDescendantsOfKind` | time       |
| ------------------- | ---------------------- | ---------- |
| before              | **2,600**              | **692 ms** |
| after               | **0**                  | **3 ms**   |

Measured by implementing the change, stashing it, and re-running — not by projecting from a
prototype. Zero after, rather than 520, because the warm-up call already collected; cold it is
one walk per file instead of five. The waste scales with the number of rules a consumer writes,
which is the number we are asking them to grow.

`functions()`, `classes()` and `modules()` issue **zero** file-level descendant queries — they
read top-level declarations — so the direct win is confined to `calls()`. The preset case below
is the commoner one.

### The second beneficiary, which is a preset we ship

`agentGuardrails` emits one
`functions()` rule **per banned API** (`src/presets/agent-guardrails.ts:65`), each carrying
`notContain(call(api))`, and that condition walks each function's body
(`src/helpers/body-traversal.ts:33`). Measured on this repository (520 files), counting
`getDescendantsOfKind` on `Node.prototype`:

| banned APIs | body walks | time   |
| ----------- | ---------- | ------ |
| 1           | 1,053      | 42 ms  |
| 8           | **8,424**  | 108 ms |

Exactly 8 x 1,053 — the same 1,053 function bodies walked once per rule. **The element cache
does not fix this**: it removes the redundant _collection_ of those functions (measured
separately, 142 -> 83 ms for eight APIs) and leaves the eight body walks in place. Sharing the
walk — collect each body's call expressions once, match N patterns against it — is a different
change with a different seam.

So the population that provably re-walks the AST is not "someone who writes lots of `calls()`
rules", it is **anyone using a preset we ship with more than one banned API**.

> **Two corrections, both from the same instrumentation error, left visible.** An earlier
> revision of this paragraph claimed the redundancy was _not_ a body walk and that
> `getDescendantsOfKind`, `getDescendants` and `forEachDescendant` recorded **zero calls** across
> 1/2/4/8 APIs. That reading came from patching the wrong prototype: `Node.prototype` is **five**
> levels above a `SourceFile` instance, and patching a nearer level shadows only the calls made
> on source files, so file-level walks were counted and body walks on function nodes were
> invisible. Walking the chain to find the owner gives the table above. The original claim was
> right; the correction was wrong; the number was off by 8,424. `tests/core/element-cache.test.ts`
> now locates the prototype by walking rather than by assuming a depth, and says why.

## Mechanism

A module-level memo per builder, keyed on the project, holding the **unfiltered** `getElements()`
result.

```ts
// src/core/element-cache.ts (new)
const caches = new WeakMap<ArchProject, Map<string, readonly unknown[]>>()
```

`WeakMap<ArchProject, …>` is the shape this codebase already uses twice — `src/core/disk-set.ts:83`
and `src/core/path-universe.ts:35` — and copying it inherits their invalidation story rather than
inventing one.

Prototyped before the plan and then measured against the real implementation: 5 × `calls()` goes
from **2,600 queries / 692 ms to 0 / 3 ms** warm, with subjects identical elementwise by name and
file and `subjects()` still returning a fresh array.

### Four constraints, each measured or derived, none optional

1. **Memoize `getElements()`, never `filterElements()`.** This single constraint answers three
   questions at once, which is why it leads.
   - **Correctness.** `ScopedFunctionRuleBuilder extends FunctionRuleBuilder`
     (`src/builders/scoped-function-rule-builder.ts:15`) and overrides `getElements()` at line 27
     to return callbacks extracted from a `CallRuleBuilder` selection — **not** the project's
     functions. A memo in `filterElements()` keyed on `(project, entry-point)` would file a
     `within(...).functions()` set and a plain `functions()` set under one key; whichever ran
     first would win, and `within(sel).functions().should().notExist()` would pass vacuously.
     That is an ADR-008 false green created by a performance change.
   - **Mutation, aliasing and identity.** `filterElements()` unconditionally calls `.filter(...)`
     (`rule-builder.ts:409`), which always allocates. With the memo on the unfiltered result,
     `subjects()` (`rule-builder.ts:158`, already `readonly T[]`) keeps returning a fresh array
     per call — verified in the prototype. No `readonly` wrapper, no defensive copy, and no
     observable change to `subjects()` identity under `===`.

2. **Module-level, not an instance field.** `shallowClone` (`src/core/shallow-clone.ts:19`) copies
   every own property and every chain link clones (`addPredicate`, `rule-builder.ts:293`), so an
   instance memo would ride along the chain. Harmless for an unfiltered set, fatal for a filtered
   one — and the next reader will not know which it was holding.

3. **`FunctionRuleBuilder`'s key must include its collection options.** `getElements()` reads
   `this._collectionOptions` (`function-rule-builder.ts:85-98`), so `functions(p)` and
   `functions(p, COLLECT_ALL)` are different populations. The prototype used
   `JSON.stringify(collectionOptions)` in the key and the preset measurement above passes with
   it; a project-only key would serve one population's elements to the other.

4. **Key on object identity, not on `tsConfigPath`.** `resetProjectCache()`
   (`src/core/project.ts:178`) clears both the `project()` and `workspace()` maps, so the next
   call constructs a new object literal and therefore a new WeakMap key — a stale entry is
   unreachable **for projects this library created**. Watch mode is the caller that depends on it,
   and it is where a stale cache would be an ADR-008 failure rather than a slow test: a rule
   re-evaluated against a pre-edit AST reports a pass the edit did not earn. A cache keyed on the
   path string would pass every test in this repository's suite and silently break watch mode.

   Stated honestly: this does **not** cover an `ArchProject` a consumer constructed themselves and
   holds across an edit. That is an already-stale-AST situation which the memo does not worsen,
   and the plan should say so rather than claim more.

## Scope

**In: six of the nine, not seven.** `call-rule-builder.ts:75`, `class-rule-builder.ts:78`,
`function-rule-builder.ts:91`, `module-rule-builder.ts:58`, `type-rule-builder.ts:58`,
`jsx-rule-builder.ts:61`.

**`ScopedFunctionRuleBuilder` is excluded, correcting this plan's own first draft**, which listed
it as in scope. It overrides `getElements()` (`scoped-function-rule-builder.ts:27`) to draw
callbacks from a `CallRuleBuilder` selection and never calls `super`, so its population is a
function of **the selection**, not the project — two different `within(...)` selections share one
project. Caching it on a project key would serve one the other's elements. It benefits anyway,
indirectly: `getMatchedCalls()` goes through the now-cached `CallRuleBuilder.getElements()`.

**Also out, and named rather than omitted:** `src/graphql/schema-rule-builder.ts:218` and
`src/graphql/resolver-rule-builder.ts:244` also define `getElements()` — `private`, on classes
extending `TerminalBuilder` rather than `RuleBuilder`, both with hand-copied `filterElements`
bodies. Neither is memoizable by this key: one reads a loaded GraphQL schema, the other
`this.sourceFiles`. **The population is nine and this plan caches six** — the test below
derives that split from source rather than restating it, because
[plan 0073](./completed/0073-conditions-declare-their-globs.md) restated a population from prose
and parsing found nearly twice as many.

Also out: `CallRuleBuilder.getMatchedCalls()` (`call-rule-builder.ts:247`) re-implements
`filterElements`'s body for the `within()` matcher, which `filterElements`'s own docstring admits
is "not routed through here" (`rule-builder.ts:404-406`). Memoizing `getElements()` **does** help
it, since it calls `this.getElements()` — but the duplicated seam is a separate cleanup.

## Phases

### Phase 1 — the benchmark fixture

A committed harness, so every number above becomes regression-testable rather than anecdotal, and
so phase 2 can show it worked. Proposal 021 sequences this first for that reason.

Not a new fixture project: **this repository is the benchmark**, because it is the only
518-file TypeScript project the suite can rely on being present, and fixture projects are 5–26
files where the effect does not exist. The harness loads `tsconfig.json`, runs a fixed suite, and
asserts on **counts**, never milliseconds — counts are a function of the code path and are
reproducible under load, which is the same reasoning proposal 021's measurement caveat uses.

**Files:** `tests/perf/collection-count.test.ts` (new).

### Phase 2 — the memo

`src/core/element-cache.ts` (new) plus one call per builder. Constraints 1–4 above.

**Files:** `src/core/element-cache.ts` (new), the six cached builders.

## Test inventory

| test                                                      | asserts                                                                                                    |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `five calls() rules issue one collection, not five`       | descendant-query count is 518, not 2,590 — the plan's whole claim, as a count                              |
| `the population is seven of nine, derived from source`    | parses `src/` for `getElements()`, asserts the two graphql ones are excluded **by name and with a reason** |
| `subjects() is unchanged elementwise`                     | 31,560 subjects, same names and lines, cached vs uncached                                                  |
| `subjects() still returns a fresh array`                  | `a !== b` for two calls — the aliasing constraint, which is the one a future refactor breaks silently      |
| `functions(p) and functions(p, COLLECT_ALL) do not share` | constraint 3; a project-only key serves the wrong population                                               |
| `within(sel).functions() does not share with functions()` | constraint 1 — the `ScopedFunctionRuleBuilder` false green                                                 |
| `resetProjectCache() makes the prior entry unreachable`   | constraint 4, through the real `project()` singleton rather than a hand-built literal                      |
| `agentGuardrails with 8 APIs collects once`               | the preset case, as a count                                                                                |

## Guards

Ask ADR-008's question: **what would these tests do if the cache returned a stale or wrong
population?** The count tests would still pass — a wrong array of the right length is still one
collection. So the count assertions are paired with elementwise-equality assertions, and the two
sharing tests exist precisely because they are the two ways the cache can serve the _wrong_
population rather than merely a stale one.

## Result

Implemented on `feat/0075-element-cache`. `tests/core/element-cache.test.ts`, 11 tests.
**8 of 8 sabotages caught**, enumerated from the diff, run in the foreground against an
asserted-green baseline, reading exit codes, tree git-verified after each: a builder stops
caching; the cache never stores; the cache returns a stale wrong population; the key ignores
collection options; `optionsKey` reduced to a hand-written field list; the cache keyed on
`tsConfigPath` instead of object identity; `ScopedFunctionRuleBuilder` routed through the shared
cache; `filterElements()` returning the cached array directly when there are no predicates.

**Two of those eight did not fail on the first attempt, and both are recorded because the fix
was to the test, not the code.**

- **`optionsKey` reduced to one field passed.** The options test compared `functions(p)` against
  `functions(p, COLLECT_ALL)`, and those two do not collide even under a key that drops fields —
  `undefined` keys as `default`. Added a case comparing `{ includeMethods: true }` against
  `{ includeMethods: true, includeObjectLiteralFunctions: true }`, which differ in exactly the
  field a hand-written key would drop. That is the shape someone reaches for when adding a field
  later.
- **The `WeakMap` → `Map` sabotage passed, and was a bad sabotage rather than a gap.** A `Map`
  with object keys still keys on identity, so it changed nothing. Re-run as genuine
  `tsConfigPath` keying, the existing two-projects test caught it.

Sabotage, from the diff: drop each builder's memo in turn (the count test must red); key on
`tsConfigPath` instead of the object (the two-projects test must red); drop `_collectionOptions`
from the key (the options tests must red); move the memo from `getElements()` to
`filterElements()` (the `within()` test must red); return the cached array directly from
`subjects()` (the fresh-array test must red).

## Out of scope

- **Part 5's survivors-only raw collection.** Split out deliberately: it changes which nodes get
  wrapped and therefore which violations are reported, and bundling it would make a
  behaviour-neutral change hostage to one that is not. It also needs an ADR decision first — the
  ADR-007 boundary it was written against does not exist (there is no `src/core/engine/`, 61
  files import ts-morph directly, and ADR-007 is still _Proposed_).
- **The `resolve()` cache** — proposal 021 Part 2, its own plan. Independent of this one.
- **Part 3's lazy dependency resolution** — a spike, on a quiet machine, after both caches.
- **Consolidating the four materialization paths** (`filterElements`, `getMatchedCalls`, and the
  two graphql builders). Real, and a refactor rather than a performance change.
