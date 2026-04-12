# What to Check

Scan this page in 2 minutes. Find your pain point. Copy the rule.

Every example is a real rule you can paste into `arch.test.ts` and run with `npx vitest run`.

## Import Dependencies

Control which modules can import from which, preventing forbidden cross-boundary dependencies.

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

// Server must depend on security middleware (import { dependOn } from '@nielspeter/ts-archunit')
modules(p).that().resideInFile('**/server.ts').should().satisfy(dependOn('**/security/**')).check()

// Imports from repositories must be type-only
modules(p)
  .that()
  .resideInFolder('**/routes/**')
  .should()
  .onlyHaveTypeImportsFrom('**/repositories/**')
  .check()
```

## Layer Ordering

Enforce that dependencies between architectural layers only flow in one direction.

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

Detect circular dependencies between modules or feature slices that make code hard to refactor.

```typescript
// No circular dependencies between feature modules
slices(p).matching('src/features/*/').should().beFreeOfCycles().check()

// Feature modules must not depend on legacy
slices(p).matching('src/features/*/').should().notDependOn('legacy', 'deprecated').check()
```

## Naming Conventions

Enforce consistent naming patterns so classes, services, and functions are discoverable by convention.

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

## Function Signatures

Constrain function parameter counts, types, and shapes to keep APIs explicit and consistent.

```typescript
// No rest parameters in route handlers (forces explicit typing)
functions(p)
  .that()
  .resideInFolder('**/routes/**')
  .and()
  .haveRestParameter()
  .should()
  .notExist()
  .check()

// Event handlers must accept exactly one Event parameter
functions(p)
  .that()
  .haveNameMatching(/^handle/)
  .and()
  .haveParameterOfType(0, matching(/Event$/))
  .and()
  .haveParameterCountGreaterThan(1)
  .should()
  .notExist()
  .because('event handlers should accept exactly one Event parameter')
  .check()

// TODO: placeholder — replace with a real optional-parameter rule for your project
```

## Class Structure

Require classes to extend specific base classes or implement required methods.

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

Ensure classes live in the correct folders based on their name or role.

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

Enforce that classes extending a base or implementing an interface follow naming and structural conventions.

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

Constrain where decorated classes may live and which combinations of decorators are allowed.

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

Ban specific function calls, constructors, or property accesses inside method and function bodies.

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

Catch weak or unsafe types like `any`, bare `string`, and type assertions at the architectural level.

```typescript
// orderBy must be typed union, not bare string
types(p)
  .that()
  .haveProperty('orderBy')
  .should()
  .havePropertyType('orderBy', not(isString()))
  .check()

// No any-typed properties
import { noAnyProperties } from '@nielspeter/ts-archunit/rules/typescript'
classes(p).that().areExported().should().satisfy(noAnyProperties()).check()

// No type assertions (as casts)
import { noTypeAssertions } from '@nielspeter/ts-archunit/rules/typescript'
classes(p).should().satisfy(noTypeAssertions()).check()
```

## Call Matching (Framework-Agnostic)

Inspect method calls on specific objects to enforce patterns like authentication or error handling in route registrations.

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

// No additionalProperties: true in route schemas (defeats validation)
calls(p)
  .that()
  .onObject('app')
  .and()
  .withMethod(/^(get|post|put|delete)$/)
  .should()
  .notHaveArgumentContaining(property('additionalProperties', true))
  .check()
```

## Scoped Rules (within)

Narrow the scope of a rule to code inside matched call sites, such as route handler callbacks.

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

Define reusable structural shapes (like paginated responses) that functions or types must conform to.

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

Import pre-built rules for common concerns like type safety, security, and code quality without writing custom conditions.

```typescript
// TypeScript strictness
import {
  noAnyProperties,
  noTypeAssertions,
  noNonNullAssertions,
} from '@nielspeter/ts-archunit/rules/typescript'

// Security
import { noEval, noConsoleLog, noProcessEnv } from '@nielspeter/ts-archunit/rules/security'

// Error handling
import { noGenericErrors } from '@nielspeter/ts-archunit/rules/errors'

// Code quality
import {
  requireJsDocOnPublicMethods,
  noPublicFields,
  noMagicNumbers,
} from '@nielspeter/ts-archunit/rules/code-quality'

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

Find copy-pasted logic and inconsistent patterns across sibling files automatically.

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

Validate GraphQL schema types and resolver implementations against architectural conventions.

```typescript
import { schema, resolvers } from '@nielspeter/ts-archunit/graphql'

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

Verify that matching counterparts exist across layers, such as a schema for every route.

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

Introduce rules into existing codebases without failing on legacy violations by using baselines and diff-awareness.

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

Exempt specific elements from a rule when a permanent exception is justified.

```typescript
// Chain-level — exclude specific elements
functions(p).should().notContain(newExpr('URLSearchParams'))
  .excluding('Asset.getImageUrl', 'Environment.sync').check()

// Inline comment — in the source code (survives refactoring)
// ts-archunit-exclude sdk/no-manual-urlsearchparams: image transform URL params
async getImageUrl() { ... }
```

## Rich Violation Messages

Attach human-readable explanations, fix suggestions, and documentation links to rule violations.

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

Set upper bounds on cyclomatic complexity, line counts, method counts, and parameter lists to prevent god classes and unreadable functions.

```typescript
import {
  maxCyclomaticComplexity,
  maxClassLines,
  maxMethodLines,
  maxMethods,
  maxParameters,
  maxFunctionComplexity,
  maxFunctionParameters,
} from '@nielspeter/ts-archunit/rules/metrics'

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

Write your own predicates and conditions with full AST access when built-in rules don't cover your case.

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
