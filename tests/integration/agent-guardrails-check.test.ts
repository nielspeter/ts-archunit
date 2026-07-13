import { describe, it, expect, vi, afterEach } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import type { ArchProject } from '../../src/core/project.js'

// Mock only the rule-file loader; everything else (real builders, real project,
// real runCheck + formatter) runs, so this exercises the full pipeline.
vi.mock('../../src/cli/load-rules.js', () => ({ loadRuleFiles: vi.fn() }))

import { runCheck } from '../../src/cli/commands/check.js'
import { loadRuleFiles } from '../../src/cli/load-rules.js'
import { agentGuardrails } from '../../src/presets/agent-guardrails.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/presets/agent-guardrails')
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

describe('agentGuardrails through the check pipeline', () => {
  it('emits ONE JSON document; errors set the exit, the copy-paste warn does not', async () => {
    const p = loadTestProject()
    const builders = agentGuardrails(p, {
      src: '**/mistakes.ts',
      noInlineLogic: ['parseInt'],
      noGenericErrors: true,
      noCopyPaste: true,
    })
    vi.mocked(loadRuleFiles).mockResolvedValue(builders)
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

    const errorCount = await runCheck({
      ruleFiles: ['arch.rules.ts'],
      changed: false,
      base: 'main',
      format: 'json',
    })

    // One valid document (not per-builder blobs)
    expect(spy).toHaveBeenCalledTimes(1)
    const parsed = JSON.parse(String(spy.mock.calls[0]?.[0])) as {
      summary: { errors: number; warnings: number }
      violations: Array<{ severity: string; ruleId: string; suggestion: string | null }>
    }

    // The copy-paste warn is surfaced (severity-tagged) but does not fail
    const warn = parsed.violations.find((v) => v.ruleId === 'preset/agent/no-copy-paste')
    expect(warn?.severity).toBe('warn')
    expect(parsed.summary.warnings).toBeGreaterThanOrEqual(1)

    // The error rules fail; exit code = error count, warn excluded
    expect(parsed.summary.errors).toBeGreaterThanOrEqual(2)
    expect(errorCount).toBe(parsed.summary.errors)

    // Agent-facing metadata reaches the payload
    expect(parsed.violations.every((v) => v.suggestion !== null)).toBe(true)
  })
})
