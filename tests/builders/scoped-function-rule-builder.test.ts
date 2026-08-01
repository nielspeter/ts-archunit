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

    // The unfiltered scope must be non-empty, or "inherits all predicates" is
    // asserted over nothing — which is what it was.
    expect(new ScopedFunctionRuleBuilder(selection).subjects().length).toBeGreaterThan(0)

    // areAsync() is a FunctionRuleBuilder predicate; it reaches scoped
    // functions. Asserted on the subject set, both outcomes: the callback is
    // not async, so the filter empties the set — which the previous version
    // checked by running a rule over that empty set and watching it not throw,
    // true however the predicate behaves.
    expect(new ScopedFunctionRuleBuilder(selection).that().areAsync().subjects()).toHaveLength(0)

    // contain() is a FunctionRuleBuilder condition; it should work — on a
    // FRESH builder. Reusing the one narrowed by `areAsync()` above ran this
    // over the emptied set, so it asserted nothing (bug 0016).
    expect(() => {
      new ScopedFunctionRuleBuilder(selection).should().contain(call('handleError')).check()
    }).not.toThrow()
  })

  it('getElements returns empty when call selection matches no calls', () => {
    const noMatchSelection = calls(p).that().onObject('nonexistent')
    const scoped = new ScopedFunctionRuleBuilder(noMatchSelection)

    // Plan 0074 (R3b) inverted this: an empty selection is a configuration finding by default now. Empty call selection -> empty elements -> nothing checked.
    expect(() => {
      scoped.should().contain(call('anything')).check()
    }).toThrow()
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
