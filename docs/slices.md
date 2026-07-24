# Slices & Layers

::: tip Rule file or test file?
Snippets on this page end in `.check()` (the **test-file** form). In a [CLI rule file](/cli) (`arch.rules.ts`), **drop `.check()`** and spread the bare builder into `export default [...]` — a `.check()` inside a rule-file array is [silently skipped](/running-in-tests#converting-between-the-two-forms). Use `.asSeverity('warn')` for warnings.
:::

The `slices()` entry point groups source files into logical slices and checks relationships between them. Use it for cycle detection, layer ordering, and slice isolation.

## What Slices Are

Slices let you reason about architecture at a higher level than individual files. Instead of writing per-module import rules, you group files into named units and enforce constraints between them -- cycle freedom, layer ordering, or isolation. Use slices when your architectural rules are about relationships between groups (features, layers, packages) rather than between individual files.

A slice is a named group of source files. Two files in the same slice are considered "together." Two files in different slices have a dependency if one imports the other.

Slices can represent:

- **Layers** -- controllers, services, repositories, domain
- **Features** -- user management, billing, notifications
- **Packages** -- in a monorepo, each package is a slice

## Glob conventions (read this first)

Every glob in ts-archunit is matched against the **absolute** file path, so a
project-relative glob like `'src/services/**'` matches nothing. The rule of thumb:

::: tip Anchor your globs with `**/`
Write `'**/src/services/**'`, not `'src/services/**'`. This applies to
`assignedFrom()`, the preset options (`layers`, `folders`, `shared`, `src`), and
predicates like `resideInFolder()`.
:::

`matching()` is the one exception, because its glob does double duty — the literal
prefix locates the files, and the segment after it _names_ each slice. It accepts
either spelling: `'src/features/*'`, `'src/features/*/'` and `'**/src/features/*'`
are equivalent.

A glob that matches nothing is not silently ignored: since v0.18 a slice rule that
discovers no slices **fails** with a message naming the glob at fault, because a
rule that discovers nothing enforces nothing.

## Defining Slices

There are two ways to assign files to slices: automatic discovery from directory structure, or explicit assignment via a map. Use `matching()` when your folder layout already reflects the architecture; use `assignedFrom()` when slices do not map one-to-one to directories or when you want explicit control.

### `matching(pattern)`

Derives slice names automatically from directory paths using a glob capture. This is the simplest approach when each subdirectory under a common parent represents one architectural slice (e.g., one feature folder per slice).

Auto-discover slices from the directory structure:

```typescript
import { project, slices } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')

// Each directory under src/features/ becomes a slice
slices(p).matching('src/features/*/').should().beFreeOfCycles().check()
```

The `*/` captures one directory level. `src/features/billing/order.ts` and `src/features/billing/invoice.ts` both land in the `billing` slice.

::: warning The captured segment may be a file
The segment after the literal prefix names each slice — a **directory** when files
are nested under it, otherwise each **file**. Over a flat folder,
`matching('src/services/*')` yields one slice per file (`order.service.ts`,
`user.service.ts`, …), not one `services` slice. That is useful for file-level
cycle detection, but it means layer names in `respectLayerOrder()` will not match
file-named slices — use `assignedFrom()` when you want to name the groups yourself.
:::

### `assignedFrom(map)`

Defines slices by providing a name-to-glob mapping. Use this when your architectural layers do not correspond to a single directory level, or when you need to name slices independently of folder structure. This is the typical choice for layer-based rules like Clean Architecture or Hexagonal Architecture.

Explicitly assign slices from a map of glob patterns:

```typescript
slices(p)
  .assignedFrom({
    controllers: '**/src/controllers/**',
    services: '**/src/services/**',
    repositories: '**/src/repositories/**',
    domain: '**/src/domain/**',
  })
  .should()
  .respectLayerOrder('controllers', 'services', 'repositories', 'domain')
  .check()
```

## Conditions

### `beFreeOfCycles()`

Detects circular dependencies between slices using Tarjan's strongly connected components algorithm.

```typescript
slices(p)
  .matching('src/features/*/')
  .should()
  .beFreeOfCycles()
  .rule({
    id: 'arch/no-feature-cycles',
    because: 'Circular dependencies prevent independent deployment and testing',
    suggestion: 'Extract shared code into src/shared/ or introduce an event bus',
  })
  .check()
```

When a cycle is detected, the violation message shows the cycle path:

```
Architecture Violation [arch/no-feature-cycles]

  Cycle detected: billing -> notifications -> billing
  billing imports notifications at src/features/billing/service.ts:5
  notifications imports billing at src/features/notifications/handler.ts:12
```

### `respectLayerOrder(...layers)`

Asserts that dependencies between slices follow the declared order. The first layer may depend on the second, the second on the third, and so on -- but not in reverse.

```typescript
slices(p)
  .assignedFrom({
    controllers: '**/src/controllers/**',
    services: '**/src/services/**',
    repositories: '**/src/repositories/**',
    domain: '**/src/domain/**',
  })
  .should()
  .respectLayerOrder('controllers', 'services', 'repositories', 'domain')
  .rule({
    id: 'layer/direction',
    because: 'Dependencies flow inward: controllers -> services -> repositories -> domain',
  })
  .check()
```

This means:

- `controllers` may import from `services`, `repositories`, `domain`
- `services` may import from `repositories`, `domain`
- `repositories` may import from `domain`
- `domain` may not import from any of the above

### `notDependOn(slice)`

Asserts that no slice depends on the named slice.

```typescript
slices(p)
  .assignedFrom({
    core: '**/src/core/**',
    legacy: '**/src/legacy/**',
    features: '**/src/features/**',
  })
  .should()
  .notDependOn('legacy')
  .because('legacy module is being phased out')
  .check()
```

## Real-World Examples

### Clean Architecture Layers

```typescript
const layers = {
  presentation: '**/src/presentation/**',
  infrastructure: '**/src/infrastructure/**',
  application: '**/src/application/**',
  domain: '**/src/domain/**',
}

slices(p)
  .assignedFrom(layers)
  .should()
  .respectLayerOrder('presentation', 'infrastructure', 'application', 'domain')
  .because('Clean Architecture: dependencies point inward')
  .check()
```

### Feature Module Independence

```typescript
slices(p)
  .matching('src/features/*/')
  .should()
  .beFreeOfCycles()
  .rule({
    id: 'arch/no-feature-cycles',
    because: 'Circular dependencies prevent independent deployment',
    suggestion: 'Extract shared code into src/shared/',
  })
  .check()
```

### Domain Aggregate Independence

```typescript
slices(p)
  .matching('src/domain/*/')
  .should()
  .beFreeOfCycles()
  .because('aggregates must be independently consistent')
  .check()
```

### No Layer Cycles

```typescript
slices(p)
  .assignedFrom({
    presentation: '**/src/presentation/**',
    infrastructure: '**/src/infrastructure/**',
    application: '**/src/application/**',
    domain: '**/src/domain/**',
  })
  .should()
  .beFreeOfCycles()
  .check()
```

### Monorepo Package Boundaries

```typescript
slices(p)
  .matching('packages/*/')
  .should()
  .beFreeOfCycles()
  .because('packages should be independently publishable')
  .check()
```

## Combining with Module Rules

Use `slices()` for architectural structure and `modules()` for fine-grained import control:

```typescript
// Architectural: layers respect order
slices(p)
  .assignedFrom({
    controllers: '**/src/controllers/**',
    services: '**/src/services/**',
    domain: '**/src/domain/**',
  })
  .should()
  .respectLayerOrder('controllers', 'services', 'domain')
  .check()

// Fine-grained: domain must not import from node_modules/express
modules(p)
  .that()
  .resideInFolder('**/domain/**')
  .should()
  .notImportFrom('**/node_modules/express/**')
  .check()
```
