import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import {
  classContain,
  classNotContain,
  classUseInsteadOf,
} from '../../src/conditions/body-analysis.js'
import { call, newExpr } from '../../src/helpers/matchers.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')

describe('Body analysis conditions (class)', () => {
  const project = new Project({
    tsConfigFilePath: path.join(fixturesDir, 'tsconfig.json'),
  })

  function findClass(name: string) {
    return project
      .getSourceFiles()
      .flatMap((sf) => sf.getClasses())
      .find((c) => c.getName() === name)!
  }

  const context = { rule: 'test rule' }

  describe('classContain()', () => {
    it('passes when class contains the call', () => {
      const condition = classContain(call('parseInt'))
      const violations = condition.evaluate([findClass('ProductService')], context)
      expect(violations).toHaveLength(0)
    })

    it('fails when class does NOT contain the call', () => {
      const condition = classContain(call('parseInt'))
      const violations = condition.evaluate([findClass('OrderService')], context)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.message).toContain('does not contain')
      expect(violations[0]!.message).toContain('parseInt')
    })

    it('has correct description', () => {
      expect(classContain(call('parseInt')).description).toBe("contain call to 'parseInt'")
    })
  })

  describe('classNotContain()', () => {
    it('passes when class does NOT contain the call', () => {
      const condition = classNotContain(call('parseInt'))
      const violations = condition.evaluate([findClass('OrderService')], context)
      expect(violations).toHaveLength(0)
    })

    it('fails when class contains the call', () => {
      const condition = classNotContain(call('parseInt'))
      const violations = condition.evaluate([findClass('ProductService')], context)
      expect(violations.length).toBeGreaterThan(0)
      expect(violations[0]!.message).toContain('contains')
      expect(violations[0]!.message).toContain('parseInt')
    })

    it('reports one violation per matching node', () => {
      // EdgeCaseService.withNesting and .withMultiple both have parseInt
      const condition = classNotContain(call('parseInt'))
      const violations = condition.evaluate([findClass('EdgeCaseService')], context)
      expect(violations.length).toBeGreaterThanOrEqual(2)
    })

    it('violation includes line number', () => {
      const condition = classNotContain(call('parseInt'))
      const violations = condition.evaluate([findClass('ProductService')], context)
      expect(violations[0]!.message).toMatch(/line \d+/)
    })

    it('passes for new Error on OrderService (uses DomainError)', () => {
      const condition = classNotContain(newExpr('Error'))
      const violations = condition.evaluate([findClass('OrderService')], context)
      expect(violations).toHaveLength(0)
    })

    it('fails for new Error on ProductService', () => {
      const condition = classNotContain(newExpr('Error'))
      const violations = condition.evaluate([findClass('ProductService')], context)
      expect(violations.length).toBeGreaterThan(0)
    })
  })

  describe('classUseInsteadOf()', () => {
    it('no violations when class uses good and avoids bad', () => {
      const condition = classUseInsteadOf(newExpr('Error'), newExpr('DomainError'))
      const violations = condition.evaluate([findClass('OrderService')], context)
      expect(violations).toHaveLength(0)
    })

    it('reports bad usage AND missing good', () => {
      const condition = classUseInsteadOf(newExpr('Error'), newExpr('DomainError'))
      const violations = condition.evaluate([findClass('ProductService')], context)
      // ProductService has new Error (bad) and no new DomainError (missing good)
      expect(violations.length).toBeGreaterThanOrEqual(2)
      const messages = violations.map((v) => v.message)
      expect(messages.some((m) => m.includes('instead'))).toBe(true)
      expect(messages.some((m) => m.includes('does not contain'))).toBe(true)
    })

    it('has correct description', () => {
      const condition = classUseInsteadOf(newExpr('Error'), newExpr('DomainError'))
      expect(condition.description).toBe("use new 'DomainError' instead of new 'Error'")
    })
  })

  describe('multiple elements', () => {
    it('checks each class independently', () => {
      const condition = classNotContain(call('parseInt'))
      const violations = condition.evaluate(
        [findClass('OrderService'), findClass('ProductService')],
        context,
      )
      // OrderService passes (no parseInt), ProductService fails
      const violatingElements = violations.map((v) => v.element)
      expect(violatingElements).not.toContain('OrderService')
      expect(violatingElements).toContain('ProductService')
    })
  })
})
