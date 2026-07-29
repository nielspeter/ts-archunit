import { describe, it, expect } from 'vitest'
import { formatViolationsGitHub, escapeGitHub } from '../../src/core/format-github.js'
import { makeViolation } from '../support/test-rule-builder.js'

/** Shorthand with format-github-test defaults. */
function mv(overrides: Partial<Parameters<typeof makeViolation>[0]> = {}) {
  return makeViolation({
    element: 'MyService.getTotal',
    file: `${process.cwd()}/src/service.ts`,
    line: 42,
    message: 'bad call to parseInt',
    ...overrides,
  })
}

describe('formatViolationsGitHub', () => {
  it('formats single violation as ::error', () => {
    const violations = [mv()]
    const output = formatViolationsGitHub(violations)
    expect(output).toContain('::error file=')
    expect(output).toContain(',line=42,')
    // ':' is escaped in property values as of 0.22.0 (workflow-command spec);
    // the rendered annotation title still reads "Architecture Violation: …".
    expect(output).toContain('title=Architecture Violation%3A test rule')
    expect(output).toContain('::bad call to parseInt')
  })

  it('uses relative file paths', () => {
    const violations = [mv()]
    const output = formatViolationsGitHub(violations)
    expect(output).toContain('file=src/service.ts,')
    expect(output).not.toContain(process.cwd())
  })

  it('escapes newlines and percent in text', () => {
    expect(escapeGitHub('line1\nline2')).toBe('line1%0Aline2')
    expect(escapeGitHub('100% done')).toBe('100%25 done')
    expect(escapeGitHub('a\rb')).toBe('a%0Db')
  })

  it('includes because in message when present', () => {
    const violations = [mv({ because: 'security risk' })]
    const output = formatViolationsGitHub(violations)
    expect(output).toContain('::bad call to parseInt (security risk)')
  })

  it('uses ::warning for warn severity', () => {
    const violations = [mv()]
    const output = formatViolationsGitHub(violations, 'warning')
    expect(output).toMatch(/^::warning file=/)
    expect(output).not.toContain('::error')
  })

  it('produces one line per violation for multiple violations', () => {
    const violations = [
      mv({ element: 'A', line: 1 }),
      mv({ element: 'B', line: 2 }),
      mv({ element: 'C', line: 3 }),
    ]
    const output = formatViolationsGitHub(violations)
    const lines = output.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatch(/^::error/)
    expect(lines[1]).toMatch(/^::error/)
    expect(lines[2]).toMatch(/^::error/)
  })
})

describe('locationless configuration findings (plan 0070)', () => {
  // A config finding has file '' and line 0, and `::error file=,line=0` is not
  // a valid annotation — GitHub drops or misplaces it. These render as
  // run-level annotations instead. Review measured the branch as deletable
  // with nothing failing; these pin it.

  it('emits a run-level annotation with no file/line properties', () => {
    const output = formatViolationsGitHub([mv({ file: '', line: 0 })])
    expect(output).toMatch(/^::error title=/)
    expect(output).not.toContain('file=')
    expect(output).not.toContain('line=')
  })

  it('a located violation in the same batch keeps its file annotation', () => {
    const output = formatViolationsGitHub([mv({ file: '', line: 0 }), mv({ line: 3 })])
    const lines = output.split('\n')
    expect(lines[0]).toMatch(/^::error title=/)
    expect(lines[1]).toMatch(/^::error file=/)
  })

  it('escapes commas and colons in file=, which is a property value too', () => {
    // The runner splits the property list on commas, so an unescaped path
    // truncates the annotation onto a file that does not exist — measured.
    const output = formatViolationsGitHub([mv({ file: 'src/a,b.ts', line: 3 })])
    expect(output).toContain('file=src/a%2Cb.ts')
    expect(output).not.toContain('file=src/a,b.ts')
  })

  it('escapes commas and colons in the title, which is the only identity carrier', () => {
    const output = formatViolationsGitHub([
      mv({ file: '', line: 0, ruleId: 'preset/layered: {a,b}' }),
    ])
    const title = output.slice(0, output.indexOf('::', 2))
    expect(title).not.toContain(',')
    expect(title).toContain('%2C')
    expect(title).toContain('%3A')
  })
})
