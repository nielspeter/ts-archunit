import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { modules } from '../../src/builders/module-rule-builder.js'
import { classes } from '../../src/builders/class-rule-builder.js'
import { functions } from '../../src/builders/function-rule-builder.js'
import { types } from '../../src/builders/type-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'

// --- Fixtures ---

const modulesDir = path.resolve(import.meta.dirname, '../fixtures/modules')
const pocDir = path.resolve(import.meta.dirname, '../fixtures/poc')

function loadProject(dir: string): ArchProject {
  const tsconfigPath = path.join(dir, 'tsconfig.json')
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('Phase tracking', () => {
  describe('modules — notImportFrom', () => {
    const p = loadProject(modulesDir)

    it('.should().notImportFrom() acts as condition (catches violation)', () => {
      // leaky-domain.ts imports from infra — this should throw
      expect(() => {
        modules(p)
          .that()
          .resideInFolder('**/domain/**')
          .should()
          .notImportFrom('**/infra/**')
          .check()
      }).toThrow(ArchRuleError)
    })

    it('.that().notImportFrom() acts as predicate (filters elements)', () => {
      // Filter to modules that do NOT import from infra, then assert they exist
      // domain/entity.ts and domain/order.ts do NOT import from infra — they should pass notExist()... no wait
      // Filter to modules NOT importing from infra, then check they don't exist → should throw because some exist
      expect(() => {
        modules(p).that().notImportFrom('**/infra/**').should().notExist().check()
      }).toThrow(ArchRuleError)
    })

    it('deprecated notImportFromCondition() still works', () => {
      expect(() => {
        modules(p)
          .that()
          .resideInFolder('**/domain/**')
          .should()
          .notImportFromCondition('**/infra/**')
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('modules — resideInFolder as condition', () => {
    const p = loadProject(modulesDir)

    it('.should().resideInFolder() acts as condition (catches violation)', () => {
      // Modules in bad/ should not pass the "reside in domain" condition
      expect(() => {
        modules(p)
          .that()
          .resideInFolder('**/bad/**')
          .should()
          .resideInFolder('**/domain/**')
          .check()
      }).toThrow(ArchRuleError)
    })

    it('.that().resideInFolder() acts as predicate (filters elements)', () => {
      // Filter to domain modules, then check something passes
      expect(() => {
        modules(p).that().resideInFolder('**/domain/**').should().notExist().check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('classes — phase-aware methods', () => {
    const p = loadProject(pocDir)

    it('.should().resideInFolder() acts as condition', () => {
      // OrderService resides in poc/src, not in services/ — should fail
      expect(() => {
        classes(p)
          .that()
          .haveNameMatching(/Service$/)
          .should()
          .resideInFolder('**/services/**')
          .check()
      }).toThrow(ArchRuleError)
    })

    it('.should().extend() acts as condition', () => {
      // OrderService extends BaseService — filter to just OrderService
      expect(() => {
        classes(p)
          .that()
          .haveNameMatching(/^OrderService$/)
          .should()
          .extend('BaseService')
          .check()
      }).not.toThrow()
    })

    it('.should().extend() catches violation when class does not extend', () => {
      // DomainError extends Error, not BaseService
      expect(() => {
        classes(p)
          .that()
          .haveNameMatching(/Error$/)
          .should()
          .extend('BaseService')
          .check()
      }).toThrow(ArchRuleError)
    })

    it('.should().haveNameMatching() acts as condition (passes)', () => {
      // All classes ending with "Service" should match /Service$/
      expect(() => {
        classes(p)
          .that()
          .haveNameMatching(/Service$/)
          .should()
          .haveNameMatching(/Service$/)
          .check()
      }).not.toThrow()
    })

    it('.should().haveNameMatching() catches violation', () => {
      // Assert ALL classes ending with "Service" match /^Order/ — should fail (BaseService, ProductService, EdgeCaseService don't)
      expect(() => {
        classes(p)
          .that()
          .haveNameMatching(/Service$/)
          .should()
          .haveNameMatching(/^Order/)
          .check()
      }).toThrow(ArchRuleError)
    })

    it('deprecated shouldResideInFolder() still works', () => {
      expect(() => {
        classes(p)
          .that()
          .haveNameMatching(/Service$/)
          .should()
          .shouldResideInFolder('**/services/**')
          .check()
      }).toThrow(ArchRuleError)
    })

    it('deprecated shouldExtend() still works', () => {
      expect(() => {
        classes(p)
          .that()
          .haveNameMatching(/Error$/)
          .should()
          .shouldExtend('BaseService')
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('functions — haveNameMatching', () => {
    const p = loadProject(modulesDir)

    it('.should().haveNameMatching() acts as condition (passes)', () => {
      // initDomain is the only function in bad/leaky-domain.ts — filter to just that file
      expect(() => {
        functions(p)
          .that()
          .resideInFile('**/leaky-domain.ts')
          .should()
          .haveNameMatching(/^init/)
          .check()
      }).not.toThrow()
    })

    it('.should().haveNameMatching() catches violation', () => {
      // Assert ALL exported functions match /^handle/ — should fail
      expect(() => {
        functions(p)
          .that()
          .areExported()
          .should()
          .haveNameMatching(/^handle/)
          .check()
      }).toThrow(ArchRuleError)
    })

    it('deprecated conditionHaveNameMatching() still works', () => {
      expect(() => {
        functions(p)
          .that()
          .areExported()
          .should()
          .conditionHaveNameMatching(/^handle/)
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('types — haveNameMatching', () => {
    const p = loadProject(modulesDir)

    it('.should().haveNameMatching() acts as condition (passes)', () => {
      // domain/entity.ts has interface Entity — filter to that file only
      expect(() => {
        types(p)
          .that()
          .resideInFile('**/entity.ts')
          .should()
          .haveNameMatching(/Entity/)
          .check()
      }).not.toThrow()
    })

    it('.should().haveNameMatching() catches violation', () => {
      // Assert all types in domain match /^Foo/ — should fail
      expect(() => {
        types(p).that().resideInFolder('**/domain/**').should().haveNameMatching(/^Foo/).check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('phase reset and chaining', () => {
    const p = loadProject(modulesDir)

    it('that() resets phase to predicate', () => {
      // This is an unusual chain but should not crash
      // .should() sets phase to condition, .that() resets to predicate
      // After .that(), notImportFrom should add a predicate, not a condition
      // This means no conditions exist, and the builder should produce no violations
      // (filtered set may be empty → no violations)
      expect(() => {
        modules(p).should().that().notImportFrom('**/infra/**').should().notExist().check()
      }).toThrow(ArchRuleError)
    })

    it('chaining predicate then condition with same method name', () => {
      // .that().notImportFrom() filters (predicate), .should().notImportFrom() asserts (condition)
      // Filter to modules NOT importing infra → domain/entity.ts, shared/*.ts
      // Then assert these must NOT import from shared → entity.ts passes, but some shared files may import each other
      expect(() => {
        modules(p)
          .that()
          .notImportFrom('**/infra/**')
          .and()
          .resideInFolder('**/domain/**')
          .should()
          .notImportFrom('**/infra/**')
          .check()
      }).not.toThrow()
    })

    it('satisfy() works regardless of phase', () => {
      // satisfy() uses structural dispatch, not phase
      const customCondition = {
        description: 'always fail',
        evaluate: () => [
          {
            rule: 'test',
            element: 'test',
            file: 'test',
            line: 1,
            message: 'forced failure',
          },
        ],
      }
      expect(() => {
        modules(p).should().satisfy(customCondition).check()
      }).toThrow(ArchRuleError)
    })
  })
})
