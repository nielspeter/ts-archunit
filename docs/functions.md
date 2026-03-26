# Function Rules

The `functions()` entry point operates on functions, arrow functions, and class methods. ts-archunit wraps all of these in a unified `ArchFunction` model.

## When to Use

- Enforce naming conventions on functions
- Require or forbid async functions in certain folders
- Check parameter counts
- Prevent copy-pasted utility functions from appearing in the wrong places
- Inspect function bodies (see [Body Analysis](/body-analysis))

## ArchFunction

ts-archunit collects three kinds of declarations into a single `ArchFunction` type:

1. **Function declarations** -- `function handleRequest() { ... }`
2. **Arrow function variables** -- `const handleRequest = () => { ... }`
3. **Class methods** -- `class OrderService { handleRequest() { ... } }`

All three support the same predicates and conditions, so you write one rule and it applies everywhere.

## Basic Usage

```typescript
import { project, functions } from 'ts-archunit'

const p = project('tsconfig.json')

functions(p).that().resideInFolder('**/handlers/**').should().beAsync().check()
```

## Available Predicates

All identity predicates (`haveNameMatching`, `resideInFolder`, `areExported`, etc.) work on functions. In addition:

| Predicate                          | Description                                          | Example                                      |
| ---------------------------------- | ---------------------------------------------------- | -------------------------------------------- |
| `areAsync`                         | Function is async                                    | `.that().areAsync()`                         |
| `areNotAsync`                      | Function is not async                                | `.that().areNotAsync()`                      |
| `haveParameterCount(n)`            | Function has exactly n parameters                    | `.that().haveParameterCount(0)`              |
| `haveParameterCountGreaterThan(n)` | Function has more than n parameters                  | `.that().haveParameterCountGreaterThan(5)`   |
| `haveParameterCountLessThan(n)`    | Function has fewer than n parameters                 | `.that().haveParameterCountLessThan(2)`      |
| `haveParameterNamed(name)`         | Function has a parameter with the given name         | `.that().haveParameterNamed('ctx')`          |
| `haveReturnType(type)`             | Function has the given return type                   | `.that().haveReturnType('Promise')`          |
| `haveRestParameter()`              | Function has a `...args` rest parameter              | `.that().haveRestParameter()`                |
| `haveOptionalParameter()`          | Function has an optional or default-valued parameter | `.that().haveOptionalParameter()`            |
| `haveParameterOfType(i, matcher)`  | Parameter at index i matches the TypeMatcher         | `.that().haveParameterOfType(0, isString())` |
| `haveParameterNameMatching(regex)` | Function has a parameter name matching regex         | `.that().haveParameterNameMatching(/^ctx/)`  |

## Available Conditions

| Condition                       | Description                                   | Example                                          |
| ------------------------------- | --------------------------------------------- | ------------------------------------------------ |
| `notExist()`                    | No functions should match the predicates      | `.should().notExist()`                           |
| `beExported()`                  | Function must be exported                     | `.should().beExported()`                         |
| `beAsync()`                     | Function must be async                        | `.should().beAsync()`                            |
| `conditionHaveNameMatching(re)` | Function name must match the regex            | `.should().conditionHaveNameMatching(/^handle/)` |
| `contain(matcher)`              | Function body must contain the expression     | `.should().contain(call('validate'))`            |
| `notContain(matcher)`           | Function body must not contain the expression | `.should().notContain(call('eval'))`             |
| `useInsteadOf(ban, alt)`        | Replace banned expression with an alternative | `.should().useInsteadOf(call('parseInt'), ...)`  |

## Real-World Examples

### Ban Copy-Pasted Parsers

```typescript
functions(p)
  .that()
  .haveNameMatching(/^parse\w+Order$/)
  .and()
  .resideInFolder('**/routes/**')
  .should()
  .notExist()
  .rule({
    id: 'route/no-copy-paste-parsers',
    because: 'Copy-pasted parsers diverge over time',
    suggestion: "Import parseOrder from '@company/server-common' and pass a column map",
  })
  .check()
```

### Route Handlers Must Be Async

```typescript
functions(p)
  .that()
  .resideInFolder('**/handlers/**')
  .should()
  .beAsync()
  .because('route handlers must be async for proper error handling')
  .check()
```

### No `new URLSearchParams` in Wrappers

```typescript
functions(p)
  .that()
  .resideInFolder('**/wrappers/**')
  .should()
  .notContain(newExpr('URLSearchParams'))
  .rule({
    id: 'sdk/no-raw-urlsearchparams',
    suggestion: 'Use buildQueryString() utility',
  })
  .check()
```

### Exported Functions Must Have Limited Parameters

```typescript
functions(p)
  .that()
  .areExported()
  .and()
  .haveParameterCountGreaterThan(5)
  .should()
  .notExist()
  .because('functions with many parameters should use an options object')
  .check()
```

### No Rest Parameters in Route Handlers

```typescript
functions(p)
  .that()
  .resideInFolder('**/routes/**')
  .and()
  .haveRestParameter()
  .should()
  .notExist()
  .because('route handlers must have explicitly typed parameters')
  .check()
```

### Event Handlers Must Accept an Event Parameter

```typescript
import { matching } from 'ts-archunit'

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

## Scoped Rules with `within()`

Use `within()` to restrict rules to callback functions inside matched call expressions:

```typescript
import { calls, call, within } from 'ts-archunit'

// Select route registrations
const routes = calls(p)
  .that()
  .onObject('app')
  .and()
  .withMethod(/^(get|post|put|delete|patch)$/)

// Within route handlers, enforce normalizePagination
within(routes)
  .functions()
  .should()
  .contain(call('normalizePagination'))
  .rule({ id: 'route/pagination', because: 'All list endpoints must use shared pagination' })
  .check()
```
