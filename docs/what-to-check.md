# What to Check

Scan this page in 2 minutes. Find your pain point. Copy the rule.

Every example is a real rule you can paste into `arch.test.ts` and run with `npx vitest run`.

## Import Dependencies

```typescript
// Domain must not import from infrastructure
modules(p)
  .that()
  .resideInFolder('**/domain/**')
  .should()
  .onlyImportFrom('**/domain/**', '**/shared/**')
  .check()

// Controllers must not access repositories directly
modules(p)
  .that()
  .resideInFolder('**/controllers/**')
  .should()
  .notImportFromCondition('**/repositories/**')
  .check()

// Shared package must not depend on app code
modules(p)
  .that()
  .resideInFolder('**/shared/**')
  .should()
  .notImportFromCondition('**/controllers/**', '**/services/**')
  .check()

// Imports from repositories must be type-only
modules(p)
  .that()
  .resideInFolder('**/routes/**')
  .should()
  .onlyHaveTypeImportsFrom('**/repositories/**')
  .check()
```

## Layer Ordering

```typescript
// Dependencies flow inward
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

## Cycle Detection

```typescript
// No circular dependencies between feature modules
slices(p).matching('src/features/*/').should().beFreeOfCycles().check()

// Feature modules must not depend on legacy
slices(p).matching('src/features/*/').should().notDependOn('legacy', 'deprecated').check()
```

## Naming Conventions

```typescript
// Controllers end with Controller
classes(p)
  .that()
  .resideInFolder('**/controllers/**')
  .should()
  .conditionHaveNameMatching(/Controller$/)
  .check()

// Services must be exported
classes(p).that().haveNameEndingWith('Service').should().beExported().check()

// No copy-pasted parsers (function name smell)
functions(p)
  .that()
  .haveNameMatching(/^parse\w+Order$/)
  .and()
  .resideInFolder('**/routes/**')
  .should()
  .notExist()
  .check()
```

## Class Structure

```typescript
// Repositories must extend BaseRepository
classes(p)
  .that()
  .haveNameEndingWith('Repository')
  .and()
  .resideInFolder('**/repositories/**')
  .should()
  .shouldExtend('BaseRepository')
  .check()

// Services must have a findById method
classes(p).that().extend('BaseService').should().shouldHaveMethodNamed('findById').check()
```

## Containment

```typescript
// Controllers must live in the controllers folder
classes(p)
  .that()
  .haveNameEndingWith('Controller')
  .should()
  .shouldResideInFile('**/controllers/**')
  .check()

// DTOs must reside in dto folder
classes(p)
  .that()
  .haveNameMatching(/Request$|Response$|DTO$/)
  .should()
  .shouldResideInFile('**/dto/**')
  .check()
```

## Inheritance

```typescript
// Classes extending BaseRepository must end with Repository
classes(p)
  .that()
  .extend('BaseRepository')
  .should()
  .conditionHaveNameMatching(/Repository$/)
  .check()

// Classes implementing EventHandler must end with Handler
classes(p)
  .that()
  .implement('EventHandler')
  .should()
  .conditionHaveNameMatching(/Handler$/)
  .check()
```

## Decorators

```typescript
// @Controller classes must be in controllers folder
classes(p)
  .that()
  .haveDecorator('Controller')
  .should()
  .shouldResideInFile('**/controllers/**')
  .check()

// Abstract classes must not have @Controller
classes(p).that().areAbstract().and().haveDecorator('Controller').should().notExist().check()
```

## Body Analysis

```typescript
// No raw parseInt — use shared helper
classes(p)
  .that()
  .extend('BaseRepository')
  .should()
  .useInsteadOf(call('parseInt'), call('this.extractCount'))
  .check()

// No generic Error — use typed domain errors
classes(p).that().extend('BaseService').should().notContain(newExpr('Error')).check()

// No eval()
classes(p).should().notContain(call('eval')).check()

// No console.log in production
functions(p).that().resideInFolder('**/src/**').should().notContain(call('console.log')).check()

// No direct process.env in domain
functions(p)
  .that()
  .resideInFolder('**/domain/**')
  .should()
  .notContain(access('process.env'))
  .check()
```

## Type Safety

```typescript
// orderBy must be typed union, not bare string
types(p)
  .that()
  .haveProperty('orderBy')
  .should()
  .havePropertyType('orderBy', notType(isString()))
  .check()

// No any-typed properties
import { noAnyProperties } from 'ts-archunit/rules/typescript'
classes(p).that().areExported().should().satisfy(noAnyProperties()).check()

// No type assertions (as casts)
import { noTypeAssertions } from 'ts-archunit/rules/typescript'
classes(p).should().satisfy(noTypeAssertions()).check()
```

## Call Matching (Framework-Agnostic)

```typescript
// All route handlers must have error handling
calls(p)
  .that()
  .onObject('app')
  .and()
  .withMethod(/^(get|post|put|delete)$/)
  .should()
  .haveCallbackContaining(call('handleError'))
  .check()

// Route registrations with specific path pattern
calls(p)
  .that()
  .onObject('router')
  .and()
  .withStringArg(0, '/api/v1/**')
  .should()
  .haveCallbackContaining(call('authenticate'))
  .check()
```

## Scoped Rules (within)

```typescript
// Within route handlers, enforce normalizePagination
const routes = calls(p)
  .that()
  .onObject('app')
  .and()
  .withMethod(/^(get|post)$/)

within(routes).functions().should().contain(call('normalizePagination')).check()
```

## Pattern Templates

```typescript
// List endpoints must return paginated collection shape
const paginatedCollection = definePattern('paginated-collection', {
  returnShape: { total: 'number', skip: 'number', limit: 'number', items: 'T[]' },
})

functions(p)
  .that()
  .resideInFolder('**/routes/**')
  .should()
  .followPattern(paginatedCollection)
  .check()
```

## Standard Rules (ready-to-use)

```typescript
// TypeScript strictness
import {
  noAnyProperties,
  noTypeAssertions,
  noNonNullAssertions,
} from 'ts-archunit/rules/typescript'

// Security
import { noEval, noConsoleLog, noProcessEnv } from 'ts-archunit/rules/security'

// Error handling
import { noGenericErrors } from 'ts-archunit/rules/errors'

// Code quality
import {
  requireJsDocOnPublicMethods,
  noPublicFields,
  noMagicNumbers,
} from 'ts-archunit/rules/code-quality'

// Apply any of them:
classes(p).should().satisfy(noAnyProperties()).check()
classes(p).should().satisfy(noEval()).check()
classes(p).should().satisfy(requireJsDocOnPublicMethods()).warn()
classes(p)
  .should()
  .satisfy(noMagicNumbers({ allowed: [0, 1, -1, 200, 404] }))
  .warn()
```

## Smell Detection

```typescript
// Detect near-identical function bodies
smells.duplicateBodies(p).inFolder('src/routes/**').withMinSimilarity(0.9).minLines(10).warn()

// Flag the odd one out in a folder
smells
  .inconsistentSiblings(p)
  .inFolder('src/repositories/**')
  .forPattern(call('this.extractCount'))
  .warn()
```

## GraphQL Rules

```typescript
import { schema, resolvers } from 'ts-archunit/graphql'

// Collection types must have pagination fields
schema(p, 'src/graphql/**/*.graphql')
  .that()
  .typesNamed(/Collection$/)
  .should()
  .haveFields('items', 'total', 'skip', 'limit')
  .check()

// Relation resolvers must use DataLoader
resolvers(p, 'src/resolvers/**')
  .that()
  .resolveFieldReturning(/^[A-Z]/)
  .should()
  .contain(call('loader.load'))
  .check()
```

## Cross-Layer Consistency

```typescript
// Every route must have a matching schema
crossLayer(p)
  .layer('routes', 'src/routes/**')
  .layer('schemas', 'src/schemas/**')
  .mapping(
    (route, schema) =>
      route.getBaseName().replace('-route', '') === schema.getBaseName().replace('-schema', ''),
  )
  .forEachPair()
  .should()
  .haveMatchingCounterpart()
  .check()
```

## Gradual Adoption

```typescript
// Baseline — only NEW violations fail
const baseline = withBaseline('arch-baseline.json')
classes(p).should().notContain(call('parseInt')).check({ baseline })

// Diff-aware — only violations in changed files
classes(p)
  .should()
  .notContain(call('eval'))
  .check({ diff: diffAware('main') })

// GitHub annotations — auto-detected in CI
classes(p).should().notContain(call('eval')).check({ format: detectFormat() })
```

## Exclusions (Permanent Exceptions)

```typescript
// Chain-level — exclude specific elements
functions(p).should().notContain(newExpr('URLSearchParams'))
  .excluding('Asset.getImageUrl', 'Environment.sync').check()

// Inline comment — in the source code (survives refactoring)
// ts-archunit-exclude sdk/no-manual-urlsearchparams: image transform URL params
async getImageUrl() { ... }
```

## Rich Violation Messages

```typescript
// Every rule can explain WHY, HOW to fix, and WHERE to learn more
classes(p)
  .that()
  .extend('BaseRepository')
  .should()
  .notContain(newExpr('Error'))
  .rule({
    id: 'repo/typed-errors',
    because: 'Generic Error loses context',
    suggestion: 'Replace new Error(msg) with new NotFoundError(entity, id)',
    docs: 'https://example.com/adr/011',
  })
  .check()
```

## Complexity & Size

```typescript
import {
  maxCyclomaticComplexity,
  maxClassLines,
  maxMethodLines,
  maxMethods,
  maxParameters,
  maxFunctionComplexity,
  maxFunctionParameters,
} from 'ts-archunit/rules/metrics'

// No method may exceed complexity 15
classes(p).should().satisfy(maxCyclomaticComplexity(15)).check()

// Classes must not exceed 300 lines
classes(p).should().satisfy(maxClassLines(300)).warn()

// Methods must be short
classes(p).should().satisfy(maxMethodLines(50)).warn()

// No god classes
classes(p).should().satisfy(maxMethods(15)).warn()

// Enforce small parameter lists
classes(p).should().satisfy(maxParameters(4)).check()

// Function-level: complexity and parameter limits
functions(p).should().satisfy(maxFunctionComplexity(15)).check()
functions(p).that().areExported().should().satisfy(maxFunctionParameters(4)).check()
```

## Custom Rules

```typescript
// Custom predicate — filter by any logic
const hasTooManyMethods = definePredicate('has >10 methods', (cls) => cls.getMethods().length > 10)

classes(p).that().satisfy(hasTooManyMethods).should().notExist().check()

// Custom condition — assert anything with full AST access
const haveJsDoc = defineCondition('have JSDoc', (elements, context) => {
  // ... inspect elements, return ArchViolation[]
})

classes(p).that().areExported().should().satisfy(haveJsDoc).check()
```

---

Every example is copy-pasteable. Add `const p = project('tsconfig.json')` at the top, wrap each in `it()`, and run with `npx vitest run`.

For full details: [Modules](/modules) · [Classes](/classes) · [Functions](/functions) · [Types](/types) · [Body Analysis](/body-analysis) · [Calls](/calls) · [Slices](/slices) · [Patterns](/patterns) · [Smells](/smell-detection) · [GraphQL](/graphql) · [Cross-Layer](/cross-layer) · [Standard Rules](/standard-rules) · [Metrics](/metrics) · [Custom Rules](/custom-rules) · [Violations](/violation-reporting)
