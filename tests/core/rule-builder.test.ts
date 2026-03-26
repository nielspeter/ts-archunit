import { describe, it, expect, vi } from 'vitest'
import { ArchRuleError } from '../../src/core/errors.js'
import type { Predicate } from '../../src/core/predicate.js'
import {
  type TestElement,
  TestRuleBuilder,
  stubProject,
  nameMatches,
  alwaysPass,
  alwaysFail,
} from '../support/test-rule-builder.js'

// --- Helpers unique to this file ---

function isExported(): Predicate<TestElement> {
  return {
    description: 'is exported',
    test: (el) => el.exported,
  }
}

const elements: TestElement[] = [
  { name: 'UserService', file: 'src/services/user.ts', line: 5, exported: true },
  { name: 'OrderService', file: 'src/services/order.ts', line: 3, exported: true },
  { name: 'helperFn', file: 'src/helpers/util.ts', line: 1, exported: false },
  { name: 'UserRepository', file: 'src/repos/user.ts', line: 10, exported: true },
]

describe('RuleBuilder', () => {
  describe('.check()', () => {
    it('passes when no violations exist', () => {
      const builder = new TestRuleBuilder(stubProject, elements)
      expect(() => {
        builder
          .that()
          .withPredicate(nameMatches(/Service$/))
          .should()
          .withCondition(alwaysPass())
          .check()
      }).not.toThrow()
    })

    it('throws ArchRuleError when violations exist', () => {
      const builder = new TestRuleBuilder(stubProject, elements)
      expect(() => {
        builder
          .that()
          .withPredicate(nameMatches(/Service$/))
          .should()
          .withCondition(alwaysFail('violated'))
          .check()
      }).toThrow(ArchRuleError)
    })

    it('includes violation details in the error', () => {
      const builder = new TestRuleBuilder(stubProject, elements)
      try {
        builder
          .that()
          .withPredicate(nameMatches(/Service$/))
          .should()
          .withCondition(alwaysFail('bad'))
          .check()
        expect.unreachable('should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ArchRuleError)
        const archError = error as ArchRuleError
        expect(archError.violations).toHaveLength(2)
        expect(archError.message).toContain('2 found')
        // Detailed violations accessible programmatically
        expect(archError.violations[0]!.element).toBe('UserService')
        expect(archError.violations[1]!.element).toBe('OrderService')
      }
    })
  })

  describe('.warn()', () => {
    it('logs violations to stderr but does not throw', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const builder = new TestRuleBuilder(stubProject, elements)
      builder
        .that()
        .withPredicate(nameMatches(/Service$/))
        .should()
        .withCondition(alwaysFail('warning'))
        .warn()
      expect(warnSpy).toHaveBeenCalledOnce()
      const output = warnSpy.mock.calls[0]?.[0] as string
      expect(output).toContain('UserService')
      expect(output).toContain('Architecture Violation')
      warnSpy.mockRestore()
    })

    it('does not log when there are no violations', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const builder = new TestRuleBuilder(stubProject, elements)
      builder
        .that()
        .withPredicate(nameMatches(/Service$/))
        .should()
        .withCondition(alwaysPass())
        .warn()
      expect(warnSpy).not.toHaveBeenCalled()
      warnSpy.mockRestore()
    })
  })

  describe('.because()', () => {
    it('attaches reason to the error message', () => {
      const builder = new TestRuleBuilder(stubProject, elements)
      try {
        builder
          .that()
          .withPredicate(nameMatches(/Service$/))
          .should()
          .withCondition(alwaysFail('bad'))
          .because('services must follow the pattern')
          .check()
        expect.unreachable('should have thrown')
      } catch (error) {
        const archError = error as ArchRuleError
        expect(archError.message).toContain('services must follow the pattern')
      }
    })
  })

  describe('.andShould()', () => {
    it('fails when any condition has violations', () => {
      const builder = new TestRuleBuilder(stubProject, elements)
      expect(() => {
        builder
          .that()
          .withPredicate(nameMatches(/Service$/))
          .should()
          .withCondition(alwaysPass())
          .andShould()
          .withCondition(alwaysFail('second'))
          .check()
      }).toThrow(ArchRuleError)
    })

    it('passes when all conditions pass', () => {
      const builder = new TestRuleBuilder(stubProject, elements)
      expect(() => {
        builder
          .that()
          .withPredicate(nameMatches(/Service$/))
          .should()
          .withCondition(alwaysPass())
          .andShould()
          .withCondition(alwaysPass())
          .check()
      }).not.toThrow()
    })
  })

  describe('named selections', () => {
    it('reuses predicate chain across multiple rules', () => {
      const services = new TestRuleBuilder(stubProject, elements)
        .that()
        .withPredicate(nameMatches(/Service$/))
      expect(() => {
        services.should().withCondition(alwaysPass()).check()
      }).not.toThrow()
      expect(() => {
        services.should().withCondition(alwaysFail('bad')).check()
      }).toThrow(ArchRuleError)
    })

    it('.should() does not mutate the original builder', () => {
      const services = new TestRuleBuilder(stubProject, elements)
        .that()
        .withPredicate(nameMatches(/Service$/))
      const rule1 = services.should().withCondition(alwaysFail('rule1'))
      const rule2 = services.should().withCondition(alwaysPass())
      expect(() => rule1.check()).toThrow(ArchRuleError)
      expect(() => rule2.check()).not.toThrow()
    })
  })

  describe('empty element set', () => {
    it('.check() passes when no elements match predicates', () => {
      const builder = new TestRuleBuilder(stubProject, elements)
      expect(() => {
        builder
          .that()
          .withPredicate(nameMatches(/^NothingMatchesThis$/))
          .should()
          .withCondition(alwaysFail('unreachable'))
          .check()
      }).not.toThrow()
    })

    it('.check() passes when element list is empty', () => {
      const builder = new TestRuleBuilder(stubProject, [])
      expect(() => {
        builder.should().withCondition(alwaysFail('unreachable')).check()
      }).not.toThrow()
    })
  })

  describe('.severity()', () => {
    it('severity("error") behaves like .check()', () => {
      const builder = new TestRuleBuilder(stubProject, elements)
      expect(() => {
        builder.should().withCondition(alwaysFail('bad')).severity('error')
      }).toThrow(ArchRuleError)
    })

    it('severity("warn") behaves like .warn()', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const builder = new TestRuleBuilder(stubProject, elements)
      builder.should().withCondition(alwaysFail('bad')).severity('warn')
      expect(warnSpy).toHaveBeenCalledOnce()
      warnSpy.mockRestore()
    })
  })

  describe('predicate combination', () => {
    it('ANDs multiple predicates together', () => {
      const builder = new TestRuleBuilder(stubProject, elements)
      try {
        builder
          .that()
          .withPredicate(nameMatches(/Service$/))
          .and()
          .withPredicate(isExported())
          .should()
          .withCondition(alwaysFail('found'))
          .check()
        expect.unreachable('should have thrown')
      } catch (error) {
        const archError = error as ArchRuleError
        // UserService and OrderService match both predicates
        expect(archError.violations).toHaveLength(2)
      }
    })
  })
})
