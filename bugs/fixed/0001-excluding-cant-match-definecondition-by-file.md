# BUG-0001: `.excluding()` can't match `defineCondition` violations by file path

**Severity:** High — prevents flipping rules with intentional exceptions to `.check()`
**Found by:** cmless dogfooding (Plan 0214, rule `route/prehandler-required`)
**Date:** 2026-03-26
**Status:** Fixed 2026-03-26
**Fix:** `src/core/execute-rule.ts` — `.excluding()` now matches against `element`, `file`, and `message`
**Tests:** `tests/core/excluding-matching.test.ts` (11 tests)

## Problem

When using `defineCondition` with `createViolation(node, message, context)`, the violation's `element` field is set to the AST node's kind name (e.g., `'CallExpression'`). The `.excluding()` feature matched only against `violation.element`.

This meant all violations from a `defineCondition` that creates violations from the same node type were indistinguishable — you couldn't exclude a specific file or function.

## Reproduction

```typescript
function routeRegistrationMustHave(propertyName: string) {
  return defineCondition('...', (fns, context) => {
    // ...
    violations.push(
      createViolation(
        node, // ← a CallExpression node
        `${expr}(${path}) missing ${propertyName}`,
        context,
      ),
    )
  })
}

// This rule finds 2 violations, both intentional:
// - images.ts:128 — hash-based auth (no preHandler needed)
// - platform/index.ts:56 — parent hook applies auth to children

functions(p)
  .should()
  .satisfy(routeRegistrationMustHave('preHandler'))
  .excluding('imagesRoutes') // ❌ element is 'CallExpression', not 'imagesRoutes'
  .excluding(/images\.ts/) // ❌ element is 'CallExpression', not a file path
  .excluding('CallExpression') // ❌ excludes ALL violations
  .check()
```

Both violations had `element: 'CallExpression'`. There was no way to exclude one without excluding all.

## Fix

In `src/core/execute-rule.ts`, `.excluding()` now matches against `[v.element, v.file, v.message]` instead of just `v.element`:

```typescript
// Before: only matches element
const matchIndex = exclusions.findIndex((pattern) =>
  typeof pattern === 'string' ? v.element === pattern : pattern.test(v.element),
)

// After: match against element, file, OR message
const targets = [v.element, v.file, v.message]
const matchIndex = exclusions.findIndex((pattern) =>
  typeof pattern === 'string'
    ? targets.some((t) => t === pattern)
    : targets.some((t) => pattern.test(t)),
)
```

Now works:

```typescript
.excluding(/images\.ts/)          // matches violation.file ✓
.excluding(/missing preHandler/)  // matches violation.message ✓
```

## Impact

Unblocks in cmless:

- `route/prehandler-required` — 2 intentional exceptions, now enforceable
- `route/schema-required` — 17 intentional exceptions, now enforceable
- `route/error-handling` — 2 intentional exceptions, now enforceable
- Any `defineCondition`-based rule with mixed intentional/unintentional violations
