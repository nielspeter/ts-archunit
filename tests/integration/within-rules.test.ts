import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { calls } from '../../src/builders/call-rule-builder.js'
import { within } from '../../src/helpers/within.js'
import { call } from '../../src/helpers/matchers.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/calls')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('within() — full fluent chain', () => {
  const p = loadTestProject()

  it('within(routes).functions().should().contain(call("handleError"))', () => {
    // GET /api/users has handleError in its callback — scoped check
    const userRoute = calls(p)
      .that()
      .onObject('app')
      .and()
      .withMethod('get')
      .and()
      .withStringArg(0, '/api/users')

    expect(() => {
      within(userRoute).functions().should().contain(call('handleError')).check()
    }).not.toThrow()
  })

  it('within(routes) detects missing handleError in POST route', () => {
    const postRoutes = calls(p).that().onObject('app').and().withMethod('post')

    // POST routes are missing handleError
    expect(() => {
      within(postRoutes).functions().should().contain(call('handleError')).check()
    }).toThrow(ArchRuleError)
  })

  it('within(routes) with .warn() does not throw', () => {
    const postRoutes = calls(p).that().onObject('app').and().withMethod('post')

    expect(() => {
      within(postRoutes).functions().should().contain(call('handleError')).warn()
    }).not.toThrow()
  })

  it('within(routes).functions().should().notContain() works', () => {
    const userRoute = calls(p)
      .that()
      .onObject('app')
      .and()
      .withMethod('get')
      .and()
      .withStringArg(0, '/api/users')

    // The GET /api/users callback calls normalizePagination, not db.rawQuery
    expect(() => {
      within(userRoute).functions().should().notContain(call('db.rawQuery')).check()
    }).not.toThrow()
  })
})
