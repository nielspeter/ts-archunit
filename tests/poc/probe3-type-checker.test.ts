import { describe, it, expect } from 'vitest'
import { Project, type Type } from 'ts-morph'
import path from 'node:path'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')

describe('Probe 3: Type Checker — query types through aliases and utility types', () => {
  const project = new Project({
    tsConfigFilePath: path.join(fixturesDir, 'tsconfig.json'),
  })

  // Helper: get the sortBy property type for a given interface/type name, stripped of undefined
  function getSortByType(name: string): Type | undefined {
    for (const sf of project.getSourceFiles()) {
      // Check interfaces
      const iface = sf.getInterface(name)
      if (iface) {
        const prop = iface.getProperty('sortBy')
        if (!prop) return undefined
        return prop.getType().getNonNullableType()
      }

      // Check type aliases (for Partial<>, Pick<>, etc.)
      const typeAlias = sf.getTypeAlias(name)
      if (typeAlias) {
        const type = typeAlias.getType()
        const prop = type.getProperty('sortBy')
        if (!prop) return undefined
        // For type aliases, we need to get the type of the property through the type checker
        const propType = prop.getTypeAtLocation(typeAlias)
        return propType.getNonNullableType()
      }
    }
    return undefined
  }

  // Helper: check if a type has a sortBy property at all
  function hasSortByProperty(name: string): boolean {
    for (const sf of project.getSourceFiles()) {
      const iface = sf.getInterface(name)
      if (iface) return iface.getProperty('sortBy') !== undefined

      const typeAlias = sf.getTypeAlias(name)
      if (typeAlias) return typeAlias.getType().getProperty('sortBy') !== undefined
    }
    return false
  }

  describe('bare string detection', () => {
    it('UnsafeOptions.sortBy is bare string — should be flagged', () => {
      const type = getSortByType('UnsafeOptions')
      expect(type).toBeDefined()
      expect(type!.isString()).toBe(true)
    })
  })

  describe('typed union detection', () => {
    it('SafeOptions.sortBy is union of literals — should pass', () => {
      const type = getSortByType('SafeOptions')
      expect(type).toBeDefined()
      expect(type!.isString()).toBe(false)
      expect(type!.isUnion()).toBe(true)

      const members = type!.getUnionTypes()
      expect(members.length).toBeGreaterThan(0)
      expect(members.every((m) => m.isStringLiteral())).toBe(true)
    })
  })

  describe('type alias resolution', () => {
    it('AliasedOptions.sortBy resolves through SortColumn alias', () => {
      const type = getSortByType('AliasedOptions')
      expect(type).toBeDefined()
      expect(type!.isString()).toBe(false)
      expect(type!.isUnion()).toBe(true)

      const members = type!.getUnionTypes()
      expect(members.every((m) => m.isStringLiteral())).toBe(true)
    })
  })

  describe('Partial<> resolution', () => {
    it('PartialStrictOptions.sortBy resolves through Partial<>', () => {
      const type = getSortByType('PartialStrictOptions')
      expect(type).toBeDefined()
      expect(type!.isString()).toBe(false)

      // Log details for findings
      console.warn('[Probe 3] PartialStrictOptions sortBy type:', {
        isString: type!.isString(),
        isUnion: type!.isUnion(),
        text: type!.getText(),
      })
    })
  })

  describe('Pick<> resolution', () => {
    it('PickedOptions.sortBy resolves through Pick<>', () => {
      const type = getSortByType('PickedOptions')
      expect(type).toBeDefined()
      expect(type!.isString()).toBe(false)

      console.warn('[Probe 3] PickedOptions sortBy type:', {
        isString: type!.isString(),
        isUnion: type!.isUnion(),
        text: type!.getText(),
      })
    })
  })

  describe('single string literal', () => {
    it('SingleLiteralOptions.sortBy is a literal, not bare string', () => {
      const type = getSortByType('SingleLiteralOptions')
      expect(type).toBeDefined()
      expect(type!.isString()).toBe(false)
      expect(type!.isStringLiteral()).toBe(true)
    })
  })

  describe('no sortBy property', () => {
    it('UnrelatedOptions has no sortBy property', () => {
      const hasProp = hasSortByProperty('UnrelatedOptions')
      expect(hasProp).toBe(false)
    })
  })

  describe('explicit undefined in union', () => {
    it('ExplicitUndefinedOptions.sortBy — getNonNullableType strips explicit undefined', () => {
      const type = getSortByType('ExplicitUndefinedOptions')
      expect(type).toBeDefined()
      expect(type!.isString()).toBe(false)

      console.warn('[Probe 3] ExplicitUndefinedOptions sortBy type:', {
        isString: type!.isString(),
        isUnion: type!.isUnion(),
        isStringLiteral: type!.isStringLiteral(),
        text: type!.getText(),
      })
    })
  })

  describe('getNonNullableType behavior', () => {
    it('correctly strips undefined from optional property', () => {
      // UnsafeOptions.sortBy is `string | undefined` (because optional)
      // getNonNullableType() should give us just `string`
      for (const sf of project.getSourceFiles()) {
        const iface = sf.getInterface('UnsafeOptions')
        if (!iface) continue

        const prop = iface.getProperty('sortBy')!
        const rawType = prop.getType()
        const strippedType = rawType.getNonNullableType()

        console.warn('[Probe 3] UnsafeOptions.sortBy raw vs stripped:', {
          rawText: rawType.getText(),
          rawIsString: rawType.isString(),
          rawIsUnion: rawType.isUnion(),
          strippedText: strippedType.getText(),
          strippedIsString: strippedType.isString(),
        })

        // Raw type should be string | undefined (union), not bare string
        expect(rawType.isString()).toBe(false) // because it's string | undefined
        expect(rawType.isUnion()).toBe(true)

        // After stripping, should be bare string
        expect(strippedType.isString()).toBe(true)
      }
    })
  })
})
