import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { onlyDependOn, mustNotDependOn } from '../../src/rules/dependencies.js'
import type { ConditionContext } from '../../src/core/condition.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/modules')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')
const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })

function getSourceFile(relativePath: string) {
  const fullPath = path.join(fixturesDir, relativePath)
  const sf = tsMorphProject.getSourceFile(fullPath)
  if (!sf) throw new Error(`Fixture not found: ${fullPath}`)
  return sf
}

const ctx: ConditionContext = { rule: 'test rule' }

describe('dependency rules', () => {
  describe('onlyDependOn()', () => {
    it('passes when all imports match allowed globs', () => {
      const sf = getSourceFile('src/domain/order.ts')
      const condition = onlyDependOn('**/domain/**', '**/shared/**')
      const violations = condition.evaluate([sf], ctx)
      expect(violations).toHaveLength(0)
    })

    it('fails when imports do not match allowed globs', () => {
      const sf = getSourceFile('src/bad/leaky-domain.ts')
      const condition = onlyDependOn('**/domain/**')
      const violations = condition.evaluate([sf], ctx)
      expect(violations.length).toBeGreaterThan(0)
    })
  })

  describe('mustNotDependOn()', () => {
    it('passes when no imports match forbidden globs', () => {
      const sf = getSourceFile('src/domain/order.ts')
      const condition = mustNotDependOn('**/infra/**')
      const violations = condition.evaluate([sf], ctx)
      expect(violations).toHaveLength(0)
    })

    it('fails when imports match forbidden globs', () => {
      const sf = getSourceFile('src/bad/leaky-domain.ts')
      const condition = mustNotDependOn('**/infra/**')
      const violations = condition.evaluate([sf], ctx)
      expect(violations.length).toBeGreaterThan(0)
    })
  })
})
