import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { Project } from 'ts-morph'
import { collectFunctions } from '../../src/models/arch-function.js'
import {
  maxFunctionComplexity,
  maxFunctionLines,
  maxFunctionParameters,
} from '../../src/rules/metrics-function.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/metrics')
const project = new Project({ tsConfigFilePath: path.join(fixturesDir, 'tsconfig.json') })
const allFunctions = project.getSourceFiles().flatMap((sf) => collectFunctions(sf))
const context = { rule: 'test rule' }

function findFn(name: string) {
  const fn = allFunctions.find((f) => f.getName() === name)
  if (!fn) throw new Error(`Fixture function not found: ${name}`)
  return fn
}

describe('maxFunctionComplexity', () => {
  it('passes for simple function', () => {
    const condition = maxFunctionComplexity(10)
    const violations = condition.evaluate([findFn('identity')], context)
    expect(violations).toHaveLength(0)
  })

  it('fails for complex function', () => {
    const condition = maxFunctionComplexity(2)
    const violations = condition.evaluate([findFn('processItems')], context)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0]!.message).toContain('cyclomatic complexity')
  })

  it('works for arrow functions', () => {
    const condition = maxFunctionComplexity(2)
    const violations = condition.evaluate([findFn('validate')], context)
    expect(violations.length).toBeGreaterThan(0)
  })
})

describe('maxFunctionLines', () => {
  it('passes for short function', () => {
    const condition = maxFunctionLines(100)
    const violations = condition.evaluate([findFn('identity')], context)
    expect(violations).toHaveLength(0)
  })

  it('fails for long function', () => {
    const condition = maxFunctionLines(3)
    const violations = condition.evaluate([findFn('processItems')], context)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0]!.message).toContain('lines')
  })
})

describe('maxFunctionParameters', () => {
  it('passes for few params', () => {
    const condition = maxFunctionParameters(10)
    const violations = condition.evaluate([findFn('identity')], context)
    expect(violations).toHaveLength(0)
  })

  it('fails for many params', () => {
    const condition = maxFunctionParameters(4)
    const violations = condition.evaluate([findFn('createRecord')], context)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0]!.message).toContain('parameters')
  })
})
