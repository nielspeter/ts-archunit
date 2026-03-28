# Plan 0036: `property()` Matcher and `haveArgumentContaining` Condition

## Status

- **State:** Done
- **Priority:** P1 — Completes the call inspection + body analysis composition layer
- **Effort:** 0.5 day
- **Created:** 2026-03-28
- **Depends on:** 0034 (Call Argument Property Condition), 0011 (Body Analysis)

## Context

Plan 0034 added `haveArgumentWithProperty` / `notHaveArgumentWithProperty` to check property **names** at the **top level** of call arguments. Two gaps remain:

1. No way to match property **values** (e.g., `additionalProperties: true` vs `false`)
2. No way to search **recursively** through nested object literals in arguments

Motivating use case: restricting `additionalProperties: true` in Fastify JSON Schema definitions, where the property is nested 2-3 levels deep. But the primitives are generic — they serve any "find a property assignment with a specific value anywhere in a call's arguments" pattern.

### Design decision: single-node matchers only

The existing matchers (`call`, `access`, `newExpr`) are all **single-node, self-describing** — one syntax kind, one string/regex check on the node itself. `property()` follows this pattern: it targets `PropertyAssignment` and matches by name/value.

A compound `objectLiteral()` matcher (checking sibling property relationships like "has `type: 'object'` but lacks `properties`") was considered and rejected. It would be a fundamentally different kind of matcher — checking children rather than self, introducing a mini constraint DSL, setting a precedent for `arrayLiteral()` and other shape matchers. That's scope creep toward a general AST query tool. Users needing sibling-property validation can use `defineCondition()` with ts-morph. If the pattern proves common enough, it can be promoted to a built-in in a future plan.

## End-state API

```ts
// Restrict additionalProperties: true in route schemas
calls(proj)
  .that()
  .onObject('app')
  .and()
  .withMethod(/^(get|post|put|patch|delete)$/)
  .should()
  .notHaveArgumentContaining(property('additionalProperties', true))
  .check()

// property() also composes with existing body analysis conditions
functions(proj)
  .that(haveNameMatching(/Schema/))
  .should(functionNotContain(property('strict', false)))
  .check()
```

## Two new primitives

### 1. `property()` ExpressionMatcher (`src/helpers/matchers.ts`)

Follows the `call()` / `access()` / `newExpr()` pattern — implements `ExpressionMatcher` with `syntaxKinds: [SyntaxKind.PropertyAssignment]`.

```ts
property(name: string | RegExp, value?: boolean | number | string | RegExp): ExpressionMatcher
```

Value matching (semantic comparison for primitives, raw text for RegExp):

- `boolean` → check initializer kind is `TrueKeyword` / `FalseKeyword`
- `number` → `Node.isNumericLiteral(init)` then compare `getLiteralValue()`
- `string` → `Node.isStringLiteral(init)` then compare `getLiteralValue()` (strips quotes — `property('type', 'object')` matches `type: 'object'`)
- `RegExp` → regex test on `initializer.getText()` (raw text including quotes — escape hatch for complex patterns)
- omitted → name-only match

Implementation notes:

- **Computed property names:** `PropertyAssignment.getName()` throws on `{ [key]: value }`. Guard with early return when `node.getNameNode().getKind() === SyntaxKind.ComputedPropertyName`.
- **ShorthandPropertyAssignment:** Not matched — different SyntaxKind, no initializer. The existing `haveArgumentWithProperty` handles name-only shorthand checking.
- **Non-literal initializers:** `property('key', true)` does NOT match `{ key: someVariable }` — only literal `TrueKeyword` / `FalseKeyword`. Same principle for string and number: identifier/expression initializers don't match primitive value params.

### 2. `haveArgumentContaining` / `notHaveArgumentContaining` (`src/conditions/call.ts`)

Searches ALL arguments of a call with any `ExpressionMatcher`, using the existing `findMatchesInNode` (which recurses through the entire subtree via `getDescendantsOfKind`).

Parallels `haveCallbackContaining` / `notHaveCallbackContaining` but not limited to function-like args:

- `haveArgumentContaining(matcher)` — passes if ANY argument subtree has a match; one violation per call with no matches
- `notHaveArgumentContaining(matcher)` — one violation per match found in any argument subtree

**Scoping note:** `haveArgumentContaining` searches the entire subtree of every argument — including callback bodies. It is a superset of `haveCallbackContaining`. Use `haveCallbackContaining` when you only want to search function-like arguments. JSDoc must clarify this distinction.

## Files changed

| File                                            | Change                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------- |
| `src/helpers/matchers.ts`                       | Add `property()` function                                                        |
| `src/conditions/call.ts`                        | Add `haveArgumentContaining`, `notHaveArgumentContaining`                        |
| `src/builders/call-rule-builder.ts`             | Add 2 builder methods + import                                                   |
| `src/index.ts`                                  | Export `property`, `callHaveArgumentContaining`, `callNotHaveArgumentContaining` |
| `tests/fixtures/calls/src/nested-properties.ts` | **New** — Fastify-style routes with nested `additionalProperties`                |
| `tests/helpers/matchers-property.test.ts`       | **New** — unit tests for `property()`                                            |
| `tests/conditions/call-args.test.ts`            | Extend — unit tests for the two new conditions                                   |
| `tests/integration/call-entry-point.test.ts`    | Extend — integration tests                                                       |

## Test inventory

**`property()` matcher (unit):**

- matches property by exact name
- rejects non-matching name
- matches name with regex
- matches boolean `true` / rejects `false` when `true` expected
- matches boolean `false` value
- matches numeric value / rejects wrong number
- matches string value via `getLiteralValue()` (no quotes in user input)
- matches regex value against `getText()` (raw text including quotes)
- rejects non-matching regex
- name-only matches regardless of value
- does not match ShorthandPropertyAssignment
- does not match identifier-valued initializers (`{ key: someVar }` with boolean value param)
- skips computed property names without throwing
- has correct syntaxKinds and description

**`haveArgumentContaining` / `notHaveArgumentContaining` (unit):**

- passes/fails for top-level property match
- finds deeply nested property (3 levels)
- value discrimination (true vs false)
- works with any ExpressionMatcher (e.g., `call()`)
- one violation per match for `notHaveArgumentContaining`
- violation messages include matcher description and line number

**Integration:**

- Full `calls(p).that().onObject('app')...should().notHaveArgumentContaining(property(...)).check()` chain against fixture
- `property()` composes with `functionNotContain` for function body analysis

## Out of scope

- **`objectLiteral()` compound matcher** — sibling property relationships (e.g., `type: 'object'` without `properties`). Different matcher category (checks children, not self). Defer to `defineCondition()` for now; promote if pattern proves common.
- Dotted path syntax (`property('schema.body.additionalProperties')`) — recursive `findMatchesInNode` already handles nesting
- Negated value matching — use `notHaveArgumentContaining(property('x', true))` instead
- Array element matching, computed property names, spread assignments

## Verification

```bash
npm run test          # all tests pass
npm run typecheck     # no type errors
npm run lint          # clean
```
