# Plan 0034: Call Argument Property Condition

## Status

- **State:** Done
- **Priority:** P2 — Completes the call inspection condition layer
- **Effort:** 0.5 day
- **Created:** 2026-03-27
- **Depends on:** 0014 (Call Entry Point)

## Broader Context

Part of the **call inspection** capability layer. The `calls()` entry point already has predicates (`onObject`, `withMethod`, `withArgMatching`, `withStringArg`) and conditions (`haveCallbackContaining`, `notHaveCallbackContaining`, `notExist`). But there's no way to inspect **properties of object literal arguments**. This is the last common call inspection pattern that requires custom `defineCondition`.

**Resolves:** bug 0006 (call argument property checking).

## Problem

Checking that call expression arguments include specific object literal properties requires ~40 lines of manual AST traversal. The `calls()` entry point can match which calls to inspect (`onObject('app').withMethod('get')`), but cannot inspect the shape of their arguments.

```typescript
// Today: 40 lines of manual AST walking per property
// Wanted:
calls(p)
  .that()
  .onObject('app')
  .and()
  .withMethod(/^(get|post|put|delete)$/)
  .should()
  .haveArgumentWithProperty('schema')
  .check()
```

## Design Decisions

### 1. Two generic conditions on `ArchCall`

- `haveArgumentWithProperty(...names)` — at least one object literal argument has ALL named properties. Violation per call missing any property.
- `notHaveArgumentWithProperty(...names)` — no object literal argument has ANY of the named properties. Violation per call per forbidden property found.

These are the call-layer equivalents of 0030's `havePropertyNamed` / `notHavePropertyNamed` — same Lego brick shape, different domain.

### 2. Scan all arguments, not just a specific index

The condition scans all arguments of the call for object literal expressions. This matches how frameworks work — the options object can be at any argument position (Fastify puts it at index 1, Express at index 2, etc.). Users don't need to know the position.

### 3. Object literal inspection via ts-morph

`ArchCall.getArguments()` returns `Node[]`. For each argument:

- Check if `Node.isObjectLiteralExpression(arg)`
- If yes, use `arg.getProperties()` to get property assignments
- Check property names via `Node.isPropertyAssignment(prop)` then `prop.getName()`
- Also handle `Node.isShorthandPropertyAssignment(prop)` for `{ schema }` shorthand

### 4. Variadic names with AND/NOR semantics

Same pattern as 0030:

- `haveArgumentWithProperty('schema', 'preHandler')` → at least one argument has BOTH
- `notHaveArgumentWithProperty('schema')` → no argument has `schema`

## Phase 1: Condition Factories

### `src/conditions/call.ts` — add to existing file

**`haveArgumentWithProperty(...names: string[])`**

- Scans all arguments for object literal expressions
- Passes if at least one object literal has ALL named properties
- Violation message: `"{callName} has no argument with properties {names}"`
- Throws if called with zero names

**`notHaveArgumentWithProperty(...names: string[])`**

- Scans all arguments for object literal expressions
- Reports violation for each forbidden property found in any argument
- Violation message: `"{callName} argument has forbidden property "{propName}""`
- Throws if called with zero names

## Phase 2: Wire Into Builder

### `src/builders/call-rule-builder.ts`

```
haveArgumentWithProperty(...names: string[]): this
notHaveArgumentWithProperty(...names: string[]): this
```

## Phase 3: Exports

### `src/index.ts`

Export from `conditions/call.js`.

## Phase 4: Fixtures

### `tests/fixtures/calls/src/` — extend existing call fixtures

Add a file with framework-style call expressions:

```typescript
declare const app: { get: Function; post: Function }

app.get('/users', {
  schema: { response: {} },
  preHandler: [authenticate],
})

app.post('/orders', {
  schema: { body: {} },
  // missing preHandler
})

app.get('/health', (req, res) => {
  // no options object at all
})
```

## Files Changed

| File                                        | Change                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| `src/conditions/call.ts`                    | Modified — add `haveArgumentWithProperty`, `notHaveArgumentWithProperty` |
| `src/builders/call-rule-builder.ts`         | Modified — add 2 condition methods                                       |
| `src/index.ts`                              | Modified — export 2 new conditions                                       |
| `tests/fixtures/calls/src/route-options.ts` | **New** — call expressions with object literal arguments                 |
| `tests/conditions/call-args.test.ts`        | **New** — unit tests                                                     |
| `tests/integration/call-rules.test.ts`      | Modified — add integration tests                                         |

## Test Inventory

### Unit tests

**haveArgumentWithProperty:**

1. **passes when argument has all named properties** — `app.get('/users', { schema, preHandler })` has both
2. **fails when argument missing a property** — `app.post('/orders', { schema })` missing `preHandler`
3. **fails when no object literal argument** — `app.get('/health', callback)` has no object arg
4. **works with single name** — check for just `schema`
5. **handles shorthand properties** — `{ schema }` shorthand assignment
6. **throws on zero arguments** — `haveArgumentWithProperty()` throws

**notHaveArgumentWithProperty:** 7. **passes when no argument has forbidden property** — call with no matching props 8. **reports violation per forbidden property found** — call with `deprecated` property 9. **throws on zero arguments**

### Integration tests

10. **calls(p).that().onObject('app').and().withMethod(/get|post/).should().haveArgumentWithProperty('schema').check()** — Fastify schema enforcement
11. **calls(p).that().onObject('app').should().haveArgumentWithProperty('schema', 'preHandler').check()** — multiple required properties
12. **Compose with withStringArg: calls(p).that().onObject('app').and().withStringArg(0, '/api/**').should().haveArgumentWithProperty('schema').check()\*\* — only API routes need schema

## Out of Scope

- **Argument property type checking** — Asserting that `schema` has a specific type/shape. Too deep for v1. Users can use `defineCondition` for deep argument inspection.
- **Nested property checking** — `haveArgumentWithProperty('schema.response')`. Niche. Defer.
- **Non-object arguments** — This plan only inspects object literal arguments. Array or primitive arguments are not checked (they can't have named properties).
- **Spread arguments** — `app.get('/users', ...opts)` — spread arguments are not object literals. Out of scope.
