import { describe, it, expect } from 'vitest'
import { Project, type ClassDeclaration } from 'ts-morph'
import path from 'node:path'
import {
  shouldExtend,
  shouldImplement,
  shouldHaveMethodNamed,
  shouldNotHaveMethodMatching,
} from '../../src/conditions/class.js'
import type { ConditionContext } from '../../src/core/condition.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
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

describe('class conditions', () => {
  describe('shouldExtend()', () => {
    it('passes for classes extending the named base', () => {
      const cond = shouldExtend('BaseService')
      const violations = cond.evaluate([getClass('OrderService')], ctx)
      expect(violations).toHaveLength(0)
    })

    it('reports violation for classes not extending the named base', () => {
      const cond = shouldExtend('BaseService')
      const violations = cond.evaluate([getClass('DomainError')], ctx)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.message).toContain('does not extend')
    })

    it('reports violations for multiple non-conforming classes', () => {
      const cond = shouldExtend('BaseService')
      const violations = cond.evaluate([getClass('OrderService'), getClass('DomainError')], ctx)
      expect(violations).toHaveLength(1) // Only DomainError fails
    })
  })

  describe('shouldImplement()', () => {
    it('passes for classes implementing the named interface', () => {
      const cond = shouldImplement('Serializable')
      const violations = cond.evaluate([getClass('UserController')], ctx)
      expect(violations).toHaveLength(0)
    })

    it('reports violation for classes not implementing the interface', () => {
      const cond = shouldImplement('Serializable')
      const violations = cond.evaluate([getClass('PlainClass')], ctx)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.message).toContain('does not implement')
    })
  })

  describe('shouldHaveMethodNamed()', () => {
    it('passes for classes with the named method', () => {
      const cond = shouldHaveMethodNamed('getTotal')
      const violations = cond.evaluate([getClass('OrderService')], ctx)
      expect(violations).toHaveLength(0)
    })

    it('reports violation for classes without the named method', () => {
      const cond = shouldHaveMethodNamed('init')
      const violations = cond.evaluate([getClass('OrderService')], ctx)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.message).toContain('does not have method "init"')
    })
  })

  describe('shouldNotHaveMethodMatching()', () => {
    it('passes when no methods match the regex', () => {
      const cond = shouldNotHaveMethodMatching(/^zzz/)
      const violations = cond.evaluate([getClass('OrderService')], ctx)
      expect(violations).toHaveLength(0)
    })

    it('reports violation when methods match the forbidden regex', () => {
      const cond = shouldNotHaveMethodMatching(/^get/)
      const violations = cond.evaluate([getClass('OrderService')], ctx)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.message).toContain('has methods matching')
      expect(violations[0]!.message).toContain('getTotal')
    })
  })
})
