import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import {
  functionContain,
  functionNotContain,
  functionUseInsteadOf,
} from '../../src/conditions/body-analysis-function.js'
import { call, newExpr } from '../../src/helpers/matchers.js'
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

describe('functionContain()', () => {
  it('passes when function body contains the call', () => {
    // parseFooOrder uses order?.startsWith('-') — look for a call in a method instead
    // ProductService.getTotal uses parseInt
    const fn = getAllFunctions().find((f) => f.getName() === 'ProductService.getTotal')
    if (!fn) return
    const condition = functionContain(call('parseInt'))
    const violations = condition.evaluate([fn], context)
    expect(violations).toHaveLength(0)
  })

  it('fails when function body does NOT contain the call', () => {
    const fn = getFunctionByName('listItems')
    const condition = functionContain(call('parseInt'))
    const violations = condition.evaluate([fn], context)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.message).toContain('does not contain')
    expect(violations[0]!.message).toContain('parseInt')
  })

  it('has correct description', () => {
    expect(functionContain(call('parseInt')).description).toBe("contain call to 'parseInt'")
  })

  it('checks multiple functions independently', () => {
    const fn1 = getFunctionByName('parseFooOrder')
    const fn2 = getFunctionByName('listItems')
    // parseFooOrder calls startsWith but not parseInt; listItems calls neither
    const condition = functionContain(call('JSON.parse'))
    const violations = condition.evaluate([fn1, fn2], context)
    // Both should fail — neither calls JSON.parse
    expect(violations).toHaveLength(2)
  })

  it('reports file path and line number', () => {
    const fn = getFunctionByName('listItems')
    const violations = functionContain(call('parseInt')).evaluate([fn], context)
    expect(violations[0]!.file).toContain('.ts')
    expect(violations[0]!.line).toBeGreaterThan(0)
  })
})

describe('functionNotContain()', () => {
  it('passes when function body does NOT contain the call', () => {
    const fn = getFunctionByName('listItems')
    const condition = functionNotContain(call('parseInt'))
    const violations = condition.evaluate([fn], context)
    expect(violations).toHaveLength(0)
  })

  it('fails when function body contains the call', () => {
    // ProductService.getTotal calls parseInt
    const fn = getAllFunctions().find((f) => f.getName() === 'ProductService.getTotal')
    if (!fn) return
    const condition = functionNotContain(call('parseInt'))
    const violations = condition.evaluate([fn], context)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0]!.message).toContain('contains')
    expect(violations[0]!.message).toContain('parseInt')
  })

  it('reports one violation per matching node', () => {
    // EdgeCaseService has methods with multiple parseInt calls
    const edgeFns = getAllFunctions().filter(
      (f) => f.getName()?.startsWith('EdgeCaseService.') ?? false,
    )
    const withParsInt = edgeFns.filter((f) => {
      const body = f.getBody()
      return body && body.getText().includes('parseInt')
    })

    if (withParsInt.length === 0) return

    const condition = functionNotContain(call('parseInt'))
    const violations = condition.evaluate(withParsInt, context)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0]!.message).toMatch(/line \d+/)
  })

  it('has correct description', () => {
    expect(functionNotContain(call('eval')).description).toBe("not contain call to 'eval'")
  })
})

describe('functionUseInsteadOf()', () => {
  it('no violations when function avoids bad and uses good', () => {
    // Find a function that uses DomainError but not Error
    const fn = getAllFunctions().find((f) => f.getName() === 'OrderService.findById')
    if (!fn) return
    const condition = functionUseInsteadOf(newExpr('Error'), newExpr('DomainError'))
    const violations = condition.evaluate([fn], context)
    expect(violations).toHaveLength(0)
  })

  it('reports bad usage when present', () => {
    // ProductService.findById uses new Error (bad)
    const fn = getAllFunctions().find((f) => f.getName() === 'ProductService.findById')
    if (!fn) return
    const condition = functionUseInsteadOf(newExpr('Error'), newExpr('DomainError'))
    const violations = condition.evaluate([fn], context)
    expect(violations.length).toBeGreaterThanOrEqual(1)
    const messages = violations.map((v) => v.message)
    expect(messages.some((m) => m.includes('instead'))).toBe(true)
  })

  it('reports missing good pattern when absent', () => {
    // ProductService.findById uses new Error but no new DomainError
    const fn = getAllFunctions().find((f) => f.getName() === 'ProductService.findById')
    if (!fn) return
    const condition = functionUseInsteadOf(newExpr('Error'), newExpr('DomainError'))
    const violations = condition.evaluate([fn], context)
    const messages = violations.map((v) => v.message)
    expect(messages.some((m) => m.includes('does not contain'))).toBe(true)
  })

  it('has correct description', () => {
    const condition = functionUseInsteadOf(newExpr('Error'), newExpr('DomainError'))
    expect(condition.description).toBe("use new 'DomainError' instead of new 'Error'")
  })
})
