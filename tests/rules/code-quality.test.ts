import { describe, it, expect } from 'vitest'
import { Project, type ClassDeclaration } from 'ts-morph'
import path from 'node:path'
import {
  requireJsDocOnPublicMethods,
  noPublicFields,
  noMagicNumbers,
} from '../../src/rules/code-quality.js'
import type { ConditionContext } from '../../src/core/condition.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/rules')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')
const project = new Project({ tsConfigFilePath: tsconfigPath })

function getClass(name: string): ClassDeclaration {
  for (const sf of project.getSourceFiles()) {
    const cls = sf.getClass(name)
    if (cls) return cls
  }
  throw new Error(`Class ${name} not found in fixtures`)
}

const ctx: ConditionContext = { rule: 'test rule' }

describe('requireJsDocOnPublicMethods', () => {
  it('flags public methods without JSDoc', () => {
    const cls = getClass('BadQualityService')
    const condition = requireJsDocOnPublicMethods()
    const violations = condition.evaluate([cls], ctx)
    const names = violations.map((v) => v.message)
    expect(names.some((m) => m.includes('increment'))).toBe(true)
  })

  it('does not flag documented public methods', () => {
    const cls = getClass('BadQualityService')
    const condition = requireJsDocOnPublicMethods()
    const violations = condition.evaluate([cls], ctx)
    const names = violations.map((v) => v.message)
    expect(names.some((m) => m.includes('getCount'))).toBe(false)
  })

  it('does not flag private methods', () => {
    const cls = getClass('BadQualityService')
    const condition = requireJsDocOnPublicMethods()
    const violations = condition.evaluate([cls], ctx)
    const names = violations.map((v) => v.message)
    expect(names.some((m) => m.includes('reset'))).toBe(false)
  })

  it('does not flag protected methods without JSDoc', () => {
    const cls = getClass('BadQualityService')
    const condition = requireJsDocOnPublicMethods()
    const violations = condition.evaluate([cls], ctx)
    const names = violations.map((v) => v.message)
    expect(names.some((m) => m.includes('update'))).toBe(false)
  })

  it('reports no violations for well-documented class', () => {
    const cls = getClass('WellDocumentedService')
    const condition = requireJsDocOnPublicMethods()
    const violations = condition.evaluate([cls], ctx)
    expect(violations).toHaveLength(0)
  })
})

describe('noPublicFields', () => {
  it('flags public mutable fields', () => {
    const cls = getClass('BadQualityService')
    const condition = noPublicFields()
    const violations = condition.evaluate([cls], ctx)
    expect(violations.length).toBeGreaterThanOrEqual(2)
    const names = violations.map((v) => v.message)
    expect(names.some((m) => m.includes('counter'))).toBe(true)
    expect(names.some((m) => m.includes('name'))).toBe(true)
  })

  it('allows static readonly fields', () => {
    const cls = getClass('BadQualityService')
    const condition = noPublicFields()
    const violations = condition.evaluate([cls], ctx)
    const names = violations.map((v) => v.message)
    expect(names.some((m) => m.includes('VERSION'))).toBe(false)
  })

  it('does not flag protected fields', () => {
    const cls = getClass('BadQualityService')
    const condition = noPublicFields()
    const violations = condition.evaluate([cls], ctx)
    const names = violations.map((v) => v.message)
    expect(names.some((m) => m.includes('status'))).toBe(false)
  })

  it('reports no violations for clean class', () => {
    const cls = getClass('WellDocumentedService')
    const condition = noPublicFields()
    const violations = condition.evaluate([cls], ctx)
    expect(violations).toHaveLength(0)
  })
})

describe('noMagicNumbers', () => {
  it('flags magic numbers in method bodies', () => {
    const cls = getClass('BadQualityService')
    const condition = noMagicNumbers()
    const violations = condition.evaluate([cls], ctx)
    expect(violations.length).toBeGreaterThanOrEqual(2)
    const messages = violations.map((v) => v.message)
    expect(messages.some((m) => m.includes('42'))).toBe(true)
    expect(messages.some((m) => m.includes('1000'))).toBe(true)
  })

  it('allows default safe numbers (0, 1, -1, 2, 10, 100)', () => {
    const cls = getClass('BadQualityService')
    const condition = noMagicNumbers()
    const violations = condition.evaluate([cls], ctx)
    const messages = violations.map((v) => v.message)
    // 0 is used in reset() — should NOT be flagged
    expect(messages.filter((m) => m.includes('magic number 0')).length).toBe(0)
  })

  it('supports custom allowed list', () => {
    const cls = getClass('BadQualityService')
    const condition = noMagicNumbers({ allowed: [0, 1, -1, 42, 1000] })
    const violations = condition.evaluate([cls], ctx)
    // 42 and 1000 are now allowed
    expect(violations).toHaveLength(0)
  })

  it('does not scan constructor bodies', () => {
    const cls = getClass('BadQualityService')
    const condition = noMagicNumbers()
    const violations = condition.evaluate([cls], ctx)
    const messages = violations.map((v) => v.message)
    // 99 is in the constructor, which is not scanned
    expect(messages.some((m) => m.includes('99'))).toBe(false)
  })

  it('reports no violations for clean class', () => {
    const cls = getClass('CleanService')
    const condition = noMagicNumbers()
    const violations = condition.evaluate([cls], ctx)
    expect(violations).toHaveLength(0)
  })
})
