# Module Rules

The `modules()` entry point operates on source files. Use it for import and dependency rules.

## When to Use

- Enforce layer boundaries (domain must not import from infrastructure)
- Restrict which modules can depend on which
- Enforce type-only imports for certain paths
- Check that specific modules export expected symbols

## Basic Usage

```typescript
import { project, modules } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')

modules(p)
  .that()
  .resideInFolder('**/domain/**')
  .should()
  .onlyImportFrom('**/domain/**', '**/shared/**')
  .check()
```

## Available Predicates

All identity predicates (`haveNameMatching`, `resideInFolder`, `areExported`, etc.) work on modules. In addition:

| Predicate                 | Description                                         | Example                                   |
| ------------------------- | --------------------------------------------------- | ----------------------------------------- |
| `importFrom(glob)`        | Module imports from files matching the glob         | `.that().importFrom('**/database/**')`    |
| `notImportFrom(glob)`     | Module does not import from files matching the glob | `.that().notImportFrom('**/legacy/**')`   |
| `exportSymbolNamed(name)` | Module exports a symbol with the given name         | `.that().exportSymbolNamed('handler')`    |
| `havePathMatching(re)`    | Module file path matches a regex                    | `.that().havePathMatching(/\.service\./)` |

## Available Conditions

| Condition                          | Description                                        | Example                                                 |
| ---------------------------------- | -------------------------------------------------- | ------------------------------------------------------- |
| `onlyImportFrom(...globs)`         | Module may only import from the listed paths       | `.should().onlyImportFrom('**/domain/**')`              |
| `notImportFromCondition(...globs)` | Module must not import from the listed paths       | `.should().notImportFromCondition('**/controllers/**')` |
| `onlyHaveTypeImportsFrom(glob)`    | Imports from matching paths must use `import type` | `.should().onlyHaveTypeImportsFrom('**/models/**')`     |

## Real-World Examples

### Domain Layer Isolation

```typescript
modules(p)
  .that()
  .resideInFolder('**/domain/**')
  .should()
  .onlyImportFrom('**/domain/**', '**/shared/**')
  .rule({
    id: 'layer/domain-isolation',
    because: 'Domain must be independent of infrastructure for testability',
    suggestion: 'Move the import to a service that bridges domain and infrastructure',
  })
  .check()
```

### No Framework Imports in Domain

```typescript
modules(p)
  .that()
  .resideInFolder('**/domain/**')
  .should()
  .notImportFromCondition('**/node_modules/express/**')
  .because('domain entities must be framework-independent')
  .check()
```

### Application Layer Depends Only on Domain

```typescript
modules(p)
  .that()
  .resideInFolder('**/application/**')
  .should()
  .onlyImportFrom('**/application/**', '**/domain/**', '**/shared/**')
  .because('use cases depend on domain, not on infrastructure')
  .check()
```

### Repositories Must Not Import Controllers

```typescript
modules(p)
  .that()
  .resideInFolder('**/repositories/**')
  .should()
  .notImportFromCondition('**/controllers/**')
  .rule({
    id: 'layer/repo-no-controllers',
    because: 'Repositories are inner layer -- they must not depend on the HTTP layer',
  })
  .check()
```

### Type-Only Imports from Domain

```typescript
modules(p)
  .that()
  .resideInFolder('**/services/**')
  .should()
  .onlyHaveTypeImportsFrom('**/domain/**')
  .because('services should depend on domain interfaces, not implementations')
  .check()
```

## Standard Rules

Pre-built dependency conditions from `ts-archunit/rules/dependencies`:

```typescript
import {
  onlyDependOn,
  mustNotDependOn,
  typeOnlyFrom,
} from '@nielspeter/ts-archunit/rules/dependencies'

modules(p)
  .that()
  .resideInFolder('**/domain/**')
  .should()
  .satisfy(onlyDependOn('**/domain/**', '**/shared/**'))
  .check()

modules(p)
  .that()
  .resideInFolder('**/domain/**')
  .should()
  .satisfy(mustNotDependOn('**/infrastructure/**'))
  .check()
```

## Combining with Other Entry Points

Use `modules()` for import rules and `classes()` for body analysis on the same codebase:

```typescript
const p = project('tsconfig.json')

// Import-level: domain isolation
modules(p)
  .that()
  .resideInFolder('**/domain/**')
  .should()
  .onlyImportFrom('**/domain/**', '**/shared/**')
  .check()

// Body-level: no raw Error in domain services
classes(p).that().resideInFolder('**/domain/**').should().notContain(newExpr('Error')).check()
```
