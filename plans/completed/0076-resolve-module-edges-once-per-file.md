# Plan 0076 — Build module edges once per file

**Status:** DONE, shipped in v0.31.0. Implemented on `perf/element-and-edge-caches`.
**Priority:** Medium. Smaller than [0075](./0075-collect-elements-once-per-project.md) in absolute
milliseconds and, like it, one of the two items in
[proposal 021](../../proposals/021-consumer-run-time-where-it-actually-goes.md) whose value survives
any TypeScript 7 outcome.
**Effort:** ~half a day.
**Origin:** Proposal 021 Part 2. Every number below is measured on **this repository (520 files,
2,097 import literals)**.

## Problem

`edgesOf()` walks and resolves a file's imports from scratch on every call, and the dependency
conditions call it once per rule per subject. Measured, rules that share subjects pay linearly:

| suite (whole-project `notImportFrom`) | `getSymbol()` calls | time  |
| ------------------------------------- | ------------------- | ----- |
| ×1                                    | 2,105               | 12 ms |
| **×5**                                | **10,525**          | 47 ms |

Exactly 5×. Five _disjoint_ folder rules cost only 388, so **the win is a function of subject
overlap**, not of rule count alone — unlike 0075, where every rule re-collected everything
regardless. A whole-project rule, or several selectors over the same folder, is where this pays.

## What to cache, which is not what the proposal said

Proposal 021 proposed caching `edgesOf()`; the `moduleEdges` docstring (`module-edges.ts:110-117`)
says the fix is "a cache of **resolution**, not of the walk". **Measured, both are aimed at the
wrong third.** Splitting 5 passes over every file:

| component                                   | time       |
| ------------------------------------------- | ---------- |
| bare walk (`getImportStringLiterals`)       | **1 ms**   |
| resolution (`getSymbol` per literal)        | **15 ms**  |
| everything else — building the `ModuleEdge` | **~32 ms** |
| total (`edgesOf`)                           | 48 ms      |

The walk is free. Resolution is a third. **Edge construction dominates** — kind classification,
`namesOf`, `statementLine`'s ancestor search, and the sort. So caching resolution alone recovers
~31% where caching the built edges recovers ~98%, and the docstring's advice was written before
anyone measured the third component. This plan caches **`edgesOf`**, and updates that docstring.

## The invalidation problem, which is real and which the proposal got wrong

Proposal 021 suggested `WeakMap<SourceFile, readonly ModuleEdge[]>`, "which is simpler and
invalidates on the same object-identity argument" as 0075's `WeakMap<ArchProject, …>`.

**It is not the same argument, and the difference is a false green.** Measured:

```
sf.addImportDeclaration(…)     SAME SourceFile object = true   (edges changed)
sf.replaceWithText(…)          SAME SourceFile object = true   (edges changed)
```

A `SourceFile`'s object identity **survives an edit**, where an `ArchProject`'s does not —
`resetProjectCache()` constructs a new one, which is exactly why 0075's key works. Keyed on the
`SourceFile`, this cache would serve pre-edit edges after an edit: a `notImportFrom` rule would
pass on an import the edit just added. That is ADR-008's false green, produced by a cache.

Two facts decide the design:

1. **`sourceFile.onModified(cb)` is a ts-morph API and fires on every mutation path.** Measured:
   `addImportDeclaration`, `replaceWithText`, `remove()` and `insertText` each fire it exactly
   once, and **reads do not fire it at all** (0 after enumerating literals). So the cache can
   invalidate itself, in-boundary, with no raw-compiler access — ADR-002 intact.
2. **Literal nodes are not reused.** After `replaceWithText`, the old literal is a different
   object and `wasForgotten()` is `true`. A resolution cache keyed on the literal would have been
   safe by construction — recorded because it is the fallback if the listener approach is ever
   removed, and because it is what the docstring's advice would have produced.

The real watch-mode flow does not depend on either: `src/cli/index.ts:123,133` calls
`resetProjectCache()`, which rebuilds the ts-morph `Project` and so produces entirely new
`SourceFile` objects. The listener matters for the in-process case — a consumer who mutates
through ts-morph and re-runs rules, and every test that does the same.

## Mechanism

```ts
const cache = new WeakMap<SourceFile, readonly ModuleEdge[]>()
const watched = new WeakSet<SourceFile>()

export function edgesOf(sourceFile: SourceFile): readonly ModuleEdge[] {
  const hit = cache.get(sourceFile)
  if (hit !== undefined) return hit
  const edges = buildEdges(sourceFile)
  if (!watched.has(sourceFile)) {
    watched.add(sourceFile)
    sourceFile.onModified(() => cache.delete(sourceFile))
  }
  cache.set(sourceFile, edges)
  return edges
}
```

`watched` exists so the listener is registered **once** per file rather than once per cache miss;
without it a long watch session accumulates one listener per rule execution.

### `edgeStream` reads the cache but never fills it

`dependOn` streams (`dependency.ts:336`) so it can stop at the first matching edge — the comment
there prices the alternative at "100 checker calls on a 100-import file where the pre-0.28.0 code
made 1". That early exit must survive.

- **Warm** — yield from the cached array. The caller still breaks early; iterating a
  materialized array costs nothing, and no resolution happens because it already did.
- **Cold** — stream lazily as today, and **do not populate**. Filling the cache here would
  resolve every literal to answer a question the first one may settle, which is the exact cost
  the generator exists to avoid.

This is the half proposal 021 missed: it proposed caching `edgesOf` without saying what happens
to the streaming path, and the obvious follow-up — routing `edgeStream` through `edgesOf` —
destroys the early exit.

## Test inventory

| test                                                    | asserts                                                                |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| `five whole-project rules resolve once, not five times` | `getSymbol` count is 2,105 not 10,525                                  |
| `the edges are identical, cached and uncached`          | full edge tuples per file, not just counts                             |
| `an edit invalidates the file's entry`                  | mutate through ts-morph, assert the new edge appears — the false green |
| `an edit invalidates only the edited file`              | the other files' entries survive, or the cache is pointless            |
| `edgeStream still stops early on a cold file`           | `getSymbol` count is 1, not the file's literal count                   |
| `edgeStream agrees with edgesOf, warm and cold`         | same edges from both paths in both states                              |
| `the listener is registered once per file`              | N cache misses do not add N listeners                                  |

## Guards

ADR-008's question: **what would these tests do if the cache returned stale edges?** The count
test would pass — a stale array is still one resolution pass. So the invalidation test mutates a
real file through ts-morph and asserts the _new_ edge is visible; it is the only test here that
fails for the reason the cache is dangerous.

Sabotage, from the diff: drop the `onModified` registration (the invalidation test must red);
register the listener per call rather than per file (the listener-count test must red); make
`edgeStream` populate the cache (the early-exit test must red); make `edgeStream` ignore the cache
(the warm-agreement test still passes, so this one is a **known-permitted** regression — it costs
speed, not correctness, and the test inventory says so rather than pretending otherwise);
`cache.delete` the wrong file on modification (the only-the-edited-file test must red).

## Result

Implemented. `tests/core/module-edge-cache.test.ts`, 13 tests, **6 of 6 sabotages caught** —
no listener at all; listener per miss instead of per file; `edgeStream` populating the cache;
the cache never storing; `edgesOf` ignoring it on read; invalidation deleting the wrong key.
Foreground, asserted-green baseline, exit codes, tree git-verified after each.

Measured end to end by checking out the previous commit's `module-edges.ts` and re-running the
same script (warm, 520 files):

| suite                              | `getSymbol` before | after | time before | after |
| ---------------------------------- | ------------------ | ----- | ----------- | ----- |
| whole-project `notImportFrom` ×1   | 2,109              | 0     | 12 ms       | 1 ms  |
| whole-project `notImportFrom` ×5   | **10,545**         | **0** | **46 ms**   | 2 ms  |
| `onlyImportFrom` ×5, same subjects | 10,545             | 0     | 47 ms       | 3 ms  |
| 5 disjoint folder rules            | 388                | 0     | 2 ms        | 1 ms  |

Zero rather than 2,109 because the harness warms the cache first, which is the realistic shape:
any earlier rule over the same file pays for it once. Note the disjoint-folder row — 388 before —
which is the honest counterweight to the headline: a suite whose selectors do not overlap had
little to recover, and this plan does not pretend otherwise.

Two notes on measuring it, both mistakes worth not repeating. `git stash push` on an
already-committed file is a **no-op that exits 0**, so a before/after harness built on it silently
measures the same tree twice — the first attempt here produced two identical columns. And the
`getSymbol` counter must be attached by walking the prototype chain, not at a fixed depth; plan
0075 recorded an entire wrong conclusion from patching the wrong level.

## Out of scope

- **Caching `resolve()` separately.** Subsumed: a cached edge already carries its `resolvedPath`.
- **`moduleEdges()`'s own `Map`.** It calls `edgesOf` per file, so it inherits this for free.
- **Part 3's lazy dependency resolution** — still a spike, still unproven, still after this.
