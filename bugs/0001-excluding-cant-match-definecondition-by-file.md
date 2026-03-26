# BUG-0001: `.excluding()` can't match `defineCondition` violations by file path

**Severity:** High — prevents flipping rules with intentional exceptions to `.check()`
**Found by:** cmless dogfooding (Plan 0214, rule `route/prehandler-required`)
**Date:** 2026-03-26

## Problem

When using `defineCondition` with `createViolation(node, message, context)`, the violation's `element` field is set to the AST node's kind name (e.g., `'CallExpression'`). The `.excluding()` feature matches only against `violation.element`.

This means all violations from a `defineCondition` that creates violations from the same node type are indistinguishable — you can't exclude a specific file or function.

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

Both violations have `element: 'CallExpression'`. There is no way to exclude one without excluding all.

## Expected Behavior

`.excluding()` should match against `violation.file` or `violation.message` in addition to `violation.element`:

```typescript
.excluding(/images\.ts/)          // matches violation.file ✓
.excluding(/missing preHandler/)  // matches violation.message ✓
```

## Suggested Fix

In `src/core/execute-rule.ts` line 40-41:

```typescript
// Current: only matches element
const matchIndex = exclusions.findIndex((pattern) =>
  typeof pattern === 'string' ? v.element === pattern : pattern.test(v.element),
)

// Fix: match against element, file, OR message
const matchIndex = exclusions.findIndex((pattern) => {
  const targets = [v.element, v.file, v.message]
  return typeof pattern === 'string'
    ? targets.some((t) => t === pattern)
    : targets.some((t) => pattern.test(t))
})
```

## Impact

Without this fix, any rule using `defineCondition` with `createViolation` on AST nodes cannot use `.excluding()` to handle intentional exceptions. The rule is stuck at `.warn()` forever even when only 1-2 violations are intentional and the rest should be enforced.

In cmless, this blocks:

- `route/prehandler-required` — 2 intentional exceptions, can't enforce
- `route/schema-required` — 17 intentional exceptions (internal + platform routes), can't enforce the rest
- `route/error-handling` — 2 intentional exceptions (platform routes), can't enforce
- Any future `defineCondition`-based rule with mixed intentional/unintentional violations
