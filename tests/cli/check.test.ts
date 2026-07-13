import { describe, it, expect, vi, afterEach } from 'vitest'
import { runCheck } from '../../src/cli/commands/check.js'

// Mock the load-rules module to avoid needing actual rule files
vi.mock('../../src/cli/load-rules.js', () => ({
  loadRuleFiles: vi.fn(),
}))

import { loadRuleFiles } from '../../src/cli/load-rules.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchViolation } from '../../src/core/violation.js'

const mockLoadRuleFiles = vi.mocked(loadRuleFiles)

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
})
