import { describe, it, expect, vi, afterEach } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import type { ArchProject } from '../../src/core/project.js'

// Mock only the rule-file loader; everything else (real builders, real project,
// real runCheck + formatter) runs, so this exercises the full pipeline.
vi.mock('../../src/cli/load-rules.js', () => ({ loadRuleFiles: vi.fn() }))

import { runCheck } from '../../src/cli/commands/check.js'
import { loadRuleFiles } from '../../src/cli/load-rules.js'
import { recommended } from '../../src/presets/recommended.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/presets/recommended')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

describe('recommended through the check pipeline', () => {
  it('emits ONE JSON document; the two errors set the exit, the two warns do not', async () => {
    const p = loadTestProject()
    const builders = recommended(p)
    vi.mocked(loadRuleFiles).mockResolvedValue(builders)
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

    const errorCount = await runCheck({
      ruleFiles: ['arch.rules.ts'],
      changed: false,
      base: 'main',
      format: 'json',
    })

    // One valid document, not per-builder blobs.
    expect(spy).toHaveBeenCalledTimes(1)
    const parsed = JSON.parse(String(spy.mock.calls[0]?.[0])) as {
      summary: { errors: number; warnings: number }
      violations: Array<{ severity: string; ruleId: string }>
    }

    // The two warn rules are surfaced but do not fail.
    const warnIds = new Set(
      parsed.violations.filter((v) => v.severity === 'warn').map((v) => v.ruleId),
    )
    expect(warnIds).toEqual(
      new Set(['preset/recommended/no-silent-catch', 'preset/recommended/no-empty-bodies']),
    )
    expect(parsed.summary.warnings).toBe(2)

    // The two error rules fail; exit code = error count, warns excluded.
    expect(parsed.summary.errors).toBe(2)
    expect(errorCount).toBe(2)
  })
})
