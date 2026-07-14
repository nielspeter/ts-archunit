import { describe, it, expect, vi } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import type { ArchProject } from '../../src/core/project.js'
import type { RuleBuilderLike } from '../../src/core/rule-builder-like.js'
import type { LayeredArchitectureOptions } from '../../src/presets/layered.js'
import { layeredArchitecture } from '../../src/presets/layered.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/presets/layered')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

const all = (rules: RuleBuilderLike[]) => rules.flatMap((r) => r.violations())
const errors = (rules: RuleBuilderLike[]) =>
  all(rules).filter((v) => (v.severity ?? 'error') === 'error')
const warns = (rules: RuleBuilderLike[]) => all(rules).filter((v) => v.severity === 'warn')
const violatedIds = (rules: RuleBuilderLike[]) => new Set(all(rules).map((v) => v.ruleId))

describe('layeredArchitecture preset', () => {
  const p = loadTestProject()
  const run = (opts: LayeredArchitectureOptions) => layeredArchitecture(p, opts)

  const ordered = {
    routes: '**/routes/**',
    services: '**/services/**',
    repositories: '**/repositories/**',
  }
  const reversed = {
    repositories: '**/repositories/**',
    services: '**/services/**',
    routes: '**/routes/**',
  }

  it('passes for correct layer ordering', () => {
    expect(errors(run({ layers: ordered }))).toEqual([])
  })

  it('detects a layer-order violation', () => {
    expect(violatedIds(run({ layers: reversed }))).toContain('preset/layered/layer-order')
  })

  it('strict mode passes when repos only import shared', () => {
    expect(errors(run({ layers: ordered, shared: ['**/shared/**'], strict: true }))).toEqual([])
  })

  it('non-strict mode does not apply innermost isolation', () => {
    expect(errors(run({ layers: ordered, strict: false }))).toEqual([])
  })

  it('override to off makes a reversed layout pass', () => {
    const rules = run({
      layers: reversed,
      overrides: { 'preset/layered/layer-order': 'off', 'preset/layered/no-cycles': 'off' },
    })
    expect(errors(rules)).toEqual([])
  })

  it('aggregates rules — the returned array holds every rule', () => {
    const rules = run({ layers: reversed })
    expect(rules.length).toBeGreaterThan(1)
    expect(errors(rules).length).toBeGreaterThan(0)
  })

  it('stamps error severity on error-rule violations', () => {
    const errs = errors(run({ layers: reversed }))
    expect(errs.length).toBeGreaterThan(0)
    expect(errs.every((v) => v.severity === 'error')).toBe(true)
  })

  describe('typeImportsAllowed', () => {
    it('surfaces a WARN (not console.warn) when a layer has value imports from others', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const rules = run({ layers: ordered, typeImportsAllowed: ['**/routes/**'] })
      const w = warns(rules)
      expect(w.some((v) => v.ruleId === 'preset/layered/type-imports-only')).toBe(true)
      expect(w.every((v) => v.severity === 'warn')).toBe(true)
      // warn never fails, and the returning form does NOT console.warn
      expect(errors(rules)).toEqual([])
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    })

    it('no warn when the type-imports layer has no value imports from others', () => {
      const rules = run({
        layers: { ...ordered, shared: '**/shared/**' },
        typeImportsAllowed: ['**/shared/**'],
      })
      expect(warns(rules).some((v) => v.ruleId === 'preset/layered/type-imports-only')).toBe(false)
    })

    it('type-imports-only can be overridden to error', () => {
      const rules = run({
        layers: ordered,
        typeImportsAllowed: ['**/routes/**'],
        overrides: { 'preset/layered/type-imports-only': 'error' },
      })
      expect(violatedIds(rules)).toContain('preset/layered/type-imports-only')
      expect(errors(rules).some((v) => v.ruleId === 'preset/layered/type-imports-only')).toBe(true)
    })

    it('skips type-imports-only when typeImportsAllowed is empty', () => {
      const rules = run({ layers: ordered, typeImportsAllowed: [] })
      expect(all(rules).some((v) => v.ruleId === 'preset/layered/type-imports-only')).toBe(false)
    })

    it('skips type-imports-only with a single layer (no others to compare)', () => {
      const rules = run({
        layers: { routes: '**/routes/**' },
        typeImportsAllowed: ['**/routes/**'],
      })
      expect(all(rules).some((v) => v.ruleId === 'preset/layered/type-imports-only')).toBe(false)
    })
  })

  describe('restrictedPackages', () => {
    it('passes when a restricted package is imported only from the allowed layer', () => {
      const rules = run({
        layers: ordered,
        restrictedPackages: { '**/repositories/**': ['**/shared/**'] },
      })
      expect(errors(rules)).toEqual([])
    })

    it('detects a violation when a non-allowed layer imports the restricted package', () => {
      const rules = run({
        layers: ordered,
        restrictedPackages: { '**/routes/**': ['**/shared/**'] },
      })
      expect(violatedIds(rules)).toContain('preset/layered/restricted-packages')
    })

    it('allows multiple layers to use a restricted package', () => {
      const rules = run({
        layers: ordered,
        restrictedPackages: {
          '**/routes/**': ['**/shared/**'],
          '**/repositories/**': ['**/shared/**'],
        },
      })
      expect(errors(rules)).toEqual([])
    })

    it('restricted-packages can be overridden to off', () => {
      const rules = run({
        layers: ordered,
        restrictedPackages: { '**/routes/**': ['**/shared/**'] },
        overrides: { 'preset/layered/restricted-packages': 'off' },
      })
      expect(errors(rules)).toEqual([])
    })
  })
})
