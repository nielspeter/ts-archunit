import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import {
  havePropertyNamed,
  notHavePropertyNamed,
  havePropertyMatching,
  notHavePropertyMatching,
  haveOnlyReadonlyProperties,
  maxProperties,
} from '../../src/conditions/members.js'
import type { ConditionContext } from '../../src/core/condition.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')
const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })

const sf = tsMorphProject.getSourceFileOrThrow('members.ts')

const context: ConditionContext = {
  rule: 'test rule for member property conditions',
}

// --- Helper to get interfaces, type aliases, and classes ---

function getInterface(name: string) {
  return sf.getInterfaceOrThrow(name)
}

function getTypeAlias(name: string) {
  return sf.getTypeAliasOrThrow(name)
}

function getClass(name: string) {
  return sf.getClassOrThrow(name)
}

// ============================================================================
// havePropertyNamed
// ============================================================================

describe('havePropertyNamed', () => {
  it('passes when all named properties exist', () => {
    const condition = havePropertyNamed('version', 'name')
    const violations = condition.evaluate([getInterface('ConfigComplete')], context)
    expect(violations).toHaveLength(0)
  })

  it('reports violation for each missing property', () => {
    const condition = havePropertyNamed('version', 'name')
    const violations = condition.evaluate([getInterface('ConfigMissingVersion')], context)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.message).toContain('ConfigMissingVersion')
    expect(violations[0]!.message).toContain('version')
  })

  it('works with single name', () => {
    const condition = havePropertyNamed('skip')
    const violations = condition.evaluate([getInterface('PaginationGood')], context)
    expect(violations).toHaveLength(0)
  })

  it('works with type aliases', () => {
    const condition = havePropertyNamed('host', 'port')
    const violations = condition.evaluate([getTypeAlias('ReadonlyConfig')], context)
    expect(violations).toHaveLength(0)
  })

  it('throws on zero arguments', () => {
    expect(() => havePropertyNamed()).toThrow('requires at least one property name')
  })
})

// ============================================================================
// notHavePropertyNamed
// ============================================================================

describe('notHavePropertyNamed', () => {
  it('passes when none of the forbidden names exist', () => {
    const condition = notHavePropertyNamed('offset', 'pageSize')
    const violations = condition.evaluate([getInterface('PaginationGood')], context)
    expect(violations).toHaveLength(0)
  })

  it('reports violation per forbidden property found', () => {
    const condition = notHavePropertyNamed('offset', 'pageSize')
    const violations = condition.evaluate([getInterface('PaginationBad')], context)
    expect(violations).toHaveLength(2)
    const messages = violations.map((v) => v.message)
    expect(messages.some((m) => m.includes('"offset"'))).toBe(true)
    expect(messages.some((m) => m.includes('"pageSize"'))).toBe(true)
  })

  it('works on classes', () => {
    const condition = notHavePropertyNamed('offset')
    const violations = condition.evaluate([getClass('ClassWithForbiddenProp')], context)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.message).toContain('ClassWithForbiddenProp')
    expect(violations[0]!.message).toContain('"offset"')
  })

  it('throws on zero arguments', () => {
    expect(() => notHavePropertyNamed()).toThrow('requires at least one property name')
  })
})

// ============================================================================
// havePropertyMatching
// ============================================================================

describe('havePropertyMatching', () => {
  it('passes when at least one property matches', () => {
    const condition = havePropertyMatching(/^id$/)
    const violations = condition.evaluate([getInterface('HasIdField')], context)
    expect(violations).toHaveLength(0)
  })

  it('reports violation when no property matches', () => {
    const condition = havePropertyMatching(/^id$/)
    const violations = condition.evaluate([getInterface('MissingIdField')], context)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.message).toContain('MissingIdField')
    expect(violations[0]!.message).toContain('/^id$/')
  })

  it('is safe with /g flag regex (no statefulness across elements)', () => {
    const condition = havePropertyMatching(/^id$/g)
    // Evaluate two elements — both have 'id', but /g regex would fail
    // on the second call if not cloned
    const elements = [getInterface('HasIdField'), getInterface('HasIdField')]
    const violations = condition.evaluate(elements, context)
    expect(violations).toHaveLength(0)
  })
})

// ============================================================================
// notHavePropertyMatching
// ============================================================================

describe('notHavePropertyMatching', () => {
  it('passes when no property matches', () => {
    const condition = notHavePropertyMatching(/^(data|info|stuff)$/)
    const violations = condition.evaluate([getInterface('PaginationGood')], context)
    expect(violations).toHaveLength(0)
  })

  it('reports violation per matching property', () => {
    const condition = notHavePropertyMatching(/^(data|info|stuff)$/)
    const violations = condition.evaluate([getInterface('BadPropertyNames')], context)
    expect(violations).toHaveLength(3)
    const propNames = violations.map((v) => v.message)
    expect(propNames.some((m) => m.includes('"data"'))).toBe(true)
    expect(propNames.some((m) => m.includes('"info"'))).toBe(true)
    expect(propNames.some((m) => m.includes('"stuff"'))).toBe(true)
  })
})

// ============================================================================
// haveOnlyReadonlyProperties
// ============================================================================

describe('haveOnlyReadonlyProperties', () => {
  it('passes for fully readonly interface', () => {
    const condition = haveOnlyReadonlyProperties()
    const violations = condition.evaluate([getInterface('FullyReadonly')], context)
    expect(violations).toHaveLength(0)
  })

  it('reports violation for mutable properties', () => {
    const condition = haveOnlyReadonlyProperties()
    const violations = condition.evaluate([getInterface('PartiallyReadonly')], context)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.message).toContain('PartiallyReadonly')
    expect(violations[0]!.message).toContain('"name"')
  })

  it('reports all mutable properties', () => {
    const condition = haveOnlyReadonlyProperties()
    const violations = condition.evaluate([getInterface('AllMutable')], context)
    expect(violations).toHaveLength(2)
    const propNames = violations.map((v) => v.message)
    expect(propNames.some((m) => m.includes('"id"'))).toBe(true)
    expect(propNames.some((m) => m.includes('"name"'))).toBe(true)
  })

  it('passes for Readonly<> type alias', () => {
    const condition = haveOnlyReadonlyProperties()
    const violations = condition.evaluate([getTypeAlias('ReadonlyConfig')], context)
    expect(violations).toHaveLength(0)
  })

  it('reports violation for mutable type alias', () => {
    const condition = haveOnlyReadonlyProperties()
    const violations = condition.evaluate([getTypeAlias('MutableConfig')], context)
    expect(violations).toHaveLength(2)
  })

  it('works on readonly class', () => {
    const condition = haveOnlyReadonlyProperties()
    const violations = condition.evaluate([getClass('ReadonlyClass')], context)
    expect(violations).toHaveLength(0)
  })

  it('reports violation for mutable class', () => {
    const condition = haveOnlyReadonlyProperties()
    const violations = condition.evaluate([getClass('MutableClass')], context)
    expect(violations).toHaveLength(2)
  })
})

// ============================================================================
// maxProperties
// ============================================================================

describe('maxProperties', () => {
  it('passes when count is within limit', () => {
    const condition = maxProperties(5)
    const violations = condition.evaluate([getInterface('SmallInterface')], context)
    expect(violations).toHaveLength(0)
  })

  it('reports violation when count exceeds limit', () => {
    const condition = maxProperties(5)
    const violations = condition.evaluate([getInterface('LargeInterface')], context)
    expect(violations).toHaveLength(1)
  })

  it('violation message includes actual count and limit', () => {
    const condition = maxProperties(5)
    const violations = condition.evaluate([getInterface('LargeInterface')], context)
    expect(violations[0]!.message).toContain('has 11 properties')
    expect(violations[0]!.message).toContain('max allowed is 5')
  })
})
