import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { project } from '../../src/core/project.js'
import { types } from '../../src/builders/type-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import { not, isString, isUnionOfLiterals } from '../../src/helpers/type-matchers.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')
const p = project(tsconfigPath)

describe('types() integration', () => {
  it('enforces no bare string on sortBy property', () => {
    // This is THE motivating use case from cmless plan 0212
    expect(() => {
      types(p)
        .that()
        .haveProperty('sortBy')
        .should()
        .havePropertyType('sortBy', not(isString()))
        .because('sortBy must be a union of string literals, not bare string')
        .check()
    }).toThrow(ArchRuleError)
  })

  it('passes when all sortBy properties are unions of literals (filtered)', () => {
    expect(() => {
      types(p)
        .that()
        .haveProperty('sortBy')
        .and()
        .haveNameMatching(/^Safe|^Aliased|^Partial|^Picked|^SingleLiteral|^ExplicitUndefined/)
        .should()
        .havePropertyType('sortBy', not(isString()))
        .check()
    }).not.toThrow()
  })

  it('filters to only interfaces', () => {
    expect(() => {
      types(p)
        .that()
        .areInterfaces()
        .and()
        .haveProperty('sortBy')
        .should()
        .havePropertyType('sortBy', not(isString()))
        .check()
    }).toThrow(ArchRuleError) // UnsafeOptions is an interface with bare string
  })

  it('filters to only type aliases', () => {
    expect(() => {
      types(p)
        .that()
        .areTypeAliases()
        .and()
        .haveProperty('sortBy')
        .should()
        .havePropertyType('sortBy', not(isString()))
        .check()
    }).not.toThrow() // all type aliases with sortBy use unions
  })

  it('violation message includes the type name and property', () => {
    try {
      types(p)
        .that()
        .haveProperty('sortBy')
        .should()
        .havePropertyType('sortBy', not(isString()))
        .check()
      expect.unreachable('should have thrown')
    } catch (error) {
      const archError = error as ArchRuleError
      expect(archError.violations.some((v) => v.element === 'UnsafeOptions')).toBe(true)
      expect(archError.violations.some((v) => v.message.includes('sortBy'))).toBe(true)
    }
  })

  it('named selection reuses predicates across rules', () => {
    const sortByTypes = types(p).that().haveProperty('sortBy')

    // Rule 1: no bare string
    expect(() => {
      sortByTypes.should().havePropertyType('sortBy', not(isString())).check()
    }).toThrow(ArchRuleError)

    // Rule 2: same selection, different condition (just pass)
    // This verifies should() forks correctly
    expect(() => {
      sortByTypes.should().havePropertyType('direction', not(isString())).check()
    }).not.toThrow()
  })

  it('supports .because() in the full chain', () => {
    try {
      types(p)
        .that()
        .haveProperty('sortBy')
        .should()
        .havePropertyType('sortBy', not(isString()))
        .because('untyped sortBy allows invalid column names at runtime')
        .check()
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as ArchRuleError).message).toContain(
        'untyped sortBy allows invalid column names at runtime',
      )
    }
  })

  it('works with isUnionOfLiterals matcher end-to-end', () => {
    expect(() => {
      types(p)
        .that()
        .haveNameMatching(/^Safe/)
        .and()
        .haveProperty('sortBy')
        .should()
        .havePropertyType('sortBy', isUnionOfLiterals())
        .check()
    }).not.toThrow()
  })
})

// ============================================================================
// Member property conditions integration (plan 0030)
// ============================================================================

describe('types() member property conditions integration', () => {
  it('enforces no forbidden pagination property names', () => {
    // The cmless pagination rule from bug 0002
    expect(() => {
      types(p)
        .that()
        .haveNameMatching(/^Pagination/)
        .should()
        .notHavePropertyNamed('offset', 'pageSize', 'page', 'size')
        .check()
    }).toThrow(ArchRuleError) // PaginationBad has offset and pageSize
  })

  it('enforces required property on Config types', () => {
    expect(() => {
      types(p)
        .that()
        .haveNameMatching(/Config/)
        .and()
        .areInterfaces()
        .should()
        .havePropertyNamed('version')
        .check()
    }).toThrow(ArchRuleError) // ConfigMissingVersion lacks 'version'
  })

  it('detects god objects via maxProperties', () => {
    expect(() => {
      types(p)
        .that()
        .haveNameMatching(/^(SmallInterface|LargeInterface)$/)
        .should()
        .maxProperties(5)
        .check()
    }).toThrow(ArchRuleError) // LargeInterface has 11 properties
  })

  it('enforces readonly on interfaces', () => {
    expect(() => {
      types(p)
        .that()
        .areInterfaces()
        .and()
        .haveNameMatching(/^(FullyReadonly|PartiallyReadonly|AllMutable)$/)
        .should()
        .haveOnlyReadonlyProperties()
        .check()
    }).toThrow(ArchRuleError) // PartiallyReadonly and AllMutable have mutable props
  })

  it('enforces naming convention via notHavePropertyMatching', () => {
    expect(() => {
      types(p)
        .that()
        .haveNameMatching(/^(BadPropertyNames|PaginationGood)$/)
        .should()
        .notHavePropertyMatching(/^(data|info|stuff)$/)
        .check()
    }).toThrow(ArchRuleError) // BadPropertyNames has data, info, stuff
  })

  it('havePropertyMatching passes when property matches pattern', () => {
    expect(() => {
      types(p)
        .that()
        .haveNameMatching(/^HasIdField$/)
        .should()
        .havePropertyMatching(/^id$/)
        .check()
    }).not.toThrow()
  })

  it('havePropertyMatching fails when no property matches pattern', () => {
    expect(() => {
      types(p)
        .that()
        .haveNameMatching(/^MissingIdField$/)
        .should()
        .havePropertyMatching(/^id$/)
        .check()
    }).toThrow(ArchRuleError)
  })

  it('predicate + condition combo: types with skip should also have limit', () => {
    expect(() => {
      types(p).that().haveProperty('skip').should().havePropertyNamed('limit').check()
    }).not.toThrow() // PaginationGood has both skip and limit
  })
})
