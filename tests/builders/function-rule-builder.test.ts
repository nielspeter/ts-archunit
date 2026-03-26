import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { functions, FunctionRuleBuilder } from '../../src/builders/function-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'
import { notExist } from '../../src/conditions/function.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('FunctionRuleBuilder', () => {
  const p = loadTestProject()

  it('returns a FunctionRuleBuilder from functions()', () => {
    expect(functions(p)).toBeInstanceOf(FunctionRuleBuilder)
  })

  describe('getElements() scans both patterns', () => {
    it('finds FunctionDeclarations', () => {
      // parseFooOrder is a FunctionDeclaration
      expect(() => {
        functions(p)
          .that()
          .haveNameMatching(/^parseFooOrder$/)
          .should()
          .notExist()
          .check()
      }).toThrow(ArchRuleError)
    })

    it('finds arrow function VariableDeclarations', () => {
      // parseBazOrder is const arrow
      expect(() => {
        functions(p)
          .that()
          .haveNameMatching(/^parseBazOrder$/)
          .should()
          .notExist()
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('identity predicates', () => {
    it('haveNameMatching filters by regex', () => {
      expect(() => {
        functions(p)
          .that()
          .haveNameMatching(/^parse\w+Order$/)
          .should()
          .notExist()
          .check()
      }).toThrow(ArchRuleError)
    })

    it('haveNameMatching with string pattern', () => {
      expect(() => {
        functions(p).that().haveNameMatching('parseFoo').should().notExist().check()
      }).toThrow(ArchRuleError)
    })

    it('haveNameStartingWith filters by prefix', () => {
      expect(() => {
        functions(p).that().haveNameStartingWith('parse').should().notExist().check()
      }).toThrow(ArchRuleError)
    })

    it('haveNameEndingWith filters by suffix', () => {
      expect(() => {
        functions(p).that().haveNameEndingWith('Order').should().notExist().check()
      }).toThrow(ArchRuleError)
    })

    it('resideInFile filters by file glob', () => {
      expect(() => {
        functions(p)
          .that()
          .haveNameMatching(/^parse\w+Order$/)
          .and()
          .resideInFile('**/routes.ts')
          .should()
          .notExist()
          .check()
      }).toThrow(ArchRuleError)
    })

    it('areExported filters to exported functions', () => {
      expect(() => {
        functions(p)
          .that()
          .areExported()
          .and()
          .haveNameMatching(/^parseFooOrder$/)
          .should()
          .notExist()
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('function-specific predicates', () => {
    it('areAsync filters async functions', () => {
      // No top-level async functions in the fixtures
      expect(() => {
        functions(p).that().areAsync().should().notExist().check()
      }).not.toThrow()
    })

    it('haveParameterCount filters by parameter count', () => {
      // listItems has 0 parameters
      expect(() => {
        functions(p)
          .that()
          .haveNameMatching(/^listItems$/)
          .and()
          .haveParameterCount(0)
          .should()
          .notExist()
          .check()
      }).toThrow(ArchRuleError)
    })

    it('haveParameterNamed filters by parameter name', () => {
      expect(() => {
        functions(p).that().haveParameterNamed('order').should().notExist().check()
      }).toThrow(ArchRuleError)
    })

    it('haveReturnType filters by return type', () => {
      expect(() => {
        functions(p)
          .that()
          .haveNameMatching(/^parseFooOrder$/)
          .and()
          .haveReturnType(/field/)
          .should()
          .notExist()
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('real-world rule patterns', () => {
    it('detects parseXxxOrder anti-pattern across both function syntaxes', () => {
      try {
        functions(p)
          .that()
          .haveNameMatching(/^parse\w+Order$/)
          .should()
          .notExist()
          .because('use shared parseOrder() utility instead')
          .check()
        expect.unreachable('should have thrown')
      } catch (error) {
        const archError = error as ArchRuleError
        // Should find 3: parseFooOrder, parseBarOrder (FunctionDecl), parseBazOrder (arrow)
        expect(archError.violations).toHaveLength(3)
        const names = archError.violations.map((v) => v.element)
        expect(names).toContain('parseFooOrder')
        expect(names).toContain('parseBarOrder')
        expect(names).toContain('parseBazOrder')
        expect(archError.message).toContain('use shared parseOrder() utility instead')
      }
    })

    it('named selection reuse works', () => {
      const parsers = functions(p)
        .that()
        .haveNameMatching(/^parse/)

      // Rule 1: parseXxxOrder should not exist
      expect(() => {
        parsers
          .that()
          .haveNameMatching(/Order$/)
          .should()
          .notExist()
          .check()
      }).toThrow(ArchRuleError)

      // Rule 2: parseConfig should exist and be exported
      expect(() => {
        parsers
          .that()
          .haveNameMatching(/^parseConfig$/)
          .should()
          .beExported()
          .check()
      }).not.toThrow()
    })
  })

  describe('chain methods', () => {
    it('.that().and() chains multiple predicates', () => {
      expect(() => {
        functions(p)
          .that()
          .haveNameMatching(/^parse/)
          .and()
          .haveParameterCount(1)
          .and()
          .areExported()
          .should()
          .notExist()
          .check()
      }).toThrow(ArchRuleError)
    })

    it('.should() forks the builder for named selections', () => {
      const exported = functions(p).that().areExported()
      const rule1 = exported.should().notExist()
      const rule2 = exported.should().beExported()
      // rule1 fails (exported functions exist)
      expect(() => rule1.check()).toThrow(ArchRuleError)
      // rule2 passes (exported functions are exported)
      expect(() => rule2.check()).not.toThrow()
    })

    it('withCondition accepts standalone conditions', () => {
      expect(() => {
        functions(p)
          .that()
          .haveNameMatching(/^parseFooOrder$/)
          .should()
          .withCondition(notExist())
          .check()
      }).toThrow(ArchRuleError)
    })
  })
})
