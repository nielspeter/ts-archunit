import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { definePattern } from '../../src/helpers/pattern.js'
import { followPattern } from '../../src/conditions/pattern.js'
import { functions } from '../../src/builders/function-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'
import { isNumber } from '../../src/helpers/type-matchers.js'

const tsconfigPath = path.resolve(import.meta.dirname, '../fixtures/patterns/tsconfig.json')

function loadProject(fixture: string): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  // Filter to only the specific fixture file
  const sourceFiles = tsMorphProject
    .getSourceFiles()
    .filter((sf) => sf.getFilePath().endsWith(`/${fixture}.ts`))
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => sourceFiles,
  }
}

const paginatedCollection = definePattern('paginated-collection', {
  returnShape: {
    total: 'number',
    skip: 'number',
    limit: 'number',
    items: 'T[]',
  },
})

describe('definePattern', () => {
  it('creates pattern with name and returnShape', () => {
    const pattern = definePattern('my-pattern', {
      returnShape: {
        id: 'number',
        name: 'string',
      },
    })
    expect(pattern.name).toBe('my-pattern')
    expect(pattern.returnShape).toEqual({ id: 'number', name: 'string' })
  })
})

describe('followPattern', () => {
  it('passes when return type matches all properties', () => {
    const p = loadProject('paginated-correct')
    expect(() => {
      functions(p).should().followPattern(paginatedCollection).check()
    }).not.toThrow()
  })

  it('fails when return type is missing a property', () => {
    const p = loadProject('paginated-missing')
    expect(() => {
      functions(p).should().followPattern(paginatedCollection).check()
    }).toThrow(ArchRuleError)
  })

  it('fails when property type mismatches', () => {
    const p = loadProject('paginated-wrong-type')
    try {
      functions(p).should().followPattern(paginatedCollection).check()
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ArchRuleError)
      const archError = error as ArchRuleError
      expect(archError.violations.length).toBeGreaterThan(0)
      const msg = archError.violations[0]?.message ?? ''
      expect(msg).toContain('total')
      expect(msg).toContain('string')
    }
  })

  it('unwraps Promise<T> for async functions', () => {
    const p = loadProject('paginated-async')
    expect(() => {
      functions(p).should().followPattern(paginatedCollection).check()
    }).not.toThrow()
  })

  it('handles T[] constraint (matches any array)', () => {
    const arrayPattern = definePattern('array-result', {
      returnShape: {
        items: 'T[]',
      },
    })
    const p = loadProject('paginated-correct')
    expect(() => {
      functions(p).should().followPattern(arrayPattern).check()
    }).not.toThrow()
  })

  it('accepts TypeMatcher as constraint', () => {
    const matcherPattern = definePattern('matcher-pattern', {
      returnShape: {
        total: isNumber(),
      },
    })
    const p = loadProject('paginated-correct')
    expect(() => {
      functions(p).should().followPattern(matcherPattern).check()
    }).not.toThrow()
  })

  it('reports all missing properties in one violation', () => {
    const p = loadProject('paginated-missing')
    try {
      functions(p).should().followPattern(paginatedCollection).check()
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ArchRuleError)
      const archError = error as ArchRuleError
      expect(archError.violations).toHaveLength(1)
      const msg = archError.violations[0]?.message ?? ''
      // Should mention both missing properties: skip and limit
      expect(msg).toContain('skip')
      expect(msg).toContain('limit')
    }
  })

  it('works via .satisfy() on RuleBuilder', () => {
    const p = loadProject('paginated-correct')
    const condition = followPattern(paginatedCollection)
    expect(() => {
      functions(p).should().satisfy(condition).check()
    }).not.toThrow()
  })

  it('works via .followPattern() on FunctionRuleBuilder', () => {
    const p = loadProject('paginated-correct')
    expect(() => {
      functions(p).should().followPattern(paginatedCollection).check()
    }).not.toThrow()
  })

  it('produces correct violation structure', () => {
    const p = loadProject('paginated-missing')
    try {
      functions(p)
        .should()
        .followPattern(paginatedCollection)
        .because('all list endpoints must be paginated')
        .check()
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ArchRuleError)
      const archError = error as ArchRuleError
      const v = archError.violations[0]
      expect(v).toBeDefined()
      expect(v?.element).toBe('listUsers')
      expect(v?.message).toContain('paginated-collection')
      expect(v?.because).toBe('all list endpoints must be paginated')
    }
  })
})
