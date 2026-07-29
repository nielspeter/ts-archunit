import { describe, it, expect } from 'vitest'
import { formatViolations, formatViolationsPlain } from '../../src/core/format.js'
import { formatViolationsGitHub } from '../../src/core/format-github.js'
import { makeViolation } from '../support/test-rule-builder.js'

/** Shorthand with format-test defaults (avoids repeating them everywhere). */
function mv(overrides: Partial<Parameters<typeof makeViolation>[0]> = {}) {
  return makeViolation({
    element: 'MyService.getTotal',
    file: '/project/src/service.ts',
    line: 42,
    message: 'bad call to parseInt',
    ...overrides,
  })
}

describe('formatViolationsPlain', () => {
  it('includes counter per violation', () => {
    const violations = [
      mv({ element: 'A', file: 'a.ts', line: 1, message: 'v1' }),
      mv({ element: 'B', file: 'b.ts', line: 2, message: 'v2' }),
      mv({ element: 'C', file: 'c.ts', line: 3, message: 'v3' }),
    ]
    const result = formatViolationsPlain(violations)
    expect(result).toContain('[1/3]')
    expect(result).toContain('[2/3]')
    expect(result).toContain('[3/3]')
  })

  it('includes reason when provided', () => {
    const violations = [mv()]
    const result = formatViolationsPlain(violations, 'use shared helper instead')
    expect(result).toContain('Reason: use shared helper instead')
  })

  it('includes code frame when present', () => {
    const codeFrame = '  > 42 | const x = parseInt(y)'
    const violations = [mv({ codeFrame })]
    const result = formatViolationsPlain(violations)
    expect(result).toContain(codeFrame)
  })

  it('includes suggestion when present', () => {
    const violations = [mv({ suggestion: 'Replace parseInt() with extractCount()' })]
    const result = formatViolationsPlain(violations)
    expect(result).toContain('Fix: Replace parseInt() with extractCount()')
  })

  it('omits code frame when absent', () => {
    const violations = [mv()]
    const result = formatViolationsPlain(violations)
    // Should not have double blank lines or stray markers
    expect(result).not.toContain('> ')
  })

  it('returns empty string for no violations', () => {
    expect(formatViolationsPlain([])).toBe('')
  })

  it('includes element and message in output', () => {
    const violations = [mv()]
    const result = formatViolationsPlain(violations)
    expect(result).toContain('MyService.getTotal')
    expect(result).toContain('bad call to parseInt')
    expect(result).toContain('1 found')
  })
})

describe('formatViolations', () => {
  it('includes violation counter', () => {
    const violations = [mv({ element: 'A' }), mv({ element: 'B' }), mv({ element: 'C' })]
    const result = formatViolations(violations)
    // In non-TTY (test env), ANSI is disabled, so plain text
    expect(result).toContain('[1 of 3]')
    expect(result).toContain('[2 of 3]')
    expect(result).toContain('[3 of 3]')
  })

  it('shows relative file paths', () => {
    const violations = [mv({ file: `${process.cwd()}/src/service.ts` })]
    const result = formatViolations(violations)
    expect(result).toContain('src/service.ts:42')
    expect(result).not.toContain(process.cwd())
  })

  it('includes suggestion as Fix line', () => {
    const violations = [mv({ suggestion: 'Use extractCount()' })]
    const result = formatViolations(violations)
    expect(result).toContain('Fix: Use extractCount()')
  })

  it('includes rule description', () => {
    const violations = [mv({ rule: 'should not call parseInt' })]
    const result = formatViolations(violations)
    expect(result).toContain('should not call parseInt')
  })

  it('includes reason from .because()', () => {
    const violations = [mv({ because: 'use helper instead' })]
    const result = formatViolations(violations)
    expect(result).toContain('use helper instead')
  })

  it('falls back to global reason when violation has no because', () => {
    const violations = [mv()]
    const result = formatViolations(violations, 'global reason')
    expect(result).toContain('global reason')
  })

  it('returns empty string for no violations', () => {
    expect(formatViolations([])).toBe('')
  })

  it('includes code frame when present', () => {
    const codeFrame = '  > 42 | const x = parseInt(y)'
    const violations = [mv({ codeFrame })]
    const result = formatViolations(violations)
    expect(result).toContain(codeFrame)
  })

  it('prints the message for a LOCATED violation, not only the location', () => {
    // The default surface dropped it for every ordinary violation: the location
    // slot rendered `file:line — element` and `message` was rendered nowhere, so
    // the single most specific sentence about the fault never reached the reader.
    // `formatViolationsPlain` had always printed it, which is how the two
    // formatters came to disagree about what a violation is.
    //
    // Both derivations asserted, because that disagreement is the actual defect.
    const violations = [mv({ message: 'contains call to parseInt' })]
    expect(formatViolations(violations)).toContain('contains call to parseInt')
    expect(formatViolationsPlain(violations)).toContain('contains call to parseInt')
    // And the location is still there — this is an addition, not a replacement.
    expect(formatViolations(violations)).toContain(':42')
    expect(formatViolations(violations)).toContain('MyService.getTotal')
  })

  it('respects codeFrames: false option', () => {
    const codeFrame = '  > 42 | const x = parseInt(y)'
    const violations = [mv({ codeFrame })]
    const result = formatViolations(violations, undefined, { codeFrames: false })
    expect(result).not.toContain(codeFrame)
  })
})

describe('formatViolationsGitHub sentence joins', () => {
  it('does not double the period when the message already ends in one', () => {
    // This is the one format that concatenates message and remedy onto a single
    // line, so it owns the punctuation between them. Measured on the real CLI:
    // `…(reading 'config').. Fix: …`, as soon as a producer wrote a
    // well-punctuated message.
    const out = formatViolationsGitHub([
      mv({ message: 'This rule file could not be evaluated.', suggestion: 'Fix the error.' }),
    ])
    expect(out).toContain('evaluated. Fix: Fix the error.')
    // Asserted on the message BODY, not the whole annotation: the fixture's file
    // is outside the cwd, so `path.relative` puts plenty of legitimate `..` in
    // the `file=` property. A blanket `not.toContain('..')` failed on those and
    // would have read as the fix not working.
    const body = out.slice(out.indexOf('::', 2) + 2)
    expect(body).not.toContain('..')
  })

  it('still inserts a period when the message does not end in one', () => {
    const out = formatViolationsGitHub([
      mv({ message: 'contains call to parseInt', suggestion: 'Use extractCount()' }),
    ])
    expect(out).toContain('parseInt. Fix: Use extractCount()')
  })
})

describe('formatViolations for location-less config-level findings', () => {
  const REMEDY = 'prefix these with "**/": services: "src/services/**"'

  /**
   * A meta-finding (empty selector / empty discovery) carries its whole remedy in
   * `message` and has no source location. The rich formatter used to print only
   * the location line, so the remedy was invisible on the default surface — the
   * one place the agent consumer reads it (ADR-008). "A message is only a remedy
   * if it is printed."
   */
  it('prints the message, so the remedy is not invisible', () => {
    const result = formatViolations([mv({ file: '', line: 0, message: REMEDY })])
    expect(result).toContain(REMEDY)
  })

  it('does not render a bogus :0 location or the cwd', () => {
    const result = formatViolations([mv({ file: '', line: 0, message: REMEDY })])
    expect(result).not.toContain(':0')
    expect(result).not.toContain(process.cwd())
  })

  it('still renders location and element for findings that have a file', () => {
    const result = formatViolations([mv({ file: '/project/src/a.ts', line: 7 })])
    expect(result).toContain('MyService.getTotal')
    expect(result).toContain(':7')
  })

  /**
   * The two halves of `remedyRepeatsMessage` in this formatter, which is the one
   * renderer that does NOT always print `message`.
   *
   * A location-less finding prints the message in the location's slot, so a
   * remedy identical to it would print twice — that was the shipped output for
   * every assertion-gate finding until it was measured (plan 0070). But a
   * LOCATED violation never prints `message` here, so for it the `Fix:` line is
   * the remedy's only appearance and must survive. Sabotage confirmed the
   * asymmetry is load-bearing: dropping the `!v.file` half of the condition
   * silently deleted the remedy from every located violation and 2408 tests
   * still passed.
   */
  it('renders a remedy that IS the message exactly once, in BOTH shapes', () => {
    // COUNTED, not just present. The previous version of this test asserted
    // `toContain('Fix: REMEDY')` for the located shape — which a duplicate
    // satisfies — and that is how a regression in the same release went
    // unnoticed: printing `message` for located violations made the location
    // slot render it, and the `Fix:` line rendered it again. Two occurrences,
    // caught by a probe rather than by this test.
    //
    // Asserting presence where the property is a count is the same
    // membership-not-identity mistake as asserting a remedy is present without
    // asserting no wrong remedy sits beside it.
    const both = [
      mv({ file: '', line: 0, message: REMEDY, suggestion: REMEDY }),
      mv({ file: '/project/src/a.ts', line: 7, message: REMEDY, suggestion: REMEDY }),
    ]
    for (const v of both) {
      const out = formatViolations([v], undefined, { codeFrames: false })
      expect(out.split(REMEDY).length - 1, v.file || '(no file)').toBe(1)
      // Present, not merely deduplicated away.
      expect(out, v.file || '(no file)').toContain(REMEDY)
    }
    // The located one keeps its location alongside the single remedy.
    const located = formatViolations([both[1]!], undefined, { codeFrames: false })
    expect(located).toContain(':7')
    expect(located).toContain('MyService.getTotal')
  })

  it('keeps a Fix line that differs from the message on both shapes', () => {
    const other = 'Use the shared helper.'
    expect(
      formatViolations([mv({ file: '', line: 0, message: REMEDY, suggestion: other })]),
    ).toContain(`Fix: ${other}`)
    expect(
      formatViolations([mv({ file: '/project/src/a.ts', line: 7, suggestion: other })]),
    ).toContain(`Fix: ${other}`)
  })
})
