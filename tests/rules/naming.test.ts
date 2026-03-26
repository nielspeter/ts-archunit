import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { mustMatchName, mustNotEndWith } from '../../src/rules/naming.js'

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

describe('naming rules', () => {
  describe('mustMatchName()', () => {
    it('passes when class name matches pattern', () => {
      const condition = mustMatchName(/Controller$/)
      const violations = condition.evaluate([findClass('OrderController')], context)
      expect(violations).toHaveLength(0)
    })

    it('fails when class name does not match pattern', () => {
      const condition = mustMatchName(/Controller$/)
      const violations = condition.evaluate([findClass('MisnamedService')], context)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.message).toContain('MisnamedService')
      expect(violations[0]!.message).toContain('naming convention')
    })

    it('has correct description', () => {
      expect(mustMatchName(/Controller$/).description).toBe('have name matching /Controller$/')
    })
  })

  describe('mustNotEndWith()', () => {
    it('passes when class name does not end with suffix', () => {
      const condition = mustNotEndWith('Entity')
      const violations = condition.evaluate([findClass('CleanService')], context)
      expect(violations).toHaveLength(0)
    })

    it('fails when class name ends with suffix', () => {
      const condition = mustNotEndWith('Entity')
      const violations = condition.evaluate([findClass('OrderEntity')], context)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.message).toContain('OrderEntity')
      expect(violations[0]!.message).toContain('"Entity"')
    })

    it('has correct description', () => {
      expect(mustNotEndWith('Entity').description).toBe('not have name ending with "Entity"')
    })
  })
})
