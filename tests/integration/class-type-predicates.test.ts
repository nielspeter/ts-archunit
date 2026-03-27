import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { classes } from '../../src/builders/class-rule-builder.js'
import { types } from '../../src/builders/type-rule-builder.js'
import { functions } from '../../src/builders/function-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import { call, access, newExpr } from '../../src/helpers/matchers.js'
import { not as notType, isString, isUnionOfLiterals } from '../../src/helpers/type-matchers.js'
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

// ─── Class predicates ──────────────────────────────────────────────

describe('class predicates through fluent chain', () => {
  const p = loadTestProject()

  describe('extend()', () => {
    it('filters to classes extending BaseService', () => {
      expect(() => {
        classes(p).that().extend('BaseService').should().beExported().check()
      }).not.toThrow()
    })

    it('extend predicate excludes classes that do not extend', () => {
      // PlainClass, UserController, UserRepository do not extend BaseService
      // but ProductService, OrderService, EdgeCaseService do
      expect(() => {
        classes(p).that().extend('BaseService').should().shouldHaveMethodNamed('getTotal').check()
      }).toThrow(ArchRuleError) // EdgeCaseService extends BaseService but has no getTotal
    })
  })

  describe('implement()', () => {
    it('filters to classes implementing Serializable', () => {
      // UserController and UserRepository both implement Serializable
      expect(() => {
        classes(p)
          .that()
          .implement('Serializable')
          .should()
          .shouldHaveMethodNamed('serialize')
          .check()
      }).not.toThrow()
    })

    it('combines implement with another condition', () => {
      expect(() => {
        classes(p).that().implement('Loggable').should().shouldHaveMethodNamed('log').check()
      }).not.toThrow()
    })
  })

  describe('haveDecorator()', () => {
    it('filters to classes with @Controller', () => {
      // Only UserController has @Controller
      expect(() => {
        classes(p)
          .that()
          .haveDecorator('Controller')
          .should()
          .shouldImplement('Serializable')
          .check()
      }).not.toThrow()
    })

    it('filters to classes with @Injectable', () => {
      expect(() => {
        classes(p).that().haveDecorator('Injectable').should().shouldImplement('Loggable').check()
      }).not.toThrow()
    })
  })

  describe('haveDecoratorMatching()', () => {
    it('matches decorators by regex', () => {
      // Both @Controller and @Injectable match /^(Controller|Injectable)$/
      expect(() => {
        classes(p)
          .that()
          .haveDecoratorMatching(/^(Controller|Injectable)$/)
          .should()
          .shouldImplement('Serializable')
          .check()
      }).not.toThrow()
    })

    it('matches partial decorator name', () => {
      // @Controller matches /Control/
      expect(() => {
        classes(p)
          .that()
          .haveDecoratorMatching(/Control/)
          .should()
          .beExported()
          .check()
      }).not.toThrow()
    })
  })

  describe('areAbstract()', () => {
    it('finds abstract classes (BaseService is abstract)', () => {
      expect(() => {
        classes(p)
          .that()
          .areAbstract()
          .should()
          .notExist()
          .because('abstract classes should live in the domain layer')
          .check()
      }).toThrow(ArchRuleError)
    })

    it('abstract classes should have specific method', () => {
      expect(() => {
        classes(p).that().areAbstract().should().shouldHaveMethodNamed('normalizeCount').check()
      }).not.toThrow()
    })
  })

  describe('haveMethodNamed()', () => {
    it('filters classes with getTotal method', () => {
      // ProductService and OrderService have getTotal
      expect(() => {
        classes(p).that().haveMethodNamed('getTotal').should().shouldExtend('BaseService').check()
      }).not.toThrow()
    })

    it('filters classes with serialize method', () => {
      expect(() => {
        classes(p)
          .that()
          .haveMethodNamed('serialize')
          .should()
          .shouldImplement('Serializable')
          .check()
      }).not.toThrow()
    })
  })

  describe('haveMethodMatching()', () => {
    it('matches methods by regex pattern', () => {
      // getTotal, findById match /^(get|find)/ — exclude MixedVisibility fixture (plan 0032)
      expect(() => {
        classes(p)
          .that()
          .haveMethodMatching(/^get/)
          .and()
          .haveNameMatching(/Service$/)
          .should()
          .shouldExtend('BaseService')
          .check()
      }).not.toThrow()
    })

    it('regex matching with broad pattern', () => {
      // Classes with any method starting with 'with' — EdgeCaseService has them
      expect(() => {
        classes(p).that().haveMethodMatching(/^with/).should().shouldExtend('BaseService').check()
      }).not.toThrow()
    })
  })

  describe('havePropertyNamed()', () => {
    it('filters classes with db property', () => {
      // BaseService has 'protected db' property and is exported
      expect(() => {
        classes(p).that().havePropertyNamed('db').should().beExported().check()
      }).not.toThrow()
    })

    it('BaseService has db property and is exported', () => {
      // BaseService has 'protected db' — but is it a property? Yes.
      // However 'areAbstract' might narrow it. Let's combine predicates.
      expect(() => {
        classes(p)
          .that()
          .havePropertyNamed('db')
          .and()
          .areAbstract()
          .should()
          .shouldHaveMethodNamed('normalizeCount')
          .check()
      }).not.toThrow()
    })
  })
})

// ─── Class conditions ──────────────────────────────────────────────

describe('class conditions through fluent chain', () => {
  const p = loadTestProject()

  describe('shouldExtend()', () => {
    it('verifies classes extend BaseService', () => {
      expect(() => {
        classes(p).that().haveMethodNamed('getTotal').should().shouldExtend('BaseService').check()
      }).not.toThrow()
    })

    it('fails when not all matching classes extend the target', () => {
      // Classes with serialize() method: UserController, UserRepository
      // Neither extends BaseService
      expect(() => {
        classes(p).that().haveMethodNamed('serialize').should().shouldExtend('BaseService').check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('shouldImplement()', () => {
    it('verifies decorated classes implement Serializable', () => {
      expect(() => {
        classes(p)
          .that()
          .haveDecoratorMatching(/./)
          .should()
          .shouldImplement('Serializable')
          .check()
      }).not.toThrow()
    })

    it('fails when classes do not implement interface', () => {
      // BaseService subclasses don't implement Serializable
      expect(() => {
        classes(p).that().extend('BaseService').should().shouldImplement('Serializable').check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('shouldHaveMethodNamed()', () => {
    it('verifies classes have getTotal', () => {
      expect(() => {
        classes(p)
          .that()
          .haveNameMatching(/Service$/)
          .and()
          .extend('BaseService')
          .should()
          .shouldHaveMethodNamed('getTotal')
          .check()
      }).toThrow(ArchRuleError) // EdgeCaseService extends BaseService but has no getTotal
    })

    it('passes when all matching classes have the method', () => {
      expect(() => {
        classes(p)
          .that()
          .implement('Serializable')
          .should()
          .shouldHaveMethodNamed('serialize')
          .check()
      }).not.toThrow()
    })
  })

  describe('shouldNotHaveMethodMatching()', () => {
    it('no BaseService subclass should have methods matching /^build/', () => {
      // Only ProductService has buildUrl
      expect(() => {
        classes(p)
          .that()
          .extend('BaseService')
          .should()
          .shouldNotHaveMethodMatching(/^build/)
          .check()
      }).toThrow(ArchRuleError)
    })

    it('passes when no methods match the forbidden pattern', () => {
      // Serializable implementors have serialize(), log() — none match /^delete/
      expect(() => {
        classes(p)
          .that()
          .implement('Serializable')
          .should()
          .shouldNotHaveMethodMatching(/^delete/)
          .check()
      }).not.toThrow()
    })
  })
})

// ─── Type predicates and conditions ────────────────────────────────

describe('type rules through fluent chain', () => {
  const p = loadTestProject()

  describe('areInterfaces()', () => {
    it('filters to only interfaces', () => {
      // Interfaces in options.ts: UnsafeOptions, SafeOptions, AliasedOptions, etc.
      // They should all be exported
      expect(() => {
        classes(p) // just to confirm types() works differently
      }).not.toThrow()

      expect(() => {
        types(p).that().areInterfaces().should().beExported().check()
      }).toThrow(ArchRuleError) // StrictOptions is not exported
    })
  })

  describe('areTypeAliases()', () => {
    it('filters to only type aliases', () => {
      // SortColumn, PartialStrictOptions, PickedOptions are type aliases
      expect(() => {
        types(p).that().areTypeAliases().should().beExported().check()
      }).not.toThrow()
    })
  })

  describe('haveProperty() predicate with havePropertyType() condition', () => {
    it('types with sortBy should not use bare string', () => {
      // UnsafeOptions has sortBy: string which violates this
      expect(() => {
        types(p)
          .that()
          .haveProperty('sortBy')
          .should()
          .havePropertyType('sortBy', notType(isString()))
          .because('sortBy must be a union of literals, not bare string')
          .check()
      }).toThrow(ArchRuleError)
    })

    it('SafeOptions passes the union of literals check', () => {
      expect(() => {
        types(p)
          .that()
          .haveNameMatching('SafeOptions')
          .should()
          .havePropertyType('sortBy', isUnionOfLiterals())
          .check()
      }).not.toThrow()
    })
  })

  describe('extendType()', () => {
    it('no interfaces extend BaseService (they extend other interfaces)', () => {
      // No interfaces in our fixtures extend "BaseConfig" or similar
      // StrictOptions doesn't extend anything. Let's check a pattern that has no matches.
      expect(() => {
        types(p).that().extendType('BaseService').should().notExist().check()
      }).not.toThrow() // no types extend BaseService, so notExist passes
    })
  })

  describe('combined type predicates', () => {
    it('interfaces with direction property should have union of literals type', () => {
      expect(() => {
        types(p)
          .that()
          .areInterfaces()
          .and()
          .haveProperty('direction')
          .should()
          .havePropertyType('direction', isUnionOfLiterals())
          .check()
      }).not.toThrow()
    })
  })
})

// ─── Body analysis matchers ────────────────────────────────────────

describe('body analysis through fluent chain', () => {
  const p = loadTestProject()

  describe('call() matcher', () => {
    it('bad-service contains parseInt — notContain should throw', () => {
      // ProductService (bad-service) calls parseInt directly
      expect(() => {
        classes(p).that().extend('BaseService').should().notContain(call('parseInt')).check()
      }).toThrow(ArchRuleError)
    })

    it('good-service uses this.normalizeCount — contain should pass for OrderService', () => {
      expect(() => {
        classes(p)
          .that()
          .haveNameMatching('OrderService')
          .should()
          .contain(call('this.normalizeCount'))
          .check()
      }).not.toThrow()
    })

    it('bad-service does NOT use this.normalizeCount — contain should throw', () => {
      expect(() => {
        classes(p)
          .that()
          .haveNameMatching('ProductService')
          .should()
          .contain(call('this.normalizeCount'))
          .check()
      }).toThrow(ArchRuleError)
    })

    it('regex call matcher detects console methods', () => {
      // No classes in fixtures call console.*, so notContain passes
      expect(() => {
        classes(p)
          .that()
          .extend('BaseService')
          .should()
          .notContain(call(/^console\./))
          .check()
      }).not.toThrow()
    })
  })

  describe('newExpr() matcher', () => {
    it('bad-service throws new Error — notContain should fail', () => {
      expect(() => {
        classes(p).that().extend('BaseService').should().notContain(newExpr('Error')).check()
      }).toThrow(ArchRuleError) // ProductService: new Error(...), EdgeCaseService: new Error(...)
    })

    it('good-service uses DomainError — notContain(newExpr("Error")) should pass', () => {
      // OrderService throws new DomainError, not new Error
      expect(() => {
        classes(p)
          .that()
          .haveNameMatching('OrderService')
          .should()
          .notContain(newExpr('Error'))
          .check()
      }).not.toThrow()
    })

    it('regex newExpr catches all Error subtypes', () => {
      // DomainError in good-service and BaseService: newExpr(/Error$/) should find them
      expect(() => {
        classes(p)
          .that()
          .extend('BaseService')
          .should()
          .notContain(newExpr(/Error$/))
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('access() matcher', () => {
    it('no BaseService subclass should access process.env', () => {
      // None of our fixtures access process.env
      expect(() => {
        classes(p).that().extend('BaseService').should().notContain(access('process.env')).check()
      }).not.toThrow()
    })

    it('regex access matcher for this.db', () => {
      // ProductService.findById accesses this.db[id], OrderService does too
      // But the property access text is 'this.db' — let's verify it's found
      expect(() => {
        classes(p)
          .that()
          .extend('BaseService')
          .and()
          .haveMethodNamed('findById')
          .should()
          .contain(access(/^this\.db/))
          .check()
      }).not.toThrow()
    })
  })

  describe('useInsteadOf()', () => {
    it('should use DomainError instead of Error for OrderService', () => {
      expect(() => {
        classes(p)
          .that()
          .haveNameMatching('OrderService')
          .should()
          .useInsteadOf(newExpr('Error'), newExpr('DomainError'))
          .check()
      }).not.toThrow()
    })

    it('should fail for ProductService which uses Error but not DomainError', () => {
      expect(() => {
        classes(p)
          .that()
          .haveNameMatching('ProductService')
          .should()
          .useInsteadOf(newExpr('Error'), newExpr('DomainError'))
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('combined body analysis with predicates', () => {
    it('edge case service has both parseInt and new Error', () => {
      expect(() => {
        classes(p)
          .that()
          .haveNameMatching('EdgeCaseService')
          .should()
          .notContain(call('parseInt'))
          .check()
      }).toThrow(ArchRuleError)
    })

    it('edge case service optional chaining normalizes to this.normalizeCount', () => {
      // EdgeCaseService.withOptionalChain uses this?.normalizeCount which normalizes
      expect(() => {
        classes(p)
          .that()
          .haveNameMatching('EdgeCaseService')
          .should()
          .contain(call('this.normalizeCount'))
          .check()
      }).not.toThrow()
    })
  })
})

// ─── Function body analysis ────────────────────────────────────────

describe('function body analysis through fluent chain', () => {
  const p = loadTestProject()

  it('functions in src should not contain eval calls', () => {
    // None of the fixture functions call eval
    expect(() => {
      functions(p).that().resideInFolder('**/src/**').should().notContain(call('eval')).check()
    }).not.toThrow()
  })

  it('parseXxxOrder functions should not exist (copy-paste smell)', () => {
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

  it('exported functions (including methods) should not contain new Error', () => {
    // functions() includes class methods by default.
    // ProductService.findById and EdgeCaseService.withMultiple throw new Error.
    expect(() => {
      functions(p).that().areExported().should().notContain(newExpr('Error')).check()
    }).toThrow(ArchRuleError)
  })

  it('standalone exported functions should not contain new Error', () => {
    // parseFooOrder, parseBarOrder, parseBazOrder, listItems, parseConfig
    // None of them throw new Error, so this passes
    expect(() => {
      functions(p)
        .that()
        .haveNameMatching(/^(parse|list)/)
        .should()
        .notContain(newExpr('Error'))
        .check()
    }).not.toThrow()
  })
})
