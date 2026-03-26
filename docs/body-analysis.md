# Body Analysis

Body analysis is the signature feature of ts-archunit. While other tools check import paths, ts-archunit inspects what happens _inside_ function and method bodies -- the actual AST of call expressions, constructor invocations, property access, and arbitrary expressions.

## What Body Analysis Is

Most architecture tools operate at the module level: "file A imports file B." That catches dependency violations but misses patterns like:

- A repository calling `parseInt()` instead of its base class helper
- A service throwing `new Error()` instead of a typed domain error
- A wrapper constructing `new URLSearchParams()` instead of using the shared utility
- Production code calling `console.log`

Body analysis fills this gap. It traverses the AST inside every method body (for classes) or function body (for functions) and matches against expression patterns you define.

## Matchers

Four matchers cover the most common expression patterns:

### `call(target)`

Matches function/method call expressions.

```typescript
import { call } from 'ts-archunit'

call('parseInt') // matches parseInt(x, 10)
call('console.log') // matches console.log('hello')
call('this.extractCount') // matches this.extractCount(result)
call(/^parse/) // matches parseInt, parseFloat, parseSomething
```

### `newExpr(target)`

Matches constructor invocations (`new ...`).

```typescript
import { newExpr } from 'ts-archunit'

newExpr('Error') // matches new Error('message')
newExpr('URLSearchParams') // matches new URLSearchParams(params)
newExpr('Function') // matches new Function('return 1')
newExpr(/^(?!Typed)Error$/) // matches new Error but not new TypeError
```

### `access(target)`

Matches property access expressions.

```typescript
import { access } from 'ts-archunit'

access('process.env') // matches process.env.DATABASE_URL
access('this.config') // matches this.config.timeout
access(/^document\./) // matches document.querySelector, document.getElementById
```

### `expression(target)`

Matches any expression by its text representation. Use this as a fallback when the other matchers don't fit.

```typescript
import { expression } from 'ts-archunit'

expression('eval') // matches eval('code')
expression(/JSON\.parse/) // matches JSON.parse(str)
```

## String vs Regex

All matchers accept either a string (exact match) or a regex (pattern match):

```typescript
// Exact match -- only parseInt
call('parseInt')

// Pattern match -- parseInt, parseFloat, parseSomething
call(/^parse/)

// Exact match -- only new Error
newExpr('Error')

// Pattern match -- new Error, new TypeError, new RangeError
newExpr(/Error$/)
```

## Optional Chaining

Optional chaining is automatically normalized. `this?.foo` matches the same pattern as `this.foo`:

```typescript
// Both of these match:
//   this.extractCount(result)
//   this?.extractCount(result)
call('this.extractCount')
```

## Conditions

### `contain(matcher)`

Asserts that the body _must contain_ the matched expression:

```typescript
classes(p).that().extend('BaseRepository').should().contain(call('this.validate')).check()
```

### `notContain(matcher)`

Asserts that the body _must not contain_ the matched expression:

```typescript
classes(p).that().extend('BaseRepository').should().notContain(call('parseInt')).check()
```

### `useInsteadOf(banned, replacement)`

A combination condition: asserts the banned expression is absent, and the replacement is present in the violation message as a suggestion.

```typescript
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
```

## Class vs Function Scope

Body analysis works on both classes and functions, but the scope differs:

- **`classes(p)`** -- checks all method bodies in each matched class
- **`functions(p)`** -- checks the body of each matched function/arrow/method individually

```typescript
// Check class method bodies
classes(p).that().extend('BaseService').should().notContain(newExpr('Error')).check()

// Check function bodies (includes standalone functions AND arrow functions)
functions(p)
  .that()
  .resideInFolder('**/wrappers/**')
  .should()
  .notContain(newExpr('URLSearchParams'))
  .check()
```

## Advanced: Standalone Body Analysis Conditions

For composition with custom rules, standalone condition functions are available:

```typescript
import {
  classContain,
  classNotContain,
  classUseInsteadOf,
  functionContain,
  functionNotContain,
  functionUseInsteadOf,
} from 'ts-archunit'
```

These return `Condition<ClassDeclaration>` or `Condition<ArchFunction>` that can be passed to `.satisfy()` or combined with other conditions.

## Real-World Examples

### Ban `parseInt` -- Require Shared Helper

```typescript
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
```

### Ban `new Error()` -- Require Typed Domain Errors

```typescript
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
```

### Ban `new URLSearchParams()` -- Require Utility

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

### Ban `console.log` in Production Code

```typescript
import { noConsoleLog } from 'ts-archunit/rules/security'

classes(p)
  .that()
  .resideInFolder('**/src/**')
  .should()
  .satisfy(noConsoleLog())
  .because('use a logger abstraction')
  .check()
```

### Ban `eval()`

```typescript
import { noEval } from 'ts-archunit/rules/security'

classes(p).should().satisfy(noEval()).because('eval is a security risk').check()
```

### Ban `process.env` in Domain Layer

```typescript
import { noProcessEnv } from 'ts-archunit/rules/security'

classes(p)
  .that()
  .resideInFolder('**/domain/**')
  .should()
  .satisfy(noProcessEnv())
  .because('use dependency injection for configuration')
  .check()
```

### Ban `new Function()` Constructor

```typescript
import { noFunctionConstructor } from 'ts-archunit/rules/security'

classes(p)
  .should()
  .satisfy(noFunctionConstructor())
  .because('new Function() is equivalent to eval')
  .check()
```

### Scoped Body Analysis with `within()`

Check what happens inside callback functions of specific call expressions:

```typescript
import { calls, call, within } from 'ts-archunit'

const routes = calls(p)
  .that()
  .onObject('app')
  .and()
  .withMethod(/^(get|post|put|delete|patch)$/)

// Within route handlers, enforce error handling
within(routes).functions().should().contain(call('handleError')).check()
```

## Known Limitations

- **Destructured calls** are not matched. `const { parse } = JSON; parse(str)` won't match `call('JSON.parse')`.
- **No cross-file tracing.** Body analysis inspects the AST of the current file. If a function delegates to another file, that delegation is not followed.
- **Dynamic expressions** like `obj[methodName]()` are not matchable by name.
