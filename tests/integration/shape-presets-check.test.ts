import { describe, it, expect, vi, afterEach } from 'vitest'
import { Project } from 'ts-morph'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ArchProject } from '../../src/core/project.js'

// Mock only the rule-file loader; the builders come from the REAL migrated
// presets, spread into an array right here — so if a shape preset still
// returned `void`, this spread would throw `TypeError: undefined is not
// iterable` in the test setup (the spread-of-void regression).
vi.mock('../../src/cli/load-rules.js', () => ({ loadRuleFiles: vi.fn() }))

import { runCheck } from '../../src/cli/commands/check.js'
import { runBaseline } from '../../src/cli/commands/baseline.js'
import { loadRuleFiles } from '../../src/cli/load-rules.js'
import { recommended } from '../../src/presets/recommended.js'
import { layeredArchitecture } from '../../src/presets/layered.js'
import { withBaseline } from '../../src/helpers/baseline.js'
import { checkAll } from '../../src/core/check-all.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { RuleBuilderLike } from '../../src/core/rule-builder-like.js'

function projectFor(fixture: string): ArchProject {
  const tsconfig = path.resolve(import.meta.dirname, `../fixtures/presets/${fixture}/tsconfig.json`)
  const tsMorph = new Project({ tsConfigFilePath: tsconfig })
  return {
    tsConfigPath: tsconfig,
    _project: tsMorph,
    getSourceFiles: () => tsMorph.getSourceFiles(),
  }
}

/** A rule file that spreads two different presets into one array (returning form). */
function buildRules(): RuleBuilderLike[] {
  const rec = projectFor('recommended') // dangerous.ts trips no-eval / no-function-constructor
  const layered = projectFor('layered') // reversed layers trip layer-order; typeImports trips a warn
  return [
    ...recommended(rec),
    ...layeredArchitecture(layered, {
      layers: {
        repositories: '**/repositories/**',
        services: '**/services/**',
        routes: '**/routes/**',
      },
      typeImportsAllowed: ['**/routes/**'],
    }),
  ]
}

const tmpFiles: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
  while (tmpFiles.length > 0) {
    const f = tmpFiles.pop()
    if (f !== undefined) fs.rmSync(f, { force: true })
  }
})

describe('shape presets through the check pipeline (returning form)', () => {
  it('spreading a shape preset does not throw (spread-of-void regression)', () => {
    expect(() => buildRules()).not.toThrow()
    expect(buildRules().length).toBeGreaterThan(1)
  })

  it('emits ONE document; error rules from BOTH presets coexist; the layered warn is non-failing', async () => {
    vi.mocked(loadRuleFiles).mockResolvedValue(buildRules())
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

    const errorCount = await runCheck({
      ruleFiles: ['arch.rules.ts'],
      changed: false,
      base: 'main',
      format: 'json',
    })

    expect(spy).toHaveBeenCalledTimes(1) // single JSON document
    const parsed = JSON.parse(String(spy.mock.calls[0]?.[0])) as {
      summary: { errors: number; warnings: number }
      violations: Array<{ severity: string; ruleId: string }>
    }
    const ids = new Set(parsed.violations.map((v) => v.ruleId))

    // Sibling coexistence: a recommended rule AND a layered rule both reported —
    // proof that neither preset's rules were dropped.
    expect(ids).toContain('preset/recommended/no-eval')
    expect(ids).toContain('preset/layered/layer-order')

    // The layered type-imports rule is a WARN: surfaced, but does not fail.
    const warn = parsed.violations.find((v) => v.ruleId === 'preset/layered/type-imports-only')
    expect(warn?.severity).toBe('warn')
    expect(parsed.summary.warnings).toBeGreaterThanOrEqual(1)

    // Exit = error-severity count, warn excluded.
    expect(parsed.summary.errors).toBeGreaterThanOrEqual(3)
    expect(errorCount).toBe(parsed.summary.errors)
  })

  it('checkAll runs the spread family and throws one aggregated error', () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    try {
      checkAll(buildRules())
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ArchRuleError)
      const ids = new Set((e as ArchRuleError).violations.map((v) => v.ruleId))
      expect(ids).toContain('preset/recommended/no-eval')
      expect(ids).toContain('preset/layered/layer-order')
      // the warn is not in the thrown error
      expect(ids.has('preset/layered/type-imports-only')).toBe(false)
    }
  })
})

describe('arch:baseline with a shape preset (no longer crashes)', () => {
  it('generates a baseline and the rules then pass against it', async () => {
    const rules = buildRules()
    vi.mocked(loadRuleFiles).mockResolvedValue(rules)
    const out = path.join(os.tmpdir(), `tsau-shape-baseline-${String(process.pid)}.json`)
    tmpFiles.push(out)
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

    await expect(
      runBaseline({ ruleFiles: ['arch.rules.ts'], output: out }),
    ).resolves.toBeUndefined()
    spy.mockRestore()

    expect(fs.existsSync(out)).toBe(true)
    // Re-run: every current violation is baselined, so nothing fails.
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(() => checkAll(rules, { baseline: withBaseline(out) })).not.toThrow()
  })

  it('degrades gracefully if a user rule file self-executes a throwing .check() at import', async () => {
    // The defensive catch in runBaseline (parity with runCheck).
    const violation = { rule: 'r', element: 'e', file: '/f.ts', line: 1, message: 'm' }
    vi.mocked(loadRuleFiles).mockRejectedValue(new ArchRuleError([violation]))
    const out = path.join(os.tmpdir(), `tsau-shape-baseline-def-${String(process.pid)}.json`)
    tmpFiles.push(out)
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)

    await expect(
      runBaseline({ ruleFiles: ['arch.rules.ts'], output: out }),
    ).resolves.toBeUndefined()
    expect(fs.existsSync(out)).toBe(true)
  })
})
