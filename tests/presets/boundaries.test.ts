import { describe, it, expect, vi } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import type { ArchProject } from '../../src/core/project.js'
import type { RuleBuilderLike } from '../../src/core/rule-builder-like.js'
import type { StrictBoundariesOptions } from '../../src/presets/boundaries.js'
import { strictBoundaries } from '../../src/presets/boundaries.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/presets/boundaries')
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

describe('strictBoundaries preset', () => {
  const p = loadTestProject()
  const run = (opts: StrictBoundariesOptions) => strictBoundaries(p, opts)

  it('passes for correct boundaries (each feature only imports from shared)', () => {
    expect(errors(run({ folders: '**/src/feature-*', shared: ['**/shared/**'] }))).toEqual([])
  })

  it('override to off suppresses the structural rules', () => {
    const rules = run({
      folders: '**/src/feature-*',
      shared: ['**/shared/**'],
      overrides: {
        'preset/boundaries/no-cross-boundary': 'off',
        'preset/boundaries/no-cycles': 'off',
        'preset/boundaries/shared-isolation': 'off',
      },
    })
    expect(errors(rules)).toEqual([])
  })

  it('emits no rules when no boundary folders match the glob', () => {
    expect(run({ folders: '**/src/nonexistent-*' })).toEqual([])
  })

  it('detects cross-boundary imports when shared is not specified', () => {
    // shared defaults to [] — features importing from shared/ become cross-boundary violations
    const rules = run({ folders: '**/src/feature-*' })
    expect(violatedIds(rules)).toContain('preset/boundaries/no-cross-boundary')
  })

  describe('isolateTests', () => {
    it('passes when test files do not import from other boundaries', () => {
      const rules = run({
        folders: '**/src/feature-*',
        shared: ['**/shared/**'],
        isolateTests: true,
      })
      expect(errors(rules)).toEqual([])
    })
  })

  describe('noCopyPaste', () => {
    it('surfaces a WARN (not console.warn) on duplicate bodies across boundaries', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const rules = run({
        folders: '**/src/feature-*',
        shared: ['**/shared/**'],
        noCopyPaste: true,
      })
      const w = warns(rules)
      expect(w.some((v) => v.ruleId === 'preset/boundaries/no-duplicate-bodies')).toBe(true)
      expect(w.every((v) => v.severity === 'warn')).toBe(true)
      expect(errors(rules)).toEqual([]) // warn never fails
      expect(spy).not.toHaveBeenCalled() // returning form does not console.warn
      spy.mockRestore()
    })

    it('no-duplicate-bodies can be overridden to error', () => {
      const rules = run({
        folders: '**/src/feature-*',
        shared: ['**/shared/**'],
        noCopyPaste: true,
        overrides: { 'preset/boundaries/no-duplicate-bodies': 'error' },
      })
      expect(errors(rules).some((v) => v.ruleId === 'preset/boundaries/no-duplicate-bodies')).toBe(
        true,
      )
    })

    it('no-duplicate-bodies can be overridden to off', () => {
      const rules = run({
        folders: '**/src/feature-*',
        shared: ['**/shared/**'],
        noCopyPaste: true,
        overrides: { 'preset/boundaries/no-duplicate-bodies': 'off' },
      })
      expect(all(rules).some((v) => v.ruleId === 'preset/boundaries/no-duplicate-bodies')).toBe(
        false,
      )
    })
  })
})
