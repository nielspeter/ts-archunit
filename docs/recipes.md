# Architecture Recipes

Copy-paste architecture rules for common scenarios. These are not shipped as standard rules because they require project-specific customization (ORM names, folder conventions, domain terms). Copy the one-liner, adjust the pattern, and add it to your architecture test file.

## Logic Placement

Logic placement rules enforce where specific operations are allowed. The most common: DB queries belong in repositories, HTTP calls belong in gateways, parsing belongs in validators. Without enforcement, these operations creep into services, handlers, and controllers — making code harder to test and refactor.

These rules are one-liners using `notContain(call(...))` or `notContain(newExpr(...))`. Customize the regex pattern to match your project's specific libraries.

### No DB calls outside repositories

```typescript
const dbPattern = /prisma|knex|drizzle/

functions(p)
  .that()
  .resideInFolder('**/services/**')
  .should()
  .notContain(call(dbPattern))
  .rule({ id: 'placement/no-db-in-services', because: 'DB access belongs in repositories' })
  .check()
```

> **Customize:** Replace the regex with your ORM. Avoid broad patterns like `/query|execute/` — they match `executeTask`, `queryString`, etc.

### No HTTP calls in domain layer

```typescript
functions(p)
  .that()
  .resideInFolder('**/domain/**')
  .should()
  .notContain(call(/fetch|axios|got/))
  .because('domain must not make HTTP calls — use a gateway')
  .check()
```

### No inline parsing

```typescript
functions(p)
  .that()
  .resideInFolder('**/routes/**')
  .should()
  .notContain(call('parseInt'))
  .because('use typed parsers from the validation layer')
  .check()
```

### No date construction in business logic

```typescript
functions(p)
  .that()
  .resideInFolder('**/services/**')
  .should()
  .notContain(newExpr('Date'))
  .because('inject a clock for testability')
  .check()
```

## Boundary Control

Boundary rules prevent cross-contamination between independent parts of a codebase. In a monorepo or feature-based architecture, each feature module should be self-contained — importing only from itself and shared utilities. Without enforcement, developers take shortcuts by importing directly from other features, creating hidden coupling that makes features impossible to extract or deploy independently.

### Feature modules only import from themselves and shared

```typescript
const features = ['auth', 'billing', 'orders']

for (const feature of features) {
  modules(p)
    .that()
    .resideInFolder(`**/features/${feature}/**`)
    .should()
    .onlyImportFrom(`**/features/${feature}/**`, '**/shared/**')
    .because(`${feature} must not depend on other features`)
    .check()
}
```

> **Or use the `strictBoundaries` preset** which does this automatically.

### Internal modules only accessible through barrel

```typescript
modules(p)
  .that()
  .resideInFile('**/internal/**/*.ts')
  .should()
  .onlyBeImportedVia('**/index.ts', '**/internal/**')
  .because('internal modules must be accessed through the public API')
  .check()
```

### No circular imports between packages

```typescript
slices(p).matching('packages/*/').should().beFreeOfCycles().check()
```

## Safety

Safety rules ban dangerous API calls from production code. `eval`, `new Function`, and direct `JSON.parse` are attack vectors; `console.*` and `process.env` bypass logging and configuration abstractions. These are straightforward bans — scope them to `src/**` and exclude test files.

### No eval in production code

```typescript
modules(p).that().resideInFolder('src/**').should().satisfy(moduleNoEval()).check()
```

### Centralized JSON parsing

```typescript
import { not, resideInFolder } from '@nielspeter/ts-archunit'

functions(p)
  .that()
  .resideInFolder('src/**')
  .and()
  .satisfy(not(resideInFolder('**/parsers/**')))
  .should()
  .satisfy(functionNoJsonParse())
  .because('use the typed parsers in src/parsers/')
  .check()
```

### Logger abstraction

```typescript
functions(p)
  .that()
  .resideInFolder('src/**')
  .should()
  .satisfy(functionNoConsole())
  .because('use Logger from @app/logger')
  .check()
```

## Dead Code

Dead code accumulates silently — files nobody imports, exports nobody references, functions with empty bodies, TODO comments that never get resolved. Unlike unused variables (which linters catch), dead modules and unused exports require project-wide analysis across the import graph. These recipes use the hygiene rules from `ts-archunit/rules/hygiene`.

### No orphaned files

```typescript
modules(p)
  .that()
  .resideInFolder('src/**')
  .should()
  .satisfy(noDeadModules())
  .excluding('index.ts', 'main.ts', 'config.ts', /\.d\.ts$/)
  .check()
```

### No unused exports

```typescript
modules(p).that().resideInFolder('src/**').should().satisfy(noUnusedExports()).check()
```

### No TODO/FIXME in production

```typescript
functions(p).that().resideInFolder('src/**').should().satisfy(noStubComments()).check()
```

## Delegation Patterns

Delegation rules are the inverse of "must not contain" — they assert that a function MUST call something matching a pattern. Use them to enforce that layers actually use their dependencies: services must delegate to repositories, handlers must call validators, controllers must call services. Without these, developers write business logic inline in the wrong layer.

### Services must call repositories

```typescript
functions(p)
  .that()
  .resideInFolder('**/services/**')
  .should()
  .satisfy(mustCall(/Repository/))
  .because('services must delegate to the data layer')
  .check()
```

### Handlers must validate input

```typescript
functions(p)
  .that()
  .resideInFolder('**/handlers/**')
  .should()
  .satisfy(mustCall(/validate|parse|check/))
  .because('handlers must validate input before processing')
  .check()
```

## Export Hygiene

Export rules control the public API surface of each file. Default exports make refactoring harder (renaming the export doesn't update import sites). Too many exports from a single file suggest it should be split. These rules are especially valuable in shared libraries and packages where the export surface is your contract with consumers.

### No default exports in library code

```typescript
modules(p)
  .that()
  .resideInFolder('src/**')
  .should()
  .notHaveDefaultExport()
  .because('named exports are easier to refactor and tree-shake')
  .check()
```

### Max exports per file

```typescript
modules(p)
  .that()
  .resideInFolder('src/**')
  .should()
  .haveMaxExports(10)
  .because('too many exports suggests the file should be split')
  .warn()
```

## Combining Recipes

In practice, you combine multiple recipes in a single test file. Group them by concern with `describe` blocks, and add `.rule()` metadata so violations include actionable context — the `because` field explains why the rule exists, and the `suggestion` field tells the developer exactly how to fix it:

```typescript
import { describe, it } from 'vitest'
import { project } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')

describe('architecture rules', () => {
  it('services delegate to repositories', () => {
    functions(p)
      .that()
      .resideInFolder('**/services/**')
      .should()
      .satisfy(mustCall(/Repository/))
      .rule({
        id: 'arch/service-delegation',
        because: 'services orchestrate — data access belongs in repositories',
        suggestion: 'Inject a repository and call its methods',
      })
      .check()
  })

  it('no DB calls in services', () => {
    functions(p)
      .that()
      .resideInFolder('**/services/**')
      .should()
      .notContain(call(/prisma|knex/))
      .rule({
        id: 'arch/no-db-in-services',
        because: 'services must not bypass the repository layer',
        suggestion: 'Move the query to a repository method',
      })
      .check()
  })
})
```
