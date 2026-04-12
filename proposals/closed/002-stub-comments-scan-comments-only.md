# Proposal 002 — noStubComments() Should Only Scan Comments

**Status:** Closed — false premise
**Closed:** 2026-04-12
**Reason:** `noStubComments()` already scans only comment ranges via the
`comment()` matcher (`src/helpers/matchers.ts:299-335`), which uses
`node.getLeadingCommentRanges()` / `node.getTrailingCommentRanges()`.
It does NOT scan full body text. The false positives described cannot
occur with the current implementation. If the original reporter hit
real issues, they were on an older version or a different rule.

**Priority:** ~~High~~ N/A
**Affects:** `noStubComments()` in `rules/hygiene`
**Origin:** React/UI project audit — false positives on React props and enum values

## Problem

`noStubComments()` scans the full text of a function body for the regex
pattern. This means identifiers, string literals, template literals, and
JSX prop names all trigger the rule — not just comments.

Examples of false positives from a real codebase:

```tsx
// React prop — "placeholder" is a standard HTML attribute
<input placeholder={`${t('recipient')}...`} />

// Enum value — "stub" is a domain term for an email service mode
{ value: 'stub', label: t('status.stub') }

// JSDoc example — "xxx" is a UUID placeholder in documentation
// { sys: { type: 'Link', id: 'org-xxx' } }

// Variable name — legitimate domain vocabulary
const hasStubEmails = (stats?.stub ?? 0) > 0
```

All of these triggered `noStubComments()` with the default STUB_PATTERNS
because the regex matches anywhere in the function body text, not just
in comment nodes.

## Proposed Fix

Change the implementation to scan only ts-morph comment/JSDoc nodes
within the function body, not the raw source text:

```ts
export function noStubComments(pattern = STUB_PATTERNS) {
  return defineCondition<FunctionDeclaration>(
    `not contain comment matching ${pattern}`,
    (elements, context) => {
      const violations = []
      for (const fn of elements) {
        // Only scan: leading comments, trailing comments,
        // JSDoc, and inline // or /* */ comments
        const comments = fn.getLeadingCommentRanges()
          .concat(fn.getTrailingCommentRanges())
        const jsDocs = fn.getJsDocs?.() ?? []

        for (const comment of [...comments, ...jsDocs]) {
          if (pattern.test(comment.getText())) {
            violations.push(...)
          }
        }
      }
      return violations
    }
  )
}
```

## Workaround

Users can pass a custom regex that drops colliding terms:

```ts
const SAFE_PATTERN = /\b(TODO|FIXME|HACK|STUB|DEFERRED)\b/i
functions(p).should().satisfy(noStubComments(SAFE_PATTERN))
```

A common workaround is dropping `PLACEHOLDER` and `XXX`
from the default pattern. But it doesn't fix the fundamental issue that
identifiers and string literals still match.

## Impact

Without this fix, the rule is unreliable for any codebase that uses
"placeholder", "stub", or "xxx" as legitimate domain vocabulary — which
includes most React/UI projects.
