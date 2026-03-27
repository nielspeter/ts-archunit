import { describe, it, expect, vi } from 'vitest'
import path from 'node:path'
import { Project, type ClassDeclaration } from 'ts-morph'
import { and, or, not } from '../../src/core/predicate.js'
import type { Predicate } from '../../src/core/predicate.js'
import {
  haveNameMatching,
  haveNameStartingWith,
  haveNameEndingWith,
  resideInFile,
  resideInFolder,
  areExported,
  areNotExported,
} from '../../src/predicates/identity.js'
import type { Named, Located, Exportable } from '../../src/predicates/identity.js'
import type { SourceFile } from 'ts-morph'

// --- Mock helpers ---

function named(name: string | undefined): Named {
  return { getName: () => name }
}

function located(filePath: string): Located {
  return { getSourceFile: () => ({ getFilePath: () => filePath }) as SourceFile }
}

function exportable(exported: boolean): Exportable {
  return { isExported: () => exported }
}

// --- Load PoC fixtures ---

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')
const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })

// --- Tests ---

describe('Predicate interface & combinators', () => {
  it('Predicate — test() returns boolean, description is readable', () => {
    const p: Predicate<string> = {
      description: 'is non-empty',
      test: (s) => s.length > 0,
    }
    expect(p.test('hello')).toBe(true)
    expect(p.test('')).toBe(false)
    expect(p.description).toBe('is non-empty')
  })

  it('and() — returns true only when all predicates match', () => {
    const p1: Predicate<number> = { description: 'positive', test: (n) => n > 0 }
    const p2: Predicate<number> = { description: 'even', test: (n) => n % 2 === 0 }
    const combined = and(p1, p2)
    expect(combined.test(4)).toBe(true)
    expect(combined.test(3)).toBe(false)
    expect(combined.test(-2)).toBe(false)
  })

  it('and() — description joins with " and "', () => {
    const p1: Predicate<number> = { description: 'positive', test: () => true }
    const p2: Predicate<number> = { description: 'even', test: () => true }
    expect(and(p1, p2).description).toBe('positive and even')
  })

  it('and() — short-circuits on first false', () => {
    const spy = vi.fn(() => true)
    const p1: Predicate<number> = { description: 'false', test: () => false }
    const p2: Predicate<number> = { description: 'spy', test: spy }
    and(p1, p2).test(1)
    expect(spy).not.toHaveBeenCalled()
  })

  it('or() — returns true when any predicate matches', () => {
    const p1: Predicate<number> = { description: 'positive', test: (n) => n > 0 }
    const p2: Predicate<number> = { description: 'even', test: (n) => n % 2 === 0 }
    const combined = or(p1, p2)
    expect(combined.test(3)).toBe(true) // positive but odd
    expect(combined.test(-2)).toBe(true) // negative but even
    expect(combined.test(-3)).toBe(false) // negative and odd
  })

  it('or() — description joins with " or "', () => {
    const p1: Predicate<number> = { description: 'positive', test: () => true }
    const p2: Predicate<number> = { description: 'even', test: () => true }
    expect(or(p1, p2).description).toBe('positive or even')
  })

  it('not() — inverts the predicate result', () => {
    const p: Predicate<number> = { description: 'positive', test: (n) => n > 0 }
    const inverted = not(p)
    expect(inverted.test(5)).toBe(false)
    expect(inverted.test(-1)).toBe(true)
  })

  it('not() — description wraps with "not (...)"', () => {
    const p: Predicate<number> = { description: 'are exported', test: () => true }
    expect(not(p).description).toBe('not (are exported)')
  })

  it('nested composition — and(not(p1), or(p2, p3)) works correctly', () => {
    const p1: Predicate<number> = { description: 'negative', test: (n) => n < 0 }
    const p2: Predicate<number> = { description: 'even', test: (n) => n % 2 === 0 }
    const p3: Predicate<number> = { description: 'gt10', test: (n) => n > 10 }
    const composed = and(not(p1), or(p2, p3))
    expect(composed.test(12)).toBe(true) // not negative, even and >10
    expect(composed.test(4)).toBe(true) // not negative, even
    expect(composed.test(15)).toBe(true) // not negative, >10
    expect(composed.test(3)).toBe(false) // not negative, but odd and <=10
    expect(composed.test(-4)).toBe(false) // negative
  })
})

describe('haveNameMatching', () => {
  it('matches class name with RegExp /Service$/', () => {
    expect(haveNameMatching(/Service$/).test(named('OrderService'))).toBe(true)
  })

  it('does not match class with non-matching name', () => {
    expect(haveNameMatching(/Service$/).test(named('DomainError'))).toBe(false)
  })

  it('handles string pattern — converts to RegExp', () => {
    expect(haveNameMatching('Service$').test(named('OrderService'))).toBe(true)
    expect(haveNameMatching('Service$').test(named('DomainError'))).toBe(false)
  })

  it('returns false for unnamed element (getName() returns undefined)', () => {
    expect(haveNameMatching(/Service$/).test(named(undefined))).toBe(false)
  })

  it('against ts-morph: matches OrderService from good-service.ts', () => {
    const classes = tsMorphProject.getSourceFiles().flatMap((sf) => sf.getClasses())
    const pred = haveNameMatching(/^OrderService$/)
    const matched = classes.filter((c) => pred.test(c))
    expect(matched).toHaveLength(1)
    expect(matched[0]?.getName()).toBe('OrderService')
  })

  it('against ts-morph: matches parseFooOrder function from routes.ts', () => {
    const routesFile = tsMorphProject
      .getSourceFiles()
      .find((sf) => sf.getBaseName() === 'routes.ts')
    expect(routesFile).toBeDefined()
    const functions = routesFile!.getFunctions()
    const pred = haveNameMatching(/^parseFooOrder$/)
    const matched = functions.filter((f) => pred.test(f))
    expect(matched).toHaveLength(1)
    expect(matched[0]?.getName()).toBe('parseFooOrder')
  })
})

describe('haveNameStartingWith / haveNameEndingWith', () => {
  it('haveNameStartingWith("parse") matches "parseFooOrder"', () => {
    expect(haveNameStartingWith('parse').test(named('parseFooOrder'))).toBe(true)
  })

  it('haveNameStartingWith("parse") does not match "listItems"', () => {
    expect(haveNameStartingWith('parse').test(named('listItems'))).toBe(false)
  })

  it('haveNameEndingWith("Service") matches "OrderService"', () => {
    expect(haveNameEndingWith('Service').test(named('OrderService'))).toBe(true)
  })

  it('haveNameEndingWith("Service") does not match "DomainError"', () => {
    expect(haveNameEndingWith('Service').test(named('DomainError'))).toBe(false)
  })

  it('both return false for unnamed elements', () => {
    expect(haveNameStartingWith('parse').test(named(undefined))).toBe(false)
    expect(haveNameEndingWith('Service').test(named(undefined))).toBe(false)
  })

  it('against ts-morph: haveNameEndingWith("Service") finds all service classes', () => {
    const classes = tsMorphProject.getSourceFiles().flatMap((sf) => sf.getClasses())
    const pred = haveNameEndingWith('Service')
    const matched = classes.filter((c) => pred.test(c))
    const names = matched.map((c) => c.getName())
    // BaseService, OrderService, ProductService, EdgeCaseService, CleanService (plan 0031 fixture)
    expect(names).toContain('BaseService')
    expect(names).toContain('OrderService')
    expect(names).toContain('ProductService')
    expect(names).toContain('EdgeCaseService')
    expect(names).toContain('CleanService')
    expect(matched).toHaveLength(5)
  })
})

describe('resideInFile', () => {
  it('matches file path with glob **/routes.ts', () => {
    const pred = resideInFile('**/routes.ts')
    expect(pred.test(located('/abs/path/src/routes.ts'))).toBe(true)
  })

  it('does not match non-matching file path', () => {
    const pred = resideInFile('**/routes.ts')
    expect(pred.test(located('/abs/path/src/services.ts'))).toBe(false)
  })

  it('against ts-morph: classes from bad-service.ts matched by **/*bad-service.ts*', () => {
    const classes = tsMorphProject.getSourceFiles().flatMap((sf) => sf.getClasses())
    const pred = resideInFile('**/bad-service.ts')
    const matched = classes.filter((c) => pred.test(c))
    expect(matched.length).toBeGreaterThan(0)
    for (const c of matched) {
      expect(c.getSourceFile().getBaseName()).toBe('bad-service.ts')
    }
  })

  it('against ts-morph: **/src/*.ts matches all fixture source files', () => {
    const sourceFiles = tsMorphProject.getSourceFiles()
    const pred = resideInFile('**/src/*.ts')
    // All fixture files are in src/ so they should all match
    for (const sf of sourceFiles) {
      expect(pred.test({ getSourceFile: () => sf })).toBe(true)
    }
  })
})

describe('resideInFolder', () => {
  it('matches directory portion of file path', () => {
    const pred = resideInFolder('**/services')
    expect(pred.test(located('/abs/path/src/services/order.ts'))).toBe(true)
  })

  it('does not match when file is in different folder', () => {
    const pred = resideInFolder('**/services')
    expect(pred.test(located('/abs/path/src/routes/order.ts'))).toBe(false)
  })

  it('glob **/poc/src matches fixture files in tests/fixtures/poc/src/', () => {
    const sourceFiles = tsMorphProject.getSourceFiles()
    const pred = resideInFolder('**/poc/src')
    for (const sf of sourceFiles) {
      expect(pred.test({ getSourceFile: () => sf })).toBe(true)
    }
  })

  it('glob **/nonexistent/** matches nothing', () => {
    const sourceFiles = tsMorphProject.getSourceFiles()
    const pred = resideInFolder('**/nonexistent/**')
    for (const sf of sourceFiles) {
      expect(pred.test({ getSourceFile: () => sf })).toBe(false)
    }
  })

  it('handles nested folders — **/fixtures/** matches tests/fixtures/poc/src/', () => {
    const sourceFiles = tsMorphProject.getSourceFiles()
    const pred = resideInFolder('**/fixtures/**')
    for (const sf of sourceFiles) {
      expect(pred.test({ getSourceFile: () => sf })).toBe(true)
    }
  })
})

describe('areExported / areNotExported', () => {
  it('areExported() returns true for exported element', () => {
    expect(areExported().test(exportable(true))).toBe(true)
  })

  it('areExported() returns false for non-exported element', () => {
    expect(areExported().test(exportable(false))).toBe(false)
  })

  it('areNotExported() inverts — true for non-exported', () => {
    expect(areNotExported().test(exportable(false))).toBe(true)
    expect(areNotExported().test(exportable(true))).toBe(false)
  })

  it('against ts-morph: OrderService is exported', () => {
    const classes = tsMorphProject.getSourceFiles().flatMap((sf) => sf.getClasses())
    const orderService = classes.find((c) => c.getName() === 'OrderService')
    expect(orderService).toBeDefined()
    expect(areExported().test(orderService!)).toBe(true)
  })

  it('against ts-morph: StrictOptions in options.ts is NOT exported', () => {
    const optionsFile = tsMorphProject
      .getSourceFiles()
      .find((sf) => sf.getBaseName() === 'options.ts')
    expect(optionsFile).toBeDefined()
    const interfaces = optionsFile!.getInterfaces()
    const strictOptions = interfaces.find((i) => i.getName() === 'StrictOptions')
    expect(strictOptions).toBeDefined()
    expect(areExported().test(strictOptions!)).toBe(false)
    expect(areNotExported().test(strictOptions!)).toBe(true)
  })
})

describe('edge cases', () => {
  it('anonymous class expression — getName() returns undefined, name predicates return false', () => {
    // The edge-cases.ts file doesn't have an anonymous class, but we test the behavior with a mock
    expect(haveNameMatching(/Service$/).test(named(undefined))).toBe(false)
    expect(haveNameStartingWith('Order').test(named(undefined))).toBe(false)
    expect(haveNameEndingWith('Service').test(named(undefined))).toBe(false)
  })

  it('composing identity predicates: and(haveNameEndingWith("Service"), areExported())', () => {
    const classes = tsMorphProject.getSourceFiles().flatMap((sf) => sf.getClasses())
    const pred = and<ClassDeclaration>(haveNameEndingWith('Service'), areExported())
    const matched = classes.filter((c) => pred.test(c))
    const names = matched.map((c) => c.getName())
    // BaseService is exported too (it's export abstract class)
    expect(names).toContain('OrderService')
    expect(names).toContain('ProductService')
    expect(names).toContain('EdgeCaseService')
  })

  it('composing with not: not(areExported()) equivalent to areNotExported()', () => {
    const notExported = not(areExported())
    const areNotExp = areNotExported()
    expect(notExported.test(exportable(true))).toBe(areNotExp.test(exportable(true)))
    expect(notExported.test(exportable(false))).toBe(areNotExp.test(exportable(false)))
  })

  it('empty predicate list: and() with no predicates returns true (vacuous truth)', () => {
    const empty = and<string>()
    expect(empty.test('anything')).toBe(true)
  })

  it('empty predicate list: or() with no predicates returns false', () => {
    const empty = or<string>()
    expect(empty.test('anything')).toBe(false)
  })
})
