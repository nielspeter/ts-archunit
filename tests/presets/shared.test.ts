import { describe, it, expect, vi } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import type { ArchProject } from '../../src/core/project.js'
import { ArchRuleError } from '../../src/core/errors.js'
import { dispatchRule, validateOverrides, throwIfViolations } from '../../src/presets/shared.js'
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

describe('dispatchRule', () => {
  const p = loadTestProject()

  it('returns empty array when severity is off', () => {
    const builder = modules(p)
      .that()
      .resideInFolder('**/routes/**')
      .should()
      .notImportFrom('**/services/**')

    const result = dispatchRule(builder, 'test/rule', 'error', {
      'test/rule': 'off',
    })
    expect(result).toEqual([])
  })

  it('returns violations when severity is error', () => {
    const builder = modules(p)
      .that()
      .resideInFolder('**/routes/**')
      .should()
      .notImportFrom('**/services/**')

    const result = dispatchRule(builder, 'test/rule', 'error', undefined)
    expect(result.length).toBeGreaterThan(0)
  })

  it('logs warnings and returns empty array when severity is warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const builder = modules(p)
      .that()
      .resideInFolder('**/routes/**')
      .should()
      .notImportFrom('**/services/**')

    const result = dispatchRule(builder, 'test/rule', 'warn', undefined)
    expect(result).toEqual([])
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('does not log when warn severity has no violations', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const builder = modules(p)
      .that()
      .resideInFolder('**/routes/**')
      .should()
      .notImportFrom('**/nonexistent/**')

    const result = dispatchRule(builder, 'test/rule', 'warn', undefined)
    expect(result).toEqual([])
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('uses override severity instead of default', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const builder = modules(p)
      .that()
      .resideInFolder('**/routes/**')
      .should()
      .notImportFrom('**/services/**')

    // Default is error, but override to warn
    const result = dispatchRule(builder, 'test/rule', 'error', {
      'test/rule': 'warn',
    })
    expect(result).toEqual([])
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('throwIfViolations', () => {
  it('does not throw when no violations', () => {
    expect(() => throwIfViolations([])).not.toThrow()
  })

  it('throws ArchRuleError when violations exist', () => {
    const violations = [
      {
        rule: 'test rule',
        message: 'violation',
        file: '/test.ts',
        line: 1,
        element: 'test',
      },
    ]
    // Suppress stderr output during test
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    expect(() => throwIfViolations(violations)).toThrow(ArchRuleError)
    spy.mockRestore()
  })
})
