# Plan 0025: Rich Rule Metadata — Why, Fix, Docs

## Status

- **State:** Not Started
- **Priority:** P2 — Critical for developer experience and AI agent feedback loops
- **Effort:** 0.5-1 day
- **Created:** 2026-03-26
- **Depends on:** 0006 (Violation Reporting)

## Problem

When a rule fails, the developer (or AI agent) sees:

```
Architecture violation (1 found)
Reason: ADR-011: dependencies flow inward

  - order-controller.ts: imports from repositories/order.repository.ts
```

This tells you WHAT's wrong but not:
- **WHY** it matters — what's the risk? what breaks?
- **HOW** to fix it — what should the code look like instead?
- **WHERE** to learn more — link to ADR, docs, or wiki

ESLint, SonarQube, and TypeScript all provide this context. ts-archunit should too. This is especially important for AI agents — they need the "how to fix" context to self-correct.

## Design

### `.rule()` method on the builder chain

Replace `.because(string)` with a richer `.rule(metadata)` that includes all context:

```typescript
classes(p)
  .that().extend('BaseRepository')
  .should().notContain(newExpr('Error'))
  .rule({
    id: 'repo/typed-errors',
    because: 'Generic Error loses context and prevents consistent error handling across the API',
    suggestion: 'Replace `new Error(msg)` with `new NotFoundError(entity, id)` or `new ValidationError(msg)`',
    docs: 'https://docs.cmless.io/adr/011#error-handling',
  })
  .check()
```

### Backward compatible

`.because(string)` still works — it's shorthand for `.rule({ because: string })`. Both can be used:

```typescript
// Simple (existing API, unchanged)
.because('use typed errors')

// Rich (new API)
.rule({
  id: 'repo/typed-errors',
  because: 'use typed errors',
  suggestion: 'Replace new Error() with new NotFoundError()',
  docs: 'https://docs.example.com/adr-011',
})
```

### RuleMetadata interface

```typescript
export interface RuleMetadata {
  /** Unique rule identifier, e.g. 'repo/typed-errors', 'layer/no-upward-deps' */
  id?: string

  /** Why this rule exists — the risk or impact of violating it */
  because?: string

  /** How to fix a violation — actionable guidance with code example */
  suggestion?: string

  /** Link to documentation — ADR, wiki, style guide */
  docs?: string
}
```

### Enhanced violation output

Terminal:
```
Architecture Violation [repo/typed-errors]

  WebhookRepository.findById throws generic Error
  at src/repositories/webhook.repository.ts:42

    41 |     if (!result) {
  > 42 |       throw new Error(`Webhook '${id}' not found`)
    43 |     }

  Why: Generic Error loses context and prevents consistent error handling
  Fix: Replace `new Error(msg)` with `new NotFoundError(entity, id)`
  Docs: https://docs.cmless.io/adr/011#error-handling
```

GitHub annotation:
```
::error file=src/repositories/webhook.repository.ts,line=42,title=repo/typed-errors::Generic Error loses context. Fix: Replace new Error(msg) with new NotFoundError(entity, id). Docs: https://docs.cmless.io/adr/011
```

JSON:
```json
{
  "violations": [{
    "rule": "repo/typed-errors",
    "element": "WebhookRepository.findById",
    "file": "src/repositories/webhook.repository.ts",
    "line": 42,
    "message": "WebhookRepository.findById contains new 'Error' at line 42",
    "because": "Generic Error loses context and prevents consistent error handling",
    "suggestion": "Replace `new Error(msg)` with `new NotFoundError(entity, id)`",
    "docs": "https://docs.cmless.io/adr/011#error-handling"
  }]
}
```

## Phase 1: RuleMetadata Interface

### `src/core/rule-metadata.ts`

```typescript
/**
 * Rich metadata for an architecture rule.
 *
 * Provides educational context beyond the violation message:
 * why the rule exists, how to fix violations, where to learn more.
 */
export interface RuleMetadata {
  /** Unique rule identifier, e.g. 'repo/typed-errors' */
  id?: string

  /** Why this rule exists — the risk or impact */
  because?: string

  /** How to fix — actionable suggestion with code example */
  suggestion?: string

  /** Link to documentation — ADR, wiki, style guide */
  docs?: string
}
```

## Phase 2: Update RuleBuilder

Add `.rule(metadata)` method alongside existing `.because(string)`:

```typescript
// In RuleBuilder<T>:

  private _metadata?: RuleMetadata

  /**
   * Attach rich metadata to the rule.
   * Provides educational context in violation output.
   */
  rule(metadata: RuleMetadata): this {
    this._metadata = metadata
    if (metadata.because) {
      this._reason = metadata.because
    }
    return this
  }

  // Existing .because() remains as shorthand:
  because(reason: string): this {
    this._reason = reason
    return this
  }
```

Update `evaluate()` to include metadata in the ConditionContext:

```typescript
const context: ConditionContext = {
  rule: this.buildRuleDescription(),
  because: this._reason,
  ruleId: this._metadata?.id,
  suggestion: this._metadata?.suggestion,
  docs: this._metadata?.docs,
}
```

## Phase 3: Update ConditionContext and ArchViolation

Add metadata fields to ConditionContext:

```typescript
export interface ConditionContext {
  rule: string
  because?: string
  ruleId?: string
  suggestion?: string
  docs?: string
}
```

ArchViolation already has `suggestion?: string`. Add `docs?: string` and `ruleId?: string`:

```typescript
export interface ArchViolation {
  rule: string
  ruleId?: string
  element: string
  file: string
  line: number
  message: string
  because?: string
  codeFrame?: string
  suggestion?: string
  docs?: string
}
```

Update `createViolation` to pass through the new fields from context.

## Phase 4: Update Formatters

### Terminal formatter

Add Why/Fix/Docs lines when present:

```typescript
if (v.because) lines.push(`  Why: ${v.because}`)
if (v.suggestion) lines.push(`  Fix: ${v.suggestion}`)
if (v.docs) lines.push(`  Docs: ${v.docs}`)
```

### GitHub formatter

Append suggestion and docs to the annotation message:

```typescript
let message = v.message
if (v.because) message += ` (${v.because})`
if (v.suggestion) message += `. Fix: ${v.suggestion}`
if (v.docs) message += `. Docs: ${v.docs}`
```

Use ruleId as the title if present:

```typescript
const title = v.ruleId
  ? `Architecture Violation: ${v.ruleId}`
  : `Architecture Violation: ${v.rule}`
```

### JSON formatter

Already includes all fields — just pass through `ruleId`, `suggestion`, `docs`.

## Phase 5: Update SliceRuleBuilder

Add `.rule(metadata)` to SliceRuleBuilder with the same pattern.

## Phase 6: Tests

1. **`.rule()` attaches metadata** — check _metadata is set
2. **`.rule()` sets because from metadata** — backward compatible
3. **`.because()` still works alone** — no regression
4. **Terminal format shows Why/Fix/Docs** — when present
5. **Terminal format omits Why/Fix/Docs** — when not present (backward compatible)
6. **GitHub format includes suggestion in message** — appended
7. **JSON format includes all metadata fields** — ruleId, suggestion, docs
8. **ArchViolation has new fields** — ruleId, docs populated from context
9. **Named selections preserve metadata** — fork copies _metadata
10. **Slice builder supports .rule()** — same behavior

## Files Changed

| File | Change |
|------|--------|
| `src/core/rule-metadata.ts` | New — RuleMetadata interface |
| `src/core/rule-builder.ts` | Modified — add .rule() method, pass metadata to context |
| `src/core/condition.ts` | Modified — add ruleId, suggestion, docs to ConditionContext |
| `src/core/violation.ts` | Modified — add ruleId, docs to ArchViolation, update createViolation |
| `src/core/format.ts` | Modified — show Why/Fix/Docs in terminal output |
| `src/core/format-github.ts` | Modified — include suggestion/docs in annotation |
| `src/core/format-json.ts` | Modified — pass through new fields |
| `src/builders/slice-rule-builder.ts` | Modified — add .rule() method |
| `src/index.ts` | Modified — export RuleMetadata |
| `tests/core/rule-metadata.test.ts` | New — 10 tests |

## Out of Scope

- **Rule registry/catalog** — no central registry of all rules. Each rule is self-documenting via its metadata.
- **Auto-generated docs from rules** — could scan all .rule() calls to build a rule catalog. Future plan.
- **Severity in metadata** — severity is already handled by .check() vs .warn(). No need to duplicate.
- **Tags/categories** — rule IDs encode the category (e.g., 'repo/' prefix). No separate tag system needed.
