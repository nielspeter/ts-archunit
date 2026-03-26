import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { ScopedFunctionRuleBuilder } from '../../src/builders/scoped-function-rule-builder.js'
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

describe('ScopedFunctionRuleBuilder', () => {
  const p = loadTestProject()

  it('fork preserves call selection context', () => {
    // After .should() the builder forks. The forked builder must
    // still use the scoped getElements(), not the global one.
    const selection = calls(p)
      .that()
      .onObject('app')
      .and()
      .withMethod('get')
      .and()
      .withStringArg(0, '/api/users')

    const scoped = new ScopedFunctionRuleBuilder(selection)

    // .should() triggers a fork. The fork must still be scoped.
    // The GET /api/users route has handleError in its callback
    expect(() => {
      scoped.should().contain(call('handleError')).check()
    }).not.toThrow()
  })

  it('inherits all FunctionRuleBuilder predicates and conditions', () => {
    const selection = calls(p)
      .that()
      .onObject('app')
      .and()
      .withMethod('get')
      .and()
      .withStringArg(0, '/api/users')

    const scoped = new ScopedFunctionRuleBuilder(selection)

    // areAsync() is a FunctionRuleBuilder predicate; it should work
    // The callback is NOT async, so filtering to async should yield no elements
    expect(() => {
      scoped.that().areAsync().should().notExist().check()
    }).not.toThrow()

    // contain() is a FunctionRuleBuilder condition; it should work
    expect(() => {
      scoped.should().contain(call('handleError')).check()
    }).not.toThrow()
  })

  it('getElements returns empty when call selection matches no calls', () => {
    const noMatchSelection = calls(p).that().onObject('nonexistent')
    const scoped = new ScopedFunctionRuleBuilder(noMatchSelection)

    // Empty call selection -> empty elements -> no violations
    expect(() => {
      scoped.should().contain(call('anything')).check()
    }).not.toThrow()
  })

  it('works with notContain condition', () => {
    const selection = calls(p)
      .that()
      .onObject('app')
      .and()
      .withMethod('get')
      .and()
      .withStringArg(0, '/api/users')

    const scoped = new ScopedFunctionRuleBuilder(selection)

    // The callback should not contain db.query (it doesn't)
    expect(() => {
      scoped.should().notContain(call('db.query')).check()
    }).not.toThrow()
  })

  it('reports violations correctly for scoped elements', () => {
    const selection = calls(p)
      .that()
      .onObject('app')
      .and()
      .withMethod('post')
      .and()
      .resideInFile('**/express-routes.ts')

    const scoped = new ScopedFunctionRuleBuilder(selection)

    // The POST route callback does NOT call normalizePagination
    expect(() => {
      scoped.should().contain(call('normalizePagination')).check()
    }).toThrow(ArchRuleError)
  })
})
