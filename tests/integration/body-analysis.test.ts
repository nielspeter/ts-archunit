import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { classes } from '../../src/builders/class-rule-builder.js'
import { call, newExpr } from '../../src/helpers/matchers.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('Integration: body analysis via fluent API', () => {
  const p = loadTestProject()

  it('classes extending BaseService should not contain call to parseInt', () => {
    // ProductService and EdgeCaseService fail, OrderService passes
    expect(() => {
      classes(p)
        .that()
        .extend('BaseService')
        .should()
        .notContain(call('parseInt'))
        .because('use this.normalizeCount() instead')
        .check()
    }).toThrow(ArchRuleError)
  })

  it('classes extending BaseService should not contain new Error', () => {
    // ProductService fails (new Error), OrderService passes (new DomainError)
    expect(() => {
      classes(p)
        .that()
        .extend('BaseService')
        .should()
        .notContain(newExpr('Error'))
        .because('use DomainError for domain-specific errors')
        .check()
    }).toThrow(ArchRuleError)
  })

  it('useInsteadOf combines both checks', () => {
    // ProductService fails on both counts
    expect(() => {
      classes(p)
        .that()
        .extend('BaseService')
        .should()
        .useInsteadOf(newExpr('Error'), newExpr('DomainError'))
        .check()
    }).toThrow(ArchRuleError)
  })

  it('andShould chains multiple body conditions', () => {
    expect(() => {
      classes(p)
        .that()
        .extend('BaseService')
        .should()
        .notContain(call('parseInt'))
        .andShould()
        .notContain(newExpr('Error'))
        .check()
    }).toThrow(ArchRuleError)
  })

  it('regex matchers work through the builder', () => {
    expect(() => {
      classes(p)
        .that()
        .extend('BaseService')
        .should()
        .notContain(call(/^parse/))
        .check()
    }).toThrow(ArchRuleError)
  })
})
