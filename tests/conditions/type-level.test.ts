import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { havePropertyType } from '../../src/conditions/type-level.js'
import { isString, isUnionOfLiterals } from '../../src/helpers/type-matchers.js'
import { not } from '../../src/core/combinators.js'
import type { ConditionContext } from '../../src/core/condition.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')
const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })

const sf = tsMorphProject.getSourceFileOrThrow('options.ts')

const context: ConditionContext = {
  rule: 'types that have property "sortBy" should have property "sortBy" with matching type',
}

describe('havePropertyType condition', () => {
  it('produces violation for bare string sortBy', () => {
    const condition = havePropertyType('sortBy', not(isString()))
    const unsafeOptions = sf.getInterfaceOrThrow('UnsafeOptions')
    const violations = condition.evaluate([unsafeOptions], context)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.element).toBe('UnsafeOptions')
    expect(violations[0]!.message).toContain('sortBy')
    expect(violations[0]!.message).toContain('string')
  })

  it('produces no violation for union of string literals', () => {
    const condition = havePropertyType('sortBy', not(isString()))
    const safeOptions = sf.getInterfaceOrThrow('SafeOptions')
    const violations = condition.evaluate([safeOptions], context)
    expect(violations).toHaveLength(0)
  })

  it('produces no violation for aliased union (AliasedOptions)', () => {
    const condition = havePropertyType('sortBy', not(isString()))
    const aliasedOptions = sf.getInterfaceOrThrow('AliasedOptions')
    const violations = condition.evaluate([aliasedOptions], context)
    expect(violations).toHaveLength(0)
  })

  it('produces no violation for Partial<StrictOptions>', () => {
    const condition = havePropertyType('sortBy', not(isString()))
    const partialOptions = sf.getTypeAliasOrThrow('PartialStrictOptions')
    const violations = condition.evaluate([partialOptions], context)
    expect(violations).toHaveLength(0)
  })

  it('produces no violation for Pick<SafeOptions, "sortBy">', () => {
    const condition = havePropertyType('sortBy', not(isString()))
    const pickedOptions = sf.getTypeAliasOrThrow('PickedOptions')
    const violations = condition.evaluate([pickedOptions], context)
    expect(violations).toHaveLength(0)
  })

  it('skips elements without the named property', () => {
    const condition = havePropertyType('sortBy', not(isString()))
    const unrelated = sf.getInterfaceOrThrow('UnrelatedOptions')
    const violations = condition.evaluate([unrelated], context)
    expect(violations).toHaveLength(0)
  })

  it('works with isUnionOfLiterals matcher', () => {
    const condition = havePropertyType('sortBy', isUnionOfLiterals())
    const safeOptions = sf.getInterfaceOrThrow('SafeOptions')
    const unsafeOptions = sf.getInterfaceOrThrow('UnsafeOptions')
    const singleLiteral = sf.getInterfaceOrThrow('SingleLiteralOptions')

    expect(condition.evaluate([safeOptions], context)).toHaveLength(0)
    expect(condition.evaluate([unsafeOptions], context)).toHaveLength(1)
    expect(condition.evaluate([singleLiteral], context)).toHaveLength(1)
  })

  it('evaluates multiple elements at once', () => {
    const condition = havePropertyType('sortBy', not(isString()))
    const all = [
      sf.getInterfaceOrThrow('UnsafeOptions'),
      sf.getInterfaceOrThrow('SafeOptions'),
      sf.getInterfaceOrThrow('AliasedOptions'),
    ]
    const violations = condition.evaluate(all, context)
    // Only UnsafeOptions has bare string
    expect(violations).toHaveLength(1)
    expect(violations[0]!.element).toBe('UnsafeOptions')
  })
})
