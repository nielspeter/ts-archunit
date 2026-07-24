# Plan 0066 — Selectable Object-Literal Functions (proposal 016) + F3

**Status:** Complete (implemented on branch `feat/f1-filtered-subjects`)
**Priority:** Low–Medium — closes proposal 015's "layer 1"; unblocks the framework-plural handler-map idiom (Bun.serve/Hono/Elysia route maps, reducer maps).
**Effort:** ~0.5–1 day
**Depends on:** none new. **Builds on / reconciles:** the callback-extractor (`within()` path).
**Context:** `proposals/016-selectable-object-literal-arrows.md` (draft 2), `plans/ai-era-product-direction.md` (F3).

## Problem

`functions()` collected only three _named_ shapes (declarations, arrow variables, class methods). Object-literal function values (`{ GET: () => {} }`, `{ GET(){} }`) — the handler-map idiom — were unreachable as subjects, so per-handler rules could not be written and a rule pointed at a handler-only file passed vacuously on zero subjects. (The docs also overclaimed "every function shape"; corrected separately to "every _named_ function shape".)

## Design

### F3 — shared object-literal traversal (`src/helpers/object-literal-functions.ts`)

`collectObjectLiteralFunctions(node, maxDepth = 3)` walks an object literal and yields every function-valued property — arrow, function expression, method shorthand — recursing into nested object literals (not into function bodies), returning `{ node, keyPath }`. Call-agnostic: the single traversal now shared by both consumers, so they cannot drift. The prior private, call-bound `extractFromObjectLiteral` (in `callback-extractor.ts`) is re-expressed on it — the callback path keeps its context-derived (anonymous-arrow) naming; F3 supplies only the traversal.

### 016 — opt-in collection (`src/models/arch-function.ts`, `src/builders/function-rule-builder.ts`)

`FunctionCollectionOptions { includeMethods?; includeObjectLiteralFunctions? }` — the first public option object on `functions(p, options)`. When `includeObjectLiteralFunctions` is set (default off), `collectFunctions` adds a 4th pattern: object-literal function values, discovered from **top-level** object literals only (F3 recurses, so each is collected once) and named by their **qualified** key path via `fromObjectLiteralFunction` (`routes["/owners/:id"].GET`; computed keys → `<computed>`). Off by default — widening it would flood every inline callback and break the named-unit contract (ADR-008 suppression-training risk). The option survives `.should()` forks via `RuleBuilder.fork()`'s field copy (tested).

### Scope note

Widened beyond arrows to **all object-literal functions** (arrows + function expressions + method shorthand) — the handler-map idiom uses all three and the shared traversal already handles them. Renamed the flag from the draft's `includeObjectLiteralArrows` accordingly.

### ADR notes

ADR-005: no `any`/`as` — traversal and factory use `Node.is*` guards. ADR-006: opt-in configurable factory, symmetric with `includeMethods`. ADR-008: default-off zero blast radius; acceptance test compares OFF vs ON subject sets by **name+file:line tuples** (not a name set / count) with a vacuity guard.

## Files changed

| File                                                          | Change                                                                                                      |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/helpers/object-literal-functions.ts`                     | New — F3 traversal.                                                                                         |
| `src/helpers/callback-extractor.ts`                           | `extractFromObjectLiteral` re-expressed on F3; `MAX_OBJECT_DEPTH` moved into F3.                            |
| `src/models/arch-function.ts`                                 | `FunctionCollectionOptions`, `fromObjectLiteralFunction`, pattern 4 in `collectFunctions`.                  |
| `src/builders/function-rule-builder.ts`                       | Constructor + `functions(p, options)` threading; `getElements` passes options.                              |
| `src/index.ts`                                                | Export options type, `fromObjectLiteralFunction`, `collectObjectLiteralFunctions`, `ObjectLiteralFunction`. |
| `docs/functions.md`                                           | Documented the opt-in flag.                                                                                 |
| `tests/helpers/object-literal-functions.test.ts`              | 6 F3 tests.                                                                                                 |
| `tests/builders/function-rule-builder-object-literal.test.ts` | 4 tests (OFF/ON, ADR-008 identity, fork).                                                                   |

Full suite: **2096 passing**, typecheck + lint clean. `within()`/callback tests unchanged (regression-free).

## Out of scope (follow-ups)

- Prefixing the qualified name with the root object's binding (variable/arg name) when the root object literal is itself the top level — v2 nicety; the key path already identifies the subject.
- Surfacing object-literal functions to the smell detectors / GraphQL resolver builder (they call `collectFunctions` with defaults by design — documented boundary).
- The Bun-specific `isRouteHandler()` filter over these subjects — tier-3 `@ts-archunit/bun` (proposal 015), now able to compose `collectObjectLiteralFunctions` rather than re-implement traversal.
