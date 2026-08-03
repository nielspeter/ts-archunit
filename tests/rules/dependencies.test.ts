import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { onlyDependOn, mustNotDependOn, typeOnlyFrom } from '../../src/rules/dependencies.js'
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

  describe('typeOnlyFrom()', () => {
    it('passes when matching imports are type-only', () => {
      // domain/order.ts has: import type { Entity } from './entity.js'
      const sf = getSourceFile('src/domain/order.ts')
      const condition = typeOnlyFrom('**/domain/**')
      const violations = condition.evaluate([sf], ctx)
      expect(violations).toHaveLength(0)
    })

    it('fails when matching imports are not type-only', () => {
      // bad/non-type-import.ts has: import { Entity } from '../domain/entity.js' (value import)
      const sf = getSourceFile('src/bad/non-type-import.ts')
      const condition = typeOnlyFrom('**/domain/**')
      const violations = condition.evaluate([sf], ctx)
      expect(violations.length).toBeGreaterThan(0)
      expect(violations.some((v) => v.message.includes('type-only'))).toBe(true)
    })

    it('ignores imports from non-matching paths', () => {
      // bad/non-type-import.ts also imports from shared — but only domain is checked
      const sf = getSourceFile('src/bad/non-type-import.ts')
      const condition = typeOnlyFrom('**/domain/**')
      const violations = condition.evaluate([sf], ctx)
      // Only the domain import is checked, not the shared import
      // WHICH import: `non-type-import.ts` also imports from `shared`, and
      // flagging that one instead also had length 1.
      const imported = violations.map((v) =>
        v.message
          .match(/from "([^"]+)"/)?.[1]
          ?.split('/')
          .at(-1),
      )
      // Basename, not the absolute path, so the fixture root stays out of the
      // assertion. Safe because the discriminator is `entity.ts` against the
      // `shared/` imports, and `tests/fixtures/modules/src/shared/` holds only
      // `logger.ts`, `utils.ts` and `validation.ts` — no collision. A future
      // `shared/entity.ts` would silently defeat it; switch to the relative path
      // that day.
      expect(imported).toEqual(['entity.ts'])
    })

    it('passes for module with no imports', () => {
      // entity.ts has no imports
      const sf = getSourceFile('src/domain/entity.ts')
      const condition = typeOnlyFrom('**/anything/**')
      const violations = condition.evaluate([sf], ctx)
      expect(violations).toHaveLength(0)
    })

    it('has correct description', () => {
      const condition = typeOnlyFrom('**/domain/**')
      expect(condition.description).toContain('type imports')
    })
  })
})
