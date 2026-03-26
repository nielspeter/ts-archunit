import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import {
  areAsync,
  areNotAsync,
  haveParameterCount,
  haveParameterCountGreaterThan,
  haveParameterCountLessThan,
  haveParameterNamed,
  haveReturnType,
} from '../../src/predicates/function.js'
import { collectFunctions } from '../../src/models/arch-function.js'
import type { ArchFunction } from '../../src/models/arch-function.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const project = new Project({
  tsConfigFilePath: path.join(fixturesDir, 'tsconfig.json'),
})

// Collect all functions from all fixture files
const allFunctions = project.getSourceFiles().flatMap((sf) => collectFunctions(sf))

function findFn(name: string): ArchFunction {
  const fn = allFunctions.find((f) => f.getName() === name)
  if (!fn) throw new Error(`Function "${name}" not found in fixtures`)
  return fn
}

describe('function predicates', () => {
  describe('areAsync', () => {
    it('matches async functions', () => {
      const predicate = areAsync()
      expect(predicate.test(findFn('parseFooOrder'))).toBe(false)
    })

    it('has readable description', () => {
      expect(areAsync().description).toBe('are async')
    })
  })

  describe('areNotAsync', () => {
    it('matches non-async functions', () => {
      const predicate = areNotAsync()
      expect(predicate.test(findFn('parseFooOrder'))).toBe(true)
    })
  })

  describe('haveParameterCount', () => {
    it('matches functions with exact parameter count', () => {
      const predicate = haveParameterCount(1)
      expect(predicate.test(findFn('parseFooOrder'))).toBe(true) // 1 param: order
    })

    it('rejects functions with different count', () => {
      const predicate = haveParameterCount(2)
      expect(predicate.test(findFn('parseFooOrder'))).toBe(false)
    })

    it('matches zero-parameter functions', () => {
      const predicate = haveParameterCount(0)
      expect(predicate.test(findFn('listItems'))).toBe(true) // no params
    })

    it('singular description for count of 1', () => {
      expect(haveParameterCount(1).description).toBe('have 1 parameter')
    })

    it('plural description for count != 1', () => {
      expect(haveParameterCount(3).description).toBe('have 3 parameters')
    })
  })

  describe('haveParameterCountGreaterThan', () => {
    it('matches functions with more than n parameters', () => {
      const predicate = haveParameterCountGreaterThan(0)
      expect(predicate.test(findFn('parseFooOrder'))).toBe(true) // 1 > 0
    })

    it('rejects functions with n or fewer parameters', () => {
      const predicate = haveParameterCountGreaterThan(1)
      expect(predicate.test(findFn('parseFooOrder'))).toBe(false) // 1 is not > 1
    })
  })

  describe('haveParameterCountLessThan', () => {
    it('matches functions with fewer than n parameters', () => {
      const predicate = haveParameterCountLessThan(2)
      expect(predicate.test(findFn('parseFooOrder'))).toBe(true) // 1 < 2
    })

    it('rejects functions with n or more parameters', () => {
      const predicate = haveParameterCountLessThan(1)
      expect(predicate.test(findFn('parseFooOrder'))).toBe(false) // 1 is not < 1
    })
  })

  describe('haveParameterNamed', () => {
    it('matches functions with a parameter of the given name', () => {
      const predicate = haveParameterNamed('order')
      expect(predicate.test(findFn('parseFooOrder'))).toBe(true)
    })

    it('rejects functions without that parameter', () => {
      const predicate = haveParameterNamed('nonexistent')
      expect(predicate.test(findFn('parseFooOrder'))).toBe(false)
    })

    it('works on arrow functions', () => {
      const predicate = haveParameterNamed('order')
      expect(predicate.test(findFn('parseBazOrder'))).toBe(true)
    })
  })

  describe('haveReturnType', () => {
    it('matches return type with regex', () => {
      const predicate = haveReturnType(/field/)
      expect(predicate.test(findFn('parseFooOrder'))).toBe(true)
    })

    it('matches return type with string pattern', () => {
      const predicate = haveReturnType('field')
      expect(predicate.test(findFn('parseFooOrder'))).toBe(true)
    })

    it('rejects non-matching return type', () => {
      const predicate = haveReturnType(/^Promise/)
      expect(predicate.test(findFn('parseFooOrder'))).toBe(false)
    })
  })
})
