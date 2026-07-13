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

  it('re-throws non-ArchRuleError errors from import', async () => {
    mockLoadRuleFiles.mockRejectedValue(new TypeError('unexpected error'))
    await expect(runCheck(baseArgs)).rejects.toThrow(TypeError)
  })

  it('captures violations from a preset that throws ArchRuleError on import (fallback)', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    mockLoadRuleFiles.mockRejectedValue(new ArchRuleError([v({ severity: 'error' })], 'preset'))
    expect(await runCheck(baseArgs)).toBe(1)
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
      { violations: () => [v({ element: 'ErrOne', severity: 'error' })] },
      { violations: () => [v({ element: 'WarnOne', severity: 'warn' })] },
    ])

    await runCheck({ ...baseArgs, format: 'github' })

    const lines = spy.mock.calls
      .map((c) => String(c[0]))
      .join('')
      .trim()
      .split('\n')
    // Severity is partitioned: exactly one ::error and one ::warning
    // (the old bug rendered both as ::error).
    expect(lines.filter((l) => l.startsWith('::error'))).toHaveLength(1)
    expect(lines.filter((l) => l.startsWith('::warning'))).toHaveLength(1)
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

    expect(count).toBe(2) // FromA (fallback) + FromB (still loaded)
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
