/**
 * Tests for variadic glob support on module predicates and builder methods.
 *
 * User reported: .notImportFrom('fastify', 'knex', 'bullmq') silently
 * ignored args 2 and 3 because the predicate only accepted a single glob.
 */
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { modules } from '../../src/builders/module-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'
import { notImportFrom, importFrom } from '../../src/predicates/module.js'

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

const p = loadTestProject()

describe('notImportFrom — variadic glob support', () => {
  it('standalone predicate accepts multiple globs', () => {
    const pred = notImportFrom('**/infra/**', '**/shared/**')
    expect(pred.description).toContain('infra')
    expect(pred.description).toContain('shared')
  })

  it('builder .notImportFrom() accepts multiple globs', () => {
    // bad/leaky-domain.ts imports from infra — should be excluded by the predicate
    // so only modules NOT importing from infra OR shared should remain
    expect(() => {
      modules(p).that().notImportFrom('**/infra/**', '**/shared/**').should().notExist().check()
    }).toThrow(ArchRuleError) // domain files exist that import from neither
  })

  it('multiple globs in .notImportFrom() all take effect', () => {
    // domain/order.ts imports from shared — filtering with notImportFrom('**/shared/**')
    // should exclude it. Adding '**/domain/**' should also exclude domain self-imports.
    // If only the first glob worked, order.ts would still be included.
    const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
    const orderFile = tsMorphProject
      .getSourceFiles()
      .find((sf) => sf.getFilePath().includes('domain/order.ts'))
    expect(orderFile).toBeDefined()

    const pred = notImportFrom('**/shared/**', '**/domain/**')
    // order.ts imports from both shared and domain — should NOT match this predicate
    expect(pred.test(orderFile!)).toBe(false)
  })
})

describe('importFrom — variadic glob support', () => {
  it('standalone predicate accepts multiple globs', () => {
    const pred = importFrom('**/infra/**', '**/shared/**')
    expect(pred.description).toContain('infra')
    expect(pred.description).toContain('shared')
  })

  it('matches when any glob matches', () => {
    const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
    const orderFile = tsMorphProject
      .getSourceFiles()
      .find((sf) => sf.getFilePath().includes('domain/order.ts'))
    expect(orderFile).toBeDefined()

    // order.ts imports from shared — should match
    const pred = importFrom('**/infra/**', '**/shared/**')
    expect(pred.test(orderFile!)).toBe(true)
  })
})
