import { describe, it, expect } from 'vitest'
import { RuleBuilder } from '../../src/core/rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import { definePredicate, defineCondition } from '../../src/core/define.js'
import type { ArchProject } from '../../src/core/project.js'
import type { Predicate } from '../../src/core/predicate.js'
import type { Condition } from '../../src/core/condition.js'

interface TestElement {
  name: string
  file: string
  line: number
}

class TestRuleBuilder extends RuleBuilder<TestElement> {
  constructor(
    project: ArchProject,
    private elements: TestElement[],
  ) {
    super(project)
  }

  protected getElements(): TestElement[] {
    return this.elements
  }

  // Expose addCondition for test setup
  withCondition(condition: Condition<TestElement>): this {
    return this.addCondition(condition)
  }
}

const stubProject = {} as ArchProject

const elements: TestElement[] = [
  { name: 'UserService', file: 'src/user.ts', line: 1 },
  { name: 'OrderService', file: 'src/order.ts', line: 1 },
  { name: 'helperUtil', file: 'src/util.ts', line: 1 },
]

describe('.satisfy() with custom predicate', () => {
  it('filters elements using a custom predicate', () => {
    const isService = definePredicate<TestElement>('is a service', (el) =>
      el.name.endsWith('Service'),
    )

    const alwaysFail = defineCondition<TestElement>('always fail', (els, ctx) =>
      els.map((el) => ({
        rule: ctx.rule,
        element: el.name,
        file: el.file,
        line: el.line,
        message: 'fail',
      })),
    )

    const builder = new TestRuleBuilder(stubProject, elements)
    try {
      builder.that().satisfy(isService).should().satisfy(alwaysFail).check()
      expect.unreachable('should have thrown')
    } catch (error) {
      const archError = error as ArchRuleError
      // Only services matched the predicate, not helperUtil
      expect(archError.violations).toHaveLength(2)
      expect(archError.violations.map((v) => v.element)).toEqual(['UserService', 'OrderService'])
    }
  })

  it('dispatches Predicate based on structural type (has test)', () => {
    const pred: Predicate<TestElement> = {
      description: 'raw predicate',
      test: (el) => el.name === 'helperUtil',
    }

    const alwaysFail = defineCondition<TestElement>('fail', (els, ctx) =>
      els.map((el) => ({
        rule: ctx.rule,
        element: el.name,
        file: el.file,
        line: el.line,
        message: 'fail',
      })),
    )

    const builder = new TestRuleBuilder(stubProject, elements)
    try {
      builder.that().satisfy(pred).should().satisfy(alwaysFail).check()
      expect.unreachable('should have thrown')
    } catch (error) {
      const archError = error as ArchRuleError
      expect(archError.violations).toHaveLength(1)
      expect(archError.violations[0]!.element).toBe('helperUtil')
    }
  })
})

describe('.satisfy() with custom condition', () => {
  it('evaluates a custom condition against filtered elements', () => {
    const mustEndWithService = defineCondition<TestElement>(
      'have names ending with "Service"',
      (els, ctx) =>
        els
          .filter((el) => !el.name.endsWith('Service'))
          .map((el) => ({
            rule: ctx.rule,
            element: el.name,
            file: el.file,
            line: el.line,
            message: `"${el.name}" does not end with "Service"`,
            because: ctx.because,
          })),
    )

    const builder = new TestRuleBuilder(stubProject, elements)
    try {
      builder.should().satisfy(mustEndWithService).because('naming convention').check()
      expect.unreachable('should have thrown')
    } catch (error) {
      const archError = error as ArchRuleError
      expect(archError.violations).toHaveLength(1)
      expect(archError.violations[0]!.element).toBe('helperUtil')
      expect(archError.violations[0]!.because).toBe('naming convention')
    }
  })

  it('dispatches Condition based on structural type (has evaluate)', () => {
    const cond: Condition<TestElement> = {
      description: 'raw condition',
      evaluate: () => [],
    }

    const builder = new TestRuleBuilder(stubProject, elements)
    // Should not throw — condition returns no violations
    expect(() => {
      builder.should().satisfy(cond).check()
    }).not.toThrow()
  })
})

describe('.satisfy() with built-in chain methods', () => {
  it('custom predicate combines with built-in conditions via andShould()', () => {
    const isService = definePredicate<TestElement>('is a service', (el) =>
      el.name.endsWith('Service'),
    )

    const alwaysPass = defineCondition<TestElement>('pass', () => [])

    const builder = new TestRuleBuilder(stubProject, elements)
    expect(() => {
      builder.that().satisfy(isService).should().satisfy(alwaysPass).check()
    }).not.toThrow()
  })

  it('works with named selections', () => {
    const isService = definePredicate<TestElement>('is a service', (el) =>
      el.name.endsWith('Service'),
    )

    const alwaysPass = defineCondition<TestElement>('pass', () => [])
    const alwaysFail = defineCondition<TestElement>('fail', (els, ctx) =>
      els.map((el) => ({
        rule: ctx.rule,
        element: el.name,
        file: el.file,
        line: el.line,
        message: 'fail',
      })),
    )

    const services = new TestRuleBuilder(stubProject, elements).that().satisfy(isService)

    expect(() => services.should().satisfy(alwaysPass).check()).not.toThrow()
    expect(() => services.should().satisfy(alwaysFail).check()).toThrow(ArchRuleError)
  })
})
