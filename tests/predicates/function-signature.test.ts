import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { collectFunctions } from '../../src/models/arch-function.js'
import {
  haveRestParameter,
  haveOptionalParameter,
  haveParameterOfType,
  haveParameterNameMatching,
} from '../../src/predicates/function.js'
import { isString, isNumber, arrayOf } from '../../src/helpers/type-matchers.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const project = new Project({
  tsConfigFilePath: path.join(fixturesDir, 'tsconfig.json'),
})
const allFunctions = project.getSourceFiles().flatMap((sf) => collectFunctions(sf))

function findFn(name: string) {
  const fn = allFunctions.find((f) => f.getName() === name)
  if (!fn) throw new Error(`Fixture function not found: ${name}`)
  return fn
}

describe('haveRestParameter', () => {
  it('matches function with ...args', () => {
    expect(haveRestParameter().test(findFn('withRest'))).toBe(true)
  })

  it('does not match function without rest param', () => {
    expect(haveRestParameter().test(findFn('allRequired'))).toBe(false)
  })

  it('matches function with both required and rest param', () => {
    expect(haveRestParameter().test(findFn('withBoth'))).toBe(true)
  })
})

describe('haveOptionalParameter', () => {
  it('matches function with optional param', () => {
    expect(haveOptionalParameter().test(findFn('withOptional'))).toBe(true)
  })

  it('matches function with default value', () => {
    expect(haveOptionalParameter().test(findFn('withDefault'))).toBe(true)
  })

  it('does not match function with only required params', () => {
    expect(haveOptionalParameter().test(findFn('allRequired'))).toBe(false)
  })
})

describe('haveParameterOfType', () => {
  it('matches first param type with isString()', () => {
    expect(haveParameterOfType(0, isString()).test(findFn('allRequired'))).toBe(true)
  })

  it('rejects wrong type', () => {
    expect(haveParameterOfType(0, isNumber()).test(findFn('allRequired'))).toBe(false)
  })

  it('returns false for out-of-bounds index', () => {
    expect(haveParameterOfType(99, isString()).test(findFn('allRequired'))).toBe(false)
  })

  it('rest param returns array type — isString() returns false', () => {
    // ...items: string[] has type string[], not string
    expect(haveParameterOfType(0, isString()).test(findFn('withRest'))).toBe(false)
  })

  it('rest param matches with arrayOf(isString())', () => {
    expect(haveParameterOfType(0, arrayOf(isString())).test(findFn('withRest'))).toBe(true)
  })

  it('optional param — isString() matches despite string|undefined', () => {
    // TypeMatcher strips nullability via getNonNullableType()
    expect(haveParameterOfType(0, isString()).test(findFn('withOptional'))).toBe(true)
  })

  it('second param type matching', () => {
    expect(haveParameterOfType(1, isNumber()).test(findFn('allRequired'))).toBe(true)
  })
})

describe('haveParameterNameMatching', () => {
  it('matches param names by regex', () => {
    expect(haveParameterNameMatching(/^item/).test(findFn('withRest'))).toBe(true)
  })

  it('rejects non-matching names', () => {
    expect(haveParameterNameMatching(/^xyz/).test(findFn('allRequired'))).toBe(false)
  })
})
