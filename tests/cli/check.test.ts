import { describe, it, expect, vi, afterEach } from 'vitest'
import { runCheck } from '../../src/cli/commands/check.js'

// Mock the load-rules module to avoid needing actual rule files
vi.mock('../../src/cli/load-rules.js', () => ({
  loadRuleFiles: vi.fn(),
}))

import { loadRuleFiles } from '../../src/cli/load-rules.js'
import { ArchRuleError } from '../../src/core/errors.js'

const mockLoadRuleFiles = vi.mocked(loadRuleFiles)

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

describe('runCheck', () => {
  it('returns 0 when all rules pass', async () => {
    mockLoadRuleFiles.mockResolvedValue([{ check: () => undefined }])

    const failures = await runCheck({
      ruleFiles: ['rules.ts'],
      changed: false,
      base: 'main',
      format: 'terminal',
    })

    expect(failures).toBe(0)
  })

  it('returns failure count when rules fail', async () => {
    const failingBuilder = {
      check: () => {
        throw new ArchRuleError(
          [
            {
              rule: 'test',
              element: 'Foo',
              file: '/test.ts',
              line: 1,
              message: 'violation',
            },
          ],
          'test reason',
        )
      },
    }
    mockLoadRuleFiles.mockResolvedValue([failingBuilder])

    const failures = await runCheck({
      ruleFiles: ['rules.ts'],
      changed: false,
      base: 'main',
      format: 'terminal',
    })

    expect(failures).toBe(1)
  })

  it('re-throws non-ArchRuleError errors', async () => {
    const badBuilder = {
      check: () => {
        throw new TypeError('unexpected error')
      },
    }
    mockLoadRuleFiles.mockResolvedValue([badBuilder])

    await expect(
      runCheck({
        ruleFiles: ['rules.ts'],
        changed: false,
        base: 'main',
        format: 'terminal',
      }),
    ).rejects.toThrow(TypeError)
  })

  it('counts multiple failing rules independently', async () => {
    const makeFailingBuilder = () => ({
      check: () => {
        throw new ArchRuleError([
          { rule: 'test', element: 'X', file: '/x.ts', line: 1, message: 'fail' },
        ])
      },
    })
    const passingBuilder = { check: () => undefined }
    mockLoadRuleFiles.mockResolvedValue([
      makeFailingBuilder(),
      passingBuilder,
      makeFailingBuilder(),
    ])

    const failures = await runCheck({
      ruleFiles: ['rules.ts'],
      changed: false,
      base: 'main',
      format: 'terminal',
    })

    expect(failures).toBe(2)
  })
})
