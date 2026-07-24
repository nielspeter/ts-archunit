import { describe, it, expect, vi } from 'vitest'
import { ArchRuleError } from '../../src/core/errors.js'
import {
  correspondence,
  byName,
  byArg,
  byPropertyNames,
} from '../../src/builders/correspondence-builder.js'
import { type TestElement, TestRuleBuilder, stubProject, nameMatches } from '../support/test-rule-builder.js'

const elements: TestElement[] = [
  { name: 'UserService', file: 'src/services/user.ts', line: 5, exported: true },
  { name: 'OrderService', file: 'src/services/order.ts', line: 3, exported: true },
  { name: 'helperFn', file: 'src/helpers/util.ts', line: 1, exported: false },
]

/** A selection of the two *Service elements, keyed by name. */
function services(): TestRuleBuilder {
  return new TestRuleBuilder(stubProject, elements).that().withPredicate(nameMatches(/Service$/))
}
const byNameKey = (e: TestElement): string => e.name

describe('correspondence()', () => {
  describe('.beComplete() — A ⊆ B (coverage)', () => {
    it('passes when every A key has a B match', () => {
      expect(() => {
        correspondence(stubProject)
          .side('services', services(), byNameKey)
          .side('registry', ['UserService', 'OrderService', 'Extra'])
          .should()
          .beComplete()
          .check()
      }).not.toThrow()
    })

    it('fails, naming the uncovered A key, when a match is missing', () => {
      const v = correspondence(stubProject)
        .side('services', services(), byNameKey)
        .side('registry', ['UserService'])
        .beComplete()
        .violations()
      expect(v).toHaveLength(1)
      expect(v[0]!.element).toBe('OrderService')
      expect(v[0]!.message).toBe('services "OrderService" has no matching registry')
    })
  })

  describe('.haveNoOrphans() — B ⊆ A', () => {
    it('flags a B key with no A source', () => {
      const v = correspondence(stubProject)
        .side('services', services(), byNameKey)
        .side('registry', ['UserService', 'OrderService', 'Ghost'])
        .haveNoOrphans()
        .violations()
      expect(v.map((x) => x.element)).toEqual(['Ghost'])
      expect(v[0]!.message).toBe('registry "Ghost" has no matching services')
    })
  })

  describe('.beBijective() — both directions', () => {
    it('passes only when the key sets are identical', () => {
      expect(() => {
        correspondence(stubProject)
          .side('services', services(), byNameKey)
          .side('registry', ['UserService', 'OrderService'])
          .beBijective()
          .check()
      }).not.toThrow()
    })

    it('reports both a missing and an orphan (identity, not cardinality)', () => {
      // same count on both sides, but one dropped + one added
      const v = correspondence(stubProject)
        .side('services', services(), byNameKey)
        .side('registry', ['UserService', 'Ghost'])
        .beBijective()
        .violations()
      const msgs = v.map((x) => x.message)
      expect(msgs).toContain('services "OrderService" has no matching registry')
      expect(msgs).toContain('registry "Ghost" has no matching services')
    })
  })

  describe('non-vacuity (ADR-008)', () => {
    it('fails when a selection side is empty, and does not run the coverage flood', () => {
      const emptySel = new TestRuleBuilder(stubProject, elements)
        .that()
        .withPredicate(nameMatches(/^NothingMatches$/))
      const v = correspondence(stubProject)
        .side('services', emptySel, byNameKey)
        .side('registry', ['UserService'])
        .beComplete()
        .violations()
      expect(v).toHaveLength(1)
      expect(v[0]!.element).toBe('services')
      expect(v[0]!.message).toMatch(/matched 0 subjects/)
    })

    it('fails when a keys side is empty', () => {
      const v = correspondence(stubProject)
        .side('services', services(), byNameKey)
        .side('registry', [])
        .beComplete()
        .violations()
      expect(v).toHaveLength(1)
      expect(v[0]!.element).toBe('registry')
    })

    it('.allowEmpty() opts a side out of the non-vacuity guard', () => {
      const emptySel = new TestRuleBuilder(stubProject, elements)
        .that()
        .withPredicate(nameMatches(/^NothingMatches$/))
      expect(() => {
        correspondence(stubProject)
          .side('services', emptySel, byNameKey)
          .side('registry', ['UserService'])
          .allowEmpty('services')
          .beComplete()
          .check()
      }).not.toThrow()
    })
  })

  describe('.distinctKeysOn() — over-normalization guard', () => {
    it('fails when a side maps distinct subjects to one key', () => {
      const collapsed = new TestRuleBuilder(stubProject, elements).that()
      const v = correspondence(stubProject)
        .side('a', collapsed, () => 'same')
        .side('b', ['same'])
        .beComplete()
        .distinctKeysOn('a')
        .violations()
      expect(v.length).toBeGreaterThan(0)
      expect(v.every((x) => /over-normalization/.test(x.message))).toBe(true)
    })
  })

  describe('literal ↔ literal independence footgun', () => {
    it('warns when both sides are literal key lists', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      correspondence(stubProject)
        .side('a', ['x'])
        .side('b', ['x'])
        .beComplete()
        .violations()
      expect(warnSpy).toHaveBeenCalledOnce()
      expect(warnSpy.mock.calls[0]?.[0]).toMatch(/independently derived/)
      warnSpy.mockRestore()
    })

    it('does not warn when one side is a selection', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      correspondence(stubProject)
        .side('services', services(), byNameKey)
        .side('registry', ['UserService', 'OrderService'])
        .beComplete()
        .violations()
      expect(warnSpy).not.toHaveBeenCalled()
      warnSpy.mockRestore()
    })
  })

  describe('terminals + errors', () => {
    it('.check() throws ArchRuleError on violations', () => {
      expect(() => {
        correspondence(stubProject)
          .side('services', services(), byNameKey)
          .side('registry', ['UserService'])
          .beComplete()
          .check()
      }).toThrow(ArchRuleError)
    })

    it('throws when there are not exactly two sides', () => {
      expect(() => {
        correspondence(stubProject).side('a', ['x']).beComplete().check()
      }).toThrow(/exactly two/)
    })

    it('throws when no assertion is chosen', () => {
      expect(() => {
        correspondence(stubProject).side('a', ['x']).side('b', ['x']).check()
      }).toThrow(/requires an assertion/)
    })

    it('a selection side requires a keyFn', () => {
      // @ts-expect-error — keyFn is required for a selection source
      expect(() => correspondence(stubProject).side('s', services())).toThrow(/requires a keyFn/)
    })

    it('propagates rule metadata to violations (agent payload)', () => {
      const v = correspondence(stubProject)
        .side('services', services(), byNameKey)
        .side('registry', ['UserService'])
        .beComplete()
        .because('routes must be registered')
        .rule({ id: 'route/matrix', suggestion: 'add it to the registry' })
        .violations()
      expect(v[0]!.ruleId).toBe('route/matrix')
      expect(v[0]!.because).toBe('routes must be registered')
      expect(v[0]!.suggestion).toBe('add it to the registry')
    })
  })

  describe('keyFn vocabulary', () => {
    it('byName() keys by getName(), with <anonymous> fallback', () => {
      expect(byName<{ getName(): string | undefined }>()({ getName: () => 'X' })).toBe('X')
      expect(byName<{ getName(): string | undefined }>()({ getName: () => undefined })).toBe(
        '<anonymous>',
      )
    })

    it('byArg(i) keys by the argument source text', () => {
      const call = { getArguments: () => [{ getText: () => '"/users/:id"' }] }
      expect(byArg<typeof call>(0)(call)).toBe('"/users/:id"')
      expect(byArg<typeof call>(9)(call)).toBe('<no-arg>')
    })

    it('byPropertyNames() keys a type by each property name (one subject → many keys)', () => {
      const iface = { getProperties: () => [{ getName: () => 'a' }, { getName: () => 'b' }] }
      expect(byPropertyNames<typeof iface>()(iface)).toEqual(['a', 'b'])
    })
  })
})
