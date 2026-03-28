import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { modules } from '../../src/builders/module-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/modules')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('modules() — full fluent chain', () => {
  const p = loadTestProject()

  describe('onlyImportFrom', () => {
    it('domain modules can import from domain and shared', () => {
      expect(() => {
        modules(p)
          .that()
          .resideInFolder('**/domain/**')
          .and()
          .haveNameMatching(/^(?!typed-service)/) // exclude type-import fixture (plan 0038)
          .should()
          .onlyImportFrom('**/domain/**', '**/shared/**')
          .check()
      }).not.toThrow()
    })

    it('bad modules violate domain import rules', () => {
      expect(() => {
        modules(p)
          .that()
          .resideInFolder('**/bad/**')
          .should()
          .onlyImportFrom('**/bad/**', '**/shared/**')
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('notImportFromCondition', () => {
    it('domain modules do not import from infra', () => {
      expect(() => {
        modules(p)
          .that()
          .resideInFolder('**/domain/**')
          .and()
          .haveNameMatching(/^(?!typed-service)/) // exclude type-import fixture (plan 0038)
          .should()
          .notImportFromCondition('**/infra/**')
          .check()
      }).not.toThrow()
    })

    it('bad modules import from infra (violation)', () => {
      expect(() => {
        modules(p)
          .that()
          .resideInFolder('**/bad/**')
          .should()
          .notImportFromCondition('**/infra/**')
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('onlyHaveTypeImportsFrom', () => {
    it('domain modules only type-import from domain', () => {
      // domain/order.ts has `import type { Entity }` from domain — should pass
      expect(() => {
        modules(p)
          .that()
          .resideInFolder('**/domain/**')
          .should()
          .onlyHaveTypeImportsFrom('**/domain/**')
          .check()
      }).not.toThrow()
    })
  })

  describe('.because() and .warn()', () => {
    it('.because() attaches reason to violations', () => {
      try {
        modules(p)
          .that()
          .resideInFolder('**/bad/**')
          .should()
          .notImportFromCondition('**/infra/**')
          .because('domain must be independent of infrastructure')
          .check()
        expect.unreachable('should have thrown')
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ArchRuleError)
        const archError = error as ArchRuleError
        expect(archError.violations[0]!.because).toBe(
          'domain must be independent of infrastructure',
        )
      }
    })

    it('.warn() does not throw on violations', () => {
      expect(() => {
        modules(p)
          .that()
          .resideInFolder('**/bad/**')
          .should()
          .notImportFromCondition('**/infra/**')
          .warn()
      }).not.toThrow()
    })
  })
})
