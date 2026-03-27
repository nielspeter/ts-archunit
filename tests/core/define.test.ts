import { describe, it, expect } from 'vitest'
import { definePredicate, defineCondition } from '../../src/core/define.js'
import { and, not } from '../../src/core/combinators.js'
import type { ConditionContext } from '../../src/core/condition.js'

describe('definePredicate', () => {
  it('creates a Predicate with the given description and test', () => {
    const pred = definePredicate<{ name: string }>('has name starting with "X"', (el) =>
      el.name.startsWith('X'),
    )
    expect(pred.description).toBe('has name starting with "X"')
    expect(pred.test({ name: 'Xavier' })).toBe(true)
    expect(pred.test({ name: 'Alice' })).toBe(false)
  })

  it('works with predicate combinators and/or/not', () => {
    const isLong = definePredicate<string>('is long', (s) => s.length > 5)
    const startsWithA = definePredicate<string>('starts with A', (s) => s.startsWith('A'))

    const combined = and(isLong, not(startsWithA))
    expect(combined.test('BobbyTables')).toBe(true)
    expect(combined.test('Alice')).toBe(false) // starts with A
    expect(combined.test('Bob')).toBe(false) // too short
  })
})

describe('defineCondition', () => {
  it('creates a Condition with the given description and evaluate', () => {
    const cond = defineCondition<{ name: string; file: string; line: number }>(
      'have short names',
      (elements, context) =>
        elements
          .filter((el) => el.name.length > 10)
          .map((el) => ({
            rule: context.rule,
            element: el.name,
            file: el.file,
            line: el.line,
            message: `Name "${el.name}" exceeds 10 characters`,
            because: context.because,
          })),
    )

    expect(cond.description).toBe('have short names')

    const ctx: ConditionContext = { rule: 'test rule' }
    const violations = cond.evaluate(
      [
        { name: 'Short', file: 'a.ts', line: 1 },
        { name: 'VeryLongClassName', file: 'b.ts', line: 5 },
      ],
      ctx,
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]!.element).toBe('VeryLongClassName')
    expect(violations[0]!.message).toContain('exceeds 10 characters')
  })

  it('propagates because from context', () => {
    const cond = defineCondition<{ name: string }>('always fail', (elements, context) =>
      elements.map((el) => ({
        rule: context.rule,
        element: el.name,
        file: 'test.ts',
        line: 1,
        message: 'failed',
        because: context.because,
      })),
    )

    const ctx: ConditionContext = { rule: 'r', because: 'reasons' }
    const violations = cond.evaluate([{ name: 'X' }], ctx)
    expect(violations[0]!.because).toBe('reasons')
  })
})
