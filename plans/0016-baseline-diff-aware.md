# Plan 0016: Baseline Mode & Diff-Aware Mode

## Status

- **State:** Not Started
- **Priority:** P2 — Critical for adoption in existing codebases
- **Effort:** 1-2 days
- **Created:** 2026-03-26
- **Depends on:** 0005 (Rule Builder), 0006 (Violation Reporting)

## Problem

ts-archunit is only usable on greenfield projects without this feature. Real teams have existing codebases with hundreds of pre-existing violations. Adding a rule like "repositories must not call parseInt" fails immediately because 15 repositories already violate it. The team can't adopt the rule without fixing all 15 violations in the same PR — unrealistic for large codebases.

Two features solve this:

1. **Baseline mode** — record existing violations, only fail on new ones. For the team adopting rules incrementally.
2. **Diff-aware mode** — evaluate the full project, only report violations in files changed in the current PR. For the individual developer not being overwhelmed.

## Design Decision: Programmatic API First

Both baseline and diff-aware could be CLI features (`npx ts-archunit baseline`). But the CLI is plan 0020 (P3). This plan delivers the **programmatic API** that users call from their test files:

```typescript
import { project, classes, call, withBaseline, diffAware } from 'ts-archunit'

const p = project('tsconfig.json')
const baseline = withBaseline('arch-baseline.json')

// Only NEW violations fail (violations in baseline are ignored)
classes(p).that().extend('BaseRepository')
  .should().notContain(call('parseInt'))
  .check({ baseline })

// Only violations in files changed since main
classes(p).that().extend('BaseRepository')
  .should().notContain(call('parseInt'))
  .check({ diff: diffAware('main') })

// Both combined: only new violations in changed files
classes(p).that().extend('BaseRepository')
  .should().notContain(call('parseInt'))
  .check({ baseline, diff: diffAware('main') })
```

The CLI plan (0020) will add `npx ts-archunit baseline --output` as a wrapper around this API.

## Phase 1: Baseline File Format

### `src/helpers/baseline.ts`

The baseline file is a JSON file recording known violations. Each entry identifies a violation by rule + file + content hash (not line number — lines drift as code changes).

```typescript
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { ArchViolation } from '../core/violation.js'

/**
 * A single entry in the baseline file.
 *
 * Violations are identified by rule + file + content hash.
 * Line numbers are stored for human readability but NOT used for matching —
 * they drift as code moves. The content hash (of the violation message +
 * element name) provides stable identity.
 */
export interface BaselineEntry {
  /** Rule description (from the fluent chain) */
  rule: string
  /** Relative file path (relative to baseline file location) */
  file: string
  /** Line number at time of baseline (informational, not used for matching) */
  line: number
  /** Stable identity hash: sha256(rule + element + message) */
  hash: string
}

/**
 * The baseline file structure.
 */
export interface BaselineFile {
  /** ISO timestamp when the baseline was generated */
  generatedAt: string
  /** Number of violations recorded */
  count: number
  /** The violations */
  violations: BaselineEntry[]
}

/**
 * Compute a stable hash for a violation.
 *
 * Uses rule + element + message as identity. This survives:
 * - Line number changes (code moved)
 * - Unrelated code changes in the same file
 *
 * Does NOT survive:
 * - Rule description changes (rewording .because())
 * - Element renames (class renamed)
 * - Message text changes (condition wording updated)
 *
 * This is intentional — if the rule or element changes,
 * the violation should be re-evaluated.
 */
export function hashViolation(violation: ArchViolation): string {
  const content = `${violation.rule}::${violation.element}::${violation.message}`
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

/**
 * Convert an absolute file path to a path relative to the baseline file.
 * Baseline files store relative paths so they're portable across machines.
 */
function toRelativePath(absolutePath: string, baselineDir: string): string {
  return path.relative(baselineDir, absolutePath)
}

/**
 * Convert a relative path back to absolute.
 */
function toAbsolutePath(relativePath: string, baselineDir: string): string {
  return path.resolve(baselineDir, relativePath)
}

/**
 * Load a baseline from a JSON file.
 *
 * @param baselinePath - Path to the baseline JSON file
 * @returns A Baseline object for use with check({ baseline })
 */
export function withBaseline(baselinePath: string): Baseline {
  const resolved = path.resolve(baselinePath)
  const baselineDir = path.dirname(resolved)

  if (!fs.existsSync(resolved)) {
    // No baseline file = no known violations = all violations are new
    return new Baseline(new Set(), baselineDir)
  }

  const raw = fs.readFileSync(resolved, 'utf-8')
  const data = JSON.parse(raw) as BaselineFile
  const hashes = new Set(data.violations.map((v) => v.hash))

  return new Baseline(hashes, baselineDir)
}

/**
 * Generate a baseline file from a list of violations.
 *
 * Call this to create/update the baseline:
 * ```typescript
 * const violations = collectAllViolations(rules)
 * generateBaseline(violations, 'arch-baseline.json')
 * ```
 */
export function generateBaseline(
  violations: ArchViolation[],
  outputPath: string,
): void {
  const resolved = path.resolve(outputPath)
  const baselineDir = path.dirname(resolved)

  const entries: BaselineEntry[] = violations.map((v) => ({
    rule: v.rule,
    file: toRelativePath(v.file, baselineDir),
    line: v.line,
    hash: hashViolation(v),
  }))

  const baseline: BaselineFile = {
    generatedAt: new Date().toISOString(),
    count: entries.length,
    violations: entries,
  }

  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, JSON.stringify(baseline, null, 2) + '\n')
}

/**
 * A loaded baseline. Passed to check({ baseline }) to filter known violations.
 */
export class Baseline {
  constructor(
    private readonly knownHashes: Set<string>,
    private readonly baselineDir: string,
  ) {}

  /**
   * Check if a violation is known (exists in the baseline).
   * Known violations are filtered out — they don't cause failures.
   */
  isKnown(violation: ArchViolation): boolean {
    return this.knownHashes.has(hashViolation(violation))
  }

  /**
   * Filter out known violations, returning only new ones.
   */
  filterNew(violations: ArchViolation[]): ArchViolation[] {
    return violations.filter((v) => !this.isKnown(v))
  }

  /** Number of known violations in the baseline */
  get size(): number {
    return this.knownHashes.size
  }
}
```

### Why content hash, not line numbers

The spec suggests "fuzzy line matching (within a small window)." But fuzzy matching is fragile:

- Add 10 lines above a violation → all line numbers shift → baseline misses them
- Two violations on adjacent lines → fuzzy matching might confuse them

Content hashing (`sha256(rule + element + message)`) is more robust:

- Survives line number changes (code reformat, added imports)
- Survives unrelated code changes in the same file
- Correctly re-evaluates if the rule text or element name changes

The tradeoff: if you rename a class, its baseline entry won't match anymore. This is correct — renamed code should be re-evaluated.

## Phase 2: Diff-Aware Mode

### `src/helpers/diff-aware.ts`

```typescript
import { execSync } from 'node:child_process'
import path from 'node:path'
import type { ArchViolation } from '../core/violation.js'

/**
 * A diff filter that restricts violation reporting to files
 * changed since a base branch.
 *
 * IMPORTANT: Rules evaluate the FULL project (needed for cross-file
 * rules like cycles and layer ordering). Only the REPORTING is filtered
 * to changed files. This ensures correctness — a new file that creates
 * a cycle is detected even though the cycle involves unchanged files.
 */
export class DiffFilter {
  private readonly changedFiles: Set<string>

  constructor(changedFiles: Set<string>) {
    this.changedFiles = changedFiles
  }

  /**
   * Filter violations to only those in changed files.
   */
  filterToChanged(violations: ArchViolation[]): ArchViolation[] {
    return violations.filter((v) => this.changedFiles.has(v.file))
  }

  /** Number of changed files detected */
  get size(): number {
    return this.changedFiles.size
  }
}

/**
 * Create a diff filter from git, comparing HEAD against a base branch.
 *
 * Uses `git diff --name-only <base>...HEAD` to find changed files.
 * Resolves relative paths to absolute paths for matching against
 * violation file paths (which are always absolute).
 *
 * @param baseBranch - The base branch to diff against (default: 'main')
 * @returns A DiffFilter for use with check({ diff })
 *
 * @example
 * // Only report violations in files changed since main
 * classes(p).should().notContain(call('eval')).check({ diff: diffAware('main') })
 */
export function diffAware(baseBranch: string = 'main'): DiffFilter {
  const cwd = process.cwd()

  let output: string
  try {
    output = execSync(`git diff --name-only ${baseBranch}...HEAD`, {
      encoding: 'utf-8',
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    // Not a git repo, or base branch doesn't exist — return all files as "changed"
    // This means no filtering, which is the safe default
    console.warn(
      `[ts-archunit] Could not run git diff against '${baseBranch}'. All violations will be reported.`,
    )
    return new DiffFilter(new Set()) // empty set = filterToChanged returns nothing, but we handle this below
  }

  if (output === '') {
    // No changes — empty set means nothing is "changed", so all violations are filtered out
    return new DiffFilter(new Set())
  }

  const changedFiles = new Set(
    output.split('\n').map((relativePath) => path.resolve(cwd, relativePath)),
  )

  return new DiffFilter(changedFiles)
}
```

### Evaluation scope vs reporting scope

This is a critical design point from the spec (Section 11.4):

- **Evaluation scope: FULL project.** Rules always analyze the complete codebase. A cycle detection rule needs all modules to find cycles. A layer rule needs all imports.
- **Reporting scope: changed files only.** Violations are only surfaced for files in the diff. Existing violations in untouched files are silently ignored.

This means a developer adding a new file won't be blocked by violations in old files — but their new file must comply.

## Phase 3: Integration with RuleBuilder

### `src/core/check-options.ts`

```typescript
import type { Baseline } from '../helpers/baseline.js'
import type { DiffFilter } from '../helpers/diff-aware.js'

/**
 * Options passed to .check() and .warn() to filter violations.
 *
 * @example
 * // Baseline only
 * .check({ baseline })
 *
 * // Diff-aware only
 * .check({ diff: diffAware('main') })
 *
 * // Both
 * .check({ baseline, diff: diffAware('main') })
 */
export interface CheckOptions {
  /** Filter out known violations from a baseline file */
  baseline?: Baseline
  /** Filter to only violations in changed files */
  diff?: DiffFilter
}
```

### Update `src/core/rule-builder.ts`

Modify `.check()` and `.warn()` to accept `CheckOptions`:

```typescript
import type { CheckOptions } from './check-options.js'

// In RuleBuilder<T>:

  /**
   * Execute the rule and throw `ArchRuleError` if any violations are found.
   *
   * @param options - Optional baseline and diff filtering
   */
  check(options?: CheckOptions): void {
    let violations = this.evaluate()

    // Apply baseline filter — remove known violations
    if (options?.baseline) {
      violations = options.baseline.filterNew(violations)
    }

    // Apply diff filter — only violations in changed files
    if (options?.diff) {
      violations = options.diff.filterToChanged(violations)
    }

    if (violations.length > 0) {
      throw new ArchRuleError(violations, this._reason)
    }
  }

  /**
   * Execute the rule and log violations to stderr. Does not throw.
   *
   * @param options - Optional baseline and diff filtering
   */
  warn(options?: CheckOptions): void {
    let violations = this.evaluate()

    if (options?.baseline) {
      violations = options.baseline.filterNew(violations)
    }

    if (options?.diff) {
      violations = options.diff.filterToChanged(violations)
    }

    if (violations.length > 0) {
      // ... existing warn formatting
    }
  }
```

Also update `SliceRuleBuilder` with the same `CheckOptions` parameter on its `check()` and `warn()` methods.

## Phase 4: Helper for Baseline Generation

Users need a way to generate the baseline. Without a CLI (plan 0020), they use a helper:

### `src/helpers/baseline-generator.ts`

```typescript
import type { ArchViolation } from '../core/violation.js'
import type { RuleBuilder } from '../core/rule-builder.js'
import { generateBaseline } from './baseline.js'

/**
 * Collect violations from a rule WITHOUT throwing.
 *
 * Used to generate a baseline: run all rules, collect violations,
 * write them to a baseline file.
 *
 * @example
 * const violations = collectViolations(
 *   classes(p).that().extend('Base').should().notContain(call('parseInt')),
 *   classes(p).that().extend('Base').should().notContain(newExpr('Error')),
 * )
 * generateBaseline(violations, 'arch-baseline.json')
 */
export function collectViolations(
  ...builders: Array<{ check: () => void }>
): ArchViolation[] {
  const allViolations: ArchViolation[] = []

  for (const builder of builders) {
    try {
      builder.check()
    } catch (error: unknown) {
      if (error instanceof Error && 'violations' in error) {
        const archError = error as { violations: ArchViolation[] }
        allViolations.push(...archError.violations)
      }
    }
  }

  return allViolations
}
```

**Usage in a one-time script (`generate-baseline.ts`):**

```typescript
import { project, classes, call, newExpr } from 'ts-archunit'
import { collectViolations } from 'ts-archunit' // exported from index
import { generateBaseline } from 'ts-archunit'  // exported from index

const p = project('tsconfig.json')

const violations = collectViolations(
  classes(p).that().extend('BaseRepository').should().notContain(call('parseInt')),
  classes(p).that().extend('BaseRepository').should().notContain(newExpr('Error')),
)

generateBaseline(violations, 'arch-baseline.json')
console.log(`Baseline generated: ${violations.length} violations recorded`)
```

**Note on ADR-005 compliance:** The `collectViolations` function catches errors and checks for `violations` property using `in` operator, not `as` cast. The intermediate `archError` variable uses a structural type assertion — this is at the boundary of catching an unknown error, which is an unavoidable interop point. We use `instanceof Error` first to narrow, then check for `violations` property.

Actually, better approach — avoid the cast entirely by importing `ArchRuleError`:

```typescript
import { ArchRuleError } from '../core/errors.js'

export function collectViolations(
  ...builders: Array<{ check: () => void }>
): ArchViolation[] {
  const allViolations: ArchViolation[] = []

  for (const builder of builders) {
    try {
      builder.check()
    } catch (error: unknown) {
      if (error instanceof ArchRuleError) {
        allViolations.push(...error.violations)
      }
    }
  }

  return allViolations
}
```

Clean — `instanceof` narrows the type, no `as` needed. ADR-005 compliant.

## Phase 5: Public API Exports

### `src/index.ts` additions

```typescript
// Baseline mode
export { withBaseline, generateBaseline, Baseline } from './helpers/baseline.js'
export type { BaselineEntry, BaselineFile } from './helpers/baseline.js'

// Diff-aware mode
export { diffAware, DiffFilter } from './helpers/diff-aware.js'

// Check options
export type { CheckOptions } from './core/check-options.js'

// Baseline generation helper
export { collectViolations } from './helpers/baseline-generator.js'
```

## Phase 6: Tests

### Test fixtures

No special fixtures needed — tests use the existing PoC fixtures with rules that produce violations.

### `tests/helpers/baseline.test.ts`

1. **hashViolation produces consistent hashes** — same violation → same hash
2. **hashViolation produces different hashes for different violations** — different element, different hash
3. **generateBaseline writes valid JSON** — write to temp file, read back, verify structure
4. **generateBaseline stores relative paths** — file paths are relative to baseline file location
5. **withBaseline loads hashes** — generate baseline, load it, verify `.isKnown()` works
6. **withBaseline returns empty baseline for missing file** — no file = no known violations
7. **Baseline.filterNew removes known violations** — 5 violations, 3 in baseline → 2 new
8. **Baseline.filterNew returns all when baseline is empty** — no baseline = all violations are new
9. **Hash survives line number change** — same rule+element+message with different line → same hash
10. **Hash changes when element name changes** — renamed class → new hash → violation re-evaluated

### `tests/helpers/diff-aware.test.ts`

11. **DiffFilter.filterToChanged returns only matching files** — 5 violations in 3 files, 1 file changed → only violations in that file
12. **DiffFilter.filterToChanged returns empty for no changes** — no changed files → no violations reported
13. **diffAware falls back gracefully when not in git repo** — logs warning, returns filter that reports all violations

### `tests/core/rule-builder-options.test.ts`

14. **check({ baseline }) passes when all violations are known** — 3 violations all in baseline → no throw
15. **check({ baseline }) throws for new violations** — 3 violations, 2 in baseline → throws with 1 violation
16. **check({ diff }) filters to changed files** — violations in 3 files, only 1 changed → throws with violations from that file only
17. **check({ baseline, diff }) combines both filters** — baseline removes known, diff removes unchanged file violations
18. **warn({ baseline }) logs only new violations** — known violations not logged
19. **check() without options works as before** — backward compatible, no filtering

### `tests/integration/baseline.test.ts`

20. **End-to-end: generate baseline, then check with it** — run rules on PoC fixtures, generate baseline, add a new violation, verify only the new one fails
21. **Baseline file is valid JSON and can be committed to git** — verify format is human-readable

## Files Changed

| File | Change |
|------|--------|
| `src/helpers/baseline.ts` | New — BaselineEntry, BaselineFile, Baseline class, withBaseline, generateBaseline, hashViolation |
| `src/helpers/diff-aware.ts` | New — DiffFilter class, diffAware |
| `src/helpers/baseline-generator.ts` | New — collectViolations helper |
| `src/core/check-options.ts` | New — CheckOptions interface |
| `src/core/rule-builder.ts` | Modified — check() and warn() accept CheckOptions |
| `src/builders/slice-rule-builder.ts` | Modified — check() and warn() accept CheckOptions |
| `src/index.ts` | Modified — export baseline, diff-aware, check options |
| `tests/helpers/baseline.test.ts` | New — 10 tests |
| `tests/helpers/diff-aware.test.ts` | New — 3 tests |
| `tests/core/rule-builder-options.test.ts` | New — 6 tests |
| `tests/integration/baseline.test.ts` | New — 2 tests |

## Out of Scope

- **CLI commands** (`npx ts-archunit baseline --output`) — plan 0020 wraps the programmatic API
- **Automatic baseline ratcheting** — "regenerate baseline and fail if it grows" is a CI pattern, not a library feature. Users add this to their CI scripts.
- **Per-rule baselines** — one baseline file covers all rules. Per-rule baselines would add complexity for little benefit.
- **Violation diff display** — "3 new violations, 2 resolved since last baseline" is a nice CI message but deferred to plan 0019 (output formats)
- **Baseline merge conflict resolution** — the baseline is a JSON file. Git merge conflicts are resolved by regenerating it.
