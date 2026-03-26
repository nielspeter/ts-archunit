# Plan 0006: Violation Reporting & Code Frames

## Status

- **State:** Not Started
- **Priority:** P1 — First plan after foundation; needed by all entry points for good DX
- **Effort:** 1-2 days
- **Created:** 2026-03-26
- **Depends on:** 0004 (Condition Engine — `ArchViolation`), 0005 (Rule Builder — `ArchRuleError`, `formatViolations`)

## Purpose

Upgrade violation reporting from plain-text bullet lists to actionable, visual output with source code context. After this plan, every violation shows the exact source line with surrounding context (a "code frame"), grouped by rule, with a violation counter, colored terminal output, and an optional suggestion field for future `useInsteadOf` rules.

This plan touches only the reporter layer. It does not add new conditions, entry points, or predicates. All existing tests continue to pass — the violation interface gains optional fields, and the formatter is replaced with a richer one.

The target output format:

```
Architecture Violation [1 of 3]

  Rule: that have name matching /Repository$/ should not contain call('parseInt')
  Reason: use shared extractCount() helper instead

  webhook.repository.ts:56 — WebhookRepository.query()

    54 |     const countResult = await baseQuery.clone().count('* as count').first()
    55 |     const total =
  > 56 |       typeof countResult.count === 'string' ? parseInt(countResult.count, 10) : countResult.count
    57 |

  Suggestion: Replace parseInt() with this.extractCount()
```

## Phase 1: Code Frame Extraction

### `src/core/code-frame.ts` (new)

A pure function that takes source text, a target line number, and a context radius, and returns a formatted code frame string. No ts-morph dependency — it operates on plain strings so it can be tested in isolation.

```typescript
/**
 * Options for code frame generation.
 */
export interface CodeFrameOptions {
  /** Number of context lines before and after the target line. Default: 3 */
  contextLines?: number
}

/**
 * Generate a code frame showing source context around a target line.
 *
 * @param sourceText - Full source file text
 * @param targetLine - 1-based line number to highlight
 * @param options - Context line count
 * @returns Formatted code frame string, or empty string if targetLine is out of range
 */
export function generateCodeFrame(
  sourceText: string,
  targetLine: number,
  options?: CodeFrameOptions,
): string {
  const contextLines = options?.contextLines ?? 3
  const lines = sourceText.split('\n')

  if (targetLine < 1 || targetLine > lines.length) {
    return ''
  }

  const start = Math.max(0, targetLine - 1 - contextLines)
  const end = Math.min(lines.length, targetLine + contextLines)

  // Determine gutter width from the largest line number in the range
  const gutterWidth = String(end).length

  const frameLines: string[] = []
  for (let i = start; i < end; i++) {
    const lineNum = i + 1
    const isTarget = lineNum === targetLine
    const marker = isTarget ? '>' : ' '
    const paddedNum = String(lineNum).padStart(gutterWidth)
    frameLines.push(`  ${marker} ${paddedNum} | ${lines[i]}`)
  }

  return frameLines.join('\n')
}
```

Key decisions:

- **3-line context** is the default (matching spec Section 12). Configurable via `contextLines` for future use.
- **1-based line numbers** to match ts-morph's `getStartLineNumber()`.
- **Gutter alignment** — line numbers are right-padded to the width of the largest line number in the range.
- **`>` marker** on the violating line. Two-space indent on all lines so the frame is visually inset.
- **Returns empty string** for out-of-range lines rather than throwing — violations should never crash the formatter.

## Phase 2: Extend ArchViolation with Optional Fields

### `src/core/violation.ts` (modified)

Add two optional fields to `ArchViolation`:

```typescript
export interface ArchViolation {
  /** Human-readable rule description (from the fluent chain) */
  rule: string
  /** Element identifier, e.g. "OrderService.getTotal()" or "parseConfig" */
  element: string
  /** Absolute file path where the violation occurs */
  file: string
  /** Line number where the violating element starts */
  line: number
  /** Human-readable description of what went wrong */
  message: string
  /** Optional rationale provided via .because() */
  because?: string
  /** Source code snippet around the violation line */
  codeFrame?: string
  /** Actionable suggestion for fixing the violation (e.g. "Replace parseInt() with this.extractCount()") */
  suggestion?: string
}
```

Both fields are optional. Existing code that creates violations without them continues to work unchanged. The `suggestion` field is populated by future conditions like `useInsteadOf` (plan 0011). The `codeFrame` field is populated by `createViolation` when a ts-morph node is available.

### Update `createViolation` to generate code frames

```typescript
import { generateCodeFrame } from './code-frame.js'

export function createViolation(
  node: Node,
  message: string,
  context: { rule: string; because?: string; suggestion?: string },
): ArchViolation {
  const line = getElementLine(node)
  const sourceText = node.getSourceFile().getFullText()
  return {
    rule: context.rule,
    element: getElementName(node),
    file: getElementFile(node),
    line,
    message,
    because: context.because,
    suggestion: context.suggestion,
    codeFrame: generateCodeFrame(sourceText, line),
  }
}
```

The `context` parameter gains an optional `suggestion` field. Existing callers that omit it are unaffected.

## Phase 3: ANSI Color Helpers

### `src/core/ansi.ts` (new)

Minimal ANSI escape code helpers. No external dependency — just the standard SGR codes. Color is auto-disabled when `NO_COLOR` env var is set or stdout is not a TTY (checked via `process.stdout.isTTY`).

```typescript
const enabled =
  typeof process !== 'undefined' &&
  !process.env['NO_COLOR'] &&
  process.stdout?.isTTY === true

function wrap(code: number, resetCode: number): (text: string) => string {
  if (!enabled) return (text) => text
  return (text) => `\x1b[${String(code)}m${text}\x1b[${String(resetCode)}m`
}

export const bold = wrap(1, 22)
export const dim = wrap(2, 22)
export const red = wrap(31, 39)
export const yellow = wrap(33, 39)
export const cyan = wrap(36, 39)
export const gray = wrap(90, 39)
```

Design notes:

- **`NO_COLOR` standard** (https://no-color.org/) — respected by default.
- **TTY check** — colors are only applied when writing to a terminal, not when piped to a file or CI log capture.
- **No dependency** — six SGR codes, no chalk/kleur needed. Keeps the package zero-dependency (aside from ts-morph and picomatch).

## Phase 4: Enhanced Violation Formatter

### `src/core/format.ts` (new)

The main formatting function. Takes violations, groups them by rule, and produces the full terminal output.

```typescript
import type { ArchViolation } from './violation.js'
import { bold, red, yellow, cyan, dim, gray } from './ansi.js'
import path from 'node:path'

/**
 * Format options for violation output.
 */
export interface FormatOptions {
  /** Working directory for relative path display. Default: process.cwd() */
  cwd?: string
  /** Whether to include code frames in output. Default: true */
  codeFrames?: boolean
}

/**
 * Format violations into a rich, readable terminal string.
 *
 * Groups violations by rule, shows a counter ("Architecture Violation [1 of 3]"),
 * displays code frames and suggestions, and uses ANSI colors for emphasis.
 */
export function formatViolations(
  violations: ArchViolation[],
  reason?: string,
  options?: FormatOptions,
): string {
  if (violations.length === 0) return ''

  const cwd = options?.cwd ?? process.cwd()
  const showCodeFrames = options?.codeFrames ?? true
  const total = violations.length
  const sections: string[] = []

  for (let i = 0; i < violations.length; i++) {
    const v = violations[i]!
    const counter = bold(red(`Architecture Violation [${String(i + 1)} of ${String(total)}]`))

    // Rule line
    const ruleLine = `  ${dim('Rule:')} ${v.rule}`

    // Reason line (from .because())
    const reasonLine = v.because ? `  ${dim('Reason:')} ${v.because}` : reason ? `  ${dim('Reason:')} ${reason}` : ''

    // Location: relative path + element
    const relativePath = path.relative(cwd, v.file)
    const location = `  ${cyan(`${relativePath}:${String(v.line)}`)} ${dim('—')} ${v.element}`

    // Code frame
    const codeLine = showCodeFrames && v.codeFrame ? `\n${v.codeFrame}` : ''

    // Suggestion
    const suggestionLine = v.suggestion ? `\n  ${yellow(`Suggestion: ${v.suggestion}`)}` : ''

    const parts = [counter, '', ruleLine]
    if (reasonLine) parts.push(reasonLine)
    parts.push('', location)
    if (codeLine) parts.push(codeLine)
    if (suggestionLine) parts.push(suggestionLine)

    sections.push(parts.join('\n'))
  }

  return sections.join('\n\n')
}

/**
 * Format violations into a plain-text string (no ANSI codes).
 *
 * Used by ArchRuleError.message — error messages should be plain text
 * since they may be captured by test runners, serialized, or logged to files.
 */
export function formatViolationsPlain(
  violations: ArchViolation[],
  reason?: string,
): string {
  if (violations.length === 0) return ''

  const header = `Architecture violation${violations.length === 1 ? '' : 's'} (${String(violations.length)} found)`
  const reasonLine = reason ? `\nReason: ${reason}` : ''

  const details = violations
    .map((v, i) => {
      const parts = [`  [${String(i + 1)}/${String(violations.length)}] ${v.element}: ${v.message} (${v.file}:${String(v.line)})`]
      if (v.codeFrame) parts.push(v.codeFrame)
      if (v.suggestion) parts.push(`  Suggestion: ${v.suggestion}`)
      return parts.join('\n')
    })
    .join('\n\n')

  return `${header}${reasonLine}\n\n${details}`
}
```

Two functions:

1. **`formatViolations`** — Rich output with ANSI colors, used by `.warn()` and future CLI output. Groups each violation with a counter header, rule, reason, location, code frame, and suggestion.
2. **`formatViolationsPlain`** — Plain text, used by `ArchRuleError.message`. Test runners capture error messages as strings, so no ANSI codes. Includes code frames and suggestions but without color.

## Phase 5: Update ArchRuleError and RuleBuilder

### `src/core/errors.ts` (modified)

Replace the inline `formatViolations` with the new plain-text formatter:

```typescript
import type { ArchViolation } from './violation.js'
import { formatViolationsPlain } from './format.js'

/**
 * Thrown by `.check()` when architecture violations are found.
 *
 * Integrates naturally with vitest/jest — the test fails with a readable
 * error message listing all violations and their locations.
 */
export class ArchRuleError extends Error {
  public readonly violations: ArchViolation[]

  constructor(violations: ArchViolation[], reason?: string) {
    super(formatViolationsPlain(violations, reason))
    this.name = 'ArchRuleError'
    this.violations = violations
  }
}
```

### `src/core/rule-builder.ts` (modified)

Update `.warn()` to use the rich formatter:

```typescript
import { formatViolations } from './format.js'

// In the warn() method:
warn(): void {
  const violations = this.evaluate()
  if (violations.length > 0) {
    console.warn(formatViolations(violations, this._reason))
  }
}
```

## Phase 6: Public API Export

### `src/core/index.ts` (modified)

```typescript
export { generateCodeFrame } from './code-frame.js'
export type { CodeFrameOptions } from './code-frame.js'
export { formatViolations, formatViolationsPlain } from './format.js'
export type { FormatOptions } from './format.js'
```

### `src/index.ts` (modified)

```typescript
// Core — formatting
export { generateCodeFrame } from './core/code-frame.js'
export type { CodeFrameOptions } from './core/code-frame.js'
export { formatViolations, formatViolationsPlain } from './core/format.js'
export type { FormatOptions } from './core/format.js'
```

Exported so users can build custom reporters or format violations in their own way.

## Files Changed

| File | Change |
|------|--------|
| `src/core/code-frame.ts` | New — `generateCodeFrame()` pure function |
| `src/core/ansi.ts` | New — minimal ANSI color helpers (`bold`, `red`, `yellow`, `cyan`, `dim`, `gray`) |
| `src/core/format.ts` | New — `formatViolations()` (rich) and `formatViolationsPlain()` (plain) |
| `src/core/violation.ts` | Modified — add `codeFrame?` and `suggestion?` fields to `ArchViolation`; update `createViolation` context type and code frame generation |
| `src/core/errors.ts` | Modified — replace inline formatter with `formatViolationsPlain` |
| `src/core/rule-builder.ts` | Modified — `.warn()` uses `formatViolations` for rich output |
| `src/core/index.ts` | Modified — export new modules |
| `src/index.ts` | Modified — export new modules |
| `tests/core/code-frame.test.ts` | New — tests for code frame generation |
| `tests/core/format.test.ts` | New — tests for both formatters |
| `tests/core/ansi.test.ts` | New — tests for ANSI color helpers |
| `tests/core/violation.test.ts` | Modified — test `codeFrame` and `suggestion` fields on `createViolation` output |

## Test Inventory

| # | Test | File | What it validates |
|---|------|------|-------------------|
| 1 | generates a code frame with default 3-line context | `code-frame.test.ts` | Lines before/after target are included |
| 2 | marks the target line with `>` | `code-frame.test.ts` | Arrow marker on correct line |
| 3 | right-aligns line numbers in the gutter | `code-frame.test.ts` | Gutter width matches largest line number |
| 4 | clamps context at file start (target near line 1) | `code-frame.test.ts` | No negative indices, no blank lines above |
| 5 | clamps context at file end (target near last line) | `code-frame.test.ts` | No out-of-bounds, no blank lines below |
| 6 | respects custom `contextLines` option | `code-frame.test.ts` | 1-line context shows only 3 lines total |
| 7 | returns empty string for out-of-range line | `code-frame.test.ts` | Line 0, line > length both return `''` |
| 8 | handles single-line file | `code-frame.test.ts` | No crash, shows the one line with `>` |
| 9 | handles empty source text | `code-frame.test.ts` | Returns empty string |
| 10 | `formatViolationsPlain` includes counter per violation | `format.test.ts` | `[1/3]` numbering |
| 11 | `formatViolationsPlain` includes reason | `format.test.ts` | `Reason:` line present |
| 12 | `formatViolationsPlain` includes code frame when present | `format.test.ts` | Code frame text in output |
| 13 | `formatViolationsPlain` includes suggestion when present | `format.test.ts` | `Suggestion:` line present |
| 14 | `formatViolationsPlain` omits code frame when absent | `format.test.ts` | No extra blank lines |
| 15 | `formatViolationsPlain` returns empty string for no violations | `format.test.ts` | Edge case |
| 16 | `formatViolations` includes ANSI codes when enabled | `format.test.ts` | Contains `\x1b[` sequences (mock TTY) |
| 17 | `formatViolations` includes violation counter | `format.test.ts` | `[1 of 3]` in output |
| 18 | `formatViolations` shows relative file paths | `format.test.ts` | Absolute path converted to relative |
| 19 | `formatViolations` includes suggestion in yellow | `format.test.ts` | Suggestion text present |
| 20 | ANSI helpers produce correct escape sequences | `ansi.test.ts` | `bold('x')` wraps with SGR 1/22 |
| 21 | ANSI helpers are no-ops when `NO_COLOR` is set | `ansi.test.ts` | Returns plain text |
| 22 | `createViolation` populates `codeFrame` field | `violation.test.ts` | Code frame string is non-empty |
| 23 | `createViolation` populates `suggestion` field when provided | `violation.test.ts` | Suggestion present in output |
| 24 | `createViolation` omits `suggestion` when not provided | `violation.test.ts` | Field is `undefined` |
| 25 | `ArchRuleError` message includes code frames | `errors.test.ts` | Existing tests updated to verify new format |
| 26 | `.warn()` produces colored output | `rule-builder.test.ts` | `console.warn` receives ANSI-formatted string |

## Out of Scope

- **`useInsteadOf` condition** — plan 0011 will populate the `suggestion` field; this plan only adds the field and renders it
- **JSON / GitHub Annotations output format** — plan 0019
- **CLI standalone runner** — plan 0020
- **Grouped-by-file display** — the current format groups by violation (one block per violation with counter). Grouping by file is a future enhancement if users request it
- **Clickable file paths in terminals** — depends on terminal emulator support; the `file:line` format already works in VS Code terminal, iTerm2, etc.
- **Source maps** — violations report ts-morph positions in the original TypeScript source, not compiled JS. Source map support is not needed.
