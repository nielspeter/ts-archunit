import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { classes } from '../../src/builders/class-rule-builder.js'
import { functions } from '../../src/builders/function-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'
import {
  maxCyclomaticComplexity,
  maxClassLines,
  maxMethodLines,
  maxMethods,
  maxParameters,
  maxFunctionComplexity,
  maxFunctionLines,
  maxFunctionParameters,
} from '../../src/rules/metrics.js'
import {
  haveCyclomaticComplexity,
  haveMoreMethodsThan,
  haveComplexity,
} from '../../src/predicates/metrics.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/metrics')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({
    tsConfigFilePath: path.join(fixturesDir, 'tsconfig.json'),
  })
  return {
    tsConfigPath: path.join(fixturesDir, 'tsconfig.json'),
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('metrics — full fluent chain (how users write rules)', () => {
  const p = loadTestProject()

  describe('class-level conditions via .should().satisfy()', () => {
    it('maxCyclomaticComplexity passes with high threshold', () => {
      expect(() => {
        classes(p).should().satisfy(maxCyclomaticComplexity(100)).check()
      }).not.toThrow()
    })

    it('maxCyclomaticComplexity fails with low threshold', () => {
      expect(() => {
        classes(p).should().satisfy(maxCyclomaticComplexity(1)).check()
      }).toThrow(ArchRuleError)
    })

    it('maxCyclomaticComplexity scoped to specific classes', () => {
      expect(() => {
        classes(p)
          .that()
          .haveNameMatching(/Simple/)
          .should()
          .satisfy(maxCyclomaticComplexity(5))
          .check()
      }).not.toThrow()
    })

    it('maxClassLines passes with high threshold', () => {
      expect(() => {
        classes(p).should().satisfy(maxClassLines(1000)).check()
      }).not.toThrow()
    })

    it('maxClassLines fails with low threshold', () => {
      expect(() => {
        classes(p).should().satisfy(maxClassLines(2)).check()
      }).toThrow(ArchRuleError)
    })

    it('maxMethodLines passes with high threshold', () => {
      expect(() => {
        classes(p).should().satisfy(maxMethodLines(500)).check()
      }).not.toThrow()
    })

    it('maxMethods passes with high threshold', () => {
      expect(() => {
        classes(p).should().satisfy(maxMethods(100)).check()
      }).not.toThrow()
    })

    it('maxMethods fails for LargeService', () => {
      expect(() => {
        classes(p).that().haveNameMatching(/Large/).should().satisfy(maxMethods(5)).check()
      }).toThrow(ArchRuleError)
    })

    it('maxParameters passes with high threshold', () => {
      expect(() => {
        classes(p).should().satisfy(maxParameters(20)).check()
      }).not.toThrow()
    })

    it('maxParameters fails with low threshold on ParamHeavy', () => {
      expect(() => {
        classes(p)
          .that()
          .haveNameMatching(/ParamHeavy/)
          .should()
          .satisfy(maxParameters(4))
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('class-level predicates via .that().satisfy()', () => {
    it('haveCyclomaticComplexity filters then asserts', () => {
      // "complex classes should not exist" pattern
      expect(() => {
        classes(p)
          .that()
          .satisfy(haveCyclomaticComplexity({ greaterThan: 100 }))
          .should()
          .notExist()
          .check()
      }).not.toThrow() // no class has complexity > 100
    })

    it('haveCyclomaticComplexity catches complex classes', () => {
      expect(() => {
        classes(p)
          .that()
          .satisfy(haveCyclomaticComplexity({ greaterThan: 3 }))
          .should()
          .notExist()
          .check()
      }).toThrow(ArchRuleError) // ComplexService and ConfigService have complex members
    })

    it('haveMoreMethodsThan combined with condition', () => {
      // "classes with >10 methods should not exist"
      expect(() => {
        classes(p).that().satisfy(haveMoreMethodsThan(10)).should().notExist().check()
      }).toThrow(ArchRuleError) // LargeService has 12 methods
    })
  })

  describe('function-level conditions via functions(p).should().satisfy()', () => {
    it('maxFunctionComplexity passes with high threshold', () => {
      expect(() => {
        functions(p).should().satisfy(maxFunctionComplexity(100)).check()
      }).not.toThrow()
    })

    it('maxFunctionComplexity fails with low threshold', () => {
      expect(() => {
        functions(p).should().satisfy(maxFunctionComplexity(1)).check()
      }).toThrow(ArchRuleError)
    })

    it('maxFunctionComplexity scoped to specific folder', () => {
      // All fixture functions live in src/, so this tests folder scoping works
      expect(() => {
        functions(p)
          .that()
          .resideInFolder('**/metrics/src/**')
          .should()
          .satisfy(maxFunctionComplexity(100))
          .check()
      }).not.toThrow()
    })

    it('maxFunctionLines passes with high threshold', () => {
      expect(() => {
        functions(p).should().satisfy(maxFunctionLines(500)).check()
      }).not.toThrow()
    })

    it('maxFunctionLines fails with low threshold', () => {
      expect(() => {
        functions(p).should().satisfy(maxFunctionLines(2)).check()
      }).toThrow(ArchRuleError)
    })

    it('maxFunctionParameters passes with high threshold', () => {
      expect(() => {
        functions(p).should().satisfy(maxFunctionParameters(20)).check()
      }).not.toThrow()
    })

    it('maxFunctionParameters fails with low threshold', () => {
      expect(() => {
        functions(p).should().satisfy(maxFunctionParameters(3)).check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('function-level predicates via .that().satisfy()', () => {
    it('haveComplexity filters complex functions', () => {
      expect(() => {
        functions(p)
          .that()
          .satisfy(haveComplexity({ greaterThan: 3 }))
          .should()
          .notExist()
          .check()
      }).toThrow(ArchRuleError) // processItems has complexity > 3
    })

    it('haveComplexity with high threshold finds nothing', () => {
      expect(() => {
        functions(p)
          .that()
          .satisfy(haveComplexity({ greaterThan: 100 }))
          .should()
          .notExist()
          .check()
      }).not.toThrow()
    })
  })

  describe('.warn() does not throw', () => {
    it('warn mode logs but does not fail', () => {
      // This would throw with .check() but .warn() should not throw
      expect(() => {
        classes(p).should().satisfy(maxCyclomaticComplexity(1)).warn()
      }).not.toThrow()
    })
  })

  describe('.because() attaches reason', () => {
    it('violation message includes the because reason', () => {
      try {
        classes(p)
          .should()
          .satisfy(maxCyclomaticComplexity(1))
          .because('complex methods are hard to test')
          .check()
        expect.unreachable('should have thrown')
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ArchRuleError)
        const archError = error as ArchRuleError
        expect(archError.violations.length).toBeGreaterThan(0)
        expect(archError.violations[0]!.because).toBe('complex methods are hard to test')
      }
    })
  })
})
