# Plan 0026: Per-Rule Exclusions

## Status

- **State:** Not Started
- **Priority:** P2 — Enables enforcement of rules with intentional exceptions
- **Effort:** 1-2 days
- **Created:** 2026-03-26
- **Depends on:** 0005 (Rule Builder), 0025 (Rich Rule Metadata)

## Problem

The gap between `.warn()` (never enforced) and `.check()` (no exceptions). Rules with even one intentional violation can never be enforced. In real projects, 3 of 5 `.warn()` rules could flip to `.check()` if exclusions existed.

Baseline mode solves temporary violations ("we'll fix this"). Exclusions solve permanent exceptions ("this is intentionally different"). Mixing them in the baseline makes it impossible to distinguish.

## Design: Two Phases

### Phase 1: `.excluding()` chain method

Exclusion lives with the rule in the test file. Simple, covers the common case.

```typescript
functions(p)
  .that().resideInFolder('**/wrappers/**')
  .should().notContain(newExpr('URLSearchParams'))
  .excluding('Asset.getImageUrl', 'Environment.sync')
  .rule({ id: 'sdk/no-manual-urlsearchparams' })
  .check()  // enforced — excluded elements silently skipped
```

### Phase 2: Inline exclusion comments

Exclusion lives with the code. Survives refactoring. Familiar ESLint-like pattern.

```typescript
// ts-archunit-exclude sdk/no-manual-urlsearchparams: builds image transform URL, not list pagination
async getImageUrl() {
  const params = new URLSearchParams()  // ← not flagged
}
```

## Phase 1 Implementation: `.excluding()`

### Update `src/core/rule-builder.ts`

Add `_exclusions` field and `.excluding()` method:

```typescript
export abstract class RuleBuilder<T> {
  protected _predicates: Predicate<T>[] = []
  protected _conditions: Condition<T>[] = []
  protected _reason?: string
  protected _metadata?: RuleMetadata
  protected _exclusions: (string | RegExp)[] = []

  /**
   * Exclude specific elements from violation reporting.
   *
   * Matched violations are silently suppressed. Use for permanent,
   * intentional exceptions — not for temporary violations (use baseline for those).
   *
   * Matches against the violation's `element` field (e.g., 'Asset.getImageUrl').
   * Supports exact strings and regex patterns.
   *
   * Emits a warning if an exclusion matches zero violations (stale exclusion).
   */
  excluding(...patterns: (string | RegExp)[]): this {
    this._exclusions.push(...patterns)
    return this
  }
```

Update `evaluate()` to filter exclusions:

```typescript
private evaluate(): ArchViolation[] {
  // ... existing predicate filtering and condition evaluation ...

  // Filter exclusions — track which patterns matched for stale detection
  if (this._exclusions.length > 0) {
    const matchedPatterns = new Set<number>()
    violations = violations.filter((v) => {
      const matchIndex = this._exclusions.findIndex((pattern) =>
        typeof pattern === 'string'
          ? v.element === pattern
          : pattern.test(v.element),
      )
      if (matchIndex >= 0) {
        matchedPatterns.add(matchIndex)
        return false // suppress this violation
      }
      return true // keep this violation
    })

    // Warn about each unused exclusion pattern individually
    const ruleId = this._metadata?.id ?? 'unnamed'
    this._exclusions.forEach((pattern, index) => {
      if (!matchedPatterns.has(index)) {
        console.warn(
          `[ts-archunit] Unused exclusion '${String(pattern)}' in rule '${ruleId}'. ` +
          `It matched zero violations — it may be stale after a rename.`,
        )
      }
    })
  }

  return violations
}
```

Update `fork()` to copy `_exclusions`:

```typescript
protected fork(): this {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const proto: object = Object.getPrototypeOf(this)
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const fork: this = Object.create(proto)
  Object.assign(fork, this)
  fork._predicates = [...this._predicates]
  fork._conditions = []
  fork._exclusions = [...this._exclusions]  // preserve exclusions on fork
  fork._reason = undefined
  return fork
}
```

### Update `src/builders/slice-rule-builder.ts`

Add the same `.excluding()` method and filtering to `SliceRuleBuilder`.

### Tests: `tests/core/rule-builder-exclusions.test.ts`

```typescript
describe('.excluding()', () => {
  it('suppresses violations matching exact element name', () => {
    // Rule produces violations for UserService and OrderService
    // Exclude UserService — only OrderService violation remains
  })

  it('suppresses violations matching regex pattern', () => {
    // Exclude /Helper$/ — violations for FooHelper, BarHelper suppressed
  })

  it('does not suppress non-matching violations', () => {
    // Exclude 'UserService' — OrderService violation still reported
  })

  it('supports multiple exclusion patterns', () => {
    // .excluding('UserService', /Helper$/) — both patterns applied
  })

  it('warns about unused exclusions', () => {
    // Exclude 'NonExistent' — warning emitted to stderr
    const warnSpy = vi.spyOn(console, 'warn')
    // ... verify warning about stale exclusion
  })

  it('works with .check() — excluded violations do not throw', () => {
    // 3 violations, 3 excluded → .check() passes (no throw)
  })

  it('works with .warn() — excluded violations not logged', () => {
    // 3 violations, 2 excluded → only 1 logged
  })

  it('works with baseline — exclusions applied after baseline filter', () => {
    // Baseline removes known, exclusions remove intentional, rest fail
  })

  it('preserved across named selections (fork)', () => {
    // const repos = classes(p).that().extend('Base').excluding('LegacyRepo')
    // repos.should()... — exclusion preserved on fork
  })

  it('interacts correctly with .rule({ id })', () => {
    // Unused exclusion warning includes the rule ID
  })
})
```

**10 tests for Phase 1.**

## Phase 2 Implementation: Inline Comments

### `src/helpers/exclusion-comments.ts`

```typescript
/**
 * Exclusion comment parsed from source code.
 */
export interface ExclusionComment {
  /** Rule ID being excluded */
  ruleId: string
  /** Required reason for the exclusion */
  reason: string
  /** File path where the comment was found */
  file: string
  /** Line number of the comment */
  line: number
  /** Whether this is a block exclusion (start/end) */
  isBlock: boolean
  /** End line for block exclusions */
  endLine?: number
}

/**
 * Scan a source file for ts-archunit exclusion comments.
 *
 * Supported formats:
 *   // ts-archunit-exclude <rule-id>: <reason>
 *   // ts-archunit-exclude-start <rule-id>: <reason>
 *   // ts-archunit-exclude-end
 *   // ts-archunit-exclude <rule-id>, <rule-id>: <reason>
 */
export function parseExclusionComments(sourceText: string, filePath: string): ExclusionComment[]

/**
 * Check if a violation is covered by an exclusion comment.
 */
export function isExcludedByComment(
  violation: ArchViolation,
  comments: ExclusionComment[],
): boolean
```

### Integration with RuleBuilder

When a rule has `.rule({ id })`, the evaluation pipeline:

1. Run predicates → filter elements
2. Run conditions → collect violations
3. **Scan source files for exclusion comments matching this rule ID** (Phase 2)
4. Apply `.excluding()` chain exclusions (Phase 1)
5. Apply baseline filter
6. Apply diff filter
7. Remaining violations → throw or warn

### Validation

- **Missing reason** → reported as a warning:
  ```
  Architecture Warning: undocumented exclusion at src/wrappers/asset.ts:42
    // ts-archunit-exclude sdk/no-manual-urlsearchparams
    Fix: Add a reason — // ts-archunit-exclude sdk/no-manual-urlsearchparams: <why>
  ```

- **Unknown rule ID** → reported as a warning:
  ```
  Architecture Warning: exclusion references unknown rule 'nonexistent/rule' at src/foo.ts:10
  ```

- **Unused block** (start without end, or end without start) → error

### Tests: `tests/helpers/exclusion-comments.test.ts`

1. **Parses single-line exclusion** — extracts rule ID and reason
2. **Parses block exclusion** — start/end with line range
3. **Parses multiple rule IDs on one line** — comma-separated
4. **Rejects missing reason** — returns validation error
5. **Handles nested blocks** — start inside another start is an error
6. **isExcludedByComment matches by file + line range** — violation within block range
7. **isExcludedByComment matches single-line** — violation on the line after the comment
8. **Does not match wrong rule ID** — exclusion for rule A doesn't suppress rule B
9. **Does not match wrong file** — exclusion in file A doesn't affect file B
10. **Integration: inline exclusion suppresses violation in full pipeline** — end-to-end

**10 tests for Phase 2.**

## Phase 3: Documentation

### Update `docs/violation-reporting.md`

Add section: "Excluding Intentional Violations"

```markdown
### Excluding Intentional Violations

Some violations are intentional — they'll never be "fixed" because the code is correct.
Use exclusions to suppress them while keeping the rule enforced for everything else.

#### Chain-level exclusion

Exclude specific elements by name in the rule definition:

\`\`\`typescript
functions(p)
  .that().resideInFolder('**/wrappers/**')
  .should().notContain(newExpr('URLSearchParams'))
  .excluding('Asset.getImageUrl', 'Environment.sync')
  .check()  // enforced — excluded elements silently skipped
\`\`\`

#### Inline exclusion comments

Exclude at the code level — the exclusion moves with the code:

\`\`\`typescript
// ts-archunit-exclude sdk/no-manual-urlsearchparams: builds image transform URL, not list pagination
async getImageUrl() {
  const params = new URLSearchParams()  // ← not flagged
}
\`\`\`

Requires a `.rule({ id })` — exclusion comments reference the rule by ID.
Requires a reason — undocumented exclusions are flagged as warnings.
```

### Update `docs/core-concepts.md`

Add to the enforcement model section:

```markdown
| Method | Behavior |
|--------|----------|
| `.check()` | Fail on any violation |
| `.warn()` | Log violations, don't fail |
| `.check({ baseline })` | Fail only on new violations |
| `.excluding(...)` | Permanently suppress named violations |
```

### Update `docs/api-reference.md`

Add `.excluding()` to RuleBuilder methods table.

## Files Changed

| File | Change |
|------|--------|
| `src/core/rule-builder.ts` | Modified — add `_exclusions`, `.excluding()`, `isExcluded()`, filter in `evaluate()`, copy in `fork()` |
| `src/builders/slice-rule-builder.ts` | Modified — same exclusion support |
| `src/helpers/exclusion-comments.ts` | New (Phase 2) — parse inline exclusion comments |
| `src/index.ts` | Modified — export exclusion comment types (Phase 2) |
| `docs/violation-reporting.md` | Modified — add exclusions section |
| `docs/core-concepts.md` | Modified — add exclusion to enforcement model table |
| `docs/api-reference.md` | Modified — add `.excluding()` method |
| `tests/core/rule-builder-exclusions.test.ts` | New — 10 tests (Phase 1) |
| `tests/helpers/exclusion-comments.test.ts` | New — 10 tests (Phase 2) |

## Test Inventory

| # | Test | Phase |
|---|------|-------|
| 1 | Suppresses violations matching exact element name | 1 |
| 2 | Suppresses violations matching regex | 1 |
| 3 | Does not suppress non-matching violations | 1 |
| 4 | Multiple exclusion patterns | 1 |
| 5 | Warns about unused exclusions | 1 |
| 6 | Works with .check() — excluded don't throw | 1 |
| 7 | Works with .warn() — excluded not logged | 1 |
| 8 | Works with baseline — applied after baseline | 1 |
| 9 | Preserved across named selections (fork) | 1 |
| 10 | Unused exclusion warning includes rule ID | 1 |
| 11 | Parses single-line exclusion comment | 2 |
| 12 | Parses block exclusion (start/end) | 2 |
| 13 | Parses multiple rule IDs (comma-separated) | 2 |
| 14 | Rejects missing reason | 2 |
| 15 | Handles nested block error | 2 |
| 16 | isExcludedByComment matches line range | 2 |
| 17 | isExcludedByComment matches single-line | 2 |
| 18 | Wrong rule ID not matched | 2 |
| 19 | Wrong file not matched | 2 |
| 20 | End-to-end inline exclusion in full pipeline | 2 |

## Out of Scope

- **Exclusion config file** — inline comments + `.excluding()` cover all cases
- **Auto-generating exclusions** — exclusions are intentional decisions, not generated
- **Exclusion inheritance** — no `extends` for exclusion lists
- **Per-file exclusions** — use predicates: `.that().resideInFolder()` already filters files
- **Audit command** (`npx ts-archunit audit`) — lists all exclusions. Deferred to CLI plan.
