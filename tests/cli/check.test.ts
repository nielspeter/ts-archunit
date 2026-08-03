import { describe, it, expect, vi, afterEach } from 'vitest'
import { runCheck } from '../../src/cli/commands/check.js'

// Mock the load-rules module to avoid needing actual rule files
vi.mock('../../src/cli/load-rules.js', () => ({
  loadRuleFiles: vi.fn(),
}))

// Mock the baseline helper so we can control filterNew without a baseline file
vi.mock('../../src/helpers/baseline.js', () => ({
  withBaseline: vi.fn(),
}))

import { loadRuleFiles } from '../../src/cli/load-rules.js'
import { withBaseline } from '../../src/helpers/baseline.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchViolation } from '../../src/core/violation.js'

const mockLoadRuleFiles = vi.mocked(loadRuleFiles)
const mockWithBaseline = vi.mocked(withBaseline)

function v(overrides: Partial<ArchViolation> = {}): ArchViolation {
  return {
    rule: 'test',
    element: 'Foo',
    file: '/test.ts',
    line: 1,
    message: 'violation',
    ...overrides,
  }
}

const baseArgs = {
  ruleFiles: ['rules.ts'],
  changed: false,
  base: 'main',
  format: 'terminal' as const,
}

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

describe('runCheck', () => {
  it('returns 0 when all rules pass', async () => {
    mockLoadRuleFiles.mockResolvedValue([{ violations: () => [] }])
    expect(await runCheck(baseArgs)).toBe(0)
  })

  it('returns the error-severity violation count when rules fail', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    mockLoadRuleFiles.mockResolvedValue([{ violations: () => [v({ severity: 'error' })] }])
    expect(await runCheck(baseArgs)).toBe(1)
  })

  it('reports warn-severity violations but does NOT fail (exit 0)', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    mockLoadRuleFiles.mockResolvedValue([{ violations: () => [v({ severity: 'warn' })] }])
    expect(await runCheck(baseArgs)).toBe(0)
    expect(stderr).toHaveBeenCalled() // still surfaced, just non-failing
  })

  it('REVERSED (bug 0025): a non-ArchRuleError becomes a finding, never a re-throw', async () => {
    // This test pinned the defect. Re-throwing escaped the per-file loop, so no
    // report was written, no exit code was returned, and every finding already
    // collected in the run was discarded — measured with two rule files, where
    // one malformed rule silenced the other file's four real violations and
    // printed a raw Node stack trace with node_modules paths in their place.
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    mockLoadRuleFiles.mockRejectedValue(new TypeError('unexpected error'))
    const code = await runCheck(baseArgs)
    expect(code).toBe(1)
  })

  it('a throwing rule file does not silence the other files (bug 0025)', async () => {
    // The property the re-throw broke, asserted by IDENTITY rather than by a
    // count: the surviving file's own violation has to be in the report, not
    // just "two findings were produced".
    const reported: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      reported.push(String(chunk))
      return true
    })
    mockLoadRuleFiles
      .mockRejectedValueOnce(new TypeError('boom from file A'))
      .mockResolvedValueOnce([{ violations: () => [v({ element: 'SurvivorFromB' })] }])
    const code = await runCheck({ ...baseArgs, ruleFiles: ['a.rules.ts', 'b.rules.ts'] })
    const output = reported.join('')
    expect(output).toContain('SurvivorFromB')
    expect(output).toContain('boom from file A')
    expect(output).toContain('a.rules.ts')
    expect(code).toBe(2)
  })

  it('a throwing rule does not silence its siblings in the SAME file (bug 0025)', async () => {
    // Per-BUILDER, not merely per-file. One catch around the whole file would
    // pass the test above and still lose nineteen sibling rules out of twenty —
    // the loop over builders is right there, so the finer boundary is free.
    const reported: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      reported.push(String(chunk))
      return true
    })
    mockLoadRuleFiles.mockResolvedValue([
      {
        violations: () => {
          throw new RangeError('malformed rule')
        },
      },
      { violations: () => [v({ element: 'SiblingSurvived' })] },
    ])
    const code = await runCheck(baseArgs)
    const output = reported.join('')
    expect(output).toContain('SiblingSurvived')
    expect(output).toContain('malformed rule')
    expect(code).toBe(2)
  })

  it('WIRING: a location-less finding is attributed to its rule file', async () => {
    // `attributeToRuleFile` is unit-tested in tests/cli/rule-file-findings.ts.
    // This is the other half, and sabotage proved it was missing: unwiring the
    // call in this command left the whole suite green, because every assertion
    // about the attribution was made against the function rather than against
    // the command that has to call it.
    const reported: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      reported.push(String(chunk))
      return true
    })
    mockLoadRuleFiles.mockResolvedValue([
      {
        violations: () => [
          v({
            rule: 'x/vacuous',
            element: 'x/vacuous',
            file: '',
            line: 0,
            message: 'this rule asserts nothing and can never fail',
            bypassFilters: true,
          }),
        ],
      },
    ])
    const code = await runCheck({ ...baseArgs, ruleFiles: ['rules/mine.rules.ts'] })
    expect(code).toBe(1)
    expect(reported.join('')).toContain('rules/mine.rules.ts')
  })

  it('the rule-file failure is a configuration finding, so nothing can silence it', async () => {
    // A rule file that could not run enforced nothing, which is not a violation
    // to grade or to accept into a baseline. Asserted through the machinery
    // rather than by reading the flag back: `--changed` with no diff filters
    // ordinary findings out and must not filter this one.
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    mockLoadRuleFiles.mockRejectedValue(new TypeError('unloadable'))
    const code = await runCheck({ ...baseArgs, changed: true })
    expect(code).toBe(1)
  })

  it('captures violations from a preset that throws ArchRuleError on import (fallback)', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    mockLoadRuleFiles.mockRejectedValue(new ArchRuleError([v({ severity: 'error' })], 'preset'))
    // TWO, not one: the thrown violation plus the truncation notice. An
    // `ArchRuleError` from loading means a terminal fired at module scope, so any rule
    // after it never ran — and saying so is bug 0029's fix. Both are error-severity,
    // and `runCheck` returns that count.
    expect(await runCheck(baseArgs)).toBe(2)
  })

  it('sums error-severity violations across builders', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    mockLoadRuleFiles.mockResolvedValue([
      { violations: () => [v({ element: 'X', severity: 'error' })] },
      { violations: () => [] },
      { violations: () => [v({ element: 'Y', severity: 'error' })] },
    ])
    expect(await runCheck(baseArgs)).toBe(2)
  })

  it('emits ONE JSON document for a multi-builder run (agent-loop contract)', async () => {
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    mockLoadRuleFiles.mockResolvedValue([
      { violations: () => [v({ element: 'A', severity: 'error' })] },
      { violations: () => [v({ element: 'B', severity: 'warn' })] },
    ])

    const count = await runCheck({ ...baseArgs, format: 'json' })

    expect(count).toBe(1) // one error, one warn
    expect(spy).toHaveBeenCalledTimes(1) // single write, not per-builder
    const output = String(spy.mock.calls[0]?.[0])
    const parsed = JSON.parse(output) as {
      summary: { total: number; errors: number; warnings: number }
      violations: unknown[]
    }
    expect(parsed.summary).toMatchObject({ total: 2, errors: 1, warnings: 1 })
    expect(parsed.violations).toHaveLength(2)
  })

  it('--format json emits a valid document even on a clean run (agent contract)', async () => {
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    mockLoadRuleFiles.mockResolvedValue([{ violations: () => [] }])

    const count = await runCheck({ ...baseArgs, format: 'json' })

    expect(count).toBe(0)
    expect(spy).toHaveBeenCalledTimes(1)
    const parsed = JSON.parse(String(spy.mock.calls[0]?.[0])) as {
      summary: { total: number; errors: number; warnings: number }
      violations: unknown[]
    }
    expect(parsed.summary).toMatchObject({ total: 0, errors: 0, warnings: 0 })
    expect(parsed.violations).toEqual([])
  })

  it('--format github renders warns as ::warning, not ::error', async () => {
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    mockLoadRuleFiles.mockResolvedValue([
      { violations: () => [v({ element: 'ErrOne', message: 'the error one', severity: 'error' })] },
      { violations: () => [v({ element: 'WarnOne', message: 'the warn one', severity: 'warn' })] },
    ])

    await runCheck({ ...baseArgs, format: 'github' })

    const lines = spy.mock.calls
      .map((c) => String(c[0]))
      .join('')
      .trim()
      .split('\n')
    // Severity is partitioned: exactly one ::error and one ::warning
    // (the old bug rendered both as ::error).
    // WHICH violation got which annotation. Counting one of each passes when
    // the two are swapped — the sharper form of the bug this guards, since a
    // warn rendered as ::error fails the build and an error rendered as
    // ::warning does not.
    const errors = lines.filter((l) => l.startsWith('::error'))
    const warnings = lines.filter((l) => l.startsWith('::warning'))
    // Identity AND cardinality: the identity catches a swap, and "exactly one of
    // each" catches the same violation annotated twice. Dropping the count to gain
    // the identity was a trade, and it did not need to be one.
    expect(errors).toHaveLength(1)
    expect(warnings).toHaveLength(1)
    expect(errors.join('')).toContain('the error one')
    expect(warnings.join('')).toContain('the warn one')
  })

  it('collects across multiple files and one file throwing on import does not abort the rest', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    mockLoadRuleFiles.mockImplementation((files) => {
      if (files[0] === 'a.ts') {
        return Promise.reject(
          new ArchRuleError([v({ element: 'FromA', severity: 'error' })], 'preset'),
        )
      }
      return Promise.resolve([{ violations: () => [v({ element: 'FromB', severity: 'error' })] }])
    })

    const count = await runCheck({ ...baseArgs, ruleFiles: ['a.ts', 'b.ts'] })

    // FromA (fallback) + a.ts's truncation notice + FromB (still loaded).
    //
    // The notice is bug 0029's fix: `a.ts` threw a terminal at module scope, so any
    // rule it declared after that point never ran. `b.ts` loaded cleanly and gets no
    // notice, which is the property that matters here — one file stopping early must
    // not make the others look truncated too.
    expect(count).toBe(3)
  })

  it('applies the baseline to the unified list before computing the exit code', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    // Baseline that suppresses the known error, leaving only the new one
    mockWithBaseline.mockReturnValue({
      filterNew: (vs: ArchViolation[]) => vs.filter((x) => x.element !== 'Known'),
    } as unknown as ReturnType<typeof withBaseline>)
    mockLoadRuleFiles.mockResolvedValue([
      { violations: () => [v({ element: 'Known', severity: 'error' })] },
      { violations: () => [v({ element: 'New', severity: 'error' })] },
    ])

    const count = await runCheck({ ...baseArgs, baseline: 'baseline.json' })

    expect(count).toBe(1) // Known filtered out by baseline, only New fails
  })
})
