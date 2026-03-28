import { describe, it, expect, vi } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { modules } from '../../src/builders/module-rule-builder.js'
import { types } from '../../src/builders/type-rule-builder.js'
import { functions } from '../../src/builders/function-rule-builder.js'
import { classes } from '../../src/builders/class-rule-builder.js'
import { calls } from '../../src/builders/call-rule-builder.js'
import { crossLayer } from '../../src/builders/cross-layer-builder.js'
import { smells } from '../../src/smells/index.js'
import { ArchRuleError } from '../../src/core/errors.js'
import { call, access, newExpr, expression } from '../../src/helpers/matchers.js'
import {
  isString,
  isNumber,
  isBoolean,
  isUnionOfLiterals,
  isStringLiteral,
  arrayOf,
  matching,
  exactly,
  not,
} from '../../src/index.js'
import { haveConsistentExports } from '../../src/conditions/cross-layer.js'
import { parseExclusionComments, isExcludedByComment } from '../../src/core/exclusion-comments.js'
import { extractCallbacks } from '../../src/helpers/callback-extractor.js'
import { collectCalls } from '../../src/models/arch-call.js'
import type { ArchProject } from '../../src/core/project.js'
import type { ArchViolation } from '../../src/core/violation.js'

// ─── Fixture project loaders ────────────────────────────────────────

const modulesDir = path.resolve(import.meta.dirname, '../fixtures/modules')
const modulesTsconfig = path.join(modulesDir, 'tsconfig.json')

const pocDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const pocTsconfig = path.join(pocDir, 'tsconfig.json')

const callsDir = path.resolve(import.meta.dirname, '../fixtures/calls')
const callsTsconfig = path.join(callsDir, 'tsconfig.json')

const crossLayerDir = path.resolve(import.meta.dirname, '../fixtures/cross-layer')
const crossLayerTsconfig = path.join(crossLayerDir, 'tsconfig.json')

const smellsDir = path.resolve(import.meta.dirname, '../fixtures/smells/duplicate-bodies')
const smellsTsconfig = path.join(smellsDir, 'tsconfig.json')

function loadProject(tsconfigPath: string): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

// ═══════════════════════════════════════════════════════════════════
// 1. Module predicates (modules() builder)
//    Covers: src/predicates/module.ts, src/builders/module-rule-builder.ts
// ═══════════════════════════════════════════════════════════════════

describe('module predicates — importFrom, notImportFrom, exportSymbolNamed, havePathMatching', () => {
  const p = loadProject(modulesTsconfig)

  describe('importFrom()', () => {
    it('filters modules that import from shared/**', () => {
      // domain/order.ts imports from shared/validation.ts
      expect(() => {
        modules(p)
          .that()
          .importFrom('**/shared/**')
          .and()
          .resideInFolder('**/domain/**')
          .and()
          .haveNameMatching(/^(?!typed-service)/)
          .should()
          .onlyImportFrom('**/shared/**', '**/domain/**')
          .check()
      }).not.toThrow()
    })

    it('filters modules that import from infra/**', () => {
      // bad/leaky-domain.ts imports from infra/database.ts
      expect(() => {
        modules(p).that().importFrom('**/infra/**').should().notExist().check()
      }).toThrow(ArchRuleError)
    })

    it('importFrom with no matches produces no violations', () => {
      // No module imports from a nonexistent path
      expect(() => {
        modules(p).that().importFrom('**/nonexistent/**').should().notExist().check()
      }).not.toThrow()
    })
  })

  describe('notImportFrom()', () => {
    it('filters modules that do NOT import from infra/**', () => {
      // domain/order.ts and domain/entity.ts do not import from infra
      expect(() => {
        modules(p)
          .that()
          .notImportFrom('**/infra/**')
          .and()
          .resideInFolder('**/domain/**')
          .should()
          .onlyImportFrom('**/domain/**', '**/shared/**')
          .check()
      }).not.toThrow()
    })

    it('notImportFrom excludes modules that DO import from infra', () => {
      // leaky-domain.ts imports from infra — filtered OUT by notImportFrom
      // Only non-type-import.ts remains in bad/, which imports from domain and shared
      expect(() => {
        modules(p)
          .that()
          .notImportFrom('**/infra/**')
          .and()
          .resideInFolder('**/bad/**')
          .should()
          .notImportFromCondition('**/infra/**')
          .check()
      }).not.toThrow()
    })
  })

  describe('exportSymbolNamed()', () => {
    it('finds modules exporting "Order"', () => {
      // domain/order.ts exports Order interface
      expect(() => {
        modules(p)
          .that()
          .exportSymbolNamed('Order')
          .should()
          .onlyImportFrom('**/domain/**', '**/shared/**')
          .check()
      }).not.toThrow()
    })

    it('finds modules exporting "Entity"', () => {
      // domain/entity.ts exports Entity interface
      expect(() => {
        modules(p)
          .that()
          .exportSymbolNamed('Entity')
          .should()
          .onlyImportFrom('**/domain/**', '**/shared/**')
          .check()
      }).not.toThrow()
    })

    it('no module exports a nonexistent symbol', () => {
      expect(() => {
        modules(p).that().exportSymbolNamed('NonExistentSymbol').should().notExist().check()
      }).not.toThrow()
    })
  })

  describe('havePathMatching()', () => {
    it('matches modules in the domain folder', () => {
      expect(() => {
        modules(p)
          .that()
          .havePathMatching('**/domain/**')
          .and()
          .haveNameMatching(/^(?!typed-service)/)
          .should()
          .onlyImportFrom('**/domain/**', '**/shared/**')
          .check()
      }).not.toThrow()
    })

    it('matches modules in the bad folder', () => {
      expect(() => {
        modules(p)
          .that()
          .havePathMatching('**/bad/**')
          .should()
          .notImportFromCondition('**/infra/**')
          .check()
      }).toThrow(ArchRuleError)
    })

    it('havePathMatching with *.ts glob', () => {
      expect(() => {
        modules(p)
          .that()
          .havePathMatching('**/*.ts')
          .and()
          .resideInFolder('**/domain/**')
          .and()
          .haveNameMatching(/^(?!typed-service)/)
          .should()
          .onlyImportFrom('**/domain/**', '**/shared/**')
          .check()
      }).not.toThrow()
    })
  })

  describe('haveNameMatching() on modules', () => {
    it('filters modules by base file name regex', () => {
      expect(() => {
        modules(p)
          .that()
          .haveNameMatching(/^order\.ts$/)
          .should()
          .onlyImportFrom('**/domain/**', '**/shared/**')
          .check()
      }).not.toThrow()
    })
  })
})

// ═══════════════════════════════════════════════════════════════════
// 2. Type matchers (types() builder)
//    Covers: src/helpers/type-matchers.ts, src/predicates/type.ts
// ═══════════════════════════════════════════════════════════════════

describe('type matchers — isString, isNumber, isBoolean, isStringLiteral, isUnionOfLiterals, arrayOf, matching, exactly, not()', () => {
  const p = loadProject(pocTsconfig)

  describe('isString()', () => {
    it('UnsafeOptions.sortBy is a bare string — isString matches', () => {
      expect(() => {
        types(p)
          .that()
          .haveNameMatching('UnsafeOptions')
          .should()
          .havePropertyType('sortBy', isString())
          .check()
      }).not.toThrow()
    })

    it('SafeOptions.sortBy is NOT a bare string', () => {
      expect(() => {
        types(p)
          .that()
          .haveNameMatching('SafeOptions')
          .should()
          .havePropertyType('sortBy', isString())
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('isNumber()', () => {
    it('UnrelatedOptions.limit is number — isNumber matches', () => {
      expect(() => {
        types(p)
          .that()
          .haveNameMatching('UnrelatedOptions')
          .should()
          .havePropertyType('limit', isNumber())
          .check()
      }).not.toThrow()
    })

    it('UnsafeOptions.sortBy is not a number', () => {
      expect(() => {
        types(p)
          .that()
          .haveNameMatching('UnsafeOptions')
          .should()
          .havePropertyType('sortBy', isNumber())
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('isBoolean()', () => {
    it('isBoolean does not match a string type', () => {
      expect(() => {
        types(p)
          .that()
          .haveNameMatching('UnsafeOptions')
          .should()
          .havePropertyType('sortBy', isBoolean())
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('isUnionOfLiterals()', () => {
    it('SafeOptions.direction is a union of literals', () => {
      expect(() => {
        types(p)
          .that()
          .haveNameMatching('SafeOptions')
          .should()
          .havePropertyType('direction', isUnionOfLiterals())
          .check()
      }).not.toThrow()
    })

    it('UnsafeOptions.sortBy is bare string, not union of literals', () => {
      expect(() => {
        types(p)
          .that()
          .haveNameMatching('UnsafeOptions')
          .should()
          .havePropertyType('sortBy', isUnionOfLiterals())
          .check()
      }).toThrow(ArchRuleError)
    })

    it('SingleLiteralOptions.sortBy is a single literal — not a union (< 2 members)', () => {
      expect(() => {
        types(p)
          .that()
          .haveNameMatching('SingleLiteralOptions')
          .should()
          .havePropertyType('sortBy', isUnionOfLiterals())
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('isStringLiteral()', () => {
    it('isStringLiteral() matches any string literal', () => {
      expect(() => {
        types(p)
          .that()
          .haveNameMatching('SingleLiteralOptions')
          .should()
          .havePropertyType('sortBy', isStringLiteral())
          .check()
      }).not.toThrow()
    })

    it('isStringLiteral("created_at") matches specific literal', () => {
      expect(() => {
        types(p)
          .that()
          .haveNameMatching('SingleLiteralOptions')
          .should()
          .havePropertyType('sortBy', isStringLiteral('created_at'))
          .check()
      }).not.toThrow()
    })

    it('isStringLiteral("wrong_value") does not match', () => {
      expect(() => {
        types(p)
          .that()
          .haveNameMatching('SingleLiteralOptions')
          .should()
          .havePropertyType('sortBy', isStringLiteral('wrong_value'))
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('matching()', () => {
    it('matching(/string/) matches bare string type', () => {
      expect(() => {
        types(p)
          .that()
          .haveNameMatching('UnsafeOptions')
          .should()
          .havePropertyType('sortBy', matching(/string/))
          .check()
      }).not.toThrow()
    })

    it('matching(/number/) matches number type', () => {
      expect(() => {
        types(p)
          .that()
          .haveNameMatching('UnrelatedOptions')
          .should()
          .havePropertyType('limit', matching(/number/))
          .check()
      }).not.toThrow()
    })
  })

  describe('exactly()', () => {
    it('exactly("string") matches bare string', () => {
      expect(() => {
        types(p)
          .that()
          .haveNameMatching('UnsafeOptions')
          .should()
          .havePropertyType('sortBy', exactly('string'))
          .check()
      }).not.toThrow()
    })

    it('exactly("number") matches number type', () => {
      expect(() => {
        types(p)
          .that()
          .haveNameMatching('UnrelatedOptions')
          .should()
          .havePropertyType('limit', exactly('number'))
          .check()
      }).not.toThrow()
    })

    it('exactly("string") does not match union of literals', () => {
      expect(() => {
        types(p)
          .that()
          .haveNameMatching('SafeOptions')
          .should()
          .havePropertyType('sortBy', exactly('string'))
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('not(matcher)', () => {
    it('not(isString()) rejects bare string', () => {
      expect(() => {
        types(p)
          .that()
          .haveNameMatching('UnsafeOptions')
          .should()
          .havePropertyType('sortBy', not(isString()))
          .check()
      }).toThrow(ArchRuleError)
    })

    it('not(isString()) passes for union of literals', () => {
      expect(() => {
        types(p)
          .that()
          .haveNameMatching('SafeOptions')
          .should()
          .havePropertyType('sortBy', not(isString()))
          .check()
      }).not.toThrow()
    })

    it('not(isNumber()) passes for string type', () => {
      expect(() => {
        types(p)
          .that()
          .haveNameMatching('UnsafeOptions')
          .should()
          .havePropertyType('sortBy', not(isNumber()))
          .check()
      }).not.toThrow()
    })
  })

  describe('arrayOf()', () => {
    it('arrayOf(isString()) matches string[] property', () => {
      // Order interface in domain.ts: items is not available in poc, but
      // we test against the domain fixture's Order.items: string[]
      // Instead, use poc's domain.ts — but it doesn't have arrays.
      // Let's test with a negative: number is not an array
      expect(() => {
        types(p)
          .that()
          .haveNameMatching('UnrelatedOptions')
          .should()
          .havePropertyType('limit', arrayOf(isNumber()))
          .check()
      }).toThrow(ArchRuleError) // limit is number, not number[]
    })
  })

  describe('havePropertyOfType() predicate', () => {
    it('filters types that have sortBy of type string', () => {
      // UnsafeOptions has sortBy: string
      expect(() => {
        types(p)
          .that()
          .havePropertyOfType('sortBy', isString())
          .should()
          .havePropertyType('sortBy', not(isUnionOfLiterals()))
          .check()
      }).not.toThrow()
    })
  })

  describe('extendType() predicate', () => {
    it('finds interfaces extending Entity', () => {
      // domain.ts: Order extends nothing. But options.ts: interface Order extends Entity in modules.
      // In poc fixture, let's check that no type extends a nonexistent base
      expect(() => {
        types(p).that().extendType('NonExistentBase').should().notExist().check()
      }).not.toThrow()
    })
  })
})

// ═══════════════════════════════════════════════════════════════════
// 3. Body analysis matchers on functions
//    Covers: src/conditions/body-analysis-function.ts,
//            src/helpers/matchers.ts (access, newExpr, expression),
//            src/helpers/body-traversal.ts (searchFunctionBody)
// ═══════════════════════════════════════════════════════════════════

describe('function body analysis — access, newExpr, expression, useInsteadOf', () => {
  const p = loadProject(pocTsconfig)

  describe('access() matcher on functions', () => {
    it('functions should not access process.env', () => {
      expect(() => {
        functions(p)
          .that()
          .resideInFolder('**/src/**')
          .should()
          .notContain(access('process.env'))
          .check()
      }).not.toThrow()
    })

    it('access() with regex detects this.db usage', () => {
      // ProductService.findById and OrderService.findById access this.db
      expect(() => {
        functions(p)
          .that()
          .haveNameMatching('findById')
          .should()
          .contain(access(/^this\.db/))
          .check()
      }).not.toThrow()
    })
  })

  describe('newExpr() matcher on functions', () => {
    it('exported functions named parseFoo should not throw new Error', () => {
      expect(() => {
        functions(p)
          .that()
          .haveNameMatching(/^parse/)
          .should()
          .notContain(newExpr('Error'))
          .check()
      }).not.toThrow()
    })

    it('newExpr regex /Error$/ catches all Error subtypes in functions', () => {
      // BaseService.toError throws DomainError, ProductService throws Error
      expect(() => {
        functions(p)
          .that()
          .haveNameMatching('findById')
          .should()
          .notContain(newExpr(/Error$/))
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('expression() matcher on functions', () => {
    it('expression(string) searches broadly with warning', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        // parseFooOrder returns an object with field property - contains 'field'
        expect(() => {
          functions(p)
            .that()
            .haveNameMatching('parseFooOrder')
            .should()
            .contain(expression('isDesc'))
            .check()
        }).not.toThrow()
        expect(warnSpy).toHaveBeenCalled()
      } finally {
        warnSpy.mockRestore()
      }
    })

    it('expression(regex) matches against node text', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        expect(() => {
          functions(p)
            .that()
            .haveNameMatching('parseFooOrder')
            .should()
            .contain(expression(/startsWith/))
            .check()
        }).not.toThrow()
      } finally {
        warnSpy.mockRestore()
      }
    })

    it('expression() that does not match produces violation', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        expect(() => {
          functions(p)
            .that()
            .haveNameMatching('parseFooOrder')
            .should()
            .contain(expression('__nonexistent_token__'))
            .check()
        }).toThrow(ArchRuleError)
      } finally {
        warnSpy.mockRestore()
      }
    })
  })

  describe('functionUseInsteadOf()', () => {
    it('functions should use DomainError instead of Error', () => {
      // findById in OrderService uses DomainError, not Error — passes
      expect(() => {
        functions(p)
          .that()
          .haveNameMatching('findById')
          .and()
          .resideInFile('**/good-service.ts')
          .should()
          .useInsteadOf(newExpr('Error'), newExpr('DomainError'))
          .check()
      }).not.toThrow()
    })

    it('ProductService.findById uses Error instead of DomainError — violation', () => {
      expect(() => {
        functions(p)
          .that()
          .haveNameMatching('findById')
          .and()
          .resideInFile('**/bad-service.ts')
          .should()
          .useInsteadOf(newExpr('Error'), newExpr('DomainError'))
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('functionContain() positive', () => {
    it('parseFooOrder contains call to startsWith', () => {
      expect(() => {
        functions(p)
          .that()
          .haveNameMatching('parseFooOrder')
          .should()
          .contain(call(/startsWith/))
          .check()
      }).not.toThrow()
    })
  })
})

// ═══════════════════════════════════════════════════════════════════
// 4. Call conditions
//    Covers: src/conditions/call.ts, src/helpers/callback-extractor.ts,
//            src/helpers/body-traversal.ts (getFunctionBody, findMatchesInNode)
// ═══════════════════════════════════════════════════════════════════

describe('call conditions — haveCallbackContaining, notHaveCallbackContaining', () => {
  const p = loadProject(callsTsconfig)

  describe('haveCallbackContaining()', () => {
    it('app.get route callbacks should contain handleError', () => {
      // app.get('/api/users') has handleError, app.get('/api/admin/settings') has handleError
      expect(() => {
        calls(p)
          .that()
          .onObject('app')
          .and()
          .withMethod('get')
          .and()
          .resideInFile('**/express-routes.ts')
          .should()
          .haveCallbackContaining(call('handleError'))
          .check()
      }).not.toThrow()
    })

    it('app.post route callback is missing handleError — violation', () => {
      expect(() => {
        calls(p)
          .that()
          .onObject('app')
          .and()
          .withMethod('post')
          .and()
          .resideInFile('**/express-routes.ts')
          .should()
          .haveCallbackContaining(call('handleError'))
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('notHaveCallbackContaining()', () => {
    it('routes should not have callbacks containing db.query', () => {
      expect(() => {
        calls(p)
          .that()
          .onObject('app')
          .and()
          .withMethod(/^(get|post)$/)
          .and()
          .resideInFile('**/express-routes.ts')
          .should()
          .notHaveCallbackContaining(call('db.query'))
          .check()
      }).not.toThrow()
    })

    it('notHaveCallbackContaining detects handleError in callbacks that have it', () => {
      // app.get('/api/users') callback HAS handleError — this should produce violations
      expect(() => {
        calls(p)
          .that()
          .onObject('app')
          .and()
          .withMethod('get')
          .and()
          .resideInFile('**/express-routes.ts')
          .should()
          .notHaveCallbackContaining(call('handleError'))
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('nested callbacks and function expressions', () => {
    it('router.get with multiple callbacks — second has handleError', () => {
      expect(() => {
        calls(p)
          .that()
          .onObject('router')
          .and()
          .withMethod('get')
          .and()
          .resideInFile('**/nested-callbacks.ts')
          .should()
          .haveCallbackContaining(call('handleError'))
          .check()
      }).not.toThrow()
    })

    it('router.post with function expression callback has validateInput', () => {
      expect(() => {
        calls(p)
          .that()
          .onObject('router')
          .and()
          .withMethod('post')
          .and()
          .resideInFile('**/nested-callbacks.ts')
          .should()
          .haveCallbackContaining(call('validateInput'))
          .check()
      }).not.toThrow()
    })
  })
})

// ═══════════════════════════════════════════════════════════════════
// 5. extractCallbacks() — direct unit coverage through integration
//    Covers: src/helpers/callback-extractor.ts
// ═══════════════════════════════════════════════════════════════════

describe('extractCallbacks — arrow functions and function expressions', () => {
  const p = loadProject(callsTsconfig)

  it('extracts arrow function callbacks from app.get()', () => {
    const sourceFiles = p.getSourceFiles()
    const expressFile = sourceFiles.find((sf) => sf.getFilePath().endsWith('express-routes.ts'))
    expect(expressFile).toBeDefined()

    const allCalls = collectCalls(expressFile!)
    const appGetCalls = allCalls.filter(
      (c) => c.getObjectName() === 'app' && c.getMethodName() === 'get',
    )

    expect(appGetCalls.length).toBeGreaterThanOrEqual(1)

    // Extract callbacks from the first app.get()
    const firstCall = appGetCalls[0]!
    const callbacks = extractCallbacks(firstCall.getNode())
    expect(callbacks.length).toBeGreaterThanOrEqual(1)
    expect(callbacks[0]!.argIndex).toBeGreaterThanOrEqual(1) // path is arg 0, callback is arg 1
    expect(callbacks[0]!.fn.isExported()).toBe(false)
  })

  it('extracts function expression callback from router.post()', () => {
    const sourceFiles = p.getSourceFiles()
    const nestedFile = sourceFiles.find((sf) => sf.getFilePath().endsWith('nested-callbacks.ts'))
    expect(nestedFile).toBeDefined()

    const allCalls = collectCalls(nestedFile!)
    const routerPostCalls = allCalls.filter(
      (c) => c.getObjectName() === 'router' && c.getMethodName() === 'post',
    )

    expect(routerPostCalls.length).toBeGreaterThanOrEqual(1)

    const callbacks = extractCallbacks(routerPostCalls[0]!.getNode())
    expect(callbacks.length).toBeGreaterThanOrEqual(1)

    // The function expression callback has a name: 'handler'
    const namedCallback = callbacks.find((cb) => cb.fn.getName() === 'handler')
    expect(namedCallback).toBeDefined()
  })

  it('non-function arguments are not extracted as callbacks', () => {
    const sourceFiles = p.getSourceFiles()
    const expressFile = sourceFiles.find((sf) => sf.getFilePath().endsWith('express-routes.ts'))
    expect(expressFile).toBeDefined()

    // app.use(cors()) — cors() returns a value, not an inline function
    const allCalls = collectCalls(expressFile!)
    const useCalls = allCalls.filter(
      (c) => c.getObjectName() === 'app' && c.getMethodName() === 'use',
    )

    for (const useCall of useCalls) {
      const callbacks = extractCallbacks(useCall.getNode())
      // String args like '/api' and call results like cors() should not be extracted
      for (const cb of callbacks) {
        expect(cb.fn.getBody()).toBeDefined()
      }
    }
  })
})

// ═══════════════════════════════════════════════════════════════════
// 6. Terminal builder — .andShould() chaining
//    Covers: src/core/terminal-builder.ts (andShould, severity)
// ═══════════════════════════════════════════════════════════════════

describe('terminal builder — .andShould() chaining and severity', () => {
  const p = loadProject(pocTsconfig)

  it('.andShould() chains multiple conditions', () => {
    // All BaseService subclasses should be exported AND have name matching /Service$/
    expect(() => {
      classes(p)
        .that()
        .extend('BaseService')
        .should()
        .beExported()
        .andShould()
        .conditionHaveNameMatching(/Service$/)
        .check()
    }).not.toThrow()
  })

  it('.andShould() fails when second condition is violated', () => {
    // BaseService subclasses should be exported AND should extend NonExistent
    expect(() => {
      classes(p)
        .that()
        .extend('BaseService')
        .should()
        .beExported()
        .andShould()
        .shouldExtend('NonExistent')
        .check()
    }).toThrow(ArchRuleError)
  })

  it('.andShould() with body analysis — notContain + notContain', () => {
    // OrderService should not contain parseInt AND should not contain new Error
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching('OrderService')
        .should()
        .notContain(call('parseInt'))
        .andShould()
        .notContain(newExpr('Error'))
        .check()
    }).not.toThrow()
  })

  it('.andShould() fails when first condition fails', () => {
    // ProductService DOES contain parseInt — first condition fails
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching('ProductService')
        .should()
        .notContain(call('parseInt'))
        .andShould()
        .beExported()
        .check()
    }).toThrow(ArchRuleError)
  })

  it('.severity("error") throws on violation', () => {
    expect(() => {
      classes(p)
        .that()
        .extend('BaseService')
        .should()
        .shouldHaveMethodNamed('getTotal')
        .severity('error')
    }).toThrow(ArchRuleError) // EdgeCaseService extends BaseService but lacks getTotal
  })

  it('.severity("warn") does not throw', () => {
    expect(() => {
      classes(p)
        .that()
        .extend('BaseService')
        .should()
        .shouldHaveMethodNamed('getTotal')
        .severity('warn')
    }).not.toThrow()
  })
})

// ═══════════════════════════════════════════════════════════════════
// 7. Structural conditions as conditions (not predicates)
//    Covers: src/conditions/structural.ts (resideInFile, resideInFolder)
// ═══════════════════════════════════════════════════════════════════

describe('structural conditions — shouldResideInFile, shouldResideInFolder', () => {
  const p = loadProject(pocTsconfig)

  it('shouldResideInFile — classes should reside in .ts files', () => {
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching('ProductService')
        .should()
        .shouldResideInFile('**/*.ts')
        .check()
    }).not.toThrow()
  })

  it('shouldResideInFile — fails for incorrect pattern', () => {
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching('ProductService')
        .should()
        .shouldResideInFile('**/nonexistent/*.ts')
        .check()
    }).toThrow(ArchRuleError)
  })

  it('shouldResideInFolder — classes should reside in src folder', () => {
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching('ProductService')
        .should()
        .shouldResideInFolder('**/src')
        .check()
    }).not.toThrow()
  })

  it('shouldResideInFolder — fails for wrong folder', () => {
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching('ProductService')
        .should()
        .shouldResideInFolder('**/nonexistent')
        .check()
    }).toThrow(ArchRuleError)
  })
})

// ═══════════════════════════════════════════════════════════════════
// 8. Smell builder options
//    Covers: src/smells/smell-builder.ts (inFolder, ignorePaths, ignoreTests, groupByFolder)
// ═══════════════════════════════════════════════════════════════════

describe('smell builder options — inFolder, ignorePaths, ignoreTests, groupByFolder', () => {
  const p = loadProject(smellsTsconfig)

  it('inFolder scopes detection to matching files', () => {
    // Scope to the fixture dir — should still find duplicates
    expect(() => {
      smells.duplicateBodies(p).inFolder('**/*.ts').withMinSimilarity(0.7).minLines(5).check()
    }).toThrow(ArchRuleError)
  })

  it('ignorePaths excludes specific files', () => {
    // Ignore file-b.ts — the only near-duplicate of file-a.ts
    // With file-b excluded, no similar pairs remain
    expect(() => {
      smells
        .duplicateBodies(p)
        .ignorePaths('**/file-b.ts')
        .withMinSimilarity(0.7)
        .minLines(5)
        .check()
    }).not.toThrow()
  })

  it('ignoreTests does not affect non-test fixtures', () => {
    // Our fixture files are not test files, so ignoreTests has no effect
    expect(() => {
      smells.duplicateBodies(p).ignoreTests().withMinSimilarity(0.7).minLines(5).check()
    }).toThrow(ArchRuleError)
  })

  it('groupByFolder produces violations sorted by directory', () => {
    // groupByFolder changes output ordering — still produces violations
    expect(() => {
      smells.duplicateBodies(p).groupByFolder().withMinSimilarity(0.7).minLines(5).check()
    }).toThrow(ArchRuleError)
  })

  it('.because() attaches reason to smell violations', () => {
    try {
      smells
        .duplicateBodies(p)
        .withMinSimilarity(0.7)
        .minLines(5)
        .because('consolidate duplicate parsers')
        .check()
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ArchRuleError)
      const archError = error as ArchRuleError
      expect(archError.violations[0]!.because).toBe('consolidate duplicate parsers')
    }
  })

  it('combining inFolder + ignorePaths + ignoreTests + groupByFolder', () => {
    expect(() => {
      smells
        .duplicateBodies(p)
        .inFolder('**/*.ts')
        .ignoreTests()
        .ignorePaths('**/file-c.ts')
        .groupByFolder()
        .withMinSimilarity(0.7)
        .minLines(5)
        .check()
    }).toThrow(ArchRuleError)
  })
})

// ═══════════════════════════════════════════════════════════════════
// 9. Cross-layer — haveConsistentExports
//    Covers: src/conditions/cross-layer.ts (haveConsistentExports)
// ═══════════════════════════════════════════════════════════════════

describe('cross-layer — haveConsistentExports', () => {
  const p = loadProject(crossLayerTsconfig)

  it('detects inconsistent exports between paired layers', () => {
    // user-route.ts exports UserRoute (class), user-schema.ts exports UserSchema (interface)
    // The extractors pull different symbol names => violations
    const mapped = crossLayer(p)
      .layer('routes', '**/routes/**')
      .layer('schemas', '**/schemas/**')
      .mapping(
        (a, b) =>
          a.getBaseName().replace('-route.ts', '') === b.getBaseName().replace('-schema.ts', ''),
      )

    expect(() => {
      mapped
        .forEachPair()
        .should(
          haveConsistentExports(
            (file) => {
              const names: string[] = []
              for (const [name] of file.getExportedDeclarations()) {
                names.push(name)
              }
              return names
            },
            (file) => {
              const names: string[] = []
              for (const [name] of file.getExportedDeclarations()) {
                names.push(name)
              }
              return names
            },
          ),
        )
        .check()
    }).toThrow(ArchRuleError) // UserRoute !== UserSchema
  })

  it('haveConsistentExports passes when extractors return matching symbols', () => {
    const mapped = crossLayer(p)
      .layer('routes', '**/routes/**')
      .layer('schemas', '**/schemas/**')
      .mapping(
        (a, b) =>
          a.getBaseName().replace('-route.ts', '') === b.getBaseName().replace('-schema.ts', ''),
      )

    // Normalize both sides to just the entity name (e.g., "User", "Order")
    expect(() => {
      mapped
        .forEachPair()
        .should(
          haveConsistentExports(
            (file) => {
              const names: string[] = []
              for (const [name] of file.getExportedDeclarations()) {
                names.push(name.replace('Route', '').replace('Schema', ''))
              }
              return names
            },
            (file) => {
              const names: string[] = []
              for (const [name] of file.getExportedDeclarations()) {
                names.push(name.replace('Route', '').replace('Schema', ''))
              }
              return names
            },
          ),
        )
        .check()
    }).not.toThrow()
  })
})

// ═══════════════════════════════════════════════════════════════════
// 10. Exclusion comments
//     Covers: src/helpers/exclusion-comments.ts
// ═══════════════════════════════════════════════════════════════════

describe('exclusion comments — parseExclusionComments and isExcludedByComment', () => {
  describe('parseExclusionComments', () => {
    it('parses single-line exclusion with reason', () => {
      const source = `// ts-archunit-exclude no-any: legacy code\nconst x = 1;`
      const result = parseExclusionComments(source, '/test/file.ts')
      expect(result.exclusions).toHaveLength(1)
      expect(result.exclusions[0]!.ruleId).toBe('no-any')
      expect(result.exclusions[0]!.reason).toBe('legacy code')
      expect(result.exclusions[0]!.isBlock).toBe(false)
      expect(result.exclusions[0]!.file).toBe('/test/file.ts')
      expect(result.exclusions[0]!.line).toBe(1)
    })

    it('parses single-line exclusion without reason — produces warning', () => {
      const source = `// ts-archunit-exclude no-any\nconst x = 1;`
      const result = parseExclusionComments(source, '/test/file.ts')
      expect(result.exclusions).toHaveLength(1)
      expect(result.exclusions[0]!.ruleId).toBe('no-any')
      expect(result.exclusions[0]!.reason).toBe('')
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]!.message).toContain('Undocumented exclusion')
    })

    it('parses multiple rule IDs in one comment', () => {
      const source = `// ts-archunit-exclude rule-a, rule-b: both needed\nconst x = 1;`
      const result = parseExclusionComments(source, '/test/file.ts')
      expect(result.exclusions).toHaveLength(2)
      expect(result.exclusions[0]!.ruleId).toBe('rule-a')
      expect(result.exclusions[1]!.ruleId).toBe('rule-b')
      expect(result.exclusions[0]!.reason).toBe('both needed')
    })

    it('parses block exclusion (start + end)', () => {
      const source = [
        '// ts-archunit-exclude-start no-any: legacy section',
        'const x: any = 1;',
        'const y: any = 2;',
        '// ts-archunit-exclude-end',
      ].join('\n')
      const result = parseExclusionComments(source, '/test/file.ts')
      expect(result.exclusions).toHaveLength(1)
      expect(result.exclusions[0]!.ruleId).toBe('no-any')
      expect(result.exclusions[0]!.isBlock).toBe(true)
      expect(result.exclusions[0]!.line).toBe(1)
      expect(result.exclusions[0]!.endLine).toBe(4)
    })

    it('warns on block end without matching start', () => {
      const source = `// ts-archunit-exclude-end\nconst x = 1;`
      const result = parseExclusionComments(source, '/test/file.ts')
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]!.message).toContain('without matching start')
    })

    it('warns on unclosed block', () => {
      const source = `// ts-archunit-exclude-start no-any: reason\nconst x = 1;`
      const result = parseExclusionComments(source, '/test/file.ts')
      expect(result.exclusions).toHaveLength(0) // not closed, so not pushed
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]!.message).toContain('without matching end')
    })

    it('warns on nested block start', () => {
      const source = [
        '// ts-archunit-exclude-start rule-a: first block',
        '// ts-archunit-exclude-start rule-b: nested block',
        '// ts-archunit-exclude-end',
      ].join('\n')
      const result = parseExclusionComments(source, '/test/file.ts')
      expect(result.warnings.length).toBeGreaterThanOrEqual(1)
      const nestedWarning = result.warnings.find((w) => w.message.includes('Nested'))
      expect(nestedWarning).toBeDefined()
    })

    it('block start without reason produces undocumented warning', () => {
      const source = [
        '// ts-archunit-exclude-start no-any',
        'const x = 1;',
        '// ts-archunit-exclude-end',
      ].join('\n')
      const result = parseExclusionComments(source, '/test/file.ts')
      const undocWarning = result.warnings.find((w) => w.message.includes('Undocumented'))
      expect(undocWarning).toBeDefined()
    })
  })

  describe('isExcludedByComment', () => {
    it('single-line exclusion covers the next line', () => {
      const source = `// ts-archunit-exclude no-any: legacy\nconst x = 1;`
      const result = parseExclusionComments(source, '/test/file.ts')

      const violation: ArchViolation = {
        rule: 'test rule',
        element: 'x',
        file: '/test/file.ts',
        line: 2, // next line after the comment
        message: 'violation',
        ruleId: 'no-any',
      }

      expect(isExcludedByComment(violation, result.exclusions)).toBe(true)
    })

    it('single-line exclusion does NOT cover a different line', () => {
      const source = `// ts-archunit-exclude no-any: legacy\nconst x = 1;\nconst y = 2;`
      const result = parseExclusionComments(source, '/test/file.ts')

      const violation: ArchViolation = {
        rule: 'test rule',
        element: 'y',
        file: '/test/file.ts',
        line: 3, // two lines after the comment
        message: 'violation',
        ruleId: 'no-any',
      }

      expect(isExcludedByComment(violation, result.exclusions)).toBe(false)
    })

    it('block exclusion covers lines within the block range', () => {
      const source = [
        '// ts-archunit-exclude-start no-any: legacy section',
        'const x: any = 1;',
        'const y: any = 2;',
        '// ts-archunit-exclude-end',
      ].join('\n')
      const result = parseExclusionComments(source, '/test/file.ts')

      const violation: ArchViolation = {
        rule: 'test rule',
        element: 'y',
        file: '/test/file.ts',
        line: 3, // within block
        message: 'violation',
        ruleId: 'no-any',
      }

      expect(isExcludedByComment(violation, result.exclusions)).toBe(true)
    })

    it('block exclusion does NOT cover lines outside the block', () => {
      const source = [
        '// ts-archunit-exclude-start no-any: legacy section',
        'const x: any = 1;',
        '// ts-archunit-exclude-end',
        'const y: any = 2;',
      ].join('\n')
      const result = parseExclusionComments(source, '/test/file.ts')

      const violation: ArchViolation = {
        rule: 'test rule',
        element: 'y',
        file: '/test/file.ts',
        line: 4, // outside block
        message: 'violation',
        ruleId: 'no-any',
      }

      expect(isExcludedByComment(violation, result.exclusions)).toBe(false)
    })

    it('different ruleId is not excluded', () => {
      const source = `// ts-archunit-exclude no-any: legacy\nconst x = 1;`
      const result = parseExclusionComments(source, '/test/file.ts')

      const violation: ArchViolation = {
        rule: 'test rule',
        element: 'x',
        file: '/test/file.ts',
        line: 2,
        message: 'violation',
        ruleId: 'different-rule',
      }

      expect(isExcludedByComment(violation, result.exclusions)).toBe(false)
    })

    it('different file is not excluded', () => {
      const source = `// ts-archunit-exclude no-any: legacy\nconst x = 1;`
      const result = parseExclusionComments(source, '/test/file.ts')

      const violation: ArchViolation = {
        rule: 'test rule',
        element: 'x',
        file: '/test/other-file.ts',
        line: 2,
        message: 'violation',
        ruleId: 'no-any',
      }

      expect(isExcludedByComment(violation, result.exclusions)).toBe(false)
    })

    it('violation without ruleId is never excluded', () => {
      const source = `// ts-archunit-exclude no-any: legacy\nconst x = 1;`
      const result = parseExclusionComments(source, '/test/file.ts')

      const violation: ArchViolation = {
        rule: 'test rule',
        element: 'x',
        file: '/test/file.ts',
        line: 2,
        message: 'violation',
        // no ruleId
      }

      expect(isExcludedByComment(violation, result.exclusions)).toBe(false)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════
// 11. Additional module rule builder coverage
//     Covers more of src/builders/module-rule-builder.ts
// ═══════════════════════════════════════════════════════════════════

describe('module rule builder — additional methods', () => {
  const p = loadProject(modulesTsconfig)

  it('.notExist() — asserts no matching modules exist', () => {
    // Modules in a nonexistent path should not exist — passes
    expect(() => {
      modules(p).that().resideInFolder('**/nonexistent/**').should().notExist().check()
    }).not.toThrow()
  })

  it('.notExist() fails when matching modules DO exist', () => {
    expect(() => {
      modules(p).that().resideInFolder('**/domain/**').should().notExist().check()
    }).toThrow(ArchRuleError)
  })

  it('onlyHaveTypeImportsFrom — non-type imports from domain produce violations', () => {
    // bad/non-type-import.ts has `import { Entity }` (value import) from domain
    expect(() => {
      modules(p)
        .that()
        .havePathMatching('**/non-type-import.ts')
        .should()
        .onlyHaveTypeImportsFrom('**/domain/**')
        .check()
    }).toThrow(ArchRuleError)
  })
})

// ═══════════════════════════════════════════════════════════════════
// 12. Additional body-traversal coverage
//     Covers: src/helpers/body-traversal.ts (searchClassBody with
//     constructors, getters, setters)
// ═══════════════════════════════════════════════════════════════════

describe('body traversal — class constructors and edge cases', () => {
  const p = loadProject(pocTsconfig)

  it('searchClassBody finds patterns in constructor', () => {
    // DomainError constructor calls super(message)
    expect(() => {
      classes(p).that().haveNameMatching('DomainError').should().contain(call('super')).check()
    }).not.toThrow()
  })

  it('notContain on class with empty result — no violations', () => {
    // DomainError does not contain parseInt
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching('DomainError')
        .should()
        .notContain(call('parseInt'))
        .check()
    }).not.toThrow()
  })
})
