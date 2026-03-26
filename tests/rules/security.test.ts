import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { noEval, noFunctionConstructor, noProcessEnv, noConsoleLog } from '../../src/rules/security.js'

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

describe('security rules', () => {
  describe('noEval()', () => {
    it('detects eval() calls', () => {
      const condition = noEval()
      const violations = condition.evaluate([findClass('SecurityViolationClass')], context)
      expect(violations.length).toBeGreaterThan(0)
      expect(violations.some((v) => v.message.includes('eval'))).toBe(true)
    })

    it('passes for clean class', () => {
      const condition = noEval()
      const violations = condition.evaluate([findClass('CleanService')], context)
      expect(violations).toHaveLength(0)
    })
  })

  describe('noFunctionConstructor()', () => {
    it('detects new Function() calls', () => {
      const condition = noFunctionConstructor()
      const violations = condition.evaluate([findClass('SecurityViolationClass')], context)
      expect(violations.length).toBeGreaterThan(0)
      expect(violations.some((v) => v.message.includes('Function'))).toBe(true)
    })

    it('passes for clean class', () => {
      const condition = noFunctionConstructor()
      const violations = condition.evaluate([findClass('CleanService')], context)
      expect(violations).toHaveLength(0)
    })
  })

  describe('noProcessEnv()', () => {
    it('detects process.env access', () => {
      const condition = noProcessEnv()
      const violations = condition.evaluate([findClass('SecurityViolationClass')], context)
      expect(violations.length).toBeGreaterThan(0)
      expect(violations.some((v) => v.message.includes('process.env'))).toBe(true)
    })

    it('passes for clean class', () => {
      const condition = noProcessEnv()
      const violations = condition.evaluate([findClass('CleanService')], context)
      expect(violations).toHaveLength(0)
    })
  })

  describe('noConsoleLog()', () => {
    it('detects console.log calls', () => {
      const condition = noConsoleLog()
      const violations = condition.evaluate([findClass('SecurityViolationClass')], context)
      expect(violations.length).toBeGreaterThan(0)
      expect(violations.some((v) => v.message.includes('console.log'))).toBe(true)
    })

    it('passes for clean class', () => {
      const condition = noConsoleLog()
      const violations = condition.evaluate([findClass('CleanService')], context)
      expect(violations).toHaveLength(0)
    })
  })
})
