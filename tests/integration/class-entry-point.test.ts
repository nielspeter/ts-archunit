import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { classes } from '../../src/builders/class-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import { matching } from '../../src/helpers/type-matchers.js'
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

describe('classes() entry point integration', () => {
  const p = loadTestProject()

  it('all BaseService subclasses should be exported', () => {
    expect(() => {
      classes(p).that().extend('BaseService').should().beExported().check()
    }).not.toThrow()
  })

  it('abstract classes should not exist in service folder (negative test)', () => {
    // This validates the full chain works end-to-end
    expect(() => {
      classes(p)
        .that()
        .areAbstract()
        .should()
        .notExist()
        .because('abstract classes should live in the domain layer')
        .check()
    }).toThrow(ArchRuleError) // BaseService is abstract
  })

  it('classes with getTotal should extend BaseService', () => {
    expect(() => {
      classes(p).that().haveMethodNamed('getTotal').should().shouldExtend('BaseService').check()
    }).not.toThrow()
  })

  it('fluent chain reads naturally', () => {
    // Validates the grammar: entry -> .that() -> predicate -> .should() -> condition -> .check()
    expect(() => {
      classes(p)
        .that()
        .extend('BaseService')
        .and()
        .haveNameMatching(/^Order/)
        .should()
        .shouldHaveMethodNamed('getTotal')
        .because('order services must expose a total')
        .check()
    }).not.toThrow()
  })

  it('returns a ClassRuleBuilder', () => {
    const builder = classes(p)
    expect(builder).toBeInstanceOf(Object)
    // Can chain without errors
    expect(() => {
      builder.that().extend('BaseService')
    }).not.toThrow()
  })

  // --- Plan 0031: Parameter type conditions ---

  describe('acceptParameterOfType (plan 0031)', () => {
    it('repos must accept DatabaseClient', () => {
      expect(() => {
        classes(p)
          .that()
          .haveNameEndingWith('Repo')
          .and()
          .resideInFile('**/members.ts')
          .should()
          .acceptParameterOfType(matching(/DatabaseClient/))
          .check()
      }).not.toThrow()
    })
  })

  describe('notAcceptParameterOfType (plan 0031)', () => {
    it('classes with Service in name should not accept DatabaseClient — DI boundary rule', () => {
      // Matches: ServiceAcceptingDb, CleanService, ServiceWithDbMethod, ServiceWithDbEverywhere
      // ServiceAcceptingDb, ServiceWithDbMethod, and ServiceWithDbEverywhere violate this
      expect(() => {
        classes(p)
          .that()
          .haveNameMatching(/Service/)
          .and()
          .resideInFile('**/members.ts')
          .should()
          .notAcceptParameterOfType(matching(/DatabaseClient/))
          .check()
      }).toThrow(ArchRuleError)
    })

    it('CleanService passes the DI boundary rule', () => {
      expect(() => {
        classes(p)
          .that()
          .haveNameMatching('CleanService')
          .should()
          .notAcceptParameterOfType(matching(/DatabaseClient/))
          .check()
      }).not.toThrow()
    })
  })

  describe('setter parameter scanning (plan 0031 branch coverage)', () => {
    it('acceptParameterOfType detects matching param in setter', () => {
      expect(() => {
        classes(p)
          .that()
          .haveNameMatching('ServiceWithDbSetter')
          .should()
          .acceptParameterOfType(matching(/DatabaseClient/))
          .check()
      }).not.toThrow()
    })

    it('acceptParameterOfType fails when setter has non-matching param', () => {
      expect(() => {
        classes(p)
          .that()
          .haveNameMatching('ServiceWithLoggerSetter')
          .should()
          .acceptParameterOfType(matching(/DatabaseClient/))
          .check()
      }).toThrow(ArchRuleError)
    })

    it('notAcceptParameterOfType detects matching param in setter', () => {
      expect(() => {
        classes(p)
          .that()
          .haveNameMatching('ServiceWithDbSetter')
          .should()
          .notAcceptParameterOfType(matching(/DatabaseClient/))
          .check()
      }).toThrow(ArchRuleError)
    })
  })
})
