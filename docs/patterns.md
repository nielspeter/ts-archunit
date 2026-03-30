# Pattern Templates

Pattern templates enforce return type shapes across functions. Use them to ensure that all functions in a folder return objects with the expected structure -- for example, every list endpoint must return `{ total, skip, limit, items }`. This catches missing or mistyped fields at CI time, before inconsistent response shapes reach production and break clients.

## When to Use

- Enforce consistent return types across similar functions
- Validate that paginated endpoints always include pagination metadata
- Ensure API response shapes follow a company-wide standard
- Catch missing fields before they reach production

## `definePattern()`

`definePattern()` creates a reusable, named template describing the return type shape you expect. Define it once with a `returnShape` -- a record mapping property names to type constraints -- and then apply it to any set of functions via `followPattern()`. The name appears in violation messages so you can immediately tell which contract a function broke.

```typescript
import { definePattern } from '@nielspeter/ts-archunit'

const paginatedCollection = definePattern('paginated-collection', {
  returnShape: {
    total: 'number',
    skip: 'number',
    limit: 'number',
    items: 'T[]',
  },
})
```

The `name` is used in violation messages to identify which pattern a function failed to follow.

## `PropertyConstraint`

Each property in `returnShape` is a `PropertyConstraint` -- one of three forms:

### String (Regex)

A string is matched as a regex against the property type's text representation. Common examples:

```typescript
definePattern('example', {
  returnShape: {
    total: 'number', // exact type match
    name: 'string', // exact type match
    status: 'string|null', // union type
    id: 'string|number', // accepts either
  },
})
```

The string is anchored with `^...$` automatically, so `'number'` only matches the type `number`, not `number | undefined`.

### `'T[]'` (Array)

The special string `'T[]'` matches any array type regardless of element type. Use it when you care that a property is an array but not what it contains.

```typescript
definePattern('collection', {
  returnShape: {
    items: 'T[]', // matches string[], User[], ReadonlyArray<Order>, etc.
  },
})
```

### `TypeMatcher` (Programmatic)

For full control, pass a `TypeMatcher` function. This reuses the same matchers available in type-level rules.

```typescript
import { definePattern, arrayOf, isString } from '@nielspeter/ts-archunit'

definePattern('tagged-collection', {
  returnShape: {
    tags: arrayOf(isString()), // must be string[]
  },
})
```

Available type matchers: `isString()`, `isNumber()`, `isBoolean()`, `isUnionOfLiterals()`, `isStringLiteral()`, `arrayOf(matcher)`, `matching(regex)`, `exactly(text)`, `not(matcher)`.

## `followPattern()`

`followPattern()` is the condition that wires a pattern template into a function rule. It inspects every matched function's return type and reports a violation whenever a required property is missing or has the wrong type. Use it in combination with predicates like `resideInFolder()` or `haveNameMatching()` to target exactly the functions that should conform.

```typescript
import { project, functions, definePattern } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')

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

When a function's return type is missing a required property or has the wrong type:

```
Architecture Violation

  "listUsers" does not follow pattern "paginated-collection": missing property "skip"
  src/routes/user-route.ts:42
```

## Promise Unwrapping

Async functions return `Promise<T>`. Pattern templates automatically unwrap the Promise to inspect the resolved type `T`. This means the same pattern works for both sync and async functions:

```typescript
// Both of these are checked against the same returnShape:
function listUsersSync(): PaginatedResult<User> { ... }
async function listUsersAsync(): Promise<PaginatedResult<User>> { ... }
```

You do not need to account for `Promise` in your pattern definition.

## Real-World Examples

### Paginated Collection Pattern

```typescript
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
  .and()
  .haveNameMatching(/^list/)
  .should()
  .followPattern(paginatedCollection)
  .rule({
    id: 'api/paginated-response',
    because: 'List endpoints must return consistent pagination metadata',
    suggestion: 'Return { total, skip, limit, items } from every list route',
  })
  .check()
```

### API Error Response Pattern

```typescript
const errorResponse = definePattern('error-response', {
  returnShape: {
    code: 'string',
    message: 'string',
  },
})

functions(p)
  .that()
  .resideInFolder('**/errors/**')
  .and()
  .haveNameMatching(/^create\w+Error$/)
  .should()
  .followPattern(errorResponse)
  .because('all error constructors must return code + message')
  .check()
```

### API Response Envelope

```typescript
import { definePattern, arrayOf, matching } from '@nielspeter/ts-archunit'

const apiEnvelope = definePattern('api-envelope', {
  returnShape: {
    success: 'boolean',
    data: 'T[]',
    meta: matching(/Meta$/),
  },
})

functions(p)
  .that()
  .resideInFolder('**/api/**')
  .and()
  .areExported()
  .should()
  .followPattern(apiEnvelope)
  .because('all API responses must use the standard envelope format')
  .check()
```

### Combining Patterns with Other Conditions

Patterns compose naturally with other function conditions:

```typescript
functions(p).that().resideInFolder('**/routes/**').should().beAsync().check()

functions(p)
  .that()
  .resideInFolder('**/routes/**')
  .and()
  .haveNameMatching(/^list/)
  .should()
  .followPattern(paginatedCollection)
  .check()
```
