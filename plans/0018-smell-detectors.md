# Plan 0018: Smell Detectors — Duplicate Bodies & Inconsistent Siblings

## Status

- **State:** Not Started
- **Priority:** P3 — Advisory tooling, build when users ask
- **Effort:** 2-3 days
- **Created:** 2026-03-26
- **Depends on:** 0009 (Function Entry Point / ArchFunction), 0011 (Body Analysis / matchers)

## Purpose

Ship two opt-in smell detectors that catch the exact copy-paste and inconsistency problems described in spec section 1.1 (the 433-line audit). These are syntactic sugar over the predicate/condition engine — users *could* build these with custom conditions, but the common case should be one chain.

```typescript
import { smells, project } from 'ts-archunit'

const p = project('tsconfig.json')

// Flag near-identical function bodies across the codebase
smells.duplicateBodies(p).inFolder('src/routes/**').withMinSimilarity(0.9).warn()

// Flag the odd-one-out in same-folder files
smells
  .inconsistentSiblings(p)
  .inFolder('src/repositories/**')
  .forPattern(call('this.extractCount'))
  .warn()
```

**Default behavior:** Both detectors default to `.warn()`, not `.check()`. Smells are advisory. Teams opt in to hard failure with `.check()`.

## Design Decisions

### AST Similarity, Not Text Diff

`duplicateBodies` compares **normalized AST structure**, not source text. Two functions with different variable names but identical control flow and call patterns are flagged as duplicates. This catches the `parseWebhookOrder` / `parseContentTypeOrder` case from the spec where only type names differ.

Approach: serialize each function body to a structural fingerprint (node kinds + call targets, stripped of identifiers), then compare fingerprints using a similarity metric. This reuses the `ExpressionMatcher` and body traversal patterns from plan 0011 (`src/helpers/body-traversal.ts`, `src/helpers/matchers.ts`).

### Configurable Threshold, Not Binary

A fixed "identical" check is too strict (misses near-clones) or too loose (flags everything). The `withMinSimilarity(0.0-1.0)` guardrail lets teams tune. Default: `0.85`.

### Smell Builders Are Not RuleBuilders

Smell detectors get their own `SmellBuilder` class rather than extending `RuleBuilder<T>`. Reasons:

- The chain grammar differs — smells don't have `.that()` predicates or `.should()` conditions
- The execution model differs — `duplicateBodies` compares *pairs* of functions, not individual elements against a condition
- Violation messages are smell-specific ("Function A is 92% similar to Function B")

`SmellBuilder` reuses `ArchRuleError`, `ArchViolation`, `formatViolations`, and the check/warn terminal methods from core.

### Folder Grouping for Noise Reduction

`groupByFolder()` groups results by directory in the output. Without it, a codebase with 200 route files produces an unreadable wall of violations. This is a presentation concern — it filters nothing, just organizes output.

## Phase 1: AST Fingerprinting

### `src/smells/fingerprint.ts`

Serialize a function body to a structural fingerprint for similarity comparison.

```typescript
import type { Node } from 'ts-morph'
import { SyntaxKind } from 'ts-morph'

/**
 * Structural fingerprint of a function body.
 * Captures the shape (node kinds, call targets) while ignoring
 * identifiers, literals, and whitespace.
 */
export interface Fingerprint {
  /** Ordered sequence of syntax node kinds in the body */
  readonly kinds: SyntaxKind[]
  /** Normalized call targets (e.g. ['parseInt', 'this.extractCount']) */
  readonly calls: string[]
  /** Total AST node count (for line-count filtering) */
  readonly nodeCount: number
}

/**
 * Build a structural fingerprint from a function body AST node.
 * Walks all descendants, records their SyntaxKind in order,
 * and extracts call expression targets.
 */
export function buildFingerprint(body: Node): Fingerprint {
  const kinds: SyntaxKind[] = []
  const calls: string[] = []

  for (const node of body.getDescendants()) {
    kinds.push(node.getKind())
    if (Node.isCallExpression(node)) {
      calls.push(node.getExpression().getText().replace(/\?\./g, '.'))
    }
  }

  return { kinds, calls, nodeCount: kinds.length }
}

/**
 * Compute similarity between two fingerprints.
 * Uses longest common subsequence on the kinds array,
 * normalized to [0, 1].
 */
export function computeSimilarity(a: Fingerprint, b: Fingerprint): number {
  // LCS length / max length
  const lcs = lcsLength(a.kinds, b.kinds)
  return lcs / Math.max(a.kinds.length, b.kinds.length)
}

/** Standard LCS length computation. */
function lcsLength(a: readonly number[], b: readonly number[]): number {
  // Space-optimized: two-row DP
  const m = a.length
  const n = b.length
  let prev = new Array<number>(n + 1).fill(0)
  let curr = new Array<number>(n + 1).fill(0)

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, curr[j - 1]!)
    }
    ;[prev, curr] = [curr, prev]
    curr.fill(0)
  }

  return prev[n]!
}
```

**Performance note:** LCS is O(m*n) where m, n are AST node counts per function. For typical functions (< 500 nodes), this is fast. For pathological cases, `minLines` filters out trivially small functions and `inFolder` scopes the search.

### `src/smells/fingerprint.test.ts`

Tests:
- Identical bodies produce similarity 1.0
- Bodies with same structure but different identifiers produce similarity > 0.9
- Completely different bodies produce similarity < 0.3
- Empty bodies produce similarity 1.0 (both empty)
- `minLines` filtering excludes small functions before fingerprinting

## Phase 2: SmellBuilder Base

### `src/smells/smell-builder.ts`

```typescript
import type { ArchProject } from '../core/project.js'
import type { ArchViolation } from '../core/violation.js'
import type { OutputFormat } from '../core/check-options.js'
import { ArchRuleError } from '../core/errors.js'
import { formatViolations } from '../core/format.js'

/**
 * Base class for smell detector builders.
 * Provides guardrail methods and terminal methods (check/warn).
 */
export abstract class SmellBuilder {
  protected _folders: string[] = []
  protected _minLines = 5
  protected _ignoreTests = false
  protected _ignorePaths: string[] = []
  protected _groupByFolder = false
  protected _reason?: string

  constructor(protected readonly project: ArchProject) {}

  /** Scope detection to files matching the glob pattern. */
  inFolder(glob: string): this {
    this._folders.push(glob)
    return this
  }

  /** Ignore functions/files shorter than N lines. Default: 5. */
  minLines(n: number): this {
    this._minLines = n
    return this
  }

  /** Exclude test files (*.test.ts, *.spec.ts, __tests__/**). */
  ignoreTests(): this {
    this._ignoreTests = true
    return this
  }

  /** Exclude files matching the given glob patterns. */
  ignorePaths(...globs: string[]): this {
    this._ignorePaths.push(...globs)
    return this
  }

  /** Group violation output by directory. */
  groupByFolder(): this {
    this._groupByFolder = true
    return this
  }

  /** Explain why this smell check exists. */
  because(reason: string): this {
    this._reason = reason
    return this
  }

  /** Run detection and throw on violations. */
  check(options?: { format?: OutputFormat }): void {
    const violations = this.detect()
    if (violations.length > 0) {
      throw new ArchRuleError(this.describe(), violations, options)
    }
  }

  /** Run detection and log violations without throwing. */
  warn(options?: { format?: OutputFormat }): void {
    const violations = this.detect()
    if (violations.length > 0) {
      const message = formatViolations(this.describe(), violations)
      console.warn(message)
    }
  }

  /** Subclasses implement: run detection, return violations. */
  protected abstract detect(): ArchViolation[]

  /** Subclasses implement: human-readable rule description. */
  protected abstract describe(): string
}
```

## Phase 3: duplicateBodies Detector

### `src/smells/duplicate-bodies.ts`

```typescript
import { SmellBuilder } from './smell-builder.js'
import { collectFunctions } from '../models/arch-function.js'
import { buildFingerprint, computeSimilarity } from './fingerprint.js'
import { createViolation } from '../core/violation.js'
import type { ArchViolation } from '../core/violation.js'
import type { ArchProject } from '../core/project.js'

export class DuplicateBodiesBuilder extends SmellBuilder {
  private _minSimilarity = 0.85

  constructor(project: ArchProject) {
    super(project)
  }

  /** Set the AST similarity threshold. Default: 0.85. */
  withMinSimilarity(threshold: number): this {
    this._minSimilarity = threshold
    return this
  }

  protected detect(): ArchViolation[] {
    // 1. Collect all functions matching folder/path filters
    // 2. Filter by minLines
    // 3. Build fingerprint for each
    // 4. Compare all pairs, collect those above threshold
    // 5. Return violations grouped by folder if requested
    // ... (implementation details)
  }

  protected describe(): string {
    const scope = this._folders.length > 0 ? this._folders.join(', ') : 'all files'
    return `No duplicate function bodies in ${scope} (similarity >= ${this._minSimilarity})`
  }
}
```

**Pair comparison optimization:** For N functions, naive comparison is O(N^2). Acceptable for typical projects (< 1000 functions in scope after folder filtering). If needed later: bucket by fingerprint length first (functions with very different sizes can't be similar), reducing comparisons.

### Violation format

```
Smell: Duplicate function bodies detected (similarity >= 0.90)

  src/routes/webhooks.ts:42 — parseWebhookOrder()
  is 94% similar to
  src/routes/content-types.ts:38 — parseContentTypeOrder()

  src/routes/webhooks.ts:78 — buildWebhookFilter()
  is 91% similar to
  src/routes/events.ts:65 — buildEventFilter()

Reason: Extract shared logic into a utility function.
```

## Phase 4: inconsistentSiblings Detector

### `src/smells/inconsistent-siblings.ts`

```typescript
import { SmellBuilder } from './smell-builder.js'
import type { ExpressionMatcher } from '../helpers/matchers.js'
import type { ArchViolation } from '../core/violation.js'
import type { ArchProject } from '../core/project.js'

export class InconsistentSiblingsBuilder extends SmellBuilder {
  private _pattern?: ExpressionMatcher

  constructor(project: ArchProject) {
    super(project)
  }

  /** The pattern that most siblings should follow. */
  forPattern(matcher: ExpressionMatcher): this {
    this._pattern = matcher
    return this
  }

  protected detect(): ArchViolation[] {
    // 1. Group files by parent folder
    // 2. For each group, check which files match the pattern
    // 3. If majority matches but some don't, flag the minority as "inconsistent"
    // 4. Threshold: flag when >= 60% of siblings match but a file doesn't
    // ... (implementation details)
  }

  protected describe(): string {
    const pattern = this._pattern?.description ?? 'unknown pattern'
    return `Sibling files should consistently use ${pattern}`
  }
}
```

**"Odd one out" logic:** Given a folder with 8 files where 6 use `call('this.extractCount')` and 2 don't, the 2 are flagged. The majority threshold (60%) prevents false positives when a folder has mixed concerns. If only 3 of 8 use the pattern, nothing is flagged — there's no clear majority.

### Violation format

```
Smell: Inconsistent siblings in src/repositories/

  6 of 8 files use call to 'this.extractCount', but these do not:
    src/repositories/webhook-repository.ts
    src/repositories/legacy-repository.ts

Reason: Align with sibling conventions or extract the difference.
```

## Phase 5: smells Namespace & Exports

### `src/smells/index.ts`

```typescript
import type { ArchProject } from '../core/project.js'
import { DuplicateBodiesBuilder } from './duplicate-bodies.js'
import { InconsistentSiblingsBuilder } from './inconsistent-siblings.js'

/**
 * Smell detector entry points.
 * All detectors default to .warn() — smells are advisory by design.
 */
export const smells = {
  duplicateBodies(project: ArchProject): DuplicateBodiesBuilder {
    return new DuplicateBodiesBuilder(project)
  },
  inconsistentSiblings(project: ArchProject): InconsistentSiblingsBuilder {
    return new InconsistentSiblingsBuilder(project)
  },
}
```

### `src/index.ts` addition

```typescript
// Smell detectors (plan 0018)
export { smells } from './smells/index.js'
```

## Phase 6: Tests

### `src/smells/__tests__/duplicate-bodies.test.ts`

Test cases:
- Two identical functions in different files are flagged
- Two similar functions (same structure, different identifiers) above threshold are flagged
- Two completely different functions are not flagged
- Functions below `minLines` are excluded
- `inFolder` scopes correctly — functions outside the folder are ignored
- `ignoreTests()` excludes `*.test.ts` and `*.spec.ts`
- `ignorePaths('**/*.d.ts')` excludes declaration files
- `.warn()` logs but does not throw
- `.check()` throws `ArchRuleError` with violations
- `groupByFolder()` groups output by directory
- `withMinSimilarity(1.0)` only flags exact structural matches

### `src/smells/__tests__/inconsistent-siblings.test.ts`

Test cases:
- Folder with 5/6 files matching pattern flags the 1 outlier
- Folder with 3/6 files matching pattern flags nothing (no majority)
- Empty folder produces no violations
- `forPattern(call('x'))` uses ExpressionMatcher correctly
- `minLines` excludes trivially small files
- `ignoreTests()` excludes test files from sibling analysis
- `.warn()` logs but does not throw
- `.check()` throws `ArchRuleError`
- Files in different folders are compared independently

### Test fixtures

Create minimal fixture projects under `tests/fixtures/smells/`:

```
tests/fixtures/smells/
├── duplicate-bodies/
│   ├── tsconfig.json
│   ├── file-a.ts          # parseWebhookOrder — the original
│   ├── file-b.ts          # parseContentTypeOrder — near-clone
│   └── file-c.ts          # unrelatedFunction — completely different
└── inconsistent-siblings/
    ├── tsconfig.json
    └── repositories/
        ├── user-repo.ts       # uses extractCount
        ├── order-repo.ts      # uses extractCount
        ├── product-repo.ts    # uses extractCount
        └── legacy-repo.ts     # uses parseInt (odd one out)
```

## Files Changed

| File | Change |
| --- | --- |
| `src/smells/fingerprint.ts` | AST fingerprinting + LCS similarity |
| `src/smells/smell-builder.ts` | Base class with guardrails + check/warn |
| `src/smells/duplicate-bodies.ts` | `DuplicateBodiesBuilder` |
| `src/smells/inconsistent-siblings.ts` | `InconsistentSiblingsBuilder` |
| `src/smells/index.ts` | `smells` namespace export |
| `src/index.ts` | Re-export `smells` |
| `src/smells/__tests__/fingerprint.test.ts` | Fingerprint + similarity tests |
| `src/smells/__tests__/duplicate-bodies.test.ts` | Integration tests |
| `src/smells/__tests__/inconsistent-siblings.test.ts` | Integration tests |
| `tests/fixtures/smells/**` | Fixture projects |

## Out of Scope

- **Cross-file call tracing** — detecting that function A calls function B which is a duplicate of function C. Single-hop only.
- **Auto-fix / refactoring suggestions** — detection only, no code generation.
- **Semantic similarity** — only structural (AST shape). Two functions that achieve the same result via different algorithms are not flagged.
- **Class-level duplicate detection** — v1 operates on functions/methods. Class-level (whole class similarity) is a future extension.
- **Custom smell definitions** — `defineSmell()` factory. Users use `defineCondition()` from plan 0013 for custom checks. Smell-specific sugar comes later if needed.
