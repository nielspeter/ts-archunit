# Standard Rules

Ready-to-use rules via categorized sub-path imports. No custom conditions needed — just import and apply.

## TypeScript (`ts-archunit/rules/typescript`)

```typescript
import {
  noAnyProperties,
  noTypeAssertions,
  noNonNullAssertions,
} from '@nielspeter/ts-archunit/rules/typescript'
```

| Rule                    | What it checks                                                |
| ----------------------- | ------------------------------------------------------------- |
| `noAnyProperties()`     | Class properties must not be typed as `any`                   |
| `noTypeAssertions()`    | Method bodies must not contain `as` casts (allows `as const`) |
| `noNonNullAssertions()` | Method bodies must not contain `!` non-null assertions        |

```typescript
classes(p)
  .that()
  .areExported()
  .should()
  .satisfy(noAnyProperties())
  .because('any bypasses the type checker')
  .check()

classes(p).that().haveNameEndingWith('Service').should().satisfy(noTypeAssertions()).check()
```

## Security (`ts-archunit/rules/security`)

```typescript
import {
  noEval,
  noFunctionConstructor,
  noProcessEnv,
  noConsoleLog,
} from '@nielspeter/ts-archunit/rules/security'
```

| Rule                      | What it checks                           |
| ------------------------- | ---------------------------------------- |
| `noEval()`                | No `eval()` calls in class methods       |
| `noFunctionConstructor()` | No `new Function()` (equivalent to eval) |
| `noProcessEnv()`          | No `process.env` access in class methods |
| `noConsoleLog()`          | No `console.log` calls in class methods  |

```typescript
classes(p).should().satisfy(noEval()).check()

classes(p)
  .that()
  .resideInFolder('**/domain/**')
  .should()
  .satisfy(noProcessEnv())
  .because('use dependency injection for configuration')
  .check()
```

## Error Handling (`ts-archunit/rules/errors`)

```typescript
import { noGenericErrors, noTypeErrors } from '@nielspeter/ts-archunit/rules/errors'
```

| Rule                | What it checks                                               |
| ------------------- | ------------------------------------------------------------ |
| `noGenericErrors()` | No `new Error()` — use typed domain errors                   |
| `noTypeErrors()`    | No `new TypeError()` — usually indicates a programming error |

```typescript
classes(p)
  .that()
  .extend('BaseService')
  .should()
  .satisfy(noGenericErrors())
  .rule({
    id: 'error/typed-errors',
    suggestion: 'Use NotFoundError, ValidationError, or ConflictError',
  })
  .check()
```

## Naming (`ts-archunit/rules/naming`)

```typescript
import { mustMatchName, mustNotEndWith } from '@nielspeter/ts-archunit/rules/naming'
```

| Rule                     | What it checks                                 |
| ------------------------ | ---------------------------------------------- |
| `mustMatchName(pattern)` | Class name must match a regex pattern          |
| `mustNotEndWith(suffix)` | Class name must not end with a specific suffix |

```typescript
classes(p)
  .that()
  .resideInFolder('**/controllers/**')
  .should()
  .satisfy(mustMatchName(/Controller$/))
  .check()

// JPA entities should not have "Entity" suffix
classes(p).that().resideInFolder('**/domain/**').should().satisfy(mustNotEndWith('Entity')).check()
```

## Dependencies (`ts-archunit/rules/dependencies`)

```typescript
import {
  onlyDependOn,
  mustNotDependOn,
  typeOnlyFrom,
} from '@nielspeter/ts-archunit/rules/dependencies'
```

| Rule                        | What it checks                                 |
| --------------------------- | ---------------------------------------------- |
| `onlyDependOn(...globs)`    | Module may only import from listed paths       |
| `mustNotDependOn(...globs)` | Module must not import from listed paths       |
| `typeOnlyFrom(...globs)`    | Imports from these paths must be `import type` |

```typescript
modules(p)
  .that()
  .resideInFolder('**/domain/**')
  .should()
  .satisfy(onlyDependOn('**/domain/**', '**/shared/**'))
  .check()

modules(p)
  .that()
  .resideInFolder('**/services/**')
  .should()
  .satisfy(typeOnlyFrom('**/repositories/**'))
  .because('services should only use repository types, not implementations')
  .check()
```

## Code Quality (`ts-archunit/rules/code-quality`)

```typescript
import {
  requireJsDocOnPublicMethods,
  noPublicFields,
  noMagicNumbers,
} from '@nielspeter/ts-archunit/rules/code-quality'
```

| Rule                            | What it checks                                                   |
| ------------------------------- | ---------------------------------------------------------------- |
| `requireJsDocOnPublicMethods()` | All public methods must have JSDoc comments                      |
| `noPublicFields()`              | No public mutable fields (allows static readonly)                |
| `noMagicNumbers(options?)`      | No numeric literals in method bodies (configurable allowed list) |

```typescript
classes(p)
  .that()
  .areExported()
  .should()
  .satisfy(requireJsDocOnPublicMethods())
  .because('public API must be documented')
  .warn()

classes(p)
  .that()
  .resideInFolder('**/domain/**')
  .should()
  .satisfy(noPublicFields())
  .because('encapsulate state behind methods')
  .check()

classes(p).that().haveNameEndingWith('Service').should().satisfy(noMagicNumbers()).warn()

// Custom allowed numbers (e.g., HTTP status codes)
classes(p)
  .should()
  .satisfy(noMagicNumbers({ allowed: [0, 1, -1, 200, 404, 500] }))
  .warn()
```

## Using Multiple Standard Rules

Combine standard rules in a single test file:

```typescript
import { noAnyProperties, noTypeAssertions } from '@nielspeter/ts-archunit/rules/typescript'
import { noEval, noConsoleLog } from '@nielspeter/ts-archunit/rules/security'
import { noGenericErrors } from '@nielspeter/ts-archunit/rules/errors'
import {
  requireJsDocOnPublicMethods,
  noMagicNumbers,
} from '@nielspeter/ts-archunit/rules/code-quality'

const exported = classes(p).that().areExported()

exported.should().satisfy(noAnyProperties()).check()
exported.should().satisfy(noTypeAssertions()).check()
exported.should().satisfy(noEval()).check()
exported.should().satisfy(noGenericErrors()).check()
exported.should().satisfy(requireJsDocOnPublicMethods()).warn()
exported.should().satisfy(noMagicNumbers()).warn()
```

## Metrics (`ts-archunit/rules/metrics`)

```typescript
import {
  maxCyclomaticComplexity,
  maxClassLines,
  maxMethodLines,
  maxMethods,
  maxParameters,
  maxFunctionComplexity,
  maxFunctionLines,
  maxFunctionParameters,
} from '@nielspeter/ts-archunit/rules/metrics'
```

| Rule                         | What it checks                                           |
| ---------------------------- | -------------------------------------------------------- |
| `maxCyclomaticComplexity(n)` | No method/constructor/getter/setter exceeds complexity N |
| `maxClassLines(n)`           | Class spans no more than N lines                         |
| `maxMethodLines(n)`          | No method/constructor/getter/setter exceeds N lines      |
| `maxMethods(n)`              | Class has no more than N methods                         |
| `maxParameters(n)`           | No method/constructor has more than N parameters         |
| `maxFunctionComplexity(n)`   | Function complexity does not exceed N                    |
| `maxFunctionLines(n)`        | Function spans no more than N lines                      |
| `maxFunctionParameters(n)`   | Function has no more than N parameters                   |

```typescript
classes(p).should().satisfy(maxCyclomaticComplexity(15)).check()
classes(p).should().satisfy(maxClassLines(300)).warn()
classes(p).should().satisfy(maxMethods(15)).warn()
classes(p).should().satisfy(maxParameters(4)).check()

functions(p).should().satisfy(maxFunctionComplexity(15)).check()
functions(p).should().satisfy(maxFunctionLines(40)).warn()
```

See [Metrics](/metrics) for full documentation including predicates, thresholds, and custom metric rules.

## Writing Your Own

Standard rules are just `Condition<ClassDeclaration>` factory functions. See [Custom Rules](/custom-rules) to learn how to write your own using `defineCondition()`.
