# Plan 0037: `expression()` Matcher Ancestor Deduplication

## Status

- **State:** Done
- **Priority:** P0 — Bug fix, violation counts are misleading
- **Effort:** 0.25 day
- **Created:** 2026-03-28
- **Depends on:** 0011 (Body Analysis)

## Problem

The `expression()` matcher reports violations for **every ancestor node** whose `getText()` contains the pattern. A single `reply.code(400).send({})` generates 10+ violations because the ExpressionStatement, CallExpression (send), PropertyAccessExpression, and other ancestors all have `getText()` that includes `reply.code(400)`.

This makes violation counts misleading — a user reported "189 violations" for 13 actual occurrences.

The other matchers (`call`, `access`, `newExpr`, `property`) don't have this issue because they specify `syntaxKinds`, which limits traversal to specific node types via `getDescendantsOfKind()`.

### Root cause

In `src/helpers/body-traversal.ts`, `findMatchesInNode` has two paths:

1. **With `syntaxKinds`** — uses `getDescendantsOfKind()`, only tests specific node types. No ancestor duplication.
2. **Without `syntaxKinds`** — uses `getDescendants()`, tests every node. Parent nodes' `getText()` includes children's text, so regex patterns match at multiple levels.

`expression()` takes the second path because it has no `syntaxKinds`.

## Design

### Approach: deduplicate by containment

After collecting all matches in the broad traversal path, filter out any node that is an **ancestor of another match**. Keep only the deepest (most specific) matching nodes.

This is a post-filter in `findMatchesInNode`, not a change to `expression()` itself — so any future matcher without `syntaxKinds` also gets deduplication.

```ts
// In findMatchesInNode, after the broad traversal:
if (!matcher.syntaxKinds || matcher.syntaxKinds.length === 0) {
  // Deduplicate: remove ancestors of other matches using positional ranges.
  // A node is an ancestor if another match's range is strictly contained within it.
  // ts-morph has no containsDescendant() — use getStart()/getEnd() ranges instead.
  return matches.filter(
    (node) =>
      !matches.some(
        (other) =>
          other !== node && other.getStart() >= node.getStart() && other.getEnd() <= node.getEnd(),
      ),
  )
}
```

Performance note: this is O(n^2) where n is the number of matched nodes in a single function body. Since `expression()` is already the slow path (walks all descendants) and n is bounded by function-body size (not project size), this is acceptable. For typical usage (a handful of matches per body), the overhead is negligible.

### Why not deduplicate by source line?

Line-based dedup would hide legitimate distinct violations on the same line (e.g., `foo(); bar()` where both match). Containment-based dedup is semantically correct — it removes ancestors, not siblings.

### Alternative considered: add syntaxKinds to expression()

Rejected. `expression()` is intentionally the "match anything" escape hatch. Adding syntaxKinds would limit what it can match (e.g., type annotations, decorators, object literal keys).

### CHANGELOG note

This fix changes observable violation counts — `expression()` rules will report fewer violations (e.g., 189 → 13 for a real-world case). Users with baseline files, snapshot tests, or threshold assertions must update their expected counts. Document as a "Fixed" item with migration guidance.

## Files changed

| File                             | Change                                                       |
| -------------------------------- | ------------------------------------------------------------ |
| `src/helpers/body-traversal.ts`  | Add ancestor dedup filter after broad traversal              |
| `tests/helpers/matchers.test.ts` | Add test: expression() on nested code produces one violation |
| `tests/helpers/matchers.test.ts` | Add test: two sibling matches on same line both reported     |

## Test inventory

- `expression()` on `reply.code(400).send({})` produces exactly 1 match (not 10+)
- `expression()` on `foo(); bar()` where both match produces 2 matches (siblings preserved)
- Existing `expression()` tests still pass (no behavior change for leaf-only matches)
- `call()`, `access()`, `newExpr()`, `property()` tests unaffected

## Out of scope

- Changing the `expression()` matcher itself — it remains the broad escape hatch
- Adding `syntaxKinds` to `expression()` — would limit its reach

## Verification

```bash
npm run test
npm run typecheck
npm run lint
```
