# Bug 0022: `onlyImportFrom`/`notImportFrom` are blind to re-exports and dynamic imports

**Reported:** 2026-07-28
**Found in:** all versions through v0.21.0
**Severity:** High — a false green in the enforcement itself. `export { x } from '…'` and
`import('…')` create real module dependencies, and every forward dependency condition lets both
through silently. The reverse-dependency graph indexes all three edge kinds, so the library's
two halves **disagree about what "imports" means** — a rule pair that reads as two views of one
graph is checking two different graphs.

## Description

Every forward dependency condition in `src/conditions/dependency.ts` collects edges from
`sf.getImportDeclarations()` only — five sites (`:57`, `:105`, `:155`, `:196`, `:235`), covering
`onlyImportFrom`, `notImportFrom` and their relatives. That walk sees static `import` statements
and nothing else.

The reverse graph does it right (`src/conditions/reverse-dependency.ts:128-132`):

```ts
for (const sf of sourceFiles) {
  indexStaticImports(graph, sf)
  indexReExports(graph, sf)
  indexDynamicImports(graph, sf)
}
```

So `onlyBeImportedVia('…')` sees a re-export as an import; `notImportFrom('…')` does not. Found
during the five-persona review of [bug 0017](./fixed/0017-boundaries-no-cross-boundary-message-overclaims-entry-point-enforcement.md),
independently, by measuring the boundary preset rather than reading it.

## Reproduction

Fixture: `src/features/billing/internal.ts`, three files in `src/features/reporting/`, boundary
glob `**/src/features/*`, `strictBoundaries()`. Measured at v0.21.0:

```
consumer.ts   import { secret } from '../billing/internal.ts'      ->  1 violation  (flagged)
reexport.ts   export { secret } from '../billing/internal.ts'      ->  0 violations (silent)
dynamic.ts    import('../billing/internal.ts')                     ->  0 violations (silent)
```

The re-export is the worse of the two: it not only crosses the boundary, it **re-publishes** the
other boundary's internal as its own export surface — the exact coupling the rule exists to
forbid, invisible to the rule.

## Blast radius

Every preset rule built on the forward conditions, verified by grep:

| Rule                           | Site                            |
| ------------------------------ | ------------------------------- |
| `boundaries/no-cross-boundary` | `src/presets/boundaries.ts:181` |
| `boundaries/shared-isolation`  | `boundaries.ts:48`              |
| `boundaries/test-isolation`    | `boundaries.ts:84`              |
| `layered/restricted-packages`  | `src/presets/layered.ts:105`    |
| `layered/innermost-isolation`  | `layered.ts:193`                |

Plus every user-written rule using `onlyImportFrom`/`notImportFrom` directly — which
`docs/what-to-check.md` teaches as the primary dependency tools.

## Why no test caught it

No fixture under `tests/fixtures/` contains an `export … from` or an `import()` crossing a
forbidden edge. The conditions are tested with static imports only, so "collects all
dependencies" was never a claim any test could falsify. ADR-008's question — _what would these
tests do if re-export edges were completely invisible?_ — answers: pass, which is the shipped
state.

## Suggested fix

Extract the reverse graph's three collectors into a shared edge walk and point the five forward
sites at it, so "what is an import" has one definition. That is the same single-definition
argument as `TerminalBuilder` being the single root — the two halves diverged because each
carried its own copy of the concept.

Two decisions to make explicit in the fix, not discover in review:

- **`import type` stays exempt** in whichever edges it is exempt in today — measure first,
  because `layered/type-imports-only` depends on the distinction.
- **Breaking direction:** this is green→red for every consumer with a re-export or dynamic
  import crossing a banned edge — that is the fix working, and it needs the Upgrading treatment
  (run before/after, expect new findings), not a patch. For the `onlyImportFrom` allowlist
  family it can also be red→green in principle (more matchable edges); state whichever
  direction measurement shows.

## Guard this needs

- Per edge kind, per condition family: a static import, a re-export and a dynamic import of the
  same forbidden target each produce a violation — asserted by element identity, not count.
- The `import type` exemption pinned in whichever direction is decided.
- A parity test: the forward walk and the reverse graph derive the same edge set from one
  fixture — the two-derivations guard (ADR-008 rule 5) that would have caught this divergence
  the day the reverse graph learned about re-exports.
