# Plan 0022: Cross-Layer Validation

## Status

- **State:** Done
- **Priority:** P4 — Research; hardest extension, needs real-world validation
- **Effort:** 3-5 days
- **Created:** 2026-03-26
- **Depends on:** 0002 (Project Loader), 0005 (Rule Builder), 0007 (Module Entry Point), 0012 (Slice Entry Point)

## Purpose

Implement `crossLayer(p)` for consistency checks across architectural boundaries. Where `slices(p)` enforces dependency direction between layers, `crossLayer(p)` enforces that elements _within_ different layers are consistent with each other — e.g., API routes must match SDK types must match OpenAPI schemas.

This is spec section 10.

```typescript
import { crossLayer, project } from 'ts-archunit'

const p = project('tsconfig.json')

// Every route handler in src/routes/ must have a matching schema in src/schemas/
crossLayer(p)
  .layer('routes', 'src/routes/**')
  .layer('schemas', 'src/schemas/**')
  .mapping((route, schema) => route.name.replace('Route', '') === schema.name.replace('Schema', ''))
  .forEachPair()
  .should((route, schema) => {
    // user-defined consistency check
    const routeParams = extractParams(route)
    const schemaFields = extractFields(schema)
    return routeParams.every((p) => schemaFields.includes(p))
  })
  .check()
```

First version uses **explicit user-provided mappings** only. Automatic matching by name convention is a later optimization.

## Design Decisions

### CrossLayerBuilder is a new builder, not an extension of RuleBuilder

Same reasoning as `SliceRuleBuilder` (plan 0012, ADR-003): the operation model is fundamentally different. `RuleBuilder<T>` assumes a single element type filtered by predicates. Cross-layer validation operates on _pairs_ of elements from two different layers, matched by a user-provided function. The `.that()` / `.should()` grammar doesn't map cleanly — instead we have `.layer()` / `.mapping()` / `.forEachPair()` / `.should()`.

### Layers resolve to typed element collections

Each `.layer()` call specifies a name and a glob. Resolution collects the source files matching that glob, then extracts elements (classes, functions, types, or modules depending on what the user's mapping function expects). The first version resolves layers to `SourceFile[]` — the mapping function operates on source files and can extract whatever it needs via ts-morph.

### Mapping is a user-provided function

The spec explicitly states: "first version uses explicit user-provided mappings." The mapping function takes one element from each layer and returns `boolean` — true means these two elements form a pair that should be checked together. This is deliberately low-level. Users write the matching logic; we provide the iteration and violation infrastructure.

### PairCondition is a new condition type

Standard `Condition<T>` evaluates a list of elements. Cross-layer conditions evaluate _pairs_ `[A, B]` where A and B come from different layers. We introduce `PairCondition<A, B>` with `evaluate(pairs: [A, B][], context): ArchViolation[]`. This keeps the condition model clean rather than shoe-horning pairs into `Condition<[A, B]>`.

## Phase 1: Core Types

### `src/models/cross-layer.ts`

```typescript
import type { SourceFile } from 'ts-morph'

/** A named layer resolved to its source files. */
export interface Layer {
  readonly name: string
  readonly pattern: string
  readonly files: SourceFile[]
}

/** A matched pair of elements from two layers. */
export interface LayerPair<A = SourceFile, B = SourceFile> {
  readonly left: A
  readonly leftLayer: string
  readonly right: B
  readonly rightLayer: string
}
```

### `src/core/pair-condition.ts`

```typescript
import type { ArchViolation } from './violation.js'
import type { ConditionContext } from './condition.js'
import type { LayerPair } from '../models/cross-layer.js'

/** Condition that evaluates matched pairs from two layers. */
export interface PairCondition<A = SourceFile, B = SourceFile> {
  readonly description: string
  evaluate(pairs: LayerPair<A, B>[], context: ConditionContext): ArchViolation[]
}
```

## Phase 2: CrossLayerBuilder

### `src/builders/cross-layer-builder.ts`

Builder chain:

```
crossLayer(project)
  .layer(name, glob)          → CrossLayerBuilder       (accumulate layers)
  .layer(name, glob)          → CrossLayerBuilder       (at least 2 required)
  .mapping(fn)                → MappedCrossLayerBuilder (how to pair elements)
  .forEachPair()              → PairConditionBuilder    (iterate matched pairs)
  .should(condition)          → PairFinalBuilder        (what to assert)
  .because(reason)            → PairFinalBuilder        (optional rationale)
  .check()                    → void (throws)
  .warn()                     → void
```

Key methods:

```typescript
import type { ArchProject } from '../core/project.js'
import type { PairCondition } from '../core/pair-condition.js'
import type { SourceFile } from 'ts-morph'

export function crossLayer(project: ArchProject): CrossLayerBuilder

class CrossLayerBuilder {
  layer(name: string, glob: string): CrossLayerBuilder
  mapping(fn: (a: SourceFile, b: SourceFile) => boolean): MappedCrossLayerBuilder
}

class MappedCrossLayerBuilder {
  forEachPair(): PairConditionBuilder
}

class PairConditionBuilder {
  should(condition: PairCondition): PairFinalBuilder
}

class PairFinalBuilder {
  because(reason: string): PairFinalBuilder
  check(): void
  warn(): void
}
```

### Layer resolution

When `.mapping()` is called, the builder resolves all layers to `SourceFile[]` using the same glob matching as `modules(p).that().resideInFolder()`. Then it computes the Cartesian product of the first two layers, filtered by the mapping function, producing `LayerPair[]`.

For >2 layers, pairs are computed between each consecutive pair: `(layer1, layer2)`, `(layer2, layer3)`, etc. This handles the "routes must match SDK types must match OpenAPI schemas" case from the spec.

## Phase 3: Built-in Pair Conditions

### `src/conditions/cross-layer.ts`

Ship a small set of reusable pair conditions. Users can also write custom `PairCondition` objects directly.

```typescript
/** Every element in the left layer must have at least one match in the right layer. */
export function haveMatchingCounterpart(): PairCondition

/** The matched pair must have consistent exported symbol names. */
export function haveConsistentExports(
  extractLeft: (file: SourceFile) => string[],
  extractRight: (file: SourceFile) => string[],
): PairCondition

/** Custom pair assertion — shorthand for inline PairCondition. */
export function satisfyPairCondition(
  description: string,
  fn: (pair: LayerPair) => ArchViolation | null,
): PairCondition
```

## Phase 4: Tests

### Fixtures

```
tests/fixtures/cross-layer/
├── tsconfig.json
└── src/
    ├── routes/
    │   ├── user-route.ts      # exports UserRoute class
    │   └── order-route.ts     # exports OrderRoute class
    ├── schemas/
    │   ├── user-schema.ts     # exports UserSchema
    │   └── product-schema.ts  # no matching route — violation
    └── sdk/
        ├── user-sdk.ts
        └── order-sdk.ts
```

### Test inventory

| Test                     | Description                                                   |
| ------------------------ | ------------------------------------------------------------- |
| layer resolution         | `.layer()` resolves globs to correct source files             |
| mapping produces pairs   | mapping function filters Cartesian product correctly          |
| happy path — all matched | no violations when every left element has a right counterpart |
| missing counterpart      | violation when a route has no matching schema                 |
| extra counterpart        | configurable — warn or ignore unmatched right elements        |
| 3-layer chain            | routes -> schemas -> sdk consecutive pairing works            |
| custom pair condition    | `satisfyPairCondition` receives correct pairs                 |
| `.because()`             | reason appears in violation message                           |
| `.warn()` vs `.check()`  | warn logs, check throws `ArchRuleError`                       |
| empty layer              | no violations, no crash                                       |

## Phase 5: Export & Integration

Add to `src/index.ts`:

```typescript
// Cross-layer validation (plan 0022)
export type { Layer, LayerPair } from './models/cross-layer.js'
export type { PairCondition } from './core/pair-condition.js'
export { crossLayer, CrossLayerBuilder } from './builders/cross-layer-builder.js'
export {
  haveMatchingCounterpart,
  haveConsistentExports,
  satisfyPairCondition,
} from './conditions/cross-layer.js'
```

## Files Changed

| File                                    | Change                                         |
| --------------------------------------- | ---------------------------------------------- |
| `src/models/cross-layer.ts`             | New — Layer, LayerPair types                   |
| `src/core/pair-condition.ts`            | New — PairCondition interface                  |
| `src/builders/cross-layer-builder.ts`   | New — CrossLayerBuilder chain                  |
| `src/conditions/cross-layer.ts`         | New — built-in pair conditions                 |
| `src/index.ts`                          | Modified — export crossLayer and related types |
| `tests/fixtures/cross-layer/`           | New — multi-layer fixture project              |
| `tests/cross-layer/cross-layer.test.ts` | New — builder and condition tests              |

## Out of Scope

- **Automatic matching by name convention** — the spec explicitly defers this. First version requires explicit mapping functions. Convention-based matching (e.g., `UserRoute` auto-matches `UserSchema` by stripping suffixes) is a follow-up optimization.
- **N-way simultaneous matching** — first version pairs layers consecutively (A-B, B-C). Matching across all N layers simultaneously adds combinatorial complexity with unclear benefit.
- **Cross-project validation** — both layers must be in the same `tsconfig.json` project. Cross-project consistency (monorepo packages) is a separate concern.
- **OpenAPI/JSON schema parsing** — the cross-layer builder operates on TypeScript source files via ts-morph. Validating against non-TS artifacts (OpenAPI YAML, JSON schemas) requires a different approach and is not in scope.
- **Standard cross-layer rules** — no `ts-archunit/rules/cross-layer` sub-path export in the first version. The API is low-level; standard rules emerge after real-world usage reveals common patterns.
