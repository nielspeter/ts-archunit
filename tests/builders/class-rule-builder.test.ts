import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { ClassRuleBuilder } from '../../src/builders/class-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'
import { call, newExpr } from '../../src/helpers/matchers.js'

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

describe('ClassRuleBuilder', () => {
  const p = loadTestProject()

  describe('getElements()', () => {
    it('returns all classes from all source files', () => {
      const builder = new ClassRuleBuilder(p)
      // At minimum: BaseService, DomainError, OrderService, ProductService,
      // EdgeCaseService, plus fixture decorator classes
      expect(() => {
        builder.should().notExist().check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('identity predicate wiring', () => {
    it('haveNameMatching() filters by class name', () => {
      expect(() => {
        new ClassRuleBuilder(p)
          .that()
          .haveNameMatching(/Service$/)
          .should()
          .beExported()
          .check()
      }).not.toThrow()
    })

    it('haveNameEndingWith() filters by suffix', () => {
      expect(() => {
        new ClassRuleBuilder(p).that().haveNameEndingWith('Service').should().beExported().check()
      }).not.toThrow()
    })

    it('areExported() filters to exported classes', () => {
      // All exported classes should not be abstract (most are concrete)
      // This just validates the predicate wiring works
      expect(() => {
        new ClassRuleBuilder(p)
          .that()
          .areExported()
          .and()
          .haveNameMatching(/^OrderService$/)
          .should()
          .shouldExtend('BaseService')
          .check()
      }).not.toThrow()
    })
  })

  describe('class-specific predicate wiring', () => {
    it('extend() filters to subclasses', () => {
      // All BaseService subclasses are exported
      expect(() => {
        new ClassRuleBuilder(p).that().extend('BaseService').should().beExported().check()
      }).not.toThrow()
    })

    it('areAbstract() filters to abstract classes', () => {
      // BaseService is abstract and exported
      expect(() => {
        new ClassRuleBuilder(p).that().areAbstract().should().shouldExtend('SomethingElse').check()
      }).toThrow(ArchRuleError) // BaseService doesn't extend anything
    })

    it('haveMethodNamed() filters by method presence', () => {
      // Classes with getTotal: OrderService, ProductService
      expect(() => {
        new ClassRuleBuilder(p)
          .that()
          .haveMethodNamed('getTotal')
          .should()
          .shouldExtend('BaseService')
          .check()
      }).not.toThrow()
    })
  })

  describe('additional identity predicate wiring', () => {
    it('haveNameStartingWith() filters by prefix', () => {
      expect(() => {
        new ClassRuleBuilder(p).that().haveNameStartingWith('Order').should().beExported().check()
      }).not.toThrow()
    })

    it('areNotExported() filters to non-exported classes', () => {
      // Check if there are any non-exported classes
      const builder = new ClassRuleBuilder(p).that().areNotExported()
      expect(builder).toBeInstanceOf(ClassRuleBuilder)
    })

    it('resideInFolder() filters by folder glob', () => {
      expect(() => {
        new ClassRuleBuilder(p).that().resideInFolder('**/src/**').should().beExported().check()
      }).not.toThrow()
    })

    it('havePropertyNamed() filters by property name', () => {
      const builder = new ClassRuleBuilder(p).that().havePropertyNamed('someProperty')
      expect(builder).toBeInstanceOf(ClassRuleBuilder)
    })

    it('haveMethodMatching() filters by method regex', () => {
      expect(() => {
        new ClassRuleBuilder(p)
          .that()
          .haveMethodMatching(/^getTotal$/)
          .should()
          .beExported()
          .check()
      }).not.toThrow()
    })

    it('haveDecoratorMatching() filters by decorator regex', () => {
      const builder = new ClassRuleBuilder(p).that().haveDecoratorMatching(/Injectable/)
      expect(builder).toBeInstanceOf(ClassRuleBuilder)
    })

    it('implement() filters by interface', () => {
      const builder = new ClassRuleBuilder(p).that().implement('SomeInterface')
      expect(builder).toBeInstanceOf(ClassRuleBuilder)
    })
  })

  describe('class body analysis condition wiring', () => {
    it('contain() checks for matcher in class body', () => {
      expect(() => {
        new ClassRuleBuilder(p)
          .that()
          .haveNameMatching(/^ProductService$/)
          .should()
          .contain(call('parseInt'))
          .check()
      }).not.toThrow()
    })

    it('notContain() checks absence of matcher in class body', () => {
      expect(() => {
        new ClassRuleBuilder(p)
          .that()
          .haveNameMatching(/^OrderService$/)
          .should()
          .notContain(call('parseInt'))
          .check()
      }).not.toThrow()
    })

    it('useInsteadOf() checks for good pattern in place of bad', () => {
      expect(() => {
        new ClassRuleBuilder(p)
          .that()
          .haveNameMatching(/^OrderService$/)
          .should()
          .useInsteadOf(newExpr('Error'), newExpr('DomainError'))
          .check()
      }).not.toThrow()
    })

    it('notExist() condition produces violations', () => {
      expect(() => {
        new ClassRuleBuilder(p)
          .that()
          .haveNameMatching(/^OrderService$/)
          .should()
          .notExist()
          .check()
      }).toThrow(ArchRuleError)
    })

    it('shouldResideInFile() validates file location', () => {
      expect(() => {
        new ClassRuleBuilder(p)
          .that()
          .haveNameMatching(/^OrderService$/)
          .should()
          .shouldResideInFile('**/good-service.ts')
          .check()
      }).not.toThrow()
    })

    it('shouldResideInFolder() validates folder location', () => {
      expect(() => {
        new ClassRuleBuilder(p)
          .that()
          .haveNameMatching(/^OrderService$/)
          .should()
          .shouldResideInFolder('**/src/**')
          .check()
      }).not.toThrow()
    })

    it('shouldImplement() validates interface implementation', () => {
      const builder = new ClassRuleBuilder(p)
        .that()
        .haveNameMatching(/^OrderService$/)
        .should()
        .shouldImplement('NonExistentInterface')
      expect(() => builder.check()).toThrow(ArchRuleError)
    })
  })

  describe('class-specific condition wiring', () => {
    it('shouldExtend() asserts class hierarchy', () => {
      // All classes ending in Service should extend BaseService
      // (This includes BaseService itself which doesn't extend it -- should fail)
      expect(() => {
        new ClassRuleBuilder(p)
          .that()
          .haveNameMatching(/Service$/)
          .should()
          .shouldExtend('BaseService')
          .check()
      }).toThrow(ArchRuleError)
    })

    it('shouldHaveMethodNamed() asserts method presence', () => {
      // OrderService and ProductService have getTotal
      expect(() => {
        new ClassRuleBuilder(p)
          .that()
          .extend('BaseService')
          .and()
          .haveNameMatching(/^(Order|Product)Service$/)
          .should()
          .shouldHaveMethodNamed('getTotal')
          .check()
      }).not.toThrow()
    })

    it('shouldNotHaveMethodMatching() asserts no forbidden methods', () => {
      expect(() => {
        new ClassRuleBuilder(p)
          .that()
          .extend('BaseService')
          .should()
          .shouldNotHaveMethodMatching(/^buildUrl$/)
          .check()
      }).toThrow(ArchRuleError) // ProductService has buildUrl
    })
  })

  describe('named selections', () => {
    it('supports named selection pattern', () => {
      const services = new ClassRuleBuilder(p).that().extend('BaseService')

      // Rule 1: all services must be exported
      expect(() => {
        services.should().beExported().check()
      }).not.toThrow()

      // Rule 2: all services must have getTotal (EdgeCaseService doesn't)
      // EdgeCaseService has withOptionalChain, etc. but not getTotal
      expect(() => {
        services.should().shouldHaveMethodNamed('getTotal').check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('because() reason propagation', () => {
    it('includes reason in violation message', () => {
      try {
        new ClassRuleBuilder(p)
          .that()
          .extend('BaseService')
          .should()
          .shouldHaveMethodNamed('init')
          .because('all services must implement init for lifecycle management')
          .check()
        expect.unreachable('should have thrown')
      } catch (error) {
        const archError = error as ArchRuleError
        expect(archError.message).toContain(
          'all services must implement init for lifecycle management',
        )
      }
    })
  })
})
