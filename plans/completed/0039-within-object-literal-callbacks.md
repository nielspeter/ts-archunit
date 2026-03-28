# Plan 0039: `within()` Object Literal Callback Extraction

## Status

- **State:** Done
- **Priority:** P2 — Extends scoped analysis to framework config patterns
- **Effort:** 0.5 day
- **Created:** 2026-03-28
- **Depends on:** 0015 (Named Selections, within() & Scoped Rules)

## Problem

`within()` only extracts callbacks from **direct inline function arguments**:

```ts
// ✅ Works — callback is a direct argument
app.post('/users', (req, res) => { ... })

// ❌ Not extracted — callback is a property inside an object argument
app.post('/users', {
  schema: { ... },
  handler: async (req, res) => { validateInput(req) },
})
```

The `extractCallbacks()` function in `src/helpers/callback-extractor.ts` checks each argument for `ArrowFunction` or `FunctionExpression` kind. If the argument is an `ObjectLiteralExpression`, it's skipped entirely — even though it may contain function-valued properties.

This pattern is used by frameworks that accept options objects with callback properties: Fastify (handler/preHandler/onRequest), Yargs/Commander (command handler objects), and some GraphQL resolver patterns. Note: Express and Hono primarily use direct inline callbacks, not object-literal-with-handler patterns.

### Plan 0015 scope note

Plan 0015 explicitly documented this as a v1 limitation: "within() extracts inline function arguments only. Reference resolution is out of scope." This plan addresses the object-literal case without adding reference resolution.

## Design

### Extend `extractCallbacks()` to search object literal arguments

When an argument is an `ObjectLiteralExpression`, search its property values for function-like nodes: `ArrowFunction`, `FunctionExpression`, and `MethodDeclaration` (object method shorthand).

Recursion is capped at **3 levels** of object nesting to prevent extracting unintended callbacks from deep config structures (e.g., a `() => ({})` default value function inside a schema definition).

```ts
function extractInlineFunction(
  arg: Node,
  callSite: CallExpression,
  argIndex: number,
): ExtractedCallback | null {
  // Existing: direct arrow/function expression
  if (Node.isArrowFunction(arg)) {
    /* ... */
  }
  if (Node.isFunctionExpression(arg)) {
    /* ... */
  }
  return null
}

const MAX_OBJECT_DEPTH = 3

// New: search object literal properties for function-like values
function extractFromObjectLiteral(
  arg: Node,
  callSite: CallExpression,
  argIndex: number,
  depth: number = 0,
): ExtractedCallback[] {
  if (!Node.isObjectLiteralExpression(arg)) return []
  if (depth >= MAX_OBJECT_DEPTH) return []
  const results: ExtractedCallback[] = []
  for (const prop of arg.getProperties()) {
    // Method shorthand: { handler(req, res) { ... } }
    if (Node.isMethodDeclaration(prop)) {
      results.push(/* wrap as ArchFunction */)
      continue
    }
    if (!Node.isPropertyAssignment(prop)) continue
    const init = prop.getInitializer()
    if (!init) continue
    // Direct function property
    const direct = extractInlineFunction(init, callSite, argIndex)
    if (direct) {
      results.push(direct)
      continue
    }
    // Recurse into nested object literals (depth-limited)
    results.push(...extractFromObjectLiteral(init, callSite, argIndex, depth + 1))
  }
  return results
}
```

### What this enables

```ts
const routes = calls(p)
  .that()
  .onObject('app')
  .and()
  .withMethod(/^(get|post|put|delete|patch)$/)

// Now works for { handler: (req, res) => { ... } } pattern
within(routes).functions().should().contain(call('validateInput')).check()
```

### What this does NOT enable

- Following named references (`app.post('/path', myHandler)`) — requires type-checker resolution, out of scope
- Extracting from array arguments (`[middleware1, middleware2]`) — different pattern, defer
- Callbacks deeper than 3 levels of object nesting — capped to prevent false positives from schema defaults and config literals

## Files changed

| File                                       | Change                                                                |
| ------------------------------------------ | --------------------------------------------------------------------- |
| `src/helpers/callback-extractor.ts`        | Add `extractFromObjectLiteral()`, integrate into `extractCallbacks()` |
| `tests/helpers/callback-extractor.test.ts` | Add tests for object literal extraction                               |
| `tests/fixtures/calls/src/`                | Add fixture with object-literal callback patterns                     |
| `tests/integration/within.test.ts`         | Integration test with `within()` on object callbacks                  |
| `docs/calls.md`                            | Update within() docs to mention object literal support                |

## Test inventory

- Direct inline callbacks still extracted (no regression)
- Arrow function in object property extracted: `{ handler: (req) => { ... } }`
- Function expression in object property extracted: `{ handler: function(req) { ... } }`
- Method shorthand extracted: `{ handler(req) { ... } }`
- Nested object with function property extracted: `{ hooks: { onRequest: (req) => { ... } } }`
- Non-function properties ignored: `{ schema: { type: 'object' } }` produces no callbacks
- Depth limit respected: callback at depth 4 NOT extracted
- Deep schema default `{ schema: { response: { 200: { default: () => ({}) } } } }` NOT extracted (depth > 3)
- Multiple function properties in same object all extracted
- `within()` integration: scoped body analysis works on extracted object-literal callbacks
- Existing `within()` tests pass unchanged

## Out of scope

- Named reference resolution (`app.post('/path', myHandler)`) — requires type-checker
- Array argument extraction (`[middleware1, middleware2]`)
- Configurable depth limit — hardcoded at 3, sufficient for all known framework patterns
- Spread properties (`{ ...baseConfig, handler: ... }`) — spread is opaque, skip

## Verification

```bash
npm run test
npm run typecheck
npm run lint
```
