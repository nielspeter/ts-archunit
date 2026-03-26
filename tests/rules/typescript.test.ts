import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import {
  noAnyProperties,
  noTypeAssertions,
  noNonNullAssertions,
} from '../../src/rules/typescript.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/rules')

const project = new Project({
  tsConfigFilePath: path.join(fixturesDir, 'tsconfig.json'),
})

function findClass(name: string) {
  const cls = project
    .getSourceFiles()
    .flatMap((sf) => sf.getClasses())
    .find((c) => c.getName() === name)
  if (!cls) throw new Error(`Fixture class not found: ${name}`)
  return cls
}

const context = { rule: 'test rule' }

describe('typescript rules', () => {
  describe('noAnyProperties()', () => {
    it('detects any-typed properties', () => {
      const condition = noAnyProperties()
      const violations = condition.evaluate([findClass('AnyPropertyClass')], context)
      expect(violations.length).toBeGreaterThanOrEqual(2)
      expect(violations.some((v) => v.message.includes("'any'"))).toBe(true)
    })

    it('passes for clean class with no any properties', () => {
      const condition = noAnyProperties()
      const violations = condition.evaluate([findClass('CleanService')], context)
      expect(violations).toHaveLength(0)
    })

    it('has correct description', () => {
      expect(noAnyProperties().description).toBe('have no properties typed as any')
    })
  })

  describe('noTypeAssertions()', () => {
    it('detects as type assertions in methods', () => {
      const condition = noTypeAssertions()
      const violations = condition.evaluate([findClass('AssertionClass')], context)
      // process() has `as string`, castNumber() has `as number`
      expect(violations.length).toBeGreaterThanOrEqual(2)
      expect(violations.some((v) => v.message.includes('type assertion'))).toBe(true)
    })

    it('allows as const', () => {
      const condition = noTypeAssertions()
      const violations = condition.evaluate([findClass('AssertionClass')], context)
      // safeConst() uses `as const` — should NOT be a violation
      // Only process() and castNumber() should be violations
      expect(violations).toHaveLength(2)
    })

    it('passes for clean class with no assertions', () => {
      const condition = noTypeAssertions()
      const violations = condition.evaluate([findClass('CleanService')], context)
      expect(violations).toHaveLength(0)
    })

    it('has correct description', () => {
      expect(noTypeAssertions().description).toBe('have no type assertions (as) in method bodies')
    })
  })

  describe('noNonNullAssertions()', () => {
    it('detects non-null assertions in methods', () => {
      const condition = noNonNullAssertions()
      const violations = condition.evaluate([findClass('NonNullClass')], context)
      // getItem() has `!` and getLength() has `!`
      expect(violations.length).toBeGreaterThanOrEqual(2)
      expect(violations.some((v) => v.message.includes('non-null assertion'))).toBe(true)
    })

    it('passes for clean class with no non-null assertions', () => {
      const condition = noNonNullAssertions()
      const violations = condition.evaluate([findClass('CleanService')], context)
      expect(violations).toHaveLength(0)
    })
  })
})
