import { describe, it, expect, vi } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import type { ArchProject } from '../../src/core/project.js'
import { collectRule, validateOverrides } from '../../src/presets/shared.js'
import { modules } from '../../src/builders/module-rule-builder.js'
import { strictBoundaries } from '../../src/presets/boundaries.js'
import { layeredArchitecture } from '../../src/presets/layered.js'
import { dataLayerIsolation } from '../../src/presets/data-layer.js'
import type { RuleBuilderLike } from '../../src/core/rule-builder-like.js'

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

describe('validateOverrides', () => {
  it('does nothing when overrides is undefined', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    validateOverrides(undefined, ['a', 'b'])
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('does nothing when all override keys are known', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    validateOverrides({ 'rule/a': 'off' }, ['rule/a', 'rule/b'])
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('warns for unrecognized override keys', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    validateOverrides({ 'rule/typo': 'off' }, ['rule/a', 'rule/b'])
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("Override key 'rule/typo' does not match any rule"),
    )
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('rule/a, rule/b'))
    spy.mockRestore()
  })
})

describe('collectRule', () => {
  const p = loadTestProject()

  function violatingBuilder() {
    return modules(p).that().resideInFolder('**/routes/**').should().notImportFrom('**/services/**')
  }

  it('returns an empty array when severity is off', () => {
    const result = collectRule(violatingBuilder(), { id: 'test/rule' }, 'error', {
      overrides: { 'test/rule': 'off' },
    })
    expect(result).toEqual([])
  })

  it('returns one un-executed builder stamped error by default', () => {
    const result = collectRule(violatingBuilder(), { id: 'test/rule' }, 'error', undefined)
    expect(result).toHaveLength(1)
    const violations = result[0]!.violations()
    expect(violations.length).toBeGreaterThan(0)
    expect(violations.every((v) => v.severity === 'error')).toBe(true)
  })

  it('stamps severity:warn (NOT console.warn) when severity is warn', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const result = collectRule(violatingBuilder(), { id: 'test/rule' }, 'warn', undefined)
    const violations = result[0]!.violations()
    expect(violations.length).toBeGreaterThan(0)
    expect(violations.every((v) => v.severity === 'warn')).toBe(true)
    // The returning form does NOT log — severity flows through the pipeline.
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('still returns a builder for a warn rule with no violations (0 violations, not skipped)', () => {
    const builder = modules(p)
      .that()
      .resideInFolder('**/routes/**')
      .should()
      .notImportFrom('**/nonexistent/**')
    const result = collectRule(builder, { id: 'test/rule' }, 'warn', undefined)
    expect(result).toHaveLength(1)
    expect(result[0]!.violations()).toEqual([])
  })

  it('uses the override severity instead of the default', () => {
    // Default error, overridden to warn → violations carry severity:warn.
    const result = collectRule(violatingBuilder(), { id: 'test/rule' }, 'error', {
      overrides: { 'test/rule': 'warn' },
    })
    const violations = result[0]!.violations()
    expect(violations.length).toBeGreaterThan(0)
    expect(violations.every((v) => v.severity === 'warn')).toBe(true)
  })
})

/**
 * ADR-008 rule 2: every failure carries its sanctioned fix.
 *
 * A preset is the one place a user cannot supply that themselves — they did not
 * write the rule. `collectRule` used to attach `{ id }` and nothing else, so
 * every rule in `strictBoundaries`, `layeredArchitecture` and
 * `dataLayerIsolation` failed with a bare message: 37 of 37 in
 * `strictBoundaries` alone.
 *
 * The compiler now requires metadata to be *passed*, but cannot require it to
 * be *filled in* — `{ id }` still satisfies the type. This asserts the content.
 */
describe('every preset rule carries a remedy', () => {
  // Each preset gets the fixture built for it — a shared one produced zero
  // findings for dataLayerIsolation, and the vacuity guard below caught it.
  const load = (name: string): ArchProject => {
    const tsconfig = path.join(
      path.resolve(import.meta.dirname, `../fixtures/presets/${name}`),
      'tsconfig.json',
    )
    const tsProject = new Project({ tsConfigFilePath: tsconfig })
    return {
      tsConfigPath: tsconfig,
      _project: tsProject,
      getSourceFiles: () => tsProject.getSourceFiles(),
    }
  }

  const presets: Array<[string, RuleBuilderLike[]]> = [
    [
      'strictBoundaries',
      strictBoundaries(load('boundaries'), { folders: '**/boundaries/*', noCopyPaste: true }),
    ],
    [
      'layeredArchitecture',
      layeredArchitecture(load('layered'), {
        layers: { domain: '**/domain/**', app: '**/app/**', infra: '**/infra/**' },
      }),
    ],
    [
      'dataLayerIsolation',
      dataLayerIsolation(load('data-layer'), {
        repositories: '**/repositories/**',
        baseClass: 'BaseRepository',
        requireTypedErrors: true,
      }),
    ],
  ]

  for (const [name, rules] of presets) {
    it(`${name}: no violation reaches the user without a remedy`, () => {
      expect(rules.length, `${name} must emit rules`).toBeGreaterThan(0)
      const violations = rules.flatMap((r) => r.violations())

      // Vacuity guard: a fixture that triggers nothing would pass trivially,
      // which is precisely how the gap survived — every preset test asserted
      // on counts and messages, never on whether a remedy was attached.
      expect(violations.length, `${name} must actually produce findings`).toBeGreaterThan(0)

      const bare = violations
        .filter((v) => !v.because || !v.suggestion)
        .map((v) => v.ruleId ?? v.rule)
      expect([...new Set(bare)], `${name} findings with no remedy`).toEqual([])
    })
  }
})
