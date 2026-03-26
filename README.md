# ts-archunit

Architecture testing for TypeScript. Enforce structural rules across your codebase as executable tests.

Inspired by Java's [ArchUnit](https://www.archunit.org/). Powered by [ts-morph](https://ts-morph.com/).

## Why

Architecture decisions rot. Teams agree on patterns, document them in wikis, enforce them in code review — and discover months later that half the codebase diverged. AI agents generating code don't know about team conventions. Each PR looks correct in isolation.

ts-archunit turns architectural rules into tests. They run in your CI pipeline. Violations are caught on the PR that introduces them — with clear messages explaining what's wrong, why it matters, and how to fix it.

## Install

```bash
npm install -D ts-archunit
```

Requires Node.js >= 24 and a `tsconfig.json`.

## Quick Start

Create `arch.test.ts` in your test directory:

```typescript
import { describe, it } from 'vitest' // or jest
import { project, classes, functions, modules, slices, call, newExpr } from 'ts-archunit'

const p = project('tsconfig.json')

describe('Architecture Rules', () => {
  it('domain must not import from infrastructure', () => {
    modules(p)
      .that()
      .resideInFolder('**/domain/**')
      .should()
      .onlyImportFrom('**/domain/**', '**/shared/**')
      .rule({
        id: 'layer/domain-isolation',
        because: 'Domain must be independent of infrastructure for testability',
        suggestion: 'Move the import to a service that bridges domain and infrastructure',
        docs: 'https://example.com/adr/clean-architecture',
      })
      .check()
  })

  it('services must use shared error classes', () => {
    classes(p)
      .that()
      .extend('BaseService')
      .should()
      .notContain(newExpr('Error'))
      .rule({
        id: 'error/typed-errors',
        because: 'Generic Error loses context and prevents consistent API error responses',
        suggestion: 'Use NotFoundError, ValidationError, or DomainError instead',
      })
      .check()
  })

  it('no copy-pasted order parsers', () => {
    functions(p)
      .that()
      .haveNameMatching(/^parse\w+Order$/)
      .and()
      .resideInFolder('**/routes/**')
      .should()
      .notExist()
      .rule({
        id: 'route/no-copy-paste',
        because: 'Copy-pasted parsers diverge over time',
        suggestion: 'Use the shared parseOrder() utility with a column map',
      })
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
    because: 'Dependencies flow inward: controllers → services → repositories → domain',
  })
  .check()
```

### Cycle Detection

```typescript
slices(p)
  .matching('src/features/*/')
  .should()
  .beFreeOfCycles()
  .rule({ id: 'arch/no-feature-cycles', because: 'Circular deps prevent independent deployment' })
  .check()
```

### Body Analysis

This is where ts-archunit goes beyond import-path checking. It inspects what happens _inside_ functions and class methods:

```typescript
// Ban inline parseInt — use the shared helper
classes(p)
  .that()
  .extend('BaseRepository')
  .should()
  .useInsteadOf(call('parseInt'), call('this.extractCount'))
  .rule({
    id: 'repo/no-parseint',
    because: 'BaseRepository provides extractCount() which handles type coercion safely',
    suggestion: 'Replace parseInt(x, 10) with this.extractCount(result)',
  })
  .check()

// Ban new URLSearchParams in wrappers (catches class methods too)
functions(p)
  .that()
  .resideInFolder('**/wrappers/**')
  .should()
  .notContain(newExpr('URLSearchParams'))
  .rule({ id: 'sdk/no-raw-urlsearchparams', suggestion: 'Use buildQueryString() utility' })
  .check()
```

### Type-Level Rules

Check property types using the TypeScript type checker — resolves through aliases, `Partial<>`, `Pick<>`:

```typescript
import { types, notType, isString } from 'ts-archunit'

types(p)
  .that()
  .haveNameMatching(/Options$/)
  .and()
  .haveProperty('orderBy')
  .should()
  .havePropertyType('orderBy', notType(isString()))
  .rule({
    id: 'type/no-bare-string-orderby',
    because: 'Bare string orderBy passed to .orderBy() is a SQL injection surface',
    suggestion: "Use a union type: orderBy?: 'created_at' | 'updated_at' | 'name'",
  })
  .check()
```

### Standard Rules

Ready-to-use rules via categorized sub-path imports — no custom conditions needed:

```typescript
import {
  noAnyProperties,
  noTypeAssertions,
  noNonNullAssertions,
} from 'ts-archunit/rules/typescript'
import { noEval, noConsoleLog, noProcessEnv } from 'ts-archunit/rules/security'
import { noGenericErrors } from 'ts-archunit/rules/errors'
import { mustMatchName } from 'ts-archunit/rules/naming'
import { onlyDependOn, mustNotDependOn } from 'ts-archunit/rules/dependencies'

classes(p).should().satisfy(noAnyProperties()).check()
classes(p).should().satisfy(noTypeAssertions()).check()
classes(p).should().satisfy(noEval()).check()
```

Available categories: `rules/typescript`, `rules/security`, `rules/errors`, `rules/naming`, `rules/dependencies`.

### Named Selections

Save predicate chains for reuse across multiple rules:

```typescript
const repositories = classes(p).that().extend('BaseRepository')

repositories.should().notContain(call('parseInt')).check()
repositories.should().notContain(newExpr('Error')).check()
repositories.should().beExported().check()
```

### Baseline Mode (Gradual Adoption)

Adopt rules in existing codebases without fixing every pre-existing violation first:

```typescript
import { withBaseline } from 'ts-archunit'

const baseline = withBaseline('arch-baseline.json')

// Only NEW violations fail — existing ones are recorded in the baseline
classes(p).that().extend('BaseRepository').should().notContain(call('parseInt')).check({ baseline })
```

Generate a baseline from current violations:

```typescript
import { collectViolations, generateBaseline } from 'ts-archunit'

const violations = collectViolations(rule1, rule2, rule3)
generateBaseline(violations, 'arch-baseline.json')
```

### Diff-Aware Mode

Only report violations in files changed in the current PR:

```typescript
import { diffAware } from 'ts-archunit'

classes(p)
  .should()
  .notContain(call('eval'))
  .check({ diff: diffAware('main') })
```

### GitHub Actions Annotations

Violations appear inline on PR diffs — automatically detected in GitHub Actions:

```typescript
import { detectFormat } from 'ts-archunit'

const format = detectFormat() // 'github' in CI, 'terminal' locally

classes(p).should().notContain(call('eval')).check({ format })
```

### Framework-Agnostic Route Matching

Match call expressions by object and method — works with Express, Fastify, Hono, or any framework:

```typescript
import { calls, call, within } from 'ts-archunit'

// Select route registrations
const routes = calls(p)
  .that()
  .onObject('app')
  .and()
  .withMethod(/^(get|post|put|delete|patch)$/)

// Assert all routes have error handling
routes.should().haveCallbackContaining(call('handleError')).check()
```

### Scoped Rules with `within()`

Restrict rules to callback functions inside matched call expressions:

```typescript
// "Within route handlers, enforce normalizePagination"
within(routes)
  .functions()
  .should()
  .contain(call('normalizePagination'))
  .rule({ id: 'route/pagination', because: 'All list endpoints must use shared pagination' })
  .check()
```

### Pattern Templates

Enforce return type shapes across functions:

```typescript
import { definePattern, functions } from 'ts-archunit'

const paginatedCollection = definePattern('paginated-collection', {
  returnShape: {
    total: 'number',
    skip: 'number',
    limit: 'number',
    items: 'T[]',
  },
})

functions(p)
  .that()
  .resideInFolder('**/routes/**')
  .should()
  .followPattern(paginatedCollection)
  .check()
```

### CLI

Run rules without a test runner:

```bash
# Check rules
npx ts-archunit check arch.rules.ts

# Generate baseline for existing violations
npx ts-archunit baseline --output arch-baseline.json

# Check with baseline and diff-aware mode
npx ts-archunit check arch.rules.ts --baseline arch-baseline.json --changed --base main
```

Optional config file:

```typescript
// ts-archunit.config.ts
import { defineConfig } from 'ts-archunit'

export default defineConfig({
  project: 'tsconfig.json',
  rules: ['arch.rules.ts'],
  baseline: 'arch-baseline.json',
  format: 'auto',
})
```

### Warnings (Non-Blocking Rules)

```typescript
classes(p).that().haveDecorator('Deprecated').should().notExist().warn()
```

## Rich Violation Messages

Every rule can include why it exists, how to fix it, and where to learn more:

```typescript
classes(p)
  .that()
  .extend('BaseRepository')
  .should()
  .notContain(newExpr('Error'))
  .rule({
    id: 'repo/typed-errors',
    because: 'Generic Error loses context and prevents consistent error handling',
    suggestion: 'Replace new Error(msg) with new NotFoundError(entity, id)',
    docs: 'https://example.com/adr/011#error-handling',
  })
  .check()
```

Output:

```
Architecture Violation [repo/typed-errors]

  WebhookRepository.findById contains new 'Error' at line 42
  at src/repositories/webhook.repository.ts:42

    41 |     if (!result) {
  > 42 |       throw new Error(`Webhook '${id}' not found`)
    43 |     }

  Why: Generic Error loses context and prevents consistent error handling
  Fix: Replace new Error(msg) with new NotFoundError(entity, id)
  Docs: https://example.com/adr/011#error-handling
```

## Custom Rules

Define your own predicates and conditions using the same interface as built-in ones:

```typescript
import { definePredicate, defineCondition, createViolation, classes } from 'ts-archunit'
import type { ClassDeclaration } from 'ts-morph'
import type { ArchViolation, ConditionContext } from 'ts-archunit'

// Custom predicate
const hasTooManyMethods = definePredicate<ClassDeclaration>(
  'has more than 10 methods',
  (cls) => cls.getMethods().length > 10,
)

classes(p).that().satisfy(hasTooManyMethods).should().notExist().check()

// Custom condition
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

classes(p).that().areExported().should().satisfy(haveJsDocOnPublicMethods).check()
```

## Entry Points

| Function       | Operates on                               | Use case                                        |
| -------------- | ----------------------------------------- | ----------------------------------------------- |
| `modules(p)`   | Source files                              | Import/dependency rules                         |
| `classes(p)`   | Class declarations                        | Inheritance, decorators, methods, body analysis |
| `functions(p)` | Functions, arrow functions, class methods | Naming, parameters, body analysis               |
| `types(p)`     | Interfaces + type aliases                 | Property types, type safety                     |
| `slices(p)`    | Groups of files                           | Cycles, layer ordering                          |
| `calls(p)`     | Call expressions                          | Framework-agnostic route/handler matching       |
| `within(sel)`  | Scoped callbacks                          | Rules inside matched call callbacks             |

## How It Works

ts-archunit loads your TypeScript project using [ts-morph](https://ts-morph.com/) (a wrapper around the TypeScript compiler API). It has full access to:

- **AST** — syntax tree for every file (classes, functions, imports, call expressions)
- **Type checker** — resolve types through aliases, generics, `Partial<>`, `Pick<>`

Rules run in your test suite. `.check()` throws on violations (test fails). `.warn()` logs to stderr (test passes). The project is loaded once and cached — subsequent rules in the same test run share the same instance.

## Comparison

| Tool                     | Import paths | Body analysis | Type checking | Cycles | Baseline | GitHub annotations |
| ------------------------ | ------------ | ------------- | ------------- | ------ | -------- | ------------------ |
| **ts-archunit**          | Yes          | Yes           | Yes           | Yes    | Yes      | Yes                |
| dependency-cruiser       | Yes          | No            | No            | Yes    | No       | No                 |
| eslint-plugin-boundaries | Yes          | No            | No            | No     | No       | No                 |
| ts-arch (npm)            | Yes          | No            | No            | No     | No       | No                 |
| ESLint rules             | Per-file     | No            | No            | No     | No       | Yes                |

## Requirements

- Node.js >= 24
- TypeScript project with `tsconfig.json`
- Test runner: vitest (recommended) or jest

## License

MIT
