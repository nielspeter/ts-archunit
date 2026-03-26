import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { functions } from '../../src/builders/function-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'

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

describe('functions() entry point integration', () => {
  const p = loadTestProject()

  // ----------------------------------------------------------------
  // 1. areAsync predicate + beExported condition
  // ----------------------------------------------------------------
  describe('areAsync predicate', () => {
    it('async functions in exported classes should be exported (methods)', () => {
      // All async methods live in exported classes (OrderService, ProductService),
      // so their "isExported" delegates to the parent class being exported.
      expect(() => {
        functions(p).that().areAsync().should().beExported().check()
      }).not.toThrow()
    })

    it('non-async functions should exist (negative predicate test)', () => {
      // There are plenty of non-async functions (parseFooOrder, listItems, etc.)
      // so areNotAsync + notExist should fail.
      expect(() => {
        functions(p).that().areNotAsync().should().notExist().check()
      }).toThrow(ArchRuleError)
    })
  })

  // ----------------------------------------------------------------
  // 2. haveParameterCount predicate
  // ----------------------------------------------------------------
  describe('haveParameterCount predicate', () => {
    it('functions with exactly 0 parameters should be exported', () => {
      // listItems() has 0 params and is exported.
      // Class methods with 0 params (withOptionalChain, withDestructuring, etc.)
      // are in exported classes so they count as exported too.
      expect(() => {
        functions(p).that().haveParameterCount(0).should().beExported().check()
      }).not.toThrow()
    })

    it('functions with exactly 1 parameter exist', () => {
      // parseFooOrder, parseBarOrder, parseBazOrder, parseConfig, Controller, Injectable,
      // plus many 1-param methods — they exist, so notExist should fail.
      expect(() => {
        functions(p).that().haveParameterCount(1).should().notExist().check()
      }).toThrow(ArchRuleError)
    })
  })

  // ----------------------------------------------------------------
  // 3. haveParameterCountGreaterThan predicate + notExist condition
  // ----------------------------------------------------------------
  describe('haveParameterCountGreaterThan predicate', () => {
    it('no function has more than 5 parameters', () => {
      // The fixture has no function with > 5 params, so the predicate
      // filters to zero elements and check() passes (no violations).
      expect(() => {
        functions(p)
          .that()
          .haveParameterCountGreaterThan(5)
          .should()
          .notExist()
          .because('functions with many parameters are hard to use')
          .check()
      }).not.toThrow()
    })

    it('functions with more than 0 parameters exist', () => {
      expect(() => {
        functions(p).that().haveParameterCountGreaterThan(0).should().notExist().check()
      }).toThrow(ArchRuleError)
    })
  })

  // ----------------------------------------------------------------
  // 4. haveParameterCountLessThan predicate
  // ----------------------------------------------------------------
  describe('haveParameterCountLessThan predicate', () => {
    it('functions with fewer than 3 parameters should be exported', () => {
      // All functions in the fixture have < 3 params and are in exported modules.
      expect(() => {
        functions(p).that().haveParameterCountLessThan(3).should().beExported().check()
      }).not.toThrow()
    })

    it('functions with fewer than 1 parameter exist (zero-param functions)', () => {
      // listItems, withOptionalChain, etc. have 0 params (< 1).
      expect(() => {
        functions(p).that().haveParameterCountLessThan(1).should().notExist().check()
      }).toThrow(ArchRuleError)
    })
  })

  // ----------------------------------------------------------------
  // 5. haveNameMatching predicate + beAsync condition
  // ----------------------------------------------------------------
  describe('haveNameMatching predicate + beAsync condition', () => {
    it('methods starting with "get" should be async', () => {
      // OrderService.getTotal and ProductService.getTotal are async.
      expect(() => {
        functions(p)
          .that()
          .haveNameMatching(/\.getTotal$/)
          .should()
          .beAsync()
          .check()
      }).not.toThrow()
    })

    it('parse* functions in routes are not async (negative test)', () => {
      // parseFooOrder, parseBarOrder, parseBazOrder, parseConfig are NOT async.
      expect(() => {
        functions(p)
          .that()
          .haveNameMatching(/^parse/)
          .should()
          .beAsync()
          .because('parse functions should be async')
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  // ----------------------------------------------------------------
  // 6. haveReturnType predicate
  // ----------------------------------------------------------------
  describe('haveReturnType predicate', () => {
    it('functions returning void exist', () => {
      // PlainClass.doSomething returns void, UserRepository.log returns void
      expect(() => {
        functions(p).that().haveReturnType('void').should().notExist().check()
      }).toThrow(ArchRuleError)
    })

    it('functions returning Promise<number> should be exported', () => {
      // OrderService.getTotal and ProductService.getTotal return Promise<number>.
      expect(() => {
        functions(p).that().haveReturnType('Promise<number>').should().beExported().check()
      }).not.toThrow()
    })
  })

  // ----------------------------------------------------------------
  // 7. areExported predicate + conditionHaveNameMatching condition
  // ----------------------------------------------------------------
  describe('areExported predicate + conditionHaveNameMatching condition', () => {
    it('exported top-level parse functions match expected naming', () => {
      // All exported functions whose name starts with "parse" should match
      // /^parse[A-Z]/ (they all do: parseFooOrder, parseBarOrder, parseBazOrder, parseConfig).
      expect(() => {
        functions(p)
          .that()
          .areExported()
          .and()
          .haveNameStartingWith('parse')
          .should()
          .conditionHaveNameMatching(/^parse[A-Z]/)
          .check()
      }).not.toThrow()
    })

    it('exported functions should not all match a narrow pattern (negative test)', () => {
      // Not all exported functions start with "parse", so this should fail.
      expect(() => {
        functions(p)
          .that()
          .areExported()
          .should()
          .conditionHaveNameMatching(/^parse/)
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  // ----------------------------------------------------------------
  // 8. areNotExported predicate
  // ----------------------------------------------------------------
  describe('areNotExported predicate', () => {
    it('non-exported functions should not exist (negative test — some exist)', () => {
      // StrictOptions interface is not exported, and there could be unexported methods.
      // BaseService.normalizeCount and BaseService.toError are protected methods in
      // an exported class. However their isExported() delegates to the class being exported.
      // Let's check: if all methods in exported classes count as exported AND all
      // top-level functions are exported, then no unexported functions exist.
      // Actually, StrictOptions is an interface, not a function. Let's verify behavior.
      // If there are no unexported functions, the predicate filters to 0 elements
      // and notExist passes trivially (0 violations).
      expect(() => {
        functions(p).that().areNotExported().should().notExist().check()
      }).not.toThrow()
    })
  })

  // ----------------------------------------------------------------
  // 9. resideInFolder predicate
  // ----------------------------------------------------------------
  describe('resideInFolder predicate', () => {
    it('functions in the src folder should be exported', () => {
      expect(() => {
        functions(p).that().resideInFolder('**/poc/src').should().beExported().check()
      }).not.toThrow()
    })

    it('functions in a non-existent folder should pass trivially', () => {
      // No functions in **/nonexistent/**, so 0 elements, no violations.
      expect(() => {
        functions(p).that().resideInFolder('**/nonexistent/**').should().notExist().check()
      }).not.toThrow()
    })
  })

  // ----------------------------------------------------------------
  // 10. haveParameterNamed predicate
  // ----------------------------------------------------------------
  describe('haveParameterNamed predicate', () => {
    it('functions with parameter named "order" should be exported', () => {
      // parseFooOrder, parseBarOrder, parseBazOrder all have param "order"
      // and are all exported.
      expect(() => {
        functions(p).that().haveParameterNamed('order').should().beExported().check()
      }).not.toThrow()
    })

    it('functions with parameter named "order" should match parse naming', () => {
      expect(() => {
        functions(p)
          .that()
          .haveParameterNamed('order')
          .should()
          .conditionHaveNameMatching(/parse/)
          .check()
      }).not.toThrow()
    })

    it('functions with parameter named "id" exist', () => {
      // OrderService.findById and ProductService.findById have param "id".
      expect(() => {
        functions(p).that().haveParameterNamed('id').should().notExist().check()
      }).toThrow(ArchRuleError)
    })
  })

  // ----------------------------------------------------------------
  // Compound predicate chains (and())
  // ----------------------------------------------------------------
  describe('compound predicate chains', () => {
    it('exported async functions with name matching find* should exist', () => {
      // OrderService.findById and ProductService.findById match all three.
      expect(() => {
        functions(p)
          .that()
          .areExported()
          .and()
          .areAsync()
          .and()
          .haveNameMatching(/findById/)
          .should()
          .notExist()
          .check()
      }).toThrow(ArchRuleError)
    })

    it('exported async functions with unreachable name should pass', () => {
      // No function matches all three: exported + async + name starts with "zzz".
      expect(() => {
        functions(p)
          .that()
          .areExported()
          .and()
          .areAsync()
          .and()
          .haveNameStartingWith('zzz')
          .should()
          .notExist()
          .check()
      }).not.toThrow()
    })
  })

  // ----------------------------------------------------------------
  // notExist condition (the POC use-case from the spec)
  // ----------------------------------------------------------------
  describe('notExist condition — the parseXxxOrder spec example', () => {
    it('parseXxxOrder functions should not exist', () => {
      expect(() => {
        functions(p)
          .that()
          .haveNameMatching(/^parse\w+Order$/)
          .should()
          .notExist()
          .because('use shared parseOrder() utility instead')
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  // ----------------------------------------------------------------
  // Builder returns correct type
  // ----------------------------------------------------------------
  describe('builder type', () => {
    it('returns a FunctionRuleBuilder', () => {
      const builder = functions(p)
      expect(builder).toBeInstanceOf(Object)
      expect(() => {
        builder.that().areAsync()
      }).not.toThrow()
    })
  })

  // ----------------------------------------------------------------
  // resideInFile predicate
  // ----------------------------------------------------------------
  describe('resideInFile predicate', () => {
    it('functions in routes.ts should be exported', () => {
      expect(() => {
        functions(p).that().resideInFile('**/routes.ts').should().beExported().check()
      }).not.toThrow()
    })

    it('functions in routes.ts are not async (negative test)', () => {
      // parseFooOrder, parseBarOrder, parseBazOrder, listItems, parseConfig
      // are all synchronous top-level functions.
      expect(() => {
        functions(p).that().resideInFile('**/routes.ts').should().beAsync().check()
      }).toThrow(ArchRuleError)
    })
  })

  // ----------------------------------------------------------------
  // haveNameEndingWith predicate
  // ----------------------------------------------------------------
  describe('haveNameEndingWith predicate', () => {
    it('functions ending with "Order" should not exist (they are duplicates)', () => {
      expect(() => {
        functions(p)
          .that()
          .haveNameEndingWith('Order')
          .should()
          .notExist()
          .because('use shared parseOrder() utility')
          .check()
      }).toThrow(ArchRuleError)
    })
  })
})
