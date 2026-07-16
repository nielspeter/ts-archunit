# What to Check

Find your pain point, copy the rule. A gallery of real rules organized by what they enforce.

**Structural rules:** [Import Dependencies](#import-dependencies) · [Layer Ordering](#layer-ordering) · [Cycle Detection](#cycle-detection) · [Naming Conventions](#naming-conventions) · [Class Structure](#class-structure) · [Containment](#containment) · [Inheritance](#inheritance) · [Decorators](#decorators)
**Behavioral rules:** [Body Analysis](#body-analysis) · [Type Safety](#type-safety) · [Call Matching](#call-matching-framework-agnostic) · [Function Signatures](#function-signatures) · [Complexity & Size](#complexity-size)
**JSX & framework:** [JSX Element Rules](#jsx-element-rules) · [GraphQL Rules](#graphql-rules)
**Cross-cutting:** [Pattern Templates](#pattern-templates) · [Standard Rules](#standard-rules-ready-to-use) · [Smell Detection](#smell-detection) · [Cross-Layer Consistency](#cross-layer-consistency) · [Custom Rules](#custom-rules)
**Adoption:** [Gradual Adoption](#gradual-adoption) · [Exclusions](#exclusions-permanent-exceptions) · [Rich Messages](#rich-violation-messages)
**[Customizable recipes](#customizable-recipes)** — one-liners you adjust to your ORM / folders / domain terms.

::: tip Rule file or test file?
Snippets here end in `.check()` (the **test-file** form). In a [CLI rule file](/cli) (`arch.rules.ts`), **drop `.check()`** and spread the bare builder into `export default [...]` — a `.check()` inside a rule-file array is [silently skipped](/running-in-tests#converting-between-the-two-forms). Use `.asSeverity('warn')` for warnings.
:::

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
  .notImportFrom('**/repositories/**')
  .check()

// Shared package must not depend on app code
modules(p)
  .that()
  .resideInFolder('**/shared/**')
  .should()
  .notImportFrom('**/controllers/**', '**/services/**')
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

::: tip Filenames vs code names
These rules match **code element names**. For **filename** rules, the split matters: pure casing (kebab-case, no `.spec.ts`) belongs in your linter (eslint or Biome), while filename↔element _correspondence_ (a `Controller` must live in `*-controller.ts`) is ts-archunit's — see [How It Fits](/how-it-fits#filename-conventions-a-worked-example).
:::

```typescript
// Controllers end with Controller
classes(p)
  .that()
  .resideInFolder('**/controllers/**')
  .should()
  .haveNameMatching(/Controller$/)
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
  .extend('BaseRepository')
  .check()

// Services must have a findById method
classes(p).that().extend('BaseService').should().haveMethodNamed('findById').check()
```

## Containment

Ensure classes live in the correct folders based on their name or role.

```typescript
// Controllers must live in the controllers folder
classes(p)
  .that()
  .haveNameEndingWith('Controller')
  .should()
  .resideInFile('**/controllers/**')
  .check()

// DTOs must reside in dto folder
classes(p)
  .that()
  .haveNameMatching(/Request$|Response$|DTO$/)
  .should()
  .resideInFile('**/dto/**')
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
  .haveNameMatching(/Repository$/)
  .check()

// Classes implementing EventHandler must end with Handler
classes(p)
  .that()
  .implement('EventHandler')
  .should()
  .haveNameMatching(/Handler$/)
  .check()
```

## Decorators

Constrain where decorated classes may live and which combinations of decorators are allowed.

```typescript
// @Controller classes must be in controllers folder
classes(p).that().haveDecorator('Controller').should().resideInFile('**/controllers/**').check()

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

## JSX Element Rules

Enforce design system compliance, accessibility, and structural conventions on JSX elements in `.tsx` files.

```typescript
import { jsxElements, jsxElement, modules, STANDARD_HTML_TAGS } from '@nielspeter/ts-archunit'

// No raw <button> — use design system components
jsxElements(p)
  .that()
  .areHtmlElements('button', 'input', 'select')
  .should()
  .notExist()
  .because('use design system components')
  .check()

// Every <img> must have alt text
jsxElements(p).that().areHtmlElements('img').should().haveAttribute('alt').check()

// No inline styles
jsxElements(p).should().notHaveAttribute('style').check()

// No dangerouslySetInnerHTML
jsxElements(p).should().notHaveAttribute('dangerouslySetInnerHTML').check()

// Interactive elements must have aria-label
jsxElements(p).that().withAttribute('onClick').should().haveAttribute('aria-label').check()

// Ban all standard HTML in pages folder
jsxElements(p)
  .that()
  .areHtmlElements(...STANDARD_HTML_TAGS)
  .and()
  .resideInFolder('**/pages/**')
  .should()
  .notExist()
  .check()

// Quick body-analysis check: no <script> tags
modules(p).that().resideInFile('**/*.tsx').should().notContain(jsxElement('script')).check()
```

### Hardcoded text (i18n)

Enforce that user-facing text goes through a translation function instead of being hardcoded as JSX children. `jsxText()` matches text content (`<button>Save</button>`) and expression-wrapped literals (`{"Save"}`, ``{`Save`}``), but not dynamic values (`{count}`, `{t("save")}`) or attribute values (which are the domain of `jsxElements()`).

```typescript
import { modules, jsxText } from '@nielspeter/ts-archunit'

// No hardcoded user-facing text in components — route it through t()
modules(p)
  .that()
  .resideInFolder('src/components/**')
  .should()
  .notContain(jsxText())
  .because('User-facing text must go through t()')
  .excluding('src/components/Icon.tsx') // single-glyph icons
  .check()
```

`jsxText()` takes no options and bakes in no letter filter — `<div>123</div>` matches. Narrow with folder/file predicates or `.excluding(...)`. Note that text inside translation wrappers like `<Trans>` also matches; scope those out the same way if you use them.

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

## Customizable Recipes

These aren't shipped as standard rules because they need project-specific tuning — your ORM name, folder layout, or domain terms. Copy the one-liner and adjust the pattern.

> Helpers used below (`call`, `newExpr`, `not`, `resideInFolder`, `silent`, `mustCall`, `noDeadModules`, `noUnusedExports`, `noStubComments`, `functionNoJsonParse`, `functionNoConsole`) all import from `@nielspeter/ts-archunit`.

### Logic placement — keep operations in the right layer

DB queries belong in repositories, HTTP calls in gateways, parsing in validators. Customize the regex to your libraries (avoid broad patterns like `/query|execute/` — they match `executeTask`, `queryString`).

```typescript
const dbPattern = /prisma|knex|drizzle/

// No DB calls outside repositories
functions(p)
  .that()
  .resideInFolder('**/services/**')
  .should()
  .notContain(call(dbPattern))
  .rule({ id: 'placement/no-db-in-services', because: 'DB access belongs in repositories' })
  .check()

// No HTTP in the domain layer
functions(p)
  .that()
  .resideInFolder('**/domain/**')
  .should()
  .notContain(call(/fetch|axios|got/))
  .because('domain must not make HTTP calls — use a gateway')
  .check()

// No date construction in business logic (inject a clock for testability)
functions(p).that().resideInFolder('**/services/**').should().notContain(newExpr('Date')).check()
```

### Delegation — a layer must USE its dependency

The inverse of "must not contain": assert a function _must_ call something matching a pattern.

```typescript
// Services must delegate to the data layer
functions(p)
  .that()
  .resideInFolder('**/services/**')
  .should()
  .satisfy(mustCall(/Repository/))
  .because('services must delegate to the data layer')
  .check()

// Handlers must validate input first
functions(p)
  .that()
  .resideInFolder('**/handlers/**')
  .should()
  .satisfy(mustCall(/validate|parse|check/))
  .check()
```

### Boundary control — features stay self-contained

```typescript
const features = ['auth', 'billing', 'orders']
for (const f of features) {
  modules(p)
    .that()
    .resideInFolder(`**/features/${f}/**`)
    .should()
    .onlyImportFrom(`**/features/${f}/**`, '**/shared/**')
    .because(`${f} must not depend on other features`)
    .check()
}
// Or use the `strictBoundaries` preset, which does this automatically.

// Internal modules only reachable through the barrel
modules(p)
  .that()
  .resideInFile('**/internal/**/*.ts')
  .should()
  .onlyBeImportedVia('**/index.ts', '**/internal/**')
  .check()
```

### Dead code & hygiene

```typescript
// No orphaned files (nobody imports them)
modules(p)
  .that()
  .resideInFolder('src/**')
  .should()
  .satisfy(noDeadModules())
  .excluding('index.ts', 'main.ts', 'config.ts', /\.d\.ts$/)
  .check()

// No unused exports
modules(p).that().resideInFolder('src/**').should().satisfy(noUnusedExports()).check()

// No TODO/FIXME left in production
functions(p).that().resideInFolder('src/**').should().satisfy(noStubComments()).check()
```

For broad exclusion patterns that legitimately match nothing in some workspaces, wrap them in `silent()` to suppress the stale-exclusion warning: `.excluding(silent(/\.d\.ts$/), 'index.ts')`. See [Setup & Best Practices](/setup-best-practices#suppressing-individual-violations) for baseline-vs-`.excluding()` guidance.

### Export hygiene

```typescript
// Named exports only (easier to refactor and tree-shake)
modules(p).that().resideInFolder('src/**').should().notHaveDefaultExport().check()

// Too many exports suggests the file should be split (warn, don't fail)
modules(p).that().resideInFolder('src/**').should().haveMaxExports(10).warn()
```

### Centralized parsing & logging

```typescript
// Only src/parsers/ may call JSON.parse
functions(p)
  .that()
  .resideInFolder('src/**')
  .and()
  .satisfy(not(resideInFolder('**/parsers/**')))
  .should()
  .satisfy(functionNoJsonParse())
  .because('use the typed parsers in src/parsers/')
  .check()

// No raw console.* — use the logger abstraction
functions(p)
  .that()
  .resideInFolder('src/**')
  .should()
  .satisfy(functionNoConsole())
  .because('use Logger from @app/logger')
  .check()
```

(Design-system / JSX recipes live in [JSX Element Rules](#jsx-element-rules) above.)

---

For full details: [Modules](/modules) · [Classes](/classes) · [Functions](/functions) · [Types](/types) · [Body Analysis](/body-analysis) · [Calls](/calls) · [Slices](/slices) · [Patterns](/patterns) · [Smells](/smell-detection) · [GraphQL](/graphql) · [Cross-Layer](/cross-layer) · [Standard Rules](/standard-rules) · [Metrics](/metrics) · [Custom Rules](/custom-rules) · [Violations](/violation-reporting)
