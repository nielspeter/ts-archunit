# Call Rules

::: tip Rule file or test file?
Snippets on this page end in `.check()` (the **test-file** form). In a [CLI rule file](/cli) (`arch.rules.ts`), **drop `.check()`** and spread the bare builder into `export default [...]` — a `.check()` inside a rule-file array is [silently skipped](/running-in-tests#converting-between-the-two-forms). Use `.asSeverity('warn')` for warnings.
:::

The `calls()` entry point operates on call expressions across all source files. Use it to enforce rules about what happens inside callback arguments -- particularly framework-agnostic route/handler matching for Express, Fastify, or any callback-based registration pattern.

## When to Use

- Ensure every route handler calls `authenticate()` or `handleError()`
- Ban direct `db.query()` inside route callbacks
- Scope function rules to specific call sites with `within()`
- Select routes by path pattern and enforce conventions on their handlers

## ArchCall

ts-archunit scans every `CallExpression` in the project and wraps it in an `ArchCall` model with precomputed fields. This model gives you uniform access to the call's target object, method name, and arguments regardless of whether the call is a method invocation like `app.get(...)` or a bare function call like `handleError(...)`.

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

Predicates narrow down the set of call expressions your rule targets. Without predicates, a rule applies to every call in the project; with them, you select only the calls that matter -- for example, only HTTP route registrations on a specific object. Chain multiple predicates with `.and()`.

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

## Identity enrichment

### `identifiedByArg(index)`

Folds the indexed argument's source text into the violation `element` and `message`, so identity-keyed registrations can be excluded individually rather than only by file.

By default, `calls()` violations name the callee — `app.post`, `bus.on`, `flags.define`. When many things register through the same call, every violation collapses to the same name and `.excluding()` can only operate at file granularity. `.identifiedByArg(index)` folds a chosen string-literal argument into the element name so you can exclude individual registrations:

```typescript
// Without .identifiedByArg(0) — every violation is "app.post"
// With it — "app.post(\"/auth/token\")", "app.post(\"/oidc/authorize\")", etc.
calls(p)
  .that()
  .onObject('app')
  .withMethod(/^(get|post|put|patch|delete)$/)
  .identifiedByArg(0)
  .should()
  .haveArgumentWithProperty('preHandler')
  .excluding(/"\/auth\/(login|register)"/, 'app.get("/.well-known/openid-configuration")')
  .check()
```

The same shape applies to any string-keyed registration:

| Pattern                | Call                                      | Identity needed  |
| ---------------------- | ----------------------------------------- | ---------------- |
| HTTP routes            | `app.post("/auth/token", handler)`        | the path         |
| Test discovery         | `describe("auth", () => ...)`             | the suite name   |
| Event/PubSub           | `bus.on("user.created", handler)`         | the event name   |
| Command/message router | `router.handle("createOrder", handler)`   | the command name |
| Validator registry     | `registry.register("email", validator)`   | the type key     |
| Feature flags          | `flags.define("new-checkout", true)`      | the flag key     |
| DI container           | `container.register("UserRepo", impl)`    | the token        |
| DB migrations          | `migrator.register("0042_add_users", fn)` | the migration id |

**Graceful degrade.** If the indexed argument isn't a `StringLiteral` or no-substitution template literal, the element name stays bare. Dynamic registrations (`app.post(buildPath(), h)`, `app.post(ROUTES.AUTH, h)`, ``app.post(`/auth/${env}`, h)``, `app.post('/foo' as const, h)`) all degrade to `app.post`.

**Identity scope — predicates see the bare callee.** This method affects violation output and `.excluding()` matching only. Predicates that read `archCall.getName()` continue to see the bare name:

```typescript
// ❌ Silent zero-match — predicate sees bare "app.post", regex never hits
calls(p)
  .that().haveNameMatching(/app\.post\("\/auth/)
  .identifiedByArg(0)
  .should()...

// ✅ Filter with withStringArg, then enrich identity for output
calls(p)
  .that()
  .onObject('app').withMethod(/^(get|post)$/)
  .withStringArg(0, '/auth/**')   // ← filter by arg
  .identifiedByArg(0)              // ← name violations by arg
  .should()...
```

**Long literals.** The `element` field always preserves the literal verbatim (exclusion patterns need stable keys). The rendered violation `message` elides the middle of literals longer than 80 characters with `…` so CI output stays scannable.

See proposal 011 / plan 0057 for the full design and edge-case behavior.

## Call Conditions

Conditions define the assertions enforced on calls that pass the predicate filter. They let you verify what happens inside callback arguments (e.g., every route handler must call `authenticate()`) or inspect the structure of non-callback arguments (e.g., every route must pass a schema object). If any matched call violates the condition, the rule reports it.

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

### `haveArgumentContaining(matcher)`

At least one argument subtree must contain the matched expression. Searches all arguments recursively at any depth -- object literals, nested objects, callbacks, and any other expression.

This is a superset of `haveCallbackContaining`. Use `haveCallbackContaining` when you only want to search callback (function-like) arguments.

```typescript
calls(p)
  .that()
  .onObject('app')
  .and()
  .withMethod(/^(get|post|put|delete|patch)$/)
  .should()
  .haveArgumentContaining(property('type', 'object'))
  .because('all route schemas must declare their type')
  .check()
```

### `notHaveArgumentContaining(matcher)`

No argument subtree may contain the matched expression. Reports one violation per match found at any depth.

```typescript
import { calls, property } from '@nielspeter/ts-archunit'

calls(p)
  .that()
  .onObject('app')
  .and()
  .withMethod(/^(get|post|put|delete|patch)$/)
  .should()
  .notHaveArgumentContaining(property('additionalProperties', true))
  .because('additionalProperties: true defeats schema validation')
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

`within()` also extracts callbacks from **object literal arguments** — arrow functions, function expressions, and method shorthands inside properties like `{ handler: (req) => { ... } }`. Nested objects are searched up to 3 levels deep.

```typescript
// Fastify-style: callback inside options object
app.post('/users', {
  schema: { body: { type: 'object' } },
  handler: async (req) => {
    validateInput(req)
  },
})

// within() extracts the handler callback for body analysis
within(routes).functions().should().contain(call('validateInput')).check()
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
