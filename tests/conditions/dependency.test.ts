import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import {
  onlyImportFrom,
  notImportFrom,
  onlyHaveTypeImportsFrom,
  notHaveAliasedImports,
} from '../../src/conditions/dependency.js'
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

describe('dependency conditions', () => {
  describe('onlyImportFrom', () => {
    it('passes when all imports match the allowed globs', () => {
      const sf = getSourceFile('src/domain/order.ts')
      const condition = onlyImportFrom('**/domain/**', '**/shared/**')
      const violations = condition.evaluate([sf], ctx)
      expect(violations).toHaveLength(0)
    })

    it('reports violations for imports that do not match any allowed glob', () => {
      const sf = getSourceFile('src/bad/leaky-domain.ts')
      const condition = onlyImportFrom('**/domain/**')
      const violations = condition.evaluate([sf], ctx)
      expect(violations.length).toBeGreaterThan(0)
      expect(violations.some((v) => v.message.includes('infra'))).toBe(true)
    })

    it('passes for a module with no imports (vacuously true)', () => {
      const sf = getSourceFile('src/domain/entity.ts')
      const condition = onlyImportFrom('**/nonexistent/**')
      const violations = condition.evaluate([sf], ctx)
      expect(violations).toHaveLength(0)
    })

    it('checks multiple modules and reports violations per import', () => {
      const sf1 = getSourceFile('src/domain/order.ts')
      const sf2 = getSourceFile('src/bad/leaky-domain.ts')
      const condition = onlyImportFrom('**/domain/**')
      const violations = condition.evaluate([sf1, sf2], ctx)
      // order.ts imports from shared — violation
      // leaky-domain.ts imports from infra — violation
      expect(violations.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('notImportFrom', () => {
    it('passes when no imports match the forbidden globs', () => {
      const sf = getSourceFile('src/domain/order.ts')
      const condition = notImportFrom('**/infra/**')
      const violations = condition.evaluate([sf], ctx)
      expect(violations).toHaveLength(0)
    })

    it('reports violations for imports matching forbidden globs', () => {
      const sf = getSourceFile('src/bad/leaky-domain.ts')
      const condition = notImportFrom('**/infra/**')
      const violations = condition.evaluate([sf], ctx)
      expect(violations.length).toBeGreaterThan(0)
      expect(violations.some((v) => v.message.includes('infra'))).toBe(true)
    })
  })

  describe('notHaveAliasedImports', () => {
    it('passes when no imports use aliases', () => {
      const sf = getSourceFile('src/domain/order.ts')
      const condition = notHaveAliasedImports()
      const violations = condition.evaluate([sf], ctx)
      expect(violations).toHaveLength(0)
    })

    it('reports violations for aliased import specifiers', () => {
      const sf = getSourceFile('src/bad/aliased-import.ts')
      const condition = notHaveAliasedImports()
      const violations = condition.evaluate([sf], ctx)
      expect(violations).toHaveLength(2)
      expect(violations.some((v) => v.message.includes('"Entity" as "DomainEntity"'))).toBe(true)
      expect(violations.some((v) => v.message.includes('"validate" as "check"'))).toBe(true)
    })

    it('passes for a module with no imports', () => {
      const sf = getSourceFile('src/domain/entity.ts')
      const condition = notHaveAliasedImports()
      const violations = condition.evaluate([sf], ctx)
      expect(violations).toHaveLength(0)
    })

    it('has correct description', () => {
      expect(notHaveAliasedImports().description).toBe('not have aliased imports')
    })
  })

  describe('notImportFrom with ignoreTypeImports (plan 0038)', () => {
    it('default: flags type-only imports (backward compatible)', () => {
      const sf = getSourceFile('src/domain/typed-service.ts')
      const condition = notImportFrom('**/infra/**')
      const violations = condition.evaluate([sf], ctx)
      // type-only import from infra is still flagged by default
      expect(violations.length).toBeGreaterThan(0)
    })

    it('ignoreTypeImports: skips type-only imports', () => {
      const sf = getSourceFile('src/domain/typed-service.ts')
      const condition = notImportFrom(['**/infra/**'], { ignoreTypeImports: true })
      const violations = condition.evaluate([sf], ctx)
      // type-only import from infra is now allowed
      expect(violations).toHaveLength(0)
    })

    it('mixed import (import { type X, Y }) is NOT skipped', () => {
      const sf = getSourceFile('src/bad/mixed-import.ts')
      const condition = notImportFrom(['**/shared/utils**'], { ignoreTypeImports: true })
      const violations = condition.evaluate([sf], ctx)
      // import { type format, parse } has runtime import parse — still flagged
      expect(violations.length).toBeGreaterThan(0)
    })
  })

  describe('onlyImportFrom with ignoreTypeImports (plan 0038)', () => {
    it('ignoreTypeImports: type-only imports from forbidden paths are allowed', () => {
      const sf = getSourceFile('src/domain/typed-service.ts')
      // typed-service.ts has type imports from infra and shared
      // With ignoreTypeImports, only non-type imports need to match
      const condition = onlyImportFrom(['**/domain/**', '**/shared/**'], {
        ignoreTypeImports: true,
      })
      const violations = condition.evaluate([sf], ctx)
      // The type-only import from infra is ignored, no violations
      expect(violations).toHaveLength(0)
    })
  })

  describe('onlyHaveTypeImportsFrom', () => {
    it('passes when imports from matching paths are type-only', () => {
      const sf = getSourceFile('src/domain/order.ts')
      // order.ts has: import type { Entity } from './entity.js'
      const condition = onlyHaveTypeImportsFrom('**/domain/**')
      const violations = condition.evaluate([sf], ctx)
      expect(violations).toHaveLength(0)
    })

    it('reports violations when a matching import is not type-only', () => {
      const sf = getSourceFile('src/bad/non-type-import.ts')
      // non-type-import.ts has: import { Entity } from '../domain/entity.js' (value import)
      const condition = onlyHaveTypeImportsFrom('**/domain/**')
      const violations = condition.evaluate([sf], ctx)
      expect(violations.length).toBeGreaterThan(0)
      expect(violations.some((v) => v.message.includes('type-only'))).toBe(true)
    })

    it('ignores imports from non-matching paths', () => {
      const sf = getSourceFile('src/bad/non-type-import.ts')
      // non-type-import.ts also imports from shared — not checked
      const condition = onlyHaveTypeImportsFrom('**/domain/**')
      const violations = condition.evaluate([sf], ctx)
      // Only the domain import is checked, not the shared import
      expect(violations).toHaveLength(1)
    })
  })
})
