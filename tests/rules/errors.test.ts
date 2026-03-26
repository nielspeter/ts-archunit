import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { noGenericErrors, noTypeErrors } from '../../src/rules/errors.js'

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

describe('error rules', () => {
  describe('noGenericErrors()', () => {
    it('detects new Error()', () => {
      const condition = noGenericErrors()
      const violations = condition.evaluate([findClass('GenericErrorClass')], context)
      expect(violations.length).toBeGreaterThan(0)
      expect(violations.some((v) => v.message.includes('Error'))).toBe(true)
    })

    it('passes for clean class', () => {
      const condition = noGenericErrors()
      const violations = condition.evaluate([findClass('CleanService')], context)
      expect(violations).toHaveLength(0)
    })
  })

  describe('noTypeErrors()', () => {
    it('detects new TypeError()', () => {
      const condition = noTypeErrors()
      const violations = condition.evaluate([findClass('GenericErrorClass')], context)
      expect(violations.length).toBeGreaterThan(0)
      expect(violations.some((v) => v.message.includes('TypeError'))).toBe(true)
    })

    it('passes for clean class', () => {
      const condition = noTypeErrors()
      const violations = condition.evaluate([findClass('CleanService')], context)
      expect(violations).toHaveLength(0)
    })
  })
})
