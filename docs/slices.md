# Slices & Layers

The `slices()` entry point groups source files into logical slices and checks relationships between them. Use it for cycle detection, layer ordering, and slice isolation.

## What Slices Are

Slices let you reason about architecture at a higher level than individual files. Instead of writing per-module import rules, you group files into named units and enforce constraints between them -- cycle freedom, layer ordering, or isolation. Use slices when your architectural rules are about relationships between groups (features, layers, packages) rather than between individual files.

A slice is a named group of source files. Two files in the same slice are considered "together." Two files in different slices have a dependency if one imports the other.

Slices can represent:

- **Layers** -- controllers, services, repositories, domain
- **Features** -- user management, billing, notifications
- **Packages** -- in a monorepo, each package is a slice

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

### `assignedFrom(map)`

Defines slices by providing a name-to-glob mapping. Use this when your architectural layers do not correspond to a single directory level, or when you need to name slices independently of folder structure. This is the typical choice for layer-based rules like Clean Architecture or Hexagonal Architecture.

Explicitly assign slices from a map of glob patterns:

```typescript
slices(p)
  .assignedFrom({
    controllers: 'src/controllers/**',
    services: 'src/services/**',
    repositories: 'src/repositories/**',
    domain: 'src/domain/**',
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
    controllers: 'src/controllers/**',
    services: 'src/services/**',
    repositories: 'src/repositories/**',
    domain: 'src/domain/**',
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
    core: 'src/core/**',
    legacy: 'src/legacy/**',
    features: 'src/features/**',
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
  presentation: 'src/presentation/**',
  infrastructure: 'src/infrastructure/**',
  application: 'src/application/**',
  domain: 'src/domain/**',
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
    presentation: 'src/presentation/**',
    infrastructure: 'src/infrastructure/**',
    application: 'src/application/**',
    domain: 'src/domain/**',
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
    controllers: 'src/controllers/**',
    services: 'src/services/**',
    domain: 'src/domain/**',
  })
  .should()
  .respectLayerOrder('controllers', 'services', 'domain')
  .check()

// Fine-grained: domain must not import from node_modules/express
modules(p)
  .that()
  .resideInFolder('**/domain/**')
  .should()
  .notImportFromCondition('**/node_modules/express/**')
  .check()
```
