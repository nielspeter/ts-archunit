import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import {
  areInterfaces,
  areTypeAliases,
  haveProperty,
  havePropertyOfType,
  extendType,
} from '../../src/predicates/type.js'
import { isString, isUnionOfLiterals } from '../../src/helpers/type-matchers.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')
const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })

function getInterface(name: string) {
  for (const sf of tsMorphProject.getSourceFiles()) {
    const iface = sf.getInterface(name)
    if (iface) return iface
  }
  throw new Error(`Interface ${name} not found`)
}

function getTypeAlias(name: string) {
  for (const sf of tsMorphProject.getSourceFiles()) {
    const alias = sf.getTypeAlias(name)
    if (alias) return alias
  }
  throw new Error(`Type alias ${name} not found`)
}

describe('type predicates', () => {
  describe('areInterfaces()', () => {
    it('matches InterfaceDeclaration', () => {
      expect(areInterfaces().test(getInterface('SafeOptions'))).toBe(true)
    })

    it('rejects TypeAliasDeclaration', () => {
      expect(areInterfaces().test(getTypeAlias('PartialStrictOptions'))).toBe(false)
    })
  })

  describe('areTypeAliases()', () => {
    it('matches TypeAliasDeclaration', () => {
      expect(areTypeAliases().test(getTypeAlias('PartialStrictOptions'))).toBe(true)
    })

    it('rejects InterfaceDeclaration', () => {
      expect(areTypeAliases().test(getInterface('SafeOptions'))).toBe(false)
    })
  })

  describe('haveProperty()', () => {
    it('matches interface with the property', () => {
      expect(haveProperty('sortBy').test(getInterface('SafeOptions'))).toBe(true)
    })

    it('rejects interface without the property', () => {
      expect(haveProperty('sortBy').test(getInterface('UnrelatedOptions'))).toBe(false)
    })

    it('matches type alias with the property (Partial<>)', () => {
      expect(haveProperty('sortBy').test(getTypeAlias('PartialStrictOptions'))).toBe(true)
    })

    it('matches type alias with the property (Pick<>)', () => {
      expect(haveProperty('sortBy').test(getTypeAlias('PickedOptions'))).toBe(true)
    })
  })

  describe('havePropertyOfType()', () => {
    it('matches when property type satisfies matcher', () => {
      expect(havePropertyOfType('sortBy', isString()).test(getInterface('UnsafeOptions'))).toBe(
        true,
      )
    })

    it('rejects when property type does not satisfy matcher', () => {
      expect(havePropertyOfType('sortBy', isString()).test(getInterface('SafeOptions'))).toBe(false)
    })

    it('rejects when property does not exist', () => {
      expect(havePropertyOfType('sortBy', isString()).test(getInterface('UnrelatedOptions'))).toBe(
        false,
      )
    })

    it('resolves through Partial<> for property type matching', () => {
      expect(
        havePropertyOfType('sortBy', isUnionOfLiterals()).test(
          getTypeAlias('PartialStrictOptions'),
        ),
      ).toBe(true)
    })
  })

  describe('extendType()', () => {
    it('returns false for interface that does not extend', () => {
      expect(extendType('BaseConfig').test(getInterface('SafeOptions'))).toBe(false)
    })
  })
})
