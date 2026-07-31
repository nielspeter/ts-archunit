# Proposal 021 — Consumer Run Time: Where It Actually Goes

**Status:** Draft 2 — reviewed 2026-07-31. Parts 1–2 still promote; three design corrections
below, all found by surveying the code the proposal names rather than by re-measuring.
**Verified against:** v0.30.0 (2026-07-31). Every line number below was re-checked; those in
Parts 1 and 3–5 are exact, and Part 2's had drifted (the proposal already said to locate by
name).
**Priority:** Mixed — Parts 1 and 2 are measured and promotable; Part 3 is a spike, not a design; Parts 4, 5 and 6 are negative results that close off three obvious wrong turns, one of which this document took and reversed (see Part 6)
**Affects:** `src/core/rule-builder.ts` (the shared `filterElements` seam), the seven
`getElements()` implementations in `src/builders/`, `src/models/arch-call.ts`
(`collectCalls`, per Part 5), `src/core/module-edges.ts`, and — Part 3 only —
`src/core/project.ts`. No public API surface changes in Parts 1–2.
**Origin:** A 2026-07-30 profiling session, prompted by the maintainer reporting that
ts-archunit is slow **when run by a consumer against their own codebase** — not in this
repo's own unit suite. Measured against `Nine/apmoeller-archive-search` (147 source
files, ~10 architecture test files) with 0.27.0 built from `feat/0071-r2-widen-module-edges`,
plus a `--cpu-prof` profile and deterministic instrumentation counters.

## How to read this document

This is an **observation-driven** proposal in the sense [proposal 020](./closed/020-packwerk-derived-boundary-ideas.md)
sets out: it starts
from a consumer-reported slowdown and a profile, not from "another tool is faster." But
the six parts do not carry equal evidence, and they are labelled accordingly.

| Part | Finding                                                                 | Evidence                                                                       | Disposition                                                                 |
| ---- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| 1    | Element collection re-walks the AST once per rule                       | Deterministic counts + per-rule timings                                        | **Promote to a plan.** No behaviour change; precedent exists                |
| 2    | Module edges re-resolve through the type checker per rule               | Deterministic counts (1,423 `getSymbol`)                                       | **Promote to a plan.** The code already sanctions this fix                  |
| 3    | Eager dependency resolution loads the whole `node_modules` type surface | Load 11–13x, results identical — but the naive fix measured **slower** overall | **Spike, still live.** Part 6 briefly put it on hold and then reversed that |
| 4    | ts-archunit's own code is 1.9% of self time                             | `--cpu-prof` self-time breakdown                                               | **Negative result.** Recorded to foreclose the first instinct               |
| 5    | Replacing ts-morph                                                      | Four measurements, two of which contradicted the intuition                     | **No — bypass it on the hot path.** Feeds Part 1; not its own plan          |
| 6    | TypeScript 7 / the Go compiler                                          | TS 7.0 ships **no API** (probed); ts-morph's own migration benchmark           | **Watch item.** No action; the ~10x does **not** apply to our workload      |

Parts 4, 5 and 6 are the three "don't do the obvious thing" findings, and together they
matter more than Parts 1–3. Part 4 rules out optimising ts-archunit's own logic. Part 5
rules out replacing the engine and substitutes a narrower change Part 1's plan should
absorb. Part 6 rules out betting on TypeScript 7 to solve the load cost.

**If you read only one part, read Part 6.** It is the only part where the first
conclusion was wrong: "the Go compiler is ~10x faster, so let it solve the load cost"
survives about ten minutes of contact with ts-morph's own migration benchmark, where the
operations we depend on are **3x to 8x slower**. The reversal is left visible on purpose.

## Measurement caveat, stated first

The machine was under heavy concurrent load for the later runs (loadavg 57 — other
agents were building in a sibling repository). **Treat every millisecond figure in this
document as indicative and every count as exact.** The counts come from monkey-patched
`Node.prototype` counters and are a function of the code path alone, so they are
reproducible regardless of load; the timings are not. Parts 1 and 2 rest on the counts.
Part 3 is a spike precisely because its case rests on timings that need re-measuring on
a quiet machine.

Reproduction harness is not committed — it was a throwaway script importing `dist/` and
pointing at an external tsconfig. If Parts 1–2 are promoted, the plan should commit a
small benchmark fixture instead, so the numbers below become regression-testable rather
than anecdotal.

---

## The shape of a consumer run

For the 147-file consumer, a 20-rule suite shaped like its real architecture tests:

| rule group                | `getDescendantsOfKind` calls | nodes returned | `getSymbol()` calls |
| ------------------------- | ---------------------------- | -------------- | ------------------- |
| 5 × `calls()`             | 735                          | 56,200         | 0                   |
| 12 × layer `modules()`    | 0                            | 0              | 829                 |
| 1 × `functions()` naming  | 0                            | 0              | 540                 |
| 2 × `classes()`/`types()` | 0                            | 0              | 0                   |
| **total**                 | **735**                      | **56,200**     | **1,423**           |

The project contains 143,014 AST nodes and 147 source files. The suite performed 186
per-file import scans for those 147 files, and collected the same call-expression set
five times over.

Time split, from the `--cpu-prof` profile: project load was ~87% of the run and rule
execution ~13%. Within rule execution the five `calls()` rules were ~100ms each and
everything else was 0.3–6ms.

---

## Part 1 — Element collection re-walks the AST once per rule

**Recommended disposition:** Promote to an implementation plan. This is the cheapest
change with the clearest evidence, and it needs no behavioural decision.
**Affects:** `RuleBuilder.filterElements()` (`src/core/rule-builder.ts:407`) or the seven
`RuleBuilder` subclasses implementing `getElements()` — `call-rule-builder.ts:75`,
`class-rule-builder.ts:78`, `function-rule-builder.ts:91`, `module-rule-builder.ts:58`,
`type-rule-builder.ts:58`, `jsx-rule-builder.ts:61`, `scoped-function-rule-builder.ts:27`.

> **The population is nine, not seven, and the plan must derive it rather than restate it.**
> `src/graphql/schema-rule-builder.ts:218` and `src/graphql/resolver-rule-builder.ts:244` also
> define `getElements()` — `private`, on classes extending `TerminalBuilder` rather than
> `RuleBuilder`, and both have hand-copied `filterElements`'s body. Neither is memoizable by the
> key proposed here (one reads a loaded GraphQL schema, the other `this.sourceFiles`), so the
> right move is to state which hierarchy the cache covers and why the other two are excluded.
> Flagged because [plan 0073](../plans/completed/0073-conditions-declare-their-globs.md) made
> the identical error three days later — it claimed seven conditions and parsing found twelve —
> and its guard now derives populations from source. Do the same here.
>
> There is also a **fourth materialization path** the seam analysis misses:
> `CallRuleBuilder.getMatchedCalls()` (`call-rule-builder.ts:247`) re-implements
> `filterElements`'s body for the `within()` matcher, which `filterElements`'s own docstring
> admits is "not routed through here" (`rule-builder.ts:404-406`). This is a second, independent
> reason to prefer per-builder memos: a memo in `filterElements()` would miss `within()` on the
> one entry point where the ~98ms/rule win actually lives.

### Problem

`filterElements()` calls the abstract `getElements()` on every rule execution, and each
builder re-collects from the project from scratch:

```ts
// src/builders/call-rule-builder.ts:75
protected getElements(): ArchCall[] {
  return this.project.getSourceFiles().flatMap(collectCalls)
}
```

Nothing caches the result. A suite with five `calls()` rules walks every file's AST five
times and builds five copies of the same `ArchCall[]`. Measured: **735
`getDescendantsOfKind` queries returning 56,200 call nodes, where 147 queries returning
11,240 nodes would do.** Four fifths of that work is waste, and it is waste that scales
with the number of rules the consumer writes — which is the number we are asking them to
grow.

Indicative per-rule collection cost on the 147-file consumer, steady state:

| entry point   | per-rule collection |
| ------------- | ------------------- |
| `calls()`     | ~98 ms              |
| `functions()` | ~6.3 ms             |
| `types()`     | ~4.5 ms             |
| `classes()`   | ~2.8 ms             |
| `modules()`   | ~0.3 ms             |

`calls()` dominates because it is the only entry point whose collection is a full
descendant walk rather than a top-level `getClasses()`/`getFunctions()` read. That also
means the win is concentrated: a consumer with no `calls()` rules sees little, and a
consumer with a `calls()`-heavy security or hygiene suite sees most of it.

**Who that consumer is, concretely — and it is not hypothetical.** `agentGuardrails` emits one
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

### Proposed design

A per-project memo keyed on the `ArchProject`, one per entry point:

```ts
// src/core/element-cache.ts (new)
const caches = new WeakMap<ArchProject, Map<string, readonly unknown[]>>()
```

**This pattern already exists twice in the codebase** and should be copied rather than
invented: `src/core/disk-set.ts:83` and `src/core/path-universe.ts:35` are both
`WeakMap<ArchProject, T>`. Following them keeps the shape familiar and inherits their
invalidation story.

**Invalidation is the part that matters, and `WeakMap<ArchProject, …>` gets it right for
free — for projects this library created.** Verified: `resetProjectCache()` clears both the
`project()` and `workspace()` maps, so the next call constructs a new object literal and
therefore a new WeakMap key. It does **not** reach an `ArchProject` a consumer built themselves
or still holds across a watch re-run — but both of those are already-stale-AST situations that
the memo does not make worse. State the claim as "unreachable for projects created by
`project()`/`workspace()`", which is true, rather than "unreachable". `resetProjectCache()` (`src/core/project.ts:178`) clears the `project()`
singleton map, so the next `project()` call constructs a **new** `ArchProject` object —
which is a different WeakMap key, so it cannot hit a stale entry. Watch mode is the
caller that depends on this (see that function's docstring) and it is exactly the caller
where a stale cache would be an ADR-008 failure rather than a slow test: a rule
re-evaluated against a pre-edit AST reports a pass the edit did not earn. Keying on
object identity, not on `tsConfigPath`, is what makes that unreachable. **A plan must
state this and pin it with a test** — a cache keyed on the path string would pass every
test in this repo's suite and silently break watch mode.

Open questions for the plan:

- **Where the memo lives.** In `filterElements()` it is one change for all seven
  builders, but `getElements()` is `protected abstract` and an external subclass could
  override it, so a base-class memo would silently cache a subclass's results under the
  base key. Per-builder memos are more code and no such hazard. Recommend per-builder.

  **The hazard is not hypothetical — it ships.** `ScopedFunctionRuleBuilder extends
FunctionRuleBuilder` (`scoped-function-rule-builder.ts:15`) and overrides `getElements()`
  at line 27 to return callbacks extracted from a `CallRuleBuilder` selection, **not** the
  project's functions. A `filterElements()` memo keyed on `(ArchProject, entry-point)` files a
  `within(...).functions()` set and a plain `functions()` set under one key; whichever runs
  first wins, and `within(sel).functions().should().notExist()` then passes vacuously. That is
  an ADR-008 false green produced by a performance change, and it is the case the regression
  test must reproduce — the external-subclass argument above is the weaker one.

  **Corollary: the memo must be module-level, not an instance field.** `shallowClone`
  (`src/core/shallow-clone.ts:19`) copies every own property and every chain link clones
  (`addPredicate`, `rule-builder.ts:293`), so an instance memo of a _filtered_ set would
  survive `.and()` and hand back pre-narrowing subjects. The proposed `WeakMap` avoids this;
  say so, or the next reader "simplifies" it to a field.

- **`FunctionRuleBuilder` is parameterised.** `getElements()` reads
  `this._collectionOptions` (`function-rule-builder.ts:85-98`), so the cache key must
  include those options, not just the project.
- ~~**Mutation safety.**~~ **Closed by placing the memo correctly.** `filterElements()`
  unconditionally calls `.filter(...)` (`rule-builder.ts:409`), which always allocates — so with
  the memo on the **unfiltered** `getElements()` result, `subjects()` (`rule-builder.ts:158`,
  already typed `readonly T[]`) keeps returning a fresh array per call. No `readonly` wrapper,
  no copy, and no observable change to `subjects()` identity under `===`. All three concerns —
  mutation, aliasing and identity — exist only for a `filterElements()`-level memo, which the
  hazard above independently rules out. One constraint answers all of them: **memoize
  `getElements()`, never `filterElements()`.**

---

## Part 2 — Module edges re-resolve through the type checker, once per rule

**Recommended disposition:** Promote to an implementation plan, sequenced after or
alongside Part 1.
**Affects:** `src/core/module-edges.ts` — `moduleEdges()` (line 127), `edgesOf()`
(line 143), `resolve()` (line 211).

> **Note:** `src/core/module-edges.ts` is being modified on the current branch
> (`feat/0071-r2-widen-module-edges`). Line numbers above are as of 2026-07-30 and the
> functions should be located by name.

### Problem

`resolve()` obtains the resolved path via the specifier's **symbol**:

```ts
// src/core/module-edges.ts:211
function resolve(literal: Node): string | undefined {
  for (const declaration of literal.getSymbol()?.getDeclarations() ?? []) {
    if (Node.isSourceFile(declaration)) return declaration.getFilePath()
  }
  return undefined
}
```

`getSymbol()` requires the type checker, and the checker requires the whole program to be
bound. Two consequences, both measured:

1. **Repetition.** The 12 layer rules produced **829 `getSymbol()` calls**, and the suite
   as a whole 1,423 — re-resolving the same `(file, specifier)` pairs once per rule that
   touches the file. 186 per-file import scans for 147 files.
2. **Reach.** Because it goes through the checker, a purely path-based layer rule
   (`notImportFrom('**/src/worker/**')`) pays to bind the consumer's entire declaration
   surface. For 147 project files the program holds **1,005 files, of which 858 are
   declarations totalling 11.6MB**: 699 `node_modules` package `.d.ts`, 67
   `@types/node`, 63 TypeScript libs.

### This fix is already sanctioned in the code

`moduleEdges()`'s docstring (`module-edges.ts:107-125`) reasons about exactly this and
reaches the right conclusion in advance:

> **No cache.** Measured: the full classifying pass is 9.6–17.1ms warm over 471 files
> (1914 edges) … If a consumer reports a multiple-slowdown, the fix is a cache of
> **resolution**, not of the walk.

A consumer has now reported the slowdown, and the measurement above says the same thing
the docstring predicted: the _walk_ is cheap (0 descendant queries across all 12 layer
rules), the _resolution_ is not. The docstring also names the cost this proposal should
not double-count — "the checker warm-up is shared" — which is why Part 2's win is the
1,423 → ~147 reduction in resolutions, and **not** the elimination of the 11.6MB load.
Eliminating that load is Part 3, it is a different change, and it is unproven.

### Proposed design — corrected 2026-07-31: cache `resolve()`, not `edgesOf()`

Draft 1 proposed caching `edgesOf()` per `(ArchProject, SourceFile)`. **That contradicts the
docstring it cites as sanction**, which says the fix is "a cache of **resolution**, not of the
walk" — and since draft 1 was written, `edgeStream()` (`module-edges.ts:469`, v0.28.0) made the
distinction load-bearing. There are now three entry points to edges, not one:

| entry point   | callers                                                        |
| ------------- | -------------------------------------------------------------- |
| `edgesOf`     | `dependency.ts:180`, `:239`, `:445`; `predicates/module.ts:42` |
| `edgeStream`  | `dependency.ts:336` — `dependOn`, deliberately lazy            |
| `moduleEdges` | `reverse-dependency.ts:72` — the batch form                    |

An `edgesOf` cache does not serve the streaming path, and the obvious later "fix" — routing
`edgeStream` through `edgesOf` — destroys an early exit that v0.28.0 added on purpose. The
comment at `dependency.ts:327-334` prices it: _"`edgesOf` builds and RESOLVES every edge in the
file before returning, so `.some()` on its result pays a `getSymbol()` per literal even when the
first one answers the question — 100 checker calls on a 100-import file where the pre-0.28.0
code made 1."_

So cache **`resolve()`** (`module-edges.ts:234`). It is the single function all three entry
points share, it is the one the docstring names, and it is where the 1,423 → ~147 reduction
actually lives. Two things the plan must get right:

- **The value is `string | undefined`.** Look up with `has()`, not truthiness — an unresolved
  specifier caches as `undefined`, and with `get()`-truthiness those are precisely the repeat
  lookups that never get cached. Measured on this repository: **229 of 2,082 import literals are
  unresolved**, so this is not an edge case.
- **Key on the literal node**, not `(filePath, specifier)` — one file can carry the same
  specifier twice, and a per-pair key would conflate two distinct edges.

`WeakMap` remains the right shape. Note a third precedent draft 1 did not cite and which uses a
different key: `reverse-dependency.ts:12` is `WeakMap<Project, ReverseImportGraph>`, keyed on the
**ts-morph** `Project`. Since a bare-object `ArchProject` literal is an explicitly supported shape
and two of them can wrap one ts-morph `Project`, `Project` is arguably the more correct key for a
value derived purely from the AST. Three caches with two conventions is a thing to settle, not
inherit.

The docstring's closing sentence — "What it forecloses is batching a resolution cache
later, which is recorded rather than hidden" — should be updated by the plan, since the
plan is that later.

Open question: `ModuleEdge` deliberately has **no `candidates` field** so that candidates
stay a function of `specifier` and `resolvedPath` (`src/core/import-candidates.ts:45-57`).
A cache of edges is consistent with that; a cache of _candidates_ would not be. Keep the
cache at the edge level.

---

## Part 3 — Eager dependency resolution loads the whole `node_modules` type surface

**Recommended disposition:** **Spike only. Do NOT draft an implementation plan.** The
headline number is the largest in this document and the naive implementation of it
measured _slower_. That combination is the signature of a change that needs measurement
before design, not design before measurement.

**Sequenced after Parts 1–2, and it survived a scare.** A first pass of Part 6 put this
part on hold, reasoning that TypeScript 7's ~10x would make the load cost disappear.
ts-morph's own migration benchmark says the opposite — `new Project({ tsConfigFilePath })`
goes **167ms → 512ms** on the tsgo branch — so avoiding declaration files we never query
is worth _more_ after that migration, not less. **One caveat carries over: do not build
the spike on `ts.resolveModuleName` or `ts.createModuleResolutionCache`, which Part 6
found are removed in TS 7.**
**Affects (if ever built):** `src/core/project.ts` — `project()` (line 44),
`workspace()` (line 110).

### The observation

`project()` constructs `new Project({ tsConfigFilePath })` with no options, so ts-morph
eagerly resolves and parses every file reachable from the consumer's imports.

Setting `skipFileDependencyResolution: true` on the consumer project:

- cut load by **11–13x**;
- produced **identical violation counts** across the whole 20-rule suite;
- produced **identical import resolution** — 101 relative resolved / 10 unresolved, 344
  package resolved / 65 unresolved, the same on both sides.

Package specifiers still resolve because `getModuleSpecifierSourceFile()` triggers
on-demand resolution, which adds the target lazily instead of eagerly.

### Why this is not yet a design

**Skipping alone does not save the work, it defers it.** With `skipFileDependencyResolution`
the load dropped ~11x but rule execution roughly tripled, for a net total of ~1.0–1.2x —
inside the noise on a loaded machine. A `WeakMap` cache over
`getModuleSpecifierSourceFile()` did not recover it either (~1.15x total). The
declarations still get read; only _when_ changes.

The only way the load win becomes a real win is if module resolution stops going through
the checker at all — i.e. Part 3 depends on a **stronger** version of Part 2. The
obvious candidate was tested and did not pay off:

- `ts.resolveModuleName` **agrees with the checker on 581 of 582 resolved paths** (the
  one difference was a test-setup file the checker did not resolve), so correctness looks
  tractable;
- but with a raw `ts.sys` host it measured **~2x slower than the checker**, because node
  resolution stats many candidate paths per specifier and `ts.sys` does real syscalls.
  ts-morph's `getModuleResolutionHost()` has an in-memory cached filesystem and was not
  tested against; that is the first thing a spike should try.

Three further obstacles a spike must clear:

1. **ADR-002** says ts-morph for all AST operations, never the raw TypeScript compiler
   API. `ts.resolveModuleName` is the raw API. ts-morph re-exports `ts`, which is a
   narrow seam rather than a clean pass, and ADR-007 ("confine ts-morph behind
   `src/core/engine/`") is the natural place to put it. Either way this needs an explicit
   ADR decision, not a quiet import.
2. **Ambient modules and augmentations.** The checker resolves `declare module 'x'`;
   file-based resolution does not. `resolve()`'s docstring
   (`module-edges.ts:185-210`) documents deliberate handling of module-augmentation
   symbol ordering, so this is a known-live concern in this codebase, not a hypothetical.
3. **Type-based rules genuinely need the program.** `getType()`/`getReturnType()` appear
   in 11 files including `src/conditions/type-level.ts`, `src/conditions/pattern.ts`,
   `src/rules/typescript.ts`. Any lazy-load design needs a seam those call first, memoised —
   and a rule that forgets to call it would silently see `any` everywhere and pass. **That is an
   ADR-008 false-green**, and it is the strongest argument for not attempting Part 3 casually.

   Two notes for the spike. First, **do not call it `ensureResolved()`**: that name reads as an
   idempotent no-op, which is exactly the kind of call you can safely forget — and forgetting is
   the failure mode. Name it for what it costs, e.g. `withTypeProgram(project)` returning a
   handle the type conditions take as a parameter. Second, **typing alone cannot close this**:
   `Condition<T>.evaluate(elements, context)` receives ts-morph nodes directly and
   `defineCondition` is public, so a _consumer's_ custom condition calling `getType()` cannot be
   made to take a handle without a breaking signature change. The sound options are to resolve
   on first type query behind a wrapper the nodes route through — which needs the engine
   boundary that does not exist — or to make the unresolved state **detectable** so a forgotten
   call fails loudly. If neither works, the performance number is irrelevant and Part 3 closes.

### What a spike should answer

- Does `ts.resolveModuleName` + `project.getModuleResolutionHost()` +
  `ts.createModuleResolutionCache()` beat the checker, on a quiet machine, on a
  project large enough to matter?
- Do the two resolvers agree across this repo's full module-edge fixture corpus
  (`tests/core/module-edges-corpus.test.ts` already compares two derivations of the same
  rule and is the natural harness)?
- Can `ensureResolved()` be made unforgettable — e.g. only reachable through a typed
  engine handle that type-based conditions must take — rather than a convention?

---

## Part 4 — What not to optimise

Recorded as a negative result, because it is where effort would naturally go first and it
would be wasted.

`--cpu-prof` self-time for a realistic consumer run:

| bucket             | self time  | share    |
| ------------------ | ---------- | -------- |
| `@ts-morph/common` | 2,724 ms   | 43.7%    |
| native (Node)      | 1,742 ms   | 28.0%    |
| `ts-morph`         | 1,325 ms   | 21.3%    |
| `cjs/loader`       | 122 ms     | 2.0%     |
| **`ts-archunit`**  | **120 ms** | **1.9%** |
| `picomatch`        | 16 ms      | 0.3%     |

The three largest single frames are `getCompilerForEachDescendantsIterator` (829ms, AST
descendant iteration), `readFileUtf8` (768ms, reading declaration files), and garbage
collection (681ms, AST wrapper allocation pressure).

**ts-archunit's own code is 1.9% of self time, and `picomatch` — the thing a reader would
suspect, given how many globs a rule set evaluates — is 0.3%.** There is no meaningful
win available in the DSL, the builders, the predicate/condition dispatch, or glob
matching. Every win in this document is a win because it causes **fewer ts-morph calls**,
not because it makes ts-archunit's own code faster. A plan that reads as "optimise the
hot loop" is aimed at the wrong 2%.

This also reframes Parts 1 and 2 correctly: they are not caching for its own sake, they
are the two places where ts-archunit asks ts-morph for the same answer N times. That is
the same principle as ADR-007 rule 2 — "talk to the engine in batches, not per-node" —
applied across rules rather than across nodes.

**Note the tension with Part 5.** "ts-archunit is 1.9%" does not mean the remaining 98%
is untouchable — part of the `ts-morph` bucket is wrapper overhead ts-archunit chooses to
pay, and Part 5 measures how much. What Part 4 forecloses is optimising ts-archunit's own
_logic_; Part 5 is about which engine calls that logic makes.

---

## Part 5 — Should ts-morph be replaced?

**Recommended disposition:** **No — keep ts-morph, and bypass it on the hot path behind
the ADR-007 boundary.** **Correction 2026-07-31: that boundary does not exist.** There is no
`src/core/engine/`, 61 files under `src/` import ts-morph directly, and ADR-007 is still
_Proposed_. So "behind the ADR-007 boundary" is not the small phrase it reads as — it is either
"build the boundary first", which dwarfs Part 1's plan, or "raw `ts.*` inside
`src/models/arch-call.ts`", which is a plain ADR-002 violation with nothing to hide it behind.
Part 3 states this correctly for itself; Part 5 must carry the same sentence, because the
sequencing folds Part 5 into Part 1's plan. Measured, and the measurement went against the intuition twice.
The bypass is a **Part 1 design input**, not a separate plan.
**Affects (the bypass):** the collection functions behind `getElements()` — chiefly
`collectCalls` (`src/models/arch-call.ts`) and the JSX equivalent.

Raised because Part 4 shows 93% of self time inside ts-morph and its vendored compiler,
which makes "replace the engine" the obvious next question. Four measurements answer it.

### 1. Most of that 93% is the TypeScript compiler, not ts-morph

`node_modules/@ts-morph/common/dist/typescript.js` is **8.7MB — a vendored copy of the
TypeScript compiler**, byte-comparable to `node_modules/typescript/lib/typescript.js`. The
frames in the 43.7% `@ts-morph/common` bucket are `scan`, `visitNode2`, `visitNodes`,
`bind`, `bindWorker`, `internIdentifier`, `getIdentifierToken`, `doJSDocScan` — TypeScript's
scanner, parser and binder. **Replacing ts-morph does not remove that work**; it is the
cost of type-aware analysis, whoever calls it.

Only the 21.3% `ts-morph` bucket is ts-morph's own code — the lazy node-wrapping layer
(`getCompilerForEachDescendantsIterator`, `_getCompilerDescendantsOfKindIterator`,
`get compilerNode`). That is the only part a replacement could reclaim.

### 2. A faster parser is aimed at the wrong cost

| what                                       | time    |
| ------------------------------------------ | ------- |
| parse the consumer's own 147 files         | ~39 ms  |
| load project files only (`skip deps`)      | ~51 ms  |
| full load as ts-archunit does it today     | ~498 ms |
| → reading + parsing `node_modules` `.d.ts` | ~447 ms |

Parsing the consumer's code is **39ms of a ~498ms load**. SWC, oxc and tree-sitter parse
several times faster than TypeScript, so the entire prize for swapping the parser is a
fraction of that 39ms — call it 7% of load, best case. The 447ms is declaration files, and
those are read **because we want types**. No non-TypeScript parser can supply TypeScript
type resolution, and `getType()`/`getReturnType()` appear in 11 source files including
`src/conditions/type-level.ts`, `src/conditions/pattern.ts`, `src/rules/typescript.ts`.
Swapping to a type-blind parser trades every type-aware rule for ~35ms.

### 3. The wrapper tax is real — and a naive raw rewrite is _slower_

Same task, collect every `CallExpression` with name/file/line, identical output (11,240
calls, same names and lines):

| implementation                                   | time    |
| ------------------------------------------------ | ------- |
| ts-morph `getDescendantsOfKind` + per-node reads | ~151 ms |
| ts-morph `forEachDescendant` + per-node reads    | ~155 ms |
| raw `ts.forEachChild` over `sf.compilerNode`     | ~7 ms   |

So the wrapper layer is a ~20x tax when per-node text and line data is read (~6.8x for a
bare walk that reads nothing). **But the public API hands back ts-morph nodes**, and
re-wrapping raw nodes to satisfy it — via `getDescendantAtStartWithWidth`, which does
return the identical `compilerNode` — costs **~91ms**, i.e. _more than ts-morph's own
31ms traversal._ A drop-in raw rewrite is a pessimisation.

The win exists only in one shape: **filter on raw nodes, wrap only the survivors.**

| for `calls().that().haveNameMatching(/^(console\|eval\|…)$/)` | time   |
| ------------------------------------------------------------- | ------ |
| today: wrap all 11,240, then filter                           | ~41 ms |
| proposed: raw walk + filter, wrap the ~37 survivors           | ~7 ms  |

**5.9x for one rule.** Composed with Part 1's cache — one raw index built once, five
patterns filtered over it — the `calls()`-heavy slice of the suite went 272ms → 10ms,
**27.7x**. That 27.7x is Part 1 _and_ Part 5 together and should never be quoted as
either alone.

### 4. Replacement would be a breaking change for consumers, not a refactor

**60 of the built `.d.ts` files reference ts-morph**, and both audited consumers write
custom conditions typed directly against it:

```ts
// apmoeller-archive-search/test/architecture/_helpers.ts:8-9
import type { SourceFile } from 'ts-morph'
import { Node, SyntaxKind } from 'ts-morph'
```

cmless does the same in `tests/architecture/matchers/fastify-schema-matchers.ts` and
`tests/architecture/universal-rules.test.ts`. `defineCondition<SourceFile>` is a
documented extension point, and its type parameter _is_ a ts-morph type. Replacing the
engine invalidates every consumer's custom condition — against 21,125 lines of `src/`
typed the same way, and against ADR-002's explicit "no tree-sitter/SWC/raw TS API".

### The correctness cost the bypass carries

In the measurement above the raw path found **38 survivors where ts-morph found 36**.
That is not noise, it is a semantic divergence: my raw shortcut read
`PropertyAccessExpression.name.escapedText`, so `a.b.require()` reads as `require`, while
`getExpression().getText()` yields `a.b.require` and does not match `/^require$/`.

Which is correct is a real question, but the point for this proposal is narrower: **a raw
fast path is not automatically equivalent to the wrapper path, and a divergence here
changes which violations are reported.** Under ADR-008 that makes differential testing
non-optional — the raw and wrapper collections must be proven to agree over the whole
fixture corpus, in the style `tests/core/module-edges-corpus.test.ts` already uses to
compare two derivations of one rule. A plan that adds the fast path without that test is
shipping an unverified change to rule output in the name of speed.

**Corpus testing is necessary and not sufficient, and the design should not need it to be.**
Ask ADR-008's own question of that test: what would it do if the raw path were completely broken
for nested property-access callees? It would **pass**, unless a fixture happens to have that
shape — and the one divergence we know about was found on a _consumer_ codebase, not in this
repo's fixtures. Coverage of a corpus is not a guarantee about code the corpus does not contain.

The structural fix is to stop making the raw path a second implementation of the semantics.
Require the raw filter to be a provable **over-approximation** and re-run the real ts-morph
predicate on the survivors. Then `38 vs 36` becomes "38 wrapped, 36 kept": a divergence costs
time and can never change which violations are reported, and the guarantee holds by construction
rather than by fixture coverage. The measured win barely moves — wrapping 38 nodes instead of
11,240. Soundness is not free, though: `haveNameMatching(/^a\.b\.require$/)` matches the
ts-morph text but not the raw `escapedText`, so "last identifier matches the regex" is **not** a
superset. The raw prefilter has to be derived conservatively from the pattern, or skipped.

**And it cannot fire for every rule.** Predicates are user-extensible — `satisfy(custom)`,
`definePredicate` and the `not()`/`and()`/`or()` combinators all take arbitrary
`Predicate<ArchCall>`, whose `test()` needs a built `ArchCall` with ts-morph values behind it.
An arbitrary composed predicate cannot run on a raw `ts.Node`. So the fast path applies only
when every leaf of the chain carries a raw equivalent, and the combinators must propagate that
capability — which is exactly the shape the existing `globs` propagation already has
(`combinators.ts:31,71-74`) and is the pattern to copy. Over-approximating to "everything" when
a predicate is unanalyzable makes that fallback safe by default. It also caps the 5.9x to
built-in-only chains, which the headline number should say.

### Honest ceiling

On the measured 20-rule suite, load is ~87% of the run and rule execution ~13%. Even a
perfect rule-execution win therefore caps total improvement near 13% **on that suite**.
The reason to do it anyway is that the two costs scale differently: **load is a fixed
per-process cost, rule execution scales linearly with rule count.** Extrapolating the measured per-rule costs, rule execution passes load somewhere around 140
rules — **at this suite's `calls()` ratio**, which is the caveat that makes the number honest.
5 of the measured 20 rules are `calls()` and they carry essentially all the rule-execution cost,
so a consumer who grows to 140 rules by adding `modules()` layer rules at 0.3ms each — which is
what `layeredArchitecture` and `strictBoundaries` generate — never crosses over at all. At a
preset-heavy ratio the crossover is in the thousands.

Pulling one thing up from Out of Scope, because it strengthens this and is buried there: both
audited consumers already amortise project load across Vitest workers with a shared-project
module. On a real consumer setup the 87% is **already amortised**, which makes rule execution a
larger share of wall-clock than a single-process measurement shows. The win grows precisely as adoption grows, which is the
case worth optimising for — and the fixed 87% is the half Part 6 argues we should let the
engine solve rather than work around.

---

## Part 6 — TypeScript 7 (the Go compiler)

**Recommended disposition:** **Watch item — and read the numbers before assuming it helps
us.** A first pass of this part concluded "let the compiler solve the load cost, put
Part 3 on hold." **That conclusion was wrong**, and the correction is the most useful thing
in this document: on the migration that actually exists, the operations ts-archunit
depends on get **slower**, not faster. Part 3 therefore stays live.
**Affects:** ADR-001 (TS ~5.9 pinned to ts-morph), ADR-002 (ts-morph as the engine), and
the shelf life of Part 5's raw-node design.

### What TypeScript 7 is today

`typescript@7.0.2` is the latest on npm and **ships no programmatic API.** Probed, not
inferred — the published `lib/` is `getExePath.js`, `tsc.js`, `version.cjs` and two `.d.ts`
files. `require('typescript')` reports `version: 7.0.2` and then `createProgram`,
`createSourceFile`, `forEachChild`, `resolveModuleName` and `SyntaxKind` are **all
`undefined`**. `bin/tsc` is a 44-byte shim to a platform-native binary. TS 7.0 is a CLI.

`ts-morph@28.0.0` depends on `@ts-morph/common@~0.29.0`, which vendors a 9.1MB
`typescript.js` reporting **version 6.0.2** — the JavaScript compiler, and the final
JS-based line. So upgrading ts-morph does not reach the Go compiler.

The CLI is genuinely ~10x faster. Full typecheck of the same 147-file consumer, three runs
each, same loaded machine:

| compiler                     | real time            |
| ---------------------------- | -------------------- |
| TypeScript 7.0.2 (Go native) | 0.98 / 0.31 / 0.47 s |
| TypeScript 5.9 (JavaScript)  | 5.63 / 4.63 / 4.68 s |

**That number is about `tsc --noEmit`, and it is the wrong benchmark for us.** It measures
a batch typecheck that reports diagnostics and exits. ts-archunit's workload is: load a
project, then read the AST hundreds of thousands of times from JavaScript. Those are
different costs, and the migration prices them differently.

### The migration is real, active, and being measured — by its author

ts-morph is not waiting. Tracking issue
[dsherret/ts-morph#1621](https://github.com/dsherret/ts-morph/issues/1621) records the
turn: the maintainer's March 2025 comment ("I don't think ts-morph will continue to exist
because the API sounds like it will be limited and require IPC") is **struck through**, with
"Edit: I'm working on it." On 2026-07-26: _"significant progress … a path forwards … hoping
to have a PR open in the coming weeks."_ The branch is
[`tsgo-wasm`](https://github.com/dsherret/ts-morph/tree/tsgo-wasm), **committed to on
2026-07-30** — the same day this proposal was written.

The approach, from its own README: tsgo compiled to WebAssembly and run **in-process**,
_"no subprocess, no native addon, fully synchronous."_ That resolves the fear the 2025
comment was about, and it resolves the question this proposal would otherwise have had to
leave open — an IPC-only or async API could not have served 143,014 per-node reads at any
compiler speed. This one can. It requires a fork of typescript-go, and the maintainer
intends to _"make recommendations to typescript's unstable apis"_ from it.

On the Microsoft side, from the typescript-go discussion: _"We love ts-morph; it is
explicitly an anti-goal to prevent ts-morph from working altogether. Type information is
effectively the reason why we need to have an API."_ So there is real two-way influence,
even though this is not a formally joint project. **That materially de-risks ADR-002** —
more than anything else recorded here.

### But the measured numbers go the wrong way for our workload

From the branch's own `tsgo-wasm/BREAKING-CHANGES.md` §6, the author's benchmark against a
published 28.0.0 install, 800 files:

| operation                                  | ts-morph 28.0.0 | tsgo-wasm | direction       |
| ------------------------------------------ | --------------- | --------- | --------------- |
| `new Project({ tsConfigFilePath })`        | 167 ms          | 512 ms    | **3.1x slower** |
| `addSourceFilesAtPaths`                    | 38 ms           | 309 ms    | **8.1x slower** |
| First `getPreEmitDiagnostics()`            | 547 ms          | 1003 ms   | **1.8x slower** |
| `getCompilerOptionsFromTsConfig`, repeated | 0.4 ms          | 10.3 ms   | **26x slower**  |
| `createSourceFile` in a loop               | 27 ms           | 20 ms     | 1.35x faster    |
| `createSourceFile` + read each back, 1600  | 45 ms           | 127 ms    | 2.8x slower     |

The cause is stated plainly: _"ts-morph no longer owns the parser: the tree comes from the
compiler, over a wire, as a binary encoding that has to be decoded on this side."_ 28.0.0
parsed into JavaScript objects in the same heap.

**Every row that regressed is a row ts-archunit lives on.** `new Project({ tsConfigFilePath })`
is `project()`. Reading nodes back is every rule. The one row that improved —
`createSourceFile` in a loop — is a manipulation workload ts-archunit does not have. The
author is explicit that these are constant factors and that the editing-side costs are
independent of project size, which is fair; but a 3x constant on the operation that is
already 87% of a consumer run is not a rounding error for us.

This is a snapshot of an in-progress branch, not a shipped release, and the author is
actively cutting these numbers (two `perf:` commits on 2026-07-30 alone, and `TODO.md` §2.1
targets the double parse). Native builds are named as future work to replace WASM — the
seam is _"shaped around `@typescript/native-preview`'s `unstable/sync` API so the backend
can later be swapped for the subprocess/native build for native performance."_ So expect
these figures to move. Do not plan on the direction.

### What this changes

1. **Part 3 stays live — the opposite of this part's first conclusion.** If project load
   goes from 167ms to 512ms for 800 files, then _not loading 858 declaration files we never
   query_ is worth more after the migration, not less. The reasoning that put it on hold
   ("the engine will make this cheap") is contradicted by the engine's own benchmark.
2. **Parts 1 and 2 get stronger, for a new reason.** Their case was redundancy. Now add:
   every engine call may cross a WASM boundary and decode a binary tree. A cache that
   turns 1,423 resolutions into ~147, and 735 AST walks into 147, is worth more when each
   call is more expensive. **These remain the changes that survive the migration**, and
   they are the only part of this document whose value does not depend on which way the
   tsgo numbers land.
3. **Part 5's raw-node fast path acquires a shelf life, and its `ts.*` route dies.**
   `forEachChild` and `createSourceFile` survive the shrunken `ts` namespace (2249 runtime
   keys → 411). But **`ts.resolveModuleName`, `ts.createModuleResolutionCache`,
   `nodeModuleNameResolver`, `ts.sys` and `ts.getLineAndCharacterOfPosition` are all
   removed** — which is precisely the API the checker-free resolution idea in Part 5 was
   built on, and precisely what my prototype used. Do not build on `ts.*`. Keep resolution
   behind ts-morph's own surface, which is the abstraction that will absorb this.
   Separately, the raw-vs-wrapper economics that gave Part 5 its 5.9x were measured against
   an in-heap tree; over a wire they must be **re-measured, not assumed**.

### The persisted-`SyntaxKind` hazard — audited 2026-07-30

`SyntaxKind` is **renumbered**, and the migration guide calls it _"the silent one"_:
`Identifier` is `79`, not `80`; `SyntaxList` is `344`, not `353`; `ClassDeclaration` is
`264` in both, which the guide flags as coincidence. All three confirmed against the
`typescript@5.9.2` vendored by ts-morph 27 — today's values are `80`, `353`, `264`. It warns
specifically about _"a persisted `SyntaxKind` — in a cache, a fixture, a JSON rule file, a
database."_

**Audited. The hazard does not exist in the form feared: no numeric `SyntaxKind` is
persisted anywhere.** Findings, in the order they close the question:

1. **The persistence surface is two files, and neither carries a kind.** `src/` writes to
   disk in exactly two places: `baseline.ts:311` (the baseline JSON) and
   `cli/commands/init.ts:110-113` (scaffolding). The baseline schema is
   `generatedAt, hashVersion, root, count, violations[{rule, file, line, hash, subject}]`;
   the committed `frozen-0.27.0-baseline.json` was walked and its only numeric values are
   `hashVersion=2`, `count=4` and `line=1/4/5/6`. No kind, numeric or otherwise.
2. **`fingerprint.ts` collects numeric kinds, and they never leave the process.**
   `buildFingerprint` pushes `node.getKind()` into `Fingerprint.kinds`
   (`src/smells/fingerprint.ts:27`), but the only consumers are `computeSimilarity`'s LCS
   and `nodeCount`. Both sides of every comparison come from the same ts-morph in the same
   run, so a renumbering is self-consistent and invisible. Never stringified, never hashed,
   never written.
3. **No hard-coded ordinals in `src/`.** All nine `getKind()` sites compare against named
   members (`SyntaxKind.ImportKeyword`, `.ArrowFunction`, `.FunctionExpression`,
   `.ComputedPropertyName`) or the `DECISION_KINDS` set, which is built from named members
   (`complexity.ts:6-13`). Renumbering moves the constant and the comparison together.

Two smaller things the audit did find:

4. **A string exposure via the element-name fallback — narrow, and it fails loudly.**
   `getElementName` ends `return parts.length > 0 ? parts.join('.') : node.getKindName()`
   (`violation.ts:208`), and `element` is hashed into both `hash` and `subject`. TS 7
   renames `EndOfFileToken` → `EndOfFile` and `JSDocTag` → `JSDocUnknownTag` and retires
   ~14 more kinds, so a baselined violation whose element fell back to one of those changes
   identity. **The failure direction is a false alarm, not a false green:** the entry stops
   matching, the violation re-reports as new, and the build fails. Worth recording rather
   than fixing — a bare `EndOfFileToken` as a violation subject is implausible — but note
   the one genuinely quiet half: because `element` changed, `subject` changed too, so
   `hashSubject`'s diagnostic classifies the orphaned entry as _"the violation was fixed"_
   and says nothing. So the shape is one spurious failure plus one silently dropped entry,
   and the ADR-008 concern is that the cheapest remedy — regenerate the baseline — absorbs
   both.
5. **12 hard-coded enum ordinals in `tests/`, and these are the ones worth fixing now.**
   Not `SyntaxKind` and not persisted, but `compilerOptions` ordinals: `jsx: 2` (×7, =
   `JsxEmit.React`), `target: 99` (= `ScriptTarget.Latest`), `module: 100` (=
   `ModuleKind.Node16`), `moduleResolution: 3` (= `ModuleResolutionKind.Node16`) — in
   `tests/predicates/jsx.test.ts:22`, `tests/builders/jsx-rule-builder.test.ts:12`,
   `tests/models/arch-jsx-element.test.ts:13,220,229,238`, `tests/conditions/jsx.test.ts:16`,
   `tests/helpers/module-edge-migration.test.ts:105-107`. These are **inputs**: if an
   ordinal silently comes to mean a different target or JSX mode, the fixture project
   compiles under different settings and the test still passes — a guard weakened with no
   failure. That is the ADR-008 shape, it is in the suite rather than the product, and
   replacing the numbers with named members or string literals is a few minutes' work that
   is correct regardless of TS 7. **This is the only action item the audit produced.**

Also noted, not acted on: `Fingerprint` and `buildFingerprint` are **public exports**
(`src/index.ts:341-342`) and `Fingerprint.kinds` is `readonly SyntaxKind[]`. ts-archunit
never persists them, but the API lets a consumer cache one. A docstring saying the values
are not stable across TypeScript versions would be enough.

Also breaking, for a later audit rather than now: `Type`, `Symbol` and `Signature` cannot
outlive a manipulation. ts-archunit is read-only analysis, so this looks safe — but watch
mode re-reads after edits, which is the one place it might not be.

### Review trigger

Re-open when **dsherret's PR lands** (the tracking issue is the signal, not the TS release
notes) or when **TS 7.1 ships its API** (~October 2026). Three questions, none answerable
today:

1. Have the load and node-read regressions closed? If `new Project` is still 3x, ts-archunit
   should not migrate on schedule — and Part 3 becomes the primary lever rather than a
   deferred one.
2. Does the native (non-WASM) backend arrive, and does it change the answer to 1?
3. Does the shrunken `ts` namespace break anything we depend on beyond Part 5's dead route?

Until then: the two caches are the work. They are worth doing on their own merits, they
remove redundancy no compiler upgrade removes, and — unlike everything else in this
document — their value does not depend on how TypeScript 7 turns out.

## Out of scope

- **Per-process load multiplication.** A consumer's project load is paid once per Vitest
  worker, because Vitest isolates module state per test file. Both audited consumers
  already work around this with a shared `projects.ts` / `shared-project.ts` module that
  every architecture test imports, and one of them documents the saving in a comment
  ("~2.8s saved per file"). That workaround is correct and it is consumer-side. If
  anything is owed here it is **documentation**, and possibly a recommended
  `poolOptions` snippet — not a code change. Worth a docs issue, not a part of this
  proposal.
- **This repo's own unit suite.** Separately profiled during the same session and it has
  its own, different dominant cost (per-test-file fixture project construction, where the
  fixture tsconfigs pull in the full `@types` surface for 5–26-file fixtures). That is a
  test-infrastructure question with no bearing on consumer run time, and it should not be
  bundled into a proposal about consumer performance.
- **Replacing the AST engine.** Closed by Part 5 on measurement, not on ADR-002 alone.
  Should a future reader reopen it, the four numbers to beat are there; do not reopen it
  on the strength of "93% of self time is in ts-morph," which is the reading Part 5
  exists to correct.

Not out of scope, though it reads that way at first: **AST wrapper allocation** (the 681ms
GC frame). It looked like an unavoidable ts-morph characteristic until Part 5 measured it —
wrapping 11,240 nodes to keep ~37 is a choice ts-archunit makes, and the survivors-only
design is the fix. It belongs to Part 1's plan.

## Sequencing

1. **Commit a benchmark fixture first.** Everything below is a performance claim, and the
   numbers in this document are indicative (see the measurement caveat). Without a
   committed harness the plans cannot show they worked, and a regression later cannot be
   attributed. This was step 3 in draft 1's ordering; Part 5 moved it to the front,
   because a change that alters which nodes get wrapped needs a before/after that a
   reviewer can re-run.
2. **Part 1 plan — element collection cache, on its own.** Draft 1 folded Part 5's
   survivors-only collection into this step, reasoning that "splitting them would mean touching
   `collectCalls` twice". **Split them.** That reason is maintainer convenience, and it makes a
   change with _no_ behaviour difference hostage to one that changes which nodes get wrapped —
   and therefore, absent the over-approximation design, which violations get reported. The
   asymmetry matters for consumers with a baseline: a newly-matched call is a spurious red, but
   a lost match is a **silently orphaned baseline entry**, which `hashSubject` classifies as
   "the violation was fixed" and says nothing about. Ship the cache first, with its own release
   note; ship the fast path behind its own plan and its own differential test.

2b. **Part 5 plan — survivors-only collection.** Must carry the differential test, and should
adopt the over-approximation framing above so that a divergence cannot change rule output at
all. Blocked on an explicit ADR decision about where raw `ts.*` may live, since the ADR-007
boundary it was written against does not exist yet. 3. **Part 2 plan — module-edge cache.** Self-contained; may share the cache module with 1. 4. ~~Audit the persisted-`SyntaxKind` hazard.~~ **Done 2026-07-30 — see Part 6.** No
numeric kind is persisted; the feared false green does not exist. Its one action item —
replacing 12 hard-coded `compilerOptions` ordinals with named members — is **complete as of
v0.28.0**: no `jsx: 2` remains anywhere under `tests/`, and
`tests/helpers/module-edge-migration.test.ts:120` now carries named enums with a comment
flagging `moduleResolution: 3` as the dangerous one. Plan 0071, which this was waiting on,
shipped in v0.28.0.

5. **Part 3 spike**, on a quiet machine, after 1–3. Not on `ts.resolveModuleName` — Part 6
   found it removed in TS 7. If the spike fails, close Part 3: the load cost is real but it
   may simply be the price of a type-aware tool.

Steps 2 and 3 address the cost that **scales with rule count**; step 5 is the only one that
touches the fixed per-process load. If only one lands, step 2 is the one, because it is
where the measured 27.7x lives.

### Review trigger

Re-open when **dsherret's tsgo PR lands** — the tracking issue
([#1621](https://github.com/dsherret/ts-morph/issues/1621)) is the signal, not the
TypeScript release notes — or when **TS 7.1 ships its API** (~October 2026). The questions
are in Part 6's own review trigger, and the headline one is whether the 3x–8x load and
node-read regressions on the tsgo branch have closed.

Until then the two caches are the work. They are the only items here whose value does not
depend on how TypeScript 7 turns out: they remove redundancy, and no compiler upgrade
removes redundancy.
