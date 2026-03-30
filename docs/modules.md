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

All identity predicates (`haveNameMatching`, `resideInFolder`, `areExported`, etc.) work on modules. In addition, module-specific predicates let you filter by import relationships and exported symbols. Use these in the `.that()` clause to narrow down which modules the rule applies to.

| Predicate                 | Description                                         | Example                                   |
| ------------------------- | --------------------------------------------------- | ----------------------------------------- |
| `importFrom(glob)`        | Module imports from files matching the glob         | `.that().importFrom('**/database/**')`    |
| `notImportFrom(glob)`     | Module does not import from files matching the glob | `.that().notImportFrom('**/legacy/**')`   |
| `exportSymbolNamed(name)` | Module exports a symbol with the given name         | `.that().exportSymbolNamed('handler')`    |
| `havePathMatching(re)`    | Module file path matches a regex                    | `.that().havePathMatching(/\.service\./)` |

## Available Conditions

Conditions define what the matched modules must (or must not) do. These go in the `.should()` clause and are checked against every module that passed the predicate filter. Use them to enforce import boundaries, restrict allowed dependencies, and require type-only imports where runtime coupling is undesirable.

| Condition                          | Description                                                       | Example                                                 |
| ---------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------- |
| `onlyImportFrom(...globs)`         | Module may only import from the listed paths                      | `.should().onlyImportFrom('**/domain/**')`              |
| `notImportFromCondition(...globs)` | Module must not import from the listed paths                      | `.should().notImportFromCondition('**/controllers/**')` |
| `onlyHaveTypeImportsFrom(glob)`    | Imports from matching paths must use `import type`                | `.should().onlyHaveTypeImportsFrom('**/models/**')`     |
| `notHaveAliasedImports()`          | No named import may use an alias (`import { x as y }`)            | `.should().notHaveAliasedImports()`                     |
| `notHaveDefaultExport()`           | Module must not have a default export                             | `.should().notHaveDefaultExport()`                      |
| `haveDefaultExport()`              | Module must have a default export                                 | `.should().haveDefaultExport()`                         |
| `haveMaxExports(n)`                | Module must have at most n named exports                          | `.should().haveMaxExports(10)`                          |
| `onlyBeImportedVia(...globs)`      | All importers must match at least one glob (barrel enforcement)   | `.should().onlyBeImportedVia('**/index.ts')`            |
| `beImported()`                     | Module must be imported by at least one other file                | `.should().beImported()`                                |
| `haveNoUnusedExports()`            | Every named export must be referenced elsewhere                   | `.should().haveNoUnusedExports()`                       |
| `contain(matcher, options?)`       | Module must contain at least one match for the expression matcher | `.should().contain(call('validate'))`                   |
| `notContain(matcher, options?)`    | Module must not contain any match for the expression matcher      | `.should().notContain(call('eval'))`                    |

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

### Allow Type Imports Across Layers

Type-only imports (`import type { X }`) are erased at compile time and create no runtime dependency. Use `ignoreTypeImports` to allow type-sharing while forbidding runtime imports:

```typescript
// No runtime imports from infra, but type imports are OK
modules(p)
  .that()
  .resideInFolder('**/domain/**')
  .should()
  .notImportFromConditionWithOptions(['**/infra/**'], { ignoreTypeImports: true })
  .because('domain may reference infra types for DI, but not runtime code')
  .check()
```

**Relationship with `onlyHaveTypeImportsFrom`:**

- `onlyHaveTypeImportsFrom('**/infra/**')` — imports from infra MUST use `import type`
- `notImportFromConditionWithOptions(['**/infra/**'], { ignoreTypeImports: true })` — no runtime imports from infra (type imports allowed)

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

Standard rules are pre-packaged conditions for common dependency patterns, so you do not have to write them from scratch. They are composable with `.satisfy()` and cover the most frequent layer-boundary constraints. Reach for these when your rule maps cleanly to "only depend on X" or "must not depend on Y."

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
