# Proposal 009 — General Inline Suppression Mechanism

**Status:** Closed — already implemented
**Closed:** 2026-04-12
**Reason:** Block-level suppression already exists in `src/core/exclusion-comments.ts`.
The existing directives cover every case this proposal describes:

- `// ts-archunit-exclude <rule-id>: <reason>` — single-line (next line)
- `// ts-archunit-exclude-start <rule-id>: <reason>` + `// ts-archunit-exclude-end` — block range
- Multi-rule: `// ts-archunit-exclude rule-a, rule-b: <reason>`
- Stale detection: unclosed blocks and unused exclusions produce warnings

The proposal's `disable`/`enable`/`disable-next` map directly to the existing
`exclude-start`/`exclude-end`/`exclude` directives. Shipping parallel syntax
would confuse users. If "exclude next AST element" semantics are needed (covering
the entire next function/class regardless of line count), add
`// ts-archunit-exclude-next <rule-id>: <reason>` as a third mode to the existing
parser — that's a small enhancement, not a new proposal.

**Priority:** ~~Medium~~ N/A
**Affects:** All rules
**Supersedes:** Proposal 007 (noEmptyBodies noop annotation)

## Problem

Some architectural violations are intentional and justified at the call
site. Currently ts-archunit supports two exclusion mechanisms:

1. `.excluding(pattern)` — test-author-level, matches against violation
   element/file/message, with stale-detection.
2. `// ts-archunit-exclude: <rule-id>` — already shipped for line-level
   exclusion (`src/core/exclusion-comments.ts`).

However, there are cases where a code author wants to annotate a
**block** as intentionally exempt — not just a single line. Examples:

- Test mocks with intentionally empty method bodies (the Proposal 007
  motivating case — `IntersectionObserver` stubs, event handler mocks).
- Generated code sections that legitimately violate naming conventions.
- Adapter functions that must use patterns the architecture normally bans
  (e.g., a single `JSON.parse` in a parser module that the rule
  otherwise forbids).

The existing line-level `// ts-archunit-exclude` works for single
expressions but is verbose for multi-line blocks or method bodies.

## Proposed API

Extend the existing `exclusion-comments.ts` to support block-level
suppression:

```typescript
// Suppress a specific rule for the next function/class/block:
// ts-archunit-disable: hygiene/no-empty-bodies
observe(): void { /* intentionally empty */ }

// Suppress for a range (like ESLint disable/enable):
// ts-archunit-disable: hygiene/no-empty-bodies
class MockIntersectionObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
// ts-archunit-enable: hygiene/no-empty-bodies

// Suppress all rules for the next element:
// ts-archunit-disable-next
function legacyAdapter() { ... }
```

This follows the ESLint convention (`eslint-disable` / `eslint-enable` /
`eslint-disable-next-line`) which most TypeScript developers already know.

## Design Considerations

- **Builds on existing infrastructure.** `src/core/exclusion-comments.ts`
  already parses `// ts-archunit-exclude`. Extend it to recognize
  `disable` / `enable` / `disable-next` directives.
- **Rule-specific suppression.** Always require a rule ID (or explicit
  "all") to prevent blanket suppression without thought.
- **Stale-suppression detection.** Like `.excluding()`, warn if a
  `disable` directive matches zero violations in its scope — so
  suppressions don't silently accumulate.
- **No options objects on individual rules.** This replaces the need for
  rule-specific annotation parsing (like Proposal 007's
  `allowNoopComment` option). One mechanism, all rules.

## What This Replaces

- Proposal 007's `/* noop */` annotation for `noEmptyBodies()`.
- Any future per-rule annotation proposals (they would all be special
  cases of this general mechanism).

## Scope

Medium — extends an existing parser (`exclusion-comments.ts`) with new
directive types. The evaluation pipeline in `execute-rule.ts` already
applies exclusion-comment filtering; this adds block-scoped variants.
