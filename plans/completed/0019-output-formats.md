# Plan 0019: Output Formats — JSON & GitHub Annotations

## Status

- **State:** Done
- **Priority:** P2 — Enables CI integration and inline PR feedback
- **Effort:** 0.5-1 day
- **Created:** 2026-03-26
- **Depends on:** 0006 (Violation Reporting)

## Purpose

Add JSON and GitHub Actions annotation output formats so violations integrate with CI tooling and appear inline on PR diffs. This is the "agents see violations where they wrote bad code" feature.

Currently, violations are formatted for terminal output (ANSI colors, code frames). CI systems and tooling need machine-readable formats:

1. **JSON** — for CI pipelines, custom dashboards, or piping to other tools
2. **GitHub Actions annotations** — violations appear as inline annotations on the PR diff, exactly at the line where the violation occurs

### Why this matters for AI agents

When an AI agent creates a PR, GitHub annotations show the architecture violation inline on the diff — the agent (or the developer reviewing) sees immediately what went wrong and why. This is the fastest feedback loop for enforcing architecture rules.

## Phase 1: JSON Formatter

### `src/core/format-json.ts`

```typescript
import type { ArchViolation } from './violation.js'

/**
 * Format violations as a JSON string.
 *
 * Useful for CI pipelines, custom dashboards, or piping to other tools.
 *
 * @example
 * const violations = collectViolations(rule1, rule2)
 * console.log(formatViolationsJson(violations))
 */
export function formatViolationsJson(violations: ArchViolation[], reason?: string): string {
  const output = {
    summary: {
      total: violations.length,
      reason: reason ?? null,
    },
    violations: violations.map((v) => ({
      rule: v.rule,
      element: v.element,
      file: v.file,
      line: v.line,
      message: v.message,
      because: v.because ?? null,
      suggestion: v.suggestion ?? null,
    })),
  }
  return JSON.stringify(output, null, 2)
}
```

## Phase 2: GitHub Actions Annotation Formatter

GitHub Actions supports [workflow commands](https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#setting-a-warning-message) that create inline annotations:

```
::error file={file},line={line},title={title}::{message}
::warning file={file},line={line},title={title}::{message}
```

These appear directly on the PR diff at the specified file and line.

### `src/core/format-github.ts`

```typescript
import path from 'node:path'
import type { ArchViolation } from './violation.js'

/**
 * Format violations as GitHub Actions annotation commands.
 *
 * Each violation becomes an `::error` or `::warning` command that GitHub
 * renders as an inline annotation on the PR diff.
 *
 * File paths are converted to relative (GitHub needs relative paths from repo root).
 *
 * @param severity - 'error' for ::error, 'warning' for ::warning
 *
 * @example
 * // In a GitHub Actions workflow step:
 * // - run: npm run test 2>&1 | tee test-output.txt
 * // Or directly from the test file:
 * console.log(formatViolationsGitHub(violations))
 */
export function formatViolationsGitHub(
  violations: ArchViolation[],
  severity: 'error' | 'warning' = 'error',
): string {
  const cwd = process.cwd()

  return violations
    .map((v) => {
      const relativePath = path.relative(cwd, v.file)
      const title = `Architecture Violation: ${v.rule}`
      const message = v.because ? `${v.message} (${v.because})` : v.message

      // GitHub annotation format: ::level file=path,line=N,title=T::message
      return `::${severity} file=${relativePath},line=${String(v.line)},title=${escapeGitHub(title)}::${escapeGitHub(message)}`
    })
    .join('\n')
}

/**
 * Escape special characters for GitHub Actions commands.
 * GitHub uses % encoding for newlines and other control chars.
 */
function escapeGitHub(text: string): string {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}
```

## Phase 3: Format Option on RuleBuilder

Add a `format` option to `CheckOptions` so users can switch output formats:

### Update `src/core/check-options.ts`

```typescript
/**
 * Output format for violations.
 *
 * - 'terminal' (default): ANSI-colored output with code frames
 * - 'json': Machine-readable JSON
 * - 'github': GitHub Actions annotation commands
 */
export type OutputFormat = 'terminal' | 'json' | 'github'
```

Add `format?: OutputFormat` to `CheckOptions`.

### Update `src/core/rule-builder.ts`

The `check()` and `warn()` methods use the format:

```typescript
check(options?: CheckOptions): void {
  let violations = this.evaluate()

  if (options?.baseline) {
    violations = options.baseline.filterNew(violations)
  }
  if (options?.diff) {
    violations = options.diff.filterToChanged(violations)
  }

  if (violations.length > 0) {
    if (options?.format === 'github') {
      // Print GitHub annotations to stdout (GitHub reads stdout for commands)
      console.log(formatViolationsGitHub(violations, 'error'))
    }
    throw new ArchRuleError(violations, this._reason)
  }
}

warn(options?: CheckOptions): void {
  let violations = this.evaluate()

  if (options?.baseline) {
    violations = options.baseline.filterNew(violations)
  }
  if (options?.diff) {
    violations = options.diff.filterToChanged(violations)
  }

  if (violations.length > 0) {
    if (options?.format === 'json') {
      console.warn(formatViolationsJson(violations, this._reason))
    } else if (options?.format === 'github') {
      console.log(formatViolationsGitHub(violations, 'warning'))
    } else {
      console.warn(formatViolations(violations, this._reason))
    }
  }
}
```

**Design note:** For `check()` with github format, we print the annotations AND throw the error. The annotations go to stdout (where GitHub reads them), the error fails the test. For `warn()`, annotations go to stdout as warnings, no throw.

For JSON format on `check()`, the error message itself uses plain format (for test runner output), but users can also call `formatViolationsJson()` directly via `collectViolations()`.

### Also update `SliceRuleBuilder` with the same format handling.

## Phase 4: Environment Auto-Detection

Detect GitHub Actions automatically so users don't need to pass `format: 'github'`:

### `src/core/environment.ts`

```typescript
import type { OutputFormat } from './check-options.js'

/**
 * Detect the current CI environment and return the appropriate output format.
 *
 * - GitHub Actions: detected via GITHUB_ACTIONS env var
 * - Other CI: detected via CI env var (falls back to terminal)
 * - Local: terminal
 */
export function detectFormat(): OutputFormat {
  if (process.env['GITHUB_ACTIONS'] === 'true') {
    return 'github'
  }
  return 'terminal'
}

/**
 * Check if running in any CI environment.
 */
export function isCI(): boolean {
  return process.env['CI'] === 'true' || process.env['GITHUB_ACTIONS'] === 'true'
}
```

Users can then write:

```typescript
import { detectFormat } from 'ts-archunit'

const format = detectFormat() // 'github' in GitHub Actions, 'terminal' locally

classes(p).that().extend('Base').should().notContain(call('parseInt')).check({ format })
```

Or more typically, set it once at the top of the arch test:

```typescript
const options = { format: detectFormat() }

// All rules use the same format
classes(p).should().notContain(call('eval')).check(options)
modules(p).should().notImportFrom('**forbidden**').check(options)
```

## Phase 5: Public API Exports

### `src/index.ts` additions

```typescript
// Output formats
export { formatViolationsJson } from './core/format-json.js'
export { formatViolationsGitHub } from './core/format-github.js'
export type { OutputFormat } from './core/check-options.js'
export { detectFormat, isCI } from './core/environment.js'
```

## Phase 6: Tests

### `tests/core/format-json.test.ts`

1. **Formats single violation as JSON** — valid JSON, correct fields
2. **Formats multiple violations** — array with correct count
3. **Includes reason when provided** — summary.reason field
4. **Null fields for missing optional values** — because and suggestion are null, not undefined
5. **Output is parseable** — `JSON.parse(output)` succeeds

### `tests/core/format-github.test.ts`

6. **Formats single violation as ::error** — correct format `::error file=...,line=...,title=...::message`
7. **Uses relative file paths** — absolute paths converted to relative
8. **Escapes newlines and percent** — special chars encoded
9. **Includes because in message** — appended in parentheses
10. **Uses ::warning for warn severity** — severity parameter works
11. **Multiple violations produce multiple lines** — one line per violation

### `tests/core/environment.test.ts`

12. **detectFormat returns 'github' when GITHUB_ACTIONS=true** — env var detection
13. **detectFormat returns 'terminal' by default** — no CI env vars
14. **isCI returns true when CI=true** — env var detection

### `tests/core/rule-builder-format.test.ts`

15. **check({ format: 'github' }) prints annotations and throws** — both happen
16. **warn({ format: 'json' }) prints JSON to stderr** — valid JSON output
17. **warn({ format: 'github' }) prints annotations** — ::warning format
18. **check() without format uses terminal** — backward compatible

## Files Changed

| File                                     | Change                                            |
| ---------------------------------------- | ------------------------------------------------- |
| `src/core/format-json.ts`                | New — formatViolationsJson                        |
| `src/core/format-github.ts`              | New — formatViolationsGitHub, escapeGitHub        |
| `src/core/environment.ts`                | New — detectFormat, isCI                          |
| `src/core/check-options.ts`              | Modified — add OutputFormat type and format field |
| `src/core/rule-builder.ts`               | Modified — check/warn use format option           |
| `src/builders/slice-rule-builder.ts`     | Modified — check/warn use format option           |
| `src/index.ts`                           | Modified — export new formatters and helpers      |
| `tests/core/format-json.test.ts`         | New — 5 tests                                     |
| `tests/core/format-github.test.ts`       | New — 6 tests                                     |
| `tests/core/environment.test.ts`         | New — 3 tests                                     |
| `tests/core/rule-builder-format.test.ts` | New — 4 tests                                     |

## Out of Scope

- **GitLab CI format** — can be added later as another formatter
- **SARIF format** — Static Analysis Results Interchange Format, used by GitHub Code Scanning. Higher effort, can be a follow-up.
- **Custom formatter API** — `defineFormatter()` for user-defined formats. Not needed until someone asks.
- **CLI --format flag** — plan 0020 adds CLI with format flag
- **Colored JSON** — JSON output is plain, not colored. Tools consume it programmatically.

## Example: GitHub Actions Workflow

```yaml
# .github/workflows/ci.yml
jobs:
  architecture:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run test -- --reporter=verbose
      # Annotations appear automatically because detectFormat()
      # returns 'github' when GITHUB_ACTIONS=true
```

The annotations appear inline on the PR diff — no extra configuration needed beyond `detectFormat()` in the arch test file.
