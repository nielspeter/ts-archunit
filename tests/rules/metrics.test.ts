import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import {
  maxCyclomaticComplexity,
  maxClassLines,
  maxMethodLines,
  maxMethods,
  maxParameters,
} from '../../src/rules/metrics.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/metrics')
const project = new Project({ tsConfigFilePath: path.join(fixturesDir, 'tsconfig.json') })

function findClass(name: string) {
  const cls = project
    .getSourceFiles()
    .flatMap((sf) => sf.getClasses())
    .find((c) => c.getName() === name)
  if (!cls) throw new Error(`Fixture class not found: ${name}`)
  return cls
}

const context = { rule: 'test rule' }

describe('maxCyclomaticComplexity', () => {
  it('passes for simple class', () => {
    const condition = maxCyclomaticComplexity(10)
    const violations = condition.evaluate([findClass('SimpleService')], context)
    expect(violations).toHaveLength(0)
  })

  it('fails for complex method', () => {
    const condition = maxCyclomaticComplexity(3)
    const violations = condition.evaluate([findClass('ComplexService')], context)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations.some((v) => v.message.includes('cyclomatic complexity'))).toBe(true)
  })

  it('checks constructors', () => {
    const condition = maxCyclomaticComplexity(2)
    const violations = condition.evaluate([findClass('ConfigService')], context)
    expect(violations.some((v) => v.message.includes('constructor'))).toBe(true)
  })

  it('checks getters', () => {
    const condition = maxCyclomaticComplexity(2)
    const violations = condition.evaluate([findClass('ConfigService')], context)
    expect(violations.some((v) => v.message.includes('value'))).toBe(true)
  })

  it('threshold is configurable', () => {
    const strict = maxCyclomaticComplexity(1)
    const lenient = maxCyclomaticComplexity(100)
    const cls = findClass('ComplexService')
    expect(strict.evaluate([cls], context).length).toBeGreaterThan(0)
    expect(lenient.evaluate([cls], context)).toHaveLength(0)
  })
})

describe('maxClassLines', () => {
  it('passes for small class', () => {
    const condition = maxClassLines(500)
    const violations = condition.evaluate([findClass('SmallService')], context)
    expect(violations).toHaveLength(0)
  })

  it('fails for class exceeding threshold', () => {
    const condition = maxClassLines(3)
    const violations = condition.evaluate([findClass('LargeService')], context)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0]!.message).toContain('lines')
  })
})

describe('maxMethodLines', () => {
  it('passes for short methods', () => {
    const condition = maxMethodLines(100)
    const violations = condition.evaluate([findClass('SimpleService')], context)
    expect(violations).toHaveLength(0)
  })

  it('fails for long method', () => {
    const condition = maxMethodLines(2)
    const violations = condition.evaluate([findClass('ComplexService')], context)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0]!.message).toContain('lines')
  })

  it('checks constructors', () => {
    const condition = maxMethodLines(2)
    const violations = condition.evaluate([findClass('ConfigService')], context)
    expect(violations.some((v) => v.message.includes('constructor'))).toBe(true)
  })
})

describe('maxMethods', () => {
  it('passes for small class', () => {
    const condition = maxMethods(10)
    const violations = condition.evaluate([findClass('SmallService')], context)
    expect(violations).toHaveLength(0)
  })

  it('fails for class with many methods', () => {
    const condition = maxMethods(5)
    const violations = condition.evaluate([findClass('LargeService')], context)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0]!.message).toContain('methods')
  })
})

describe('maxParameters', () => {
  it('passes for few-param methods', () => {
    const condition = maxParameters(10)
    const violations = condition.evaluate([findClass('SimpleService')], context)
    expect(violations).toHaveLength(0)
  })

  it('fails for many-param method', () => {
    const condition = maxParameters(4)
    const violations = condition.evaluate([findClass('ParamHeavy')], context)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0]!.message).toContain('parameters')
  })

  it('checks constructor parameters', () => {
    const condition = maxParameters(4)
    const violations = condition.evaluate([findClass('ParamHeavy')], context)
    expect(violations.some((v) => v.message.includes('constructor'))).toBe(true)
  })
})
