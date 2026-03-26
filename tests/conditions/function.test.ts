import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { notExist, beExported, beAsync, haveNameMatching } from '../../src/conditions/function.js'
import { collectFunctions } from '../../src/models/arch-function.js'
import type { ConditionContext } from '../../src/core/condition.js'
import type { ArchFunction } from '../../src/models/arch-function.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')

const project = new Project({
  tsConfigFilePath: path.join(fixturesDir, 'tsconfig.json'),
})

function getAllFunctions(): ArchFunction[] {
  return project.getSourceFiles().flatMap((sf) => collectFunctions(sf))
}

function getFunctionByName(name: string): ArchFunction {
  const fn = getAllFunctions().find((f) => f.getName() === name)
  if (!fn) throw new Error(`Function '${name}' not found in fixtures`)
  return fn
}

const context: ConditionContext = { rule: 'test rule' }

describe('notExist()', () => {
  it('produces a violation for every function in the set', () => {
    const fn1 = getFunctionByName('parseFooOrder')
    const fn2 = getFunctionByName('parseBarOrder')
    const condition = notExist()

    const violations = condition.evaluate([fn1, fn2], context)
    expect(violations).toHaveLength(2)
    expect(violations[0]!.element).toBe('parseFooOrder')
    expect(violations[1]!.element).toBe('parseBarOrder')
  })

  it('returns empty array when no functions passed', () => {
    const condition = notExist()
    const violations = condition.evaluate([], context)
    expect(violations).toHaveLength(0)
  })

  it('has correct description', () => {
    expect(notExist().description).toBe('not exist')
  })

  it('includes "should not exist" in violation message', () => {
    const fn = getFunctionByName('parseFooOrder')
    const violations = notExist().evaluate([fn], context)
    expect(violations[0]!.message).toContain('should not exist')
  })

  it('propagates rule from context', () => {
    const fn = getFunctionByName('parseFooOrder')
    const violations = notExist().evaluate([fn], { rule: 'custom rule' })
    expect(violations[0]!.rule).toBe('custom rule')
  })

  it('propagates because from context', () => {
    const fn = getFunctionByName('parseFooOrder')
    const violations = notExist().evaluate([fn], { rule: 'test', because: 'no dupes' })
    expect(violations[0]!.because).toBe('no dupes')
  })
})

describe('beExported()', () => {
  it('passes when function is exported', () => {
    const fn = getFunctionByName('parseFooOrder')
    const violations = beExported().evaluate([fn], context)
    expect(violations).toHaveLength(0)
  })

  it('fails when function is not exported', () => {
    // Find a non-exported function in fixtures
    const allFunctions = getAllFunctions()
    const nonExported = allFunctions.filter((f) => !f.isExported())
    // If no non-exported functions exist, skip
    if (nonExported.length === 0) return

    const violations = beExported().evaluate([nonExported[0]!], context)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.message).toContain('is not exported')
  })

  it('has correct description', () => {
    expect(beExported().description).toBe('be exported')
  })
})

describe('beAsync()', () => {
  it('fails when function is not async', () => {
    // parseFooOrder is not async
    const fn = getFunctionByName('parseFooOrder')
    const violations = beAsync().evaluate([fn], context)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.message).toContain('is not async')
  })

  it('passes for async functions', () => {
    const allFunctions = getAllFunctions()
    const asyncFn = allFunctions.find((f) => f.isAsync())
    if (!asyncFn) return

    const violations = beAsync().evaluate([asyncFn], context)
    expect(violations).toHaveLength(0)
  })

  it('has correct description', () => {
    expect(beAsync().description).toBe('be async')
  })
})

describe('haveNameMatching()', () => {
  it('passes when function name matches the regex', () => {
    const fn = getFunctionByName('parseFooOrder')
    const violations = haveNameMatching(/^parse/).evaluate([fn], context)
    expect(violations).toHaveLength(0)
  })

  it('fails when function name does not match', () => {
    const fn = getFunctionByName('parseFooOrder')
    const violations = haveNameMatching(/^get/).evaluate([fn], context)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.message).toContain('does not have a name matching')
  })

  it('has description including the pattern', () => {
    expect(haveNameMatching(/^parse/).description).toBe('have name matching /^parse/')
  })

  it('checks multiple functions independently', () => {
    const fn1 = getFunctionByName('parseFooOrder')
    const fn2 = getFunctionByName('listItems')
    const violations = haveNameMatching(/^parse/).evaluate([fn1, fn2], context)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.element).toBe('listItems')
  })
})
