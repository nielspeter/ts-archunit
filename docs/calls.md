# Call Rules

The `calls()` entry point operates on call expressions across all source files. Use it to enforce rules about what happens inside callback arguments -- particularly framework-agnostic route/handler matching for Express, Fastify, or any callback-based registration pattern.

## When to Use

- Ensure every route handler calls `authenticate()` or `handleError()`
- Ban direct `db.query()` inside route callbacks
- Scope function rules to specific call sites with `within()`
- Select routes by path pattern and enforce conventions on their handlers

## ArchCall

ts-archunit scans every `CallExpression` in the project and wraps it in an `ArchCall` model with precomputed fields:

| Method            | Returns               | Example for `app.get('/users', handler)` |
| ----------------- | --------------------- | ---------------------------------------- |
| `getName()`       | `string \| undefined` | `"app.get"`                              |
| `getObjectName()` | `string \| undefined` | `"app"`                                  |
| `getMethodName()` | `string \| undefined` | `"get"`                                  |
| `getArguments()`  | `Node[]`              | `['/users', handler]`                    |
| `getSourceFile()` | `SourceFile`          | the containing file                      |
| `getNode()`       | `CallExpression`      | underlying ts-morph node                 |

For bare calls like `handleError(...)`, `getObjectName()` returns `undefined` and `getMethodName()` returns `"handleError"`.

## Basic Usage

```typescript
import { project, calls, call } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')

// All Express route handlers must call handleError()
calls(p)
  .that()
  .onObject('app')
  .and()
  .withMethod(/^(get|post|put|delete|patch)$/)
  .should()
  .haveCallbackContaining(call('handleError'))
  .because('unhandled errors crash the server')
  .check()
```

## Call Predicates

Predicates filter which call expressions the rule applies to. Chain them with `.and()`.

### `onObject(name)`

Matches calls on the named object. For `app.get(...)`, `onObject('app')` matches. Supports nested objects: `onObject('router.route')` matches `router.route.get(...)`.

```typescript
calls(p).that().onObject('app')
calls(p).that().onObject('router')
calls(p).that().onObject('fastify')
```

### `withMethod(nameOrRegex)`

Matches by method name. Accepts an exact string or regex.

```typescript
calls(p).that().withMethod('get')
calls(p)
  .that()
  .withMethod(/^(get|post|put|delete|patch)$/)
```

For bare calls like `handleError(...)`, the method name is the function name itself.

### `withArgMatching(index, pattern)`

Matches calls where the argument at the given zero-based index matches a regex or exact string. The pattern is matched against the argument's full text representation.

```typescript
// Match calls whose first argument contains "admin"
calls(p).that().withArgMatching(0, /admin/)
```

### `withStringArg(index, glob)`

Matches calls where the argument at the given index is a string literal matching a glob pattern. Only matches actual string literals -- variable references are skipped.

```typescript
// Match: router.get('/api/users', handler)
// Match: router.get('/api/users/:id', handler)
// No match: router.get(pathVariable, handler)
calls(p).that().withStringArg(0, '/api/users/**')
```

## Call Conditions

Conditions assert what should (or should not) happen inside the matched calls -- either in callback arguments or in the call's own arguments.

### `haveCallbackContaining(matcher)`

At least one callback argument must contain the matched expression. Searches all arrow functions and function expressions passed as arguments.

```typescript
calls(p)
  .that()
  .onObject('app')
  .and()
  .withMethod('get')
  .should()
  .haveCallbackContaining(call('authenticate'))
  .check()
```

### `notHaveCallbackContaining(matcher)`

No callback argument may contain the matched expression.

```typescript
calls(p)
  .that()
  .onObject('app')
  .and()
  .withMethod(/^(get|post|put|delete|patch)$/)
  .should()
  .notHaveCallbackContaining(call('db.query'))
  .because('use repository methods instead')
  .check()
```

### `haveArgumentWithProperty(...names)`

At least one object literal argument must have ALL of the named properties. Scans all arguments at every position.

```typescript
calls(p)
  .that()
  .onObject('app')
  .and()
  .withMethod(/^(get|post|put|delete|patch)$/)
  .should()
  .haveArgumentWithProperty('schema')
  .because('all route registrations must declare a validation schema')
  .check()
```

Multiple names require all to be present in the same argument:

```typescript
calls(p)
  .that()
  .onObject('app')
  .and()
  .withMethod(/^(get|post|put|delete|patch)$/)
  .should()
  .haveArgumentWithProperty('schema', 'preHandler')
  .because('routes need both schema validation and authentication')
  .check()
```

### `notHaveArgumentWithProperty(...names)`

No object literal argument may have ANY of the named properties. Reports a violation per forbidden property found.

```typescript
calls(p)
  .that()
  .onObject('app')
  .and()
  .withMethod(/^(get|post|put|delete|patch)$/)
  .should()
  .notHaveArgumentWithProperty('deprecated')
  .because('do not register deprecated routes')
  .check()
```

### `notExist()`

The filtered call set must be empty -- no calls should match the predicates.

```typescript
calls(p)
  .that()
  .onObject('legacy')
  .should()
  .notExist()
  .because('the legacy module is being phased out')
  .check()
```

## Integration with `within()`

Use `within()` to scope function-level rules to callback arguments of matched calls. Instead of scanning all source files, scoped entry points only examine inline callback functions.

```typescript
import { calls, call, within } from '@nielspeter/ts-archunit'

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

See [Function Rules](/functions#scoped-rules-with-within) for more on `within()`.

## Real-World Examples

### Express Route Error Handling

```typescript
calls(p)
  .that()
  .onObject('app')
  .and()
  .withMethod(/^(get|post|put|delete|patch)$/)
  .should()
  .haveCallbackContaining(call('handleError'))
  .rule({
    id: 'express/error-handling',
    because: 'Unhandled errors in route handlers crash the server',
    suggestion: 'Wrap handler logic with handleError(res, async () => { ... })',
  })
  .check()
```

### Fastify Handler Authentication

```typescript
calls(p)
  .that()
  .onObject('fastify')
  .and()
  .withMethod(/^(get|post|put|delete|patch)$/)
  .and()
  .withStringArg(0, '/api/**')
  .should()
  .haveCallbackContaining(call('request.authenticate'))
  .because('all API routes must authenticate the request')
  .check()
```

### No Direct Database Access in Routes

```typescript
calls(p)
  .that()
  .onObject('router')
  .and()
  .withMethod(/^(get|post|put|delete|patch)$/)
  .should()
  .notHaveCallbackContaining(call('db.query'))
  .rule({
    id: 'route/no-direct-db',
    because: 'Routes must use repository methods for database access',
    suggestion: 'Inject and call a repository instead of db.query()',
  })
  .check()
```

### Middleware Registration Conventions

```typescript
// Every middleware registration must call next()
calls(p)
  .that()
  .onObject('app')
  .and()
  .withMethod('use')
  .should()
  .haveCallbackContaining(call('next'))
  .because('middleware that never calls next() blocks the request pipeline')
  .check()
```

### Fastify Route Schema Enforcement

```typescript
calls(p)
  .that()
  .onObject('fastify')
  .and()
  .withMethod(/^(get|post|put|delete|patch)$/)
  .and()
  .withStringArg(0, '/api/**')
  .should()
  .haveArgumentWithProperty('schema')
  .rule({
    id: 'fastify/schema-required',
    because: 'API routes must declare a validation schema for type-safe request handling',
    suggestion: 'Add a schema object with response/body/params definitions',
  })
  .check()
```

### Scoped Body Analysis Inside Route Handlers

```typescript
const routes = calls(p)
  .that()
  .onObject('app')
  .and()
  .withMethod(/^(get|post|put|delete|patch)$/)

// Route handlers must not use console.log
within(routes)
  .functions()
  .should()
  .notContain(call('console.log'))
  .because('use a structured logger instead')
  .check()
```
