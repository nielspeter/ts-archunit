import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { cyclomaticComplexity, linesOfCode, methodCount } from '../../src/helpers/complexity.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/metrics')
const project = new Project({ tsConfigFilePath: path.join(fixturesDir, 'tsconfig.json') })

function findClass(name: string) {
  const cls = project
    .getSourceFiles()
    .flatMap((sf) => sf.getClasses())
    .find((c) => c.getName() === name)
  if (!cls) throw new Error(`Fixture class not found: ${name}`)
  return cls
}

function findMethod(className: string, methodName: string) {
  const cls = findClass(className)
  const method = cls.getMethods().find((m) => m.getName() === methodName)
  if (!method) throw new Error(`Fixture method not found: ${className}.${methodName}`)
  return method
}

function findFunction(name: string) {
  const fn = project
    .getSourceFiles()
    .flatMap((sf) => sf.getFunctions())
    .find((f) => f.getName() === name)
  if (!fn) throw new Error(`Fixture function not found: ${name}`)
  return fn
}

describe('cyclomaticComplexity', () => {
  it('returns 1 for undefined body', () => {
    expect(cyclomaticComplexity(undefined)).toBe(1)
  })

  it('returns 1 for a simple method with no decision points', () => {
    const method = findMethod('ComplexService', 'simple')
    expect(cyclomaticComplexity(method.getBody())).toBe(1)
  })

  it('counts if statements', () => {
    // processItems: if + for + if + || + ?? = 5
    const fn = findFunction('processItems')
    const cc = cyclomaticComplexity(fn.getBody())
    expect(cc).toBeGreaterThanOrEqual(5)
  })

  it('counts for-of loops', () => {
    // complex method: if + for + if + && + ternary = 6
    const method = findMethod('ComplexService', 'complex')
    const cc = cyclomaticComplexity(method.getBody())
    expect(cc).toBe(6)
  })

  it('counts logical AND/OR operators', () => {
    // complex: the && adds 1
    const method = findMethod('ComplexService', 'complex')
    const cc = cyclomaticComplexity(method.getBody())
    expect(cc).toBeGreaterThan(4) // would be 4 without the && and ternary
  })

  it('counts ternary expressions', () => {
    // complex has a ternary: item.length > 10 ? 2 : 1
    const method = findMethod('ComplexService', 'complex')
    const cc = cyclomaticComplexity(method.getBody())
    expect(cc).toBe(6) // 1 + if + for + if + && + ternary
  })

  it('counts nullish coalescing', () => {
    // processItems uses ?? twice
    const fn = findFunction('processItems')
    const cc = cyclomaticComplexity(fn.getBody())
    expect(cc).toBeGreaterThanOrEqual(5)
  })

  it('counts constructor decision points', () => {
    // ConfigService constructor: if + else-if + else-if + ?? = 4
    const cls = findClass('ConfigService')
    const ctors = cls.getConstructors()
    expect(ctors.length).toBeGreaterThan(0)
    const cc = cyclomaticComplexity(ctors[0]!.getBody())
    expect(cc).toBe(5) // 1 + ?? + if + else-if + else-if
  })

  it('counts getter decision points', () => {
    // ConfigService getter: if + && = 3
    const cls = findClass('ConfigService')
    const getter = cls.getGetAccessors().find((g) => g.getName() === 'value')
    expect(getter).toBeDefined()
    const cc = cyclomaticComplexity(getter!.getBody())
    expect(cc).toBe(3) // 1 + if + &&
  })

  it('returns 1 for simple function', () => {
    const fn = findFunction('identity')
    expect(cyclomaticComplexity(fn.getBody())).toBe(1)
  })
})

describe('linesOfCode', () => {
  it('counts span lines for a class', () => {
    const cls = findClass('ComplexService')
    const loc = linesOfCode(cls)
    // ComplexService spans multiple lines
    expect(loc).toBeGreaterThan(10)
  })

  it('counts span lines for a method', () => {
    const method = findMethod('ComplexService', 'simple')
    const loc = linesOfCode(method)
    expect(loc).toBeGreaterThanOrEqual(3) // at least: signature + body + closing
  })

  it('counts span lines for a function', () => {
    const fn = findFunction('processItems')
    const loc = linesOfCode(fn)
    expect(loc).toBeGreaterThan(5)
  })
})

describe('methodCount', () => {
  it('counts methods on a class', () => {
    const cls = findClass('LargeService')
    expect(methodCount(cls)).toBe(12)
  })

  it('counts methods on a small class', () => {
    const cls = findClass('SmallService')
    expect(methodCount(cls)).toBe(2)
  })
})
