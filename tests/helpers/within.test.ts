import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { within } from '../../src/helpers/within.js'
import { calls } from '../../src/builders/call-rule-builder.js'
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

describe('within()', () => {
  const p = loadTestProject()

  it('scopes functions() to callbacks of matched calls', () => {
    // The GET /api/users route has both handleError and normalizePagination
    expect(() => {
      const routes = calls(p)
        .that()
        .onObject('app')
        .and()
        .withMethod('get')
        .and()
        .withStringArg(0, '/api/users')

      within(routes).functions().should().contain(call('normalizePagination')).check()
    }).not.toThrow()
  })

  it('reports violations for callbacks missing required calls', () => {
    // app.post('/api/users') is missing handleError
    const routes = calls(p)
      .that()
      .onObject('app')
      .and()
      .withMethod(/^(get|post)$/)
      .and()
      .resideInFile('**/express-routes.ts')

    expect(() => {
      within(routes).functions().should().contain(call('normalizePagination')).check()
    }).toThrow(ArchRuleError)
  })

  it('supports named selections with multiple rules', () => {
    // GET /api/users has both handleError and normalizePagination
    const routes = calls(p)
      .that()
      .onObject('app')
      .and()
      .withMethod('get')
      .and()
      .withStringArg(0, '/api/users')

    const scopedFunctions = within(routes).functions()

    // Rule 1: must call handleError
    expect(() => {
      scopedFunctions.should().contain(call('handleError')).check()
    }).not.toThrow()

    // Rule 2: must call normalizePagination (independent rule via fork-on-should)
    expect(() => {
      scopedFunctions.should().contain(call('normalizePagination')).check()
    }).not.toThrow()
  })

  it('supports predicates on scoped functions', () => {
    // The GET /api/users route callback is NOT async, so filtering for async should give no elements
    const routes = calls(p)
      .that()
      .onObject('app')
      .and()
      .withMethod('get')
      .and()
      .withStringArg(0, '/api/users')

    // No async callbacks in the match set --- areAsync() should filter to 0 elements
    // With 0 elements, no violations are produced (empty set passes)
    expect(() => {
      within(routes).functions().that().areAsync().should().contain(call('anything')).check()
    }).not.toThrow()
  })

  it('returns no elements when no calls match the selection', () => {
    const noRoutes = calls(p).that().onObject('nonexistent')

    // No matched calls -> no callbacks -> no violations (empty set passes)
    expect(() => {
      within(noRoutes).functions().should().contain(call('anything')).check()
    }).not.toThrow()
  })

  it('preserves .because() reason in scoped rule violations', () => {
    const routes = calls(p)
      .that()
      .onObject('app')
      .and()
      .withMethod('post')
      .and()
      .resideInFile('**/express-routes.ts')

    try {
      within(routes)
        .functions()
        .should()
        .contain(call('validateInput'))
        .because('all POST handlers must validate input')
        .check()
      expect.unreachable('should have thrown')
    } catch (error) {
      const archError = error as ArchRuleError
      expect(archError.message).toContain('all POST handlers must validate input')
    }
  })

  it('handles calls with multiple inline callbacks', () => {
    // router.get('/api/items', middleware, handler) has two inline callbacks
    const routes = calls(p)
      .that()
      .onObject('router')
      .and()
      .withMethod('get')
      .and()
      .resideInFile('**/nested-callbacks.ts')

    // The second callback calls handleError; the first calls next()
    // within() extracts ALL inline function arguments, so both are included
    // At least one of them should contain handleError
    const scopedFns = within(routes).functions()

    // Both callbacks exist: one has next(), one has handleError
    // contain(call('next')) should fail because not ALL callbacks call next()
    // (only the middleware does)
    expect(() => {
      scopedFns.should().contain(call('next')).check()
    }).toThrow(ArchRuleError)
  })

  it('scoped functions from function expressions work', () => {
    // router.post('/api/items', function handler(req, res) { ... })
    const routes = calls(p)
      .that()
      .onObject('router')
      .and()
      .withMethod('post')
      .and()
      .resideInFile('**/nested-callbacks.ts')

    expect(() => {
      within(routes).functions().should().contain(call('validateInput')).check()
    }).not.toThrow()
  })
})
