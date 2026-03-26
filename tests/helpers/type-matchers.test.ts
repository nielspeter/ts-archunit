import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import {
  not,
  isString,
  isNumber,
  isBoolean,
  isUnionOfLiterals,
  isStringLiteral,
  arrayOf,
  matching,
  exactly,
} from '../../src/helpers/type-matchers.js'

/**
 * Tests use the PoC options.ts fixture which has:
 * - UnsafeOptions { sortBy?: string }
 * - SafeOptions { sortBy?: 'created_at' | 'updated_at' | 'name' }
 * - AliasedOptions { sortBy?: SortColumn }
 * - PartialStrictOptions = Partial<StrictOptions>
 * - PickedOptions = Pick<SafeOptions, 'sortBy'>
 * - SingleLiteralOptions { sortBy?: 'created_at' }
 * - UnrelatedOptions { limit?: number; offset?: number }
 * - ExplicitUndefinedOptions { sortBy: 'a' | 'b' | undefined }
 */
const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')
const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })

function getPropertyType(interfaceName: string, propertyName: string) {
  const sf = tsMorphProject.getSourceFileOrThrow('options.ts')
  const iface = sf.getInterface(interfaceName)
  if (iface) {
    const prop = iface.getType().getProperty(propertyName)
    return prop?.getTypeAtLocation(iface)
  }
  const alias = sf.getTypeAlias(interfaceName)
  if (alias) {
    const prop = alias.getType().getProperty(propertyName)
    return prop?.getTypeAtLocation(alias)
  }
  throw new Error(`Type ${interfaceName} not found`)
}

describe('TypeMatcher', () => {
  describe('isString()', () => {
    it('matches bare string type', () => {
      const type = getPropertyType('UnsafeOptions', 'sortBy')!
      expect(isString()(type)).toBe(true)
    })

    it('does not match string literal union', () => {
      const type = getPropertyType('SafeOptions', 'sortBy')!
      expect(isString()(type)).toBe(false)
    })

    it('does not match number type', () => {
      const type = getPropertyType('UnrelatedOptions', 'limit')!
      expect(isString()(type)).toBe(false)
    })
  })

  describe('isNumber()', () => {
    it('matches bare number type', () => {
      const type = getPropertyType('UnrelatedOptions', 'limit')!
      expect(isNumber()(type)).toBe(true)
    })

    it('does not match string type', () => {
      const type = getPropertyType('UnsafeOptions', 'sortBy')!
      expect(isNumber()(type)).toBe(false)
    })
  })

  describe('isBoolean()', () => {
    it('does not match string type', () => {
      const type = getPropertyType('UnsafeOptions', 'sortBy')!
      expect(isBoolean()(type)).toBe(false)
    })
  })

  describe('not()', () => {
    it('inverts a matcher', () => {
      const type = getPropertyType('UnsafeOptions', 'sortBy')!
      expect(not(isString())(type)).toBe(false)
    })

    it('passes when inner matcher fails', () => {
      const type = getPropertyType('SafeOptions', 'sortBy')!
      expect(not(isString())(type)).toBe(true)
    })
  })

  describe('isUnionOfLiterals()', () => {
    it('matches union of string literals', () => {
      const type = getPropertyType('SafeOptions', 'sortBy')!
      expect(isUnionOfLiterals()(type)).toBe(true)
    })

    it('does not match bare string', () => {
      const type = getPropertyType('UnsafeOptions', 'sortBy')!
      expect(isUnionOfLiterals()(type)).toBe(false)
    })

    it('does not match single string literal', () => {
      const type = getPropertyType('SingleLiteralOptions', 'sortBy')!
      expect(isUnionOfLiterals()(type)).toBe(false)
    })

    it('matches through type alias (AliasedOptions -> SortColumn)', () => {
      const type = getPropertyType('AliasedOptions', 'sortBy')!
      expect(isUnionOfLiterals()(type)).toBe(true)
    })

    it('matches through Partial<> wrapper', () => {
      const type = getPropertyType('PartialStrictOptions', 'sortBy')!
      expect(isUnionOfLiterals()(type)).toBe(true)
    })

    it('matches through Pick<> wrapper', () => {
      const type = getPropertyType('PickedOptions', 'sortBy')!
      expect(isUnionOfLiterals()(type)).toBe(true)
    })

    it('matches union with explicit undefined stripped', () => {
      const type = getPropertyType('ExplicitUndefinedOptions', 'sortBy')!
      expect(isUnionOfLiterals()(type)).toBe(true)
    })
  })

  describe('isStringLiteral()', () => {
    it('matches single string literal type', () => {
      const type = getPropertyType('SingleLiteralOptions', 'sortBy')!
      expect(isStringLiteral()(type)).toBe(true)
    })

    it('matches specific string literal value', () => {
      const type = getPropertyType('SingleLiteralOptions', 'sortBy')!
      expect(isStringLiteral('created_at')(type)).toBe(true)
    })

    it('rejects wrong string literal value', () => {
      const type = getPropertyType('SingleLiteralOptions', 'sortBy')!
      expect(isStringLiteral('wrong')(type)).toBe(false)
    })

    it('does not match bare string', () => {
      const type = getPropertyType('UnsafeOptions', 'sortBy')!
      expect(isStringLiteral()(type)).toBe(false)
    })

    it('does not match union of string literals', () => {
      const type = getPropertyType('SafeOptions', 'sortBy')!
      expect(isStringLiteral()(type)).toBe(false)
    })
  })

  describe('matching()', () => {
    it('matches type text against regex', () => {
      const type = getPropertyType('UnsafeOptions', 'sortBy')!
      expect(matching(/^string$/)(type)).toBe(true)
    })

    it('rejects non-matching type text', () => {
      const type = getPropertyType('UnsafeOptions', 'sortBy')!
      expect(matching(/^number$/)(type)).toBe(false)
    })
  })

  describe('exactly()', () => {
    it('matches exact type text', () => {
      const type = getPropertyType('UnsafeOptions', 'sortBy')!
      expect(exactly('string')(type)).toBe(true)
    })

    it('rejects different type text', () => {
      const type = getPropertyType('UnsafeOptions', 'sortBy')!
      expect(exactly('number')(type)).toBe(false)
    })
  })

  describe('arrayOf()', () => {
    it('does not match non-array type', () => {
      const type = getPropertyType('UnsafeOptions', 'sortBy')!
      expect(arrayOf(isString())(type)).toBe(false)
    })
  })
})
