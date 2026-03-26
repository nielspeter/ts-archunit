import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { collectFunctions } from '../../src/models/arch-function.js'
import {
  haveCyclomaticComplexity,
  haveMoreLinesThan,
  haveMoreMethodsThan,
  haveComplexity,
  haveMoreFunctionLinesThan,
} from '../../src/predicates/metrics.js'

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

const allFunctions = project.getSourceFiles().flatMap((sf) => collectFunctions(sf))

function findFn(name: string) {
  const fn = allFunctions.find((f) => f.getName() === name)
  if (!fn) throw new Error(`Fixture function not found: ${name}`)
  return fn
}

describe('class metric predicates', () => {
  describe('haveCyclomaticComplexity', () => {
    it('matches classes with complex methods', () => {
      const pred = haveCyclomaticComplexity({ greaterThan: 3 })
      expect(pred.test(findClass('ComplexService'))).toBe(true)
    })

    it('does not match simple classes', () => {
      const pred = haveCyclomaticComplexity({ greaterThan: 3 })
      expect(pred.test(findClass('SimpleService'))).toBe(false)
    })

    it('catches complex constructors', () => {
      const pred = haveCyclomaticComplexity({ greaterThan: 3 })
      expect(pred.test(findClass('ConfigService'))).toBe(true)
    })
  })

  describe('haveMoreLinesThan', () => {
    it('matches large classes', () => {
      const pred = haveMoreLinesThan(5)
      expect(pred.test(findClass('LargeService'))).toBe(true)
    })

    it('does not match small classes', () => {
      const pred = haveMoreLinesThan(500)
      expect(pred.test(findClass('SmallService'))).toBe(false)
    })
  })

  describe('haveMoreMethodsThan', () => {
    it('matches classes with many methods', () => {
      const pred = haveMoreMethodsThan(5)
      expect(pred.test(findClass('LargeService'))).toBe(true)
    })

    it('does not match small classes', () => {
      const pred = haveMoreMethodsThan(5)
      expect(pred.test(findClass('SmallService'))).toBe(false)
    })
  })
})

describe('function metric predicates', () => {
  describe('haveComplexity', () => {
    it('matches complex functions', () => {
      const pred = haveComplexity({ greaterThan: 3 })
      expect(pred.test(findFn('processItems'))).toBe(true)
    })

    it('does not match simple functions', () => {
      const pred = haveComplexity({ greaterThan: 3 })
      expect(pred.test(findFn('identity'))).toBe(false)
    })

    it('works on arrow functions', () => {
      const pred = haveComplexity({ greaterThan: 1 })
      expect(pred.test(findFn('validate'))).toBe(true)
    })
  })

  describe('haveMoreFunctionLinesThan', () => {
    it('matches long functions', () => {
      const pred = haveMoreFunctionLinesThan(3)
      expect(pred.test(findFn('processItems'))).toBe(true)
    })

    it('does not match short functions', () => {
      const pred = haveMoreFunctionLinesThan(100)
      expect(pred.test(findFn('identity'))).toBe(false)
    })
  })
})
