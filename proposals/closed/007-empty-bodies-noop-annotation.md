# Proposal 007 — noEmptyBodies() Noop Annotation

**Status:** Closed — use existing block-level exclusion comments
**Closed:** 2026-04-12
**Reason:** A rule-specific `/* noop */` annotation only solves one rule.
Block-level suppression already exists in `src/core/exclusion-comments.ts`:

```
// ts-archunit-exclude-start hygiene/no-empty-bodies: browser API mock stubs
class MockIntersectionObserver {
  observe(): void {}
  unobserve(): void {}
}
// ts-archunit-exclude-end
```

This handles the motivating case (test mocks with empty bodies) with no
new API. Proposal 009 was also closed — the mechanism it proposed already
existed.

**Priority:** ~~Low~~ Deferred
**Affects:** `noEmptyBodies()` in `rules/hygiene`
**Origin:** Test mocks for browser APIs need intentionally empty method bodies

## Problem

Test mocks for browser APIs legitimately need empty method bodies. The
jsdom environment doesn't provide `IntersectionObserver`, so tests create
a mock class with no-op methods:

```ts
class MockIntersectionObserver {
  observe(): void {
    /* noop */
  }
  unobserve(): void {
    /* noop */
  }
  disconnect(): void {
    /* noop */
  }
}
```

`noEmptyBodies()` flags these because the bodies contain only a comment,
not a statement. The `/* noop */` comment is invisible to the AST.

## Current Workaround

Add a `return` statement:

```ts
observe(): void {
  return
}
```

This satisfies the rule but is semantically misleading — `return` in a
void function implies "early exit" rather than "intentionally does
nothing."

## Proposed Fix

Recognize a `// noop` or `/* noop */` annotation as an intentional empty
body:

```ts
export function noEmptyBodies(options?: { allowNoopComment?: boolean }) {
  // ...
  if (options?.allowNoopComment !== false) {
    const bodyText = body.getFullText().trim()
    if (/\/[/*]\s*noop\s*(\*\/)?$/.test(bodyText)) {
      continue // intentionally empty
    }
  }
}
```

Default: `allowNoopComment: true` — a `/* noop */` or `// noop` comment
in an otherwise-empty body is accepted.

## Alternative

An `@ts-archunit-ignore` annotation that works for any rule, not just
this one. But that's a broader feature (see inline suppression patterns
in ESLint).
