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

Matchers are the building blocks of body analysis rules. Each matcher targets a specific kind of AST node -- function calls, constructor invocations, property access, object properties, or arbitrary expressions. You pass a matcher to a condition like `notContain()` to define what should (or should not) appear inside method and function bodies.

Six matchers cover the most common expression patterns:

### `call(target)`

Matches function and method call expressions. Use this to ban specific function calls (like `parseInt` or `console.log`) or require that certain methods are invoked (like `this.validate`). This is the most frequently used matcher.

```typescript
import { call } from '@nielspeter/ts-archunit'

call('parseInt') // matches parseInt(x, 10)
call('console.log') // matches console.log('hello')
call('this.extractCount') // matches this.extractCount(result)
call(/^parse/) // matches parseInt, parseFloat, parseSomething
```

### `newExpr(target)`

Matches constructor invocations (`new ...`). Use this to forbid direct instantiation of certain classes -- for example, banning `new Error()` in favor of typed domain errors, or banning `new URLSearchParams()` in favor of a shared utility.

```typescript
import { newExpr } from '@nielspeter/ts-archunit'

newExpr('Error') // matches new Error('message')
newExpr('URLSearchParams') // matches new URLSearchParams(params)
newExpr('Function') // matches new Function('return 1')
newExpr(/^(?!Typed)Error$/) // matches new Error but not new TypeError
```

### `access(target)`

Matches property access expressions. Use this to detect direct access to globals like `process.env` or `document`, which should typically go through an abstraction layer for testability and portability.

```typescript
import { access } from '@nielspeter/ts-archunit'

access('process.env') // matches process.env.DATABASE_URL
access('this.config') // matches this.config.timeout
access(/^document\./) // matches document.querySelector, document.getElementById
```

### `property(name, value?)`

Matches property assignments in object literals by name and optional value. Use this when your architectural rules target configuration or schema definitions rather than executable code -- for example, ensuring JSON schemas always set `additionalProperties: false`, or that config objects use specific modes. Reach for `property()` instead of `expression()` when you need to match a specific key-value pair in an object literal.

```typescript
import { property } from '@nielspeter/ts-archunit'

property('additionalProperties', true) // matches additionalProperties: true
property('type', 'object') // matches type: 'object' (no quotes needed)
property('maximum', 100) // matches maximum: 100
property(/^additional/) // matches any property starting with 'additional'
property('mode', /^'(strict|loose)'$/) // matches mode: 'strict' or 'loose' (RegExp uses raw getText())
```

Value matching uses semantic comparison for primitives (`boolean`, `number`, `string` via `getLiteralValue()`). `RegExp` values match against the raw source text including quotes. Omit the value parameter for name-only matching.

> **Note:** `property()` targets `PropertyAssignment` nodes. It does not match shorthand properties (`{ schema }`) or computed property names (`{ [key]: value }`).

### `expression(target)`

Matches any expression by its raw source text. This is the catch-all matcher -- use it as a fallback when `call()`, `newExpr()`, `access()`, and `property()` do not cover your case. Because it matches against `getText()` output, it is less precise than the specialized matchers but more flexible.

```typescript
import { expression } from '@nielspeter/ts-archunit'

expression('eval') // matches eval('code')
expression(/JSON\.parse/) // matches JSON.parse(str)
```

### `jsxElement(tag)`

Matches JSX elements by tag name. Use this to detect raw HTML elements or specific components inside function/module bodies. This is a **tag-only** matcher — for attribute-level rules, use the [`jsxElements()` entry point](/jsx).

```typescript
import { jsxElement } from '@nielspeter/ts-archunit'

jsxElement('div') // matches <div>...</div> and <div />
jsxElement('Button') // matches <Button>...</Button>
jsxElement(/^motion\./) // matches <motion.div>, <motion.span>, etc.
```

```typescript
// Functions in pages/ must not render raw <div>
functions(p).that().resideInFile('**/pages/**/*.tsx').should().notContain(jsxElement('div')).check()
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

Conditions combine with matchers to form the `.should()` clause of a body analysis rule. They determine whether a matched expression must be present, must be absent, or should be replaced by an alternative.

### `contain(matcher)`

Asserts that every matched class or function must include at least one occurrence of the matched expression in its body. Use this to enforce that certain methods are always called -- for example, requiring that all repositories call `this.validate`.

```typescript
classes(p).that().extend('BaseRepository').should().contain(call('this.validate')).check()
```

### `notContain(matcher)`

Asserts that the matched expression must not appear anywhere in the body. This is the most common body analysis condition -- use it to ban unsafe functions, raw constructors, or direct access to globals that should go through an abstraction.

```typescript
classes(p).that().extend('BaseRepository').should().notContain(call('parseInt')).check()
```

### `useInsteadOf(banned, replacement)`

Combines a ban with a suggested alternative. It asserts the banned expression is absent and includes the replacement in the violation message as guidance. Use this instead of a bare `notContain()` when there is a clear migration path -- it produces more actionable violation messages.

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
} from '@nielspeter/ts-archunit'
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
import { noConsoleLog } from '@nielspeter/ts-archunit/rules/security'

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
import { noEval } from '@nielspeter/ts-archunit/rules/security'

classes(p).should().satisfy(noEval()).because('eval is a security risk').check()
```

### Ban `process.env` in Domain Layer

```typescript
import { noProcessEnv } from '@nielspeter/ts-archunit/rules/security'

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
import { noFunctionConstructor } from '@nielspeter/ts-archunit/rules/security'

classes(p)
  .should()
  .satisfy(noFunctionConstructor())
  .because('new Function() is equivalent to eval')
  .check()
```

### Scoped Body Analysis with `within()`

Check what happens inside callback functions of specific call expressions:

```typescript
import { calls, call, within } from '@nielspeter/ts-archunit'

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
- **`expression()` deduplicates ancestor matches.** Since `expression()` walks all AST descendants, parent nodes whose `getText()` contains the same pattern are automatically filtered out — only the deepest matching node is reported. This prevents inflated violation counts (e.g., one `reply.code(400)` producing 10+ violations from ancestor nodes).
