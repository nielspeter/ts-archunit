# ts-archunit

Architecture testing for TypeScript. Enforce structural rules across your codebase as executable tests.

Inspired by Java's [ArchUnit](https://www.archunit.org/). Powered by [ts-morph](https://ts-morph.com/).

## Why

Architecture decisions rot. Teams agree on patterns, document them in wikis, enforce them in code review — and discover months later that half the codebase diverged. A routine feature addition reveals that list endpoints have three different pagination patterns, repositories inline `parseInt` instead of using the shared helper, and `orderBy` fields accept bare `string` instead of typed unions.

ts-archunit turns architectural rules into tests. They run in your CI pipeline. Violations are caught on the PR that introduces them — not during a manual audit.

## Install

```bash
npm install -D ts-archunit
```

Requires Node.js >= 24 and a `tsconfig.json`.

## Quick Start

Create `arch.test.ts` in your test directory:

```typescript
import { describe, it } from 'vitest' // or jest
import { project, classes, functions, types, modules, slices, call, newExpr, isString, notType } from 'ts-archunit'

const p = project('tsconfig.json')

describe('Architecture Rules', () => {
  it('domain must not import from infrastructure', () => {
    modules(p)
      .that().resideInFolder('**/domain/**')
      .should().onlyImportFrom('**/domain/**', '**/shared/**')
      .check()
  })

  it('services must use shared error classes', () => {
    classes(p)
      .that().extend('BaseService')
      .should().notContain(newExpr('Error'))
      .because('use DomainError instead of generic Error')
      .check()
  })

  it('no copy-pasted order parsers', () => {
    functions(p)
      .that().haveNameMatching(/^parse\w+Order$/)
      .and().resideInFolder('**/routes/**')
      .should().notExist()
      .because('use the shared parseOrder() utility')
      .check()
  })
})
```

Run with your test runner:

```bash
npx vitest run arch.test.ts
```

## What It Can Do

### Layer Enforcement

```typescript
const layers = {
  controllers: 'src/controllers/**',
  services: 'src/services/**',
  repositories: 'src/repositories/**',
  domain: 'src/domain/**',
}

// Dependencies must flow downward
slices(p)
  .assignedFrom(layers)
  .should().respectLayerOrder('controllers', 'services', 'repositories', 'domain')
  .because('layers must not depend upward')
  .check()

// Domain must be framework-free
modules(p)
  .that().resideInFolder('**/domain/**')
  .should().notImportFrom('**/controllers/**', '**/repositories/**')
  .check()
```

### Cycle Detection

```typescript
// No circular dependencies between feature modules
slices(p)
  .matching('src/features/*/')
  .should().beFreeOfCycles()
  .check()
```

### Body Analysis

This is where ts-archunit goes beyond import-path checking. It inspects what happens _inside_ functions and methods:

```typescript
// Repositories must use the shared helper, not inline parseInt
classes(p)
  .that().extend('BaseRepository')
  .should().notContain(call('parseInt'))
  .because('use this.extractCount() from BaseRepository')
  .check()

// Or enforce both sides: ban the bad, require the good
classes(p)
  .that().extend('BaseRepository')
  .should().useInsteadOf(call('parseInt'), call('this.extractCount'))
  .check()

// Ban direct URLSearchParams construction in SDK wrappers
functions(p)
  .that().resideInFolder('**/wrappers/**')
  .should().notContain(newExpr('URLSearchParams'))
  .because('use buildQueryString() utility')
  .check()
```

### Type-Level Rules

Check property types using the TypeScript type checker — resolves through aliases, `Partial<>`, `Pick<>`, etc.:

```typescript
// Query options must use typed unions, not bare string
types(p)
  .that().haveNameMatching(/Options$/)
  .and().haveProperty('orderBy')
  .should().havePropertyType('orderBy', notType(isString()))
  .because('bare string orderBy is a SQL injection surface')
  .check()
```

### Naming Conventions

```typescript
// Controllers must end with Controller
classes(p)
  .that().resideInFolder('**/controllers/**')
  .should().haveNameMatching(/Controller$/)
  .check()

// Services must be exported
classes(p)
  .that().haveNameEndingWith('Service')
  .should().beExported()
  .check()
```

### Class Structure

```typescript
// All repositories must extend BaseRepository
classes(p)
  .that().resideInFolder('**/repositories/**')
  .and().haveNameEndingWith('Repository')
  .should().shouldExtend('BaseRepository')
  .check()

// Services must have a findById method
classes(p)
  .that().extend('BaseService')
  .should().shouldHaveMethodNamed('findById')
  .check()
```

### Named Selections

Save predicate chains for reuse across multiple rules:

```typescript
const repositories = classes(p).that().extend('BaseRepository')

// Multiple rules on the same selection
repositories.should().notContain(call('parseInt')).check()
repositories.should().notContain(newExpr('Error')).check()
repositories.should().beExported().check()
```

### Warnings (Non-Blocking Rules)

Not every rule should fail CI:

```typescript
// Warn about deprecated patterns, don't block
classes(p)
  .that().haveDecorator('Deprecated')
  .should().notExist()
  .warn() // logs to stderr, does not throw
```

## Custom Rules

Define your own predicates and conditions using the same interface as built-in ones:

```typescript
import { definePredicate, defineCondition, classes } from 'ts-archunit'
import type { ClassDeclaration } from 'ts-morph'

// Custom predicate: filter to classes with more than 10 methods
const hasTooManyMethods = definePredicate<ClassDeclaration>(
  'has more than 10 methods',
  (cls) => cls.getMethods().length > 10,
)

// Use in a rule
classes(p)
  .that().satisfy(hasTooManyMethods)
  .should().notExist()
  .because('classes with >10 methods should be split')
  .check()
```

```typescript
import { defineCondition, createViolation } from 'ts-archunit'
import type { ClassDeclaration } from 'ts-morph'
import type { ConditionContext, ArchViolation } from 'ts-archunit'

// Custom condition: all public methods must have JSDoc
const haveJsDocOnPublicMethods = defineCondition<ClassDeclaration>(
  'have JSDoc on all public methods',
  (elements, context) => {
    const violations: ArchViolation[] = []
    for (const cls of elements) {
      for (const method of cls.getMethods()) {
        if (method.getScope() === 'public' && method.getJsDocs().length === 0) {
          violations.push(createViolation(method, `${method.getName()} has no JSDoc`, context))
        }
      }
    }
    return violations
  },
)

classes(p)
  .that().areExported()
  .should().satisfy(haveJsDocOnPublicMethods)
  .check()
```

## Entry Points

| Function | Operates on | Use case |
|----------|-------------|----------|
| `modules(p)` | Source files | Import/dependency rules |
| `classes(p)` | Class declarations | Inheritance, decorators, methods, body analysis |
| `functions(p)` | Functions + arrow functions | Naming, parameters, body analysis |
| `types(p)` | Interfaces + type aliases | Property types, type safety |
| `slices(p)` | Groups of files | Cycles, layer ordering |

## Violation Output

When a rule fails, you get actionable error messages with code frames:

```
Architecture violation (2 found)
Reason: use this.extractCount() from BaseRepository

  - ProductService: ProductService contains call to 'parseInt' at line 7 (src/services/product-service.ts:3)

      1 | export class ProductService extends BaseService {
      2 |   async getTotal(): Promise<number> {
    > 3 |     return typeof result.count === 'string' ? parseInt(result.count, 10) : result.count
      4 |   }
```

## How It Works

ts-archunit loads your TypeScript project using [ts-morph](https://ts-morph.com/) (a wrapper around the TypeScript compiler API). It has full access to:

- **AST** — syntax tree for every file (classes, functions, imports, call expressions)
- **Type checker** — resolve types through aliases, generics, `Partial<>`, `Pick<>`

Rules run in your test suite. `.check()` throws on violations (test fails). `.warn()` logs to stderr (test passes). The project is loaded once and cached — subsequent rules in the same test run share the same instance.

## Comparison

| Tool | Import paths | Body analysis | Type checking | Cycles |
|------|-------------|---------------|---------------|--------|
| **ts-archunit** | Yes | Yes | Yes | Yes |
| dependency-cruiser | Yes | No | No | Yes |
| eslint-plugin-boundaries | Yes | No | No | No |
| ts-arch (npm) | Yes | No | No | No |
| ESLint rules | Per-file | No | No | No |

## Requirements

- Node.js >= 24
- TypeScript project with `tsconfig.json`
- Test runner: vitest (recommended) or jest

## License

MIT
