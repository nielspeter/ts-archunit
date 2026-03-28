import { describe, it, expect } from 'vitest'
import { Project, SyntaxKind } from 'ts-morph'
import { property } from '../../src/helpers/matchers.js'

/**
 * Create a PropertyAssignment node from an object literal source.
 * Returns the first PropertyAssignment found at any depth.
 */
function makePropertyAssignment(code: string, propName?: string) {
  const project = new Project({ useInMemoryFileSystem: true })
  const sf = project.createSourceFile('test.ts', `const x = ${code}`)
  const props = sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment)
  if (propName) {
    return props.find(
      (p) =>
        p.getNameNode().getKind() !== SyntaxKind.ComputedPropertyName && p.getName() === propName,
    )!
  }
  return props[0]!
}

/**
 * Create a ShorthandPropertyAssignment node.
 */
function makeShorthand(code: string) {
  const project = new Project({ useInMemoryFileSystem: true })
  const sf = project.createSourceFile('test.ts', code)
  return sf.getDescendantsOfKind(SyntaxKind.ShorthandPropertyAssignment)[0]!
}

describe('property() ExpressionMatcher', () => {
  describe('metadata', () => {
    it('has syntaxKinds for PropertyAssignment', () => {
      expect(property('foo').syntaxKinds).toEqual([SyntaxKind.PropertyAssignment])
    })

    it('has description for name-only', () => {
      expect(property('additionalProperties').description).toBe("property 'additionalProperties'")
    })

    it('has description for name + boolean value', () => {
      expect(property('additionalProperties', true).description).toBe(
        "property 'additionalProperties' = true",
      )
    })

    it('has description for regex name + value', () => {
      expect(property(/^additional/, true).description).toBe('property /^additional/ = true')
    })

    it('has description for string value', () => {
      expect(property('type', 'object').description).toBe("property 'type' = object")
    })
  })

  describe('name matching', () => {
    it('matches property by exact name', () => {
      const node = makePropertyAssignment('{ schema: {} }', 'schema')
      expect(property('schema').matches(node)).toBe(true)
    })

    it('rejects non-matching name', () => {
      const node = makePropertyAssignment('{ schema: {} }', 'schema')
      expect(property('body').matches(node)).toBe(false)
    })

    it('matches property name with regex', () => {
      const node = makePropertyAssignment('{ additionalProperties: true }')
      expect(property(/^additional/).matches(node)).toBe(true)
    })

    it('rejects non-matching regex', () => {
      const node = makePropertyAssignment('{ schema: {} }', 'schema')
      expect(property(/^body/).matches(node)).toBe(false)
    })

    it('matches quoted property name', () => {
      const node = makePropertyAssignment('{ "content-type": "application/json" }')
      expect(property('content-type').matches(node)).toBe(true)
    })
  })

  describe('boolean value matching', () => {
    it('matches boolean true', () => {
      const node = makePropertyAssignment('{ additionalProperties: true }')
      expect(property('additionalProperties', true).matches(node)).toBe(true)
    })

    it('rejects false when true expected', () => {
      const node = makePropertyAssignment('{ additionalProperties: false }')
      expect(property('additionalProperties', true).matches(node)).toBe(false)
    })

    it('matches boolean false', () => {
      const node = makePropertyAssignment('{ additionalProperties: false }')
      expect(property('additionalProperties', false).matches(node)).toBe(true)
    })

    it('does not match identifier-valued initializer', () => {
      const code = 'declare const v: boolean\nconst x = { additionalProperties: v }'
      const project = new Project({ useInMemoryFileSystem: true })
      const sf = project.createSourceFile('test.ts', code)
      const node = sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment)[0]!
      expect(property('additionalProperties', true).matches(node)).toBe(false)
    })
  })

  describe('number value matching', () => {
    it('matches numeric value', () => {
      const node = makePropertyAssignment('{ maximum: 100 }', 'maximum')
      expect(property('maximum', 100).matches(node)).toBe(true)
    })

    it('rejects wrong numeric value', () => {
      const node = makePropertyAssignment('{ maximum: 100 }', 'maximum')
      expect(property('maximum', 50).matches(node)).toBe(false)
    })
  })

  describe('string value matching', () => {
    it('matches string value via getLiteralValue (no quotes needed)', () => {
      const node = makePropertyAssignment("{ type: 'object' }", 'type')
      expect(property('type', 'object').matches(node)).toBe(true)
    })

    it('rejects non-matching string value', () => {
      const node = makePropertyAssignment("{ type: 'string' }", 'type')
      expect(property('type', 'object').matches(node)).toBe(false)
    })

    it('does not match non-string-literal initializer', () => {
      const code = 'declare const t: string\nconst x = { type: t }'
      const project = new Project({ useInMemoryFileSystem: true })
      const sf = project.createSourceFile('test.ts', code)
      const node = sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment)[0]!
      expect(property('type', 'object').matches(node)).toBe(false)
    })
  })

  describe('regex value matching', () => {
    it('matches regex against getText (raw text)', () => {
      const node = makePropertyAssignment("{ type: 'object' }", 'type')
      expect(property('type', /object/).matches(node)).toBe(true)
    })

    it('rejects non-matching regex', () => {
      const node = makePropertyAssignment("{ type: 'string' }", 'type')
      expect(property('type', /object/).matches(node)).toBe(false)
    })
  })

  describe('name-only matching', () => {
    it('matches regardless of value when no value param', () => {
      const node = makePropertyAssignment('{ additionalProperties: true }')
      expect(property('additionalProperties').matches(node)).toBe(true)
    })

    it('matches non-boolean values too', () => {
      const node = makePropertyAssignment("{ type: 'object' }", 'type')
      expect(property('type').matches(node)).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('does not match ShorthandPropertyAssignment', () => {
      const node = makeShorthand('declare const schema: object\nconst x = { schema }')
      // property() targets SyntaxKind.PropertyAssignment, not ShorthandPropertyAssignment
      expect(property('schema').matches(node)).toBe(false)
    })

    it('skips computed property names without throwing', () => {
      const code = "const key = 'x'\nconst obj = { [key]: true }"
      const project = new Project({ useInMemoryFileSystem: true })
      const sf = project.createSourceFile('test.ts', code)
      const props = sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment)
      for (const prop of props) {
        // Should not throw, just return false
        expect(property('key', true).matches(prop)).toBe(false)
      }
    })

    it('does not match non-PropertyAssignment nodes', () => {
      const project = new Project({ useInMemoryFileSystem: true })
      const sf = project.createSourceFile('test.ts', 'const x = 42')
      const node = sf.getStatements()[0]!
      expect(property('x').matches(node)).toBe(false)
    })
  })
})
