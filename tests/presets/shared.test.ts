import { describe, it, expect, vi } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import type { ArchProject } from '../../src/core/project.js'
import { collectRule, validateOverrides } from '../../src/presets/shared.js'
import { modules } from '../../src/builders/module-rule-builder.js'

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
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    validateOverrides(undefined, ['a', 'b'])
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('does nothing when all override keys are known', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    validateOverrides({ 'rule/a': 'off' }, ['rule/a', 'rule/b'])
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('warns for unrecognized override keys', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
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
    const result = collectRule(violatingBuilder(), 'test/rule', 'error', { 'test/rule': 'off' })
    expect(result).toEqual([])
  })

  it('returns one un-executed builder stamped error by default', () => {
    const result = collectRule(violatingBuilder(), 'test/rule', 'error', undefined)
    expect(result).toHaveLength(1)
    const violations = result[0]!.violations()
    expect(violations.length).toBeGreaterThan(0)
    expect(violations.every((v) => v.severity === 'error')).toBe(true)
  })

  it('stamps severity:warn (NOT console.warn) when severity is warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = collectRule(violatingBuilder(), 'test/rule', 'warn', undefined)
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
    const result = collectRule(builder, 'test/rule', 'warn', undefined)
    expect(result).toHaveLength(1)
    expect(result[0]!.violations()).toEqual([])
  })

  it('uses the override severity instead of the default', () => {
    // Default error, overridden to warn → violations carry severity:warn.
    const result = collectRule(violatingBuilder(), 'test/rule', 'error', { 'test/rule': 'warn' })
    const violations = result[0]!.violations()
    expect(violations.length).toBeGreaterThan(0)
    expect(violations.every((v) => v.severity === 'warn')).toBe(true)
  })
})
