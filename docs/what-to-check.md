# What to Check

A recipe gallery. Each category shows what ts-archunit can enforce in 1-2 code snippets. No theory, no explanation of how the API works -- just results.

::: tip
This is the "sell" page. Scan it in 2 minutes and know if ts-archunit solves your problem.
:::

## 1. Import Dependencies

"Domain must not import from infrastructure."

```typescript
modules(p)
  .that()
  .resideInFolder('**/domain/**')
  .should()
  .onlyImportFrom('**/domain/**', '**/shared/**')
  .check()
```

"Repositories must not import from controllers."

```typescript
modules(p)
  .that()
  .resideInFolder('**/repositories/**')
  .should()
  .notImportFrom('**/controllers/**')
  .check()
```

## 2. Layer Ordering

"Dependencies flow controllers -> services -> repositories -> domain."

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

## 3. Cycle Detection

"No circular dependencies between feature modules."

```typescript
slices(p).matching('src/features/*/').should().beFreeOfCycles().check()
```

## 4. Naming Conventions

"Controllers end with Controller, services end with Service."

```typescript
classes(p)
  .that()
  .resideInFolder('**/controllers/**')
  .should()
  .haveNameMatching(/Controller$/)
  .check()

classes(p)
  .that()
  .resideInFolder('**/services/**')
  .should()
  .haveNameMatching(/Service$/)
  .check()
```

## 5. Class Structure

"Repositories must extend BaseRepository."

```typescript
classes(p)
  .that()
  .haveNameEndingWith('Repository')
  .and()
  .resideInFolder('**/repositories/**')
  .should()
  .shouldExtend('BaseRepository')
  .check()
```

"Domain entities must be exported."

```typescript
classes(p).that().resideInFolder('**/domain/**').should().beExported().check()
```

## 6. Body Analysis

"No raw parseInt -- use the shared helper."

```typescript
classes(p)
  .that()
  .extend('BaseRepository')
  .should()
  .useInsteadOf(call('parseInt'), call('this.extractCount'))
  .check()
```

"No `new Error()` -- use typed domain errors."

```typescript
classes(p).that().extend('BaseService').should().notContain(newExpr('Error')).check()
```

"No `console.log` in production code."

```typescript
import { noConsoleLog } from 'ts-archunit/rules/security'

classes(p).that().resideInFolder('**/src/**').should().satisfy(noConsoleLog()).check()
```

## 7. Type Safety

"Query options must use typed unions, not bare string."

```typescript
types(p)
  .that()
  .haveNameMatching(/Options$/)
  .and()
  .haveProperty('orderBy')
  .should()
  .havePropertyType('orderBy', notType(isString()))
  .check()
```

"No `any`-typed properties on exported classes."

```typescript
import { noAnyProperties } from 'ts-archunit/rules/typescript'

classes(p).that().areExported().should().satisfy(noAnyProperties()).check()
```

## 8. Custom Rules

"Define your own team conventions."

```typescript
import { definePredicate, defineCondition, createViolation } from 'ts-archunit'

const hasTooManyMethods = definePredicate(
  'has more than 10 methods',
  (cls) => cls.getMethods().length > 10,
)

classes(p).that().satisfy(hasTooManyMethods).should().notExist().check()
```

"All route handlers must be async."

```typescript
functions(p).that().resideInFolder('**/handlers/**').should().beAsync().check()
```

---

Every example on this page is a real rule you can copy-paste into an `arch.test.ts` file. Wrap each in an `it()` block, add `const p = project('tsconfig.json')` at the top, and run with `npx vitest run`.

For full details on each entry point, see the guide pages: [Modules](/modules), [Classes](/classes), [Functions](/functions), [Types](/types), [Body Analysis](/body-analysis), [Slices](/slices), [Custom Rules](/custom-rules).
