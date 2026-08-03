import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import type { SourceFile } from 'ts-morph'
import path from 'node:path'
import { calls } from '../../src/builders/call-rule-builder.js'
import { within } from '../../src/index.js'
import { ArchRuleError } from '../../src/core/errors.js'
import { call, property } from '../../src/helpers/matchers.js'
import type { ArchProject } from '../../src/core/project.js'
import { definePredicate } from '../../src/core/define.js'
import type { ArchCall } from '../../src/models/arch-call.js'

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

describe('calls() entry point — end-to-end', () => {
  const p = loadTestProject()

  describe('Express route patterns', () => {
    it('detects route handlers missing handleError()', () => {
      try {
        calls(p)
          .that()
          .onObject('app')
          .and()
          .withMethod(/^(get|post|put|delete)$/)
          .and()
          .resideInFile('**/express-routes.ts')
          .should()
          .haveCallbackContaining(call('handleError'))
          .because('unhandled errors crash the server')
          .check()
        expect.unreachable('should have thrown')
      } catch (error) {
        const archError = error as ArchRuleError
        // app.post('/api/users') is missing handleError
        expect(archError.violations.length).toBeGreaterThanOrEqual(1)
        expect(archError.message).toContain('unhandled errors crash the server')
      }
    })

    it('all routes with /api/admin/** must call authenticate()', () => {
      expect(() => {
        calls(p)
          .that()
          .onObject('app')
          .and()
          .withMethod(/^(get|post|put|delete)$/)
          .and()
          .withStringArg(0, '/api/admin/**')
          .should()
          .haveCallbackContaining(call('authenticate'))
          .check()
      }).not.toThrow()
    })

    it('app.use() calls are selectable separately from routes', () => {
      expect(() => {
        calls(p)
          .that()
          .onObject('app')
          .and()
          .withMethod('use')
          .and()
          .resideInFile('**/express-routes.ts')
          .should()
          .notExist()
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('framework-agnostic patterns', () => {
    it('works with bare function calls (not method calls)', () => {
      expect(() => {
        calls(p)
          .that()
          .withMethod('handleError')
          .and()
          .resideInFile('**/bare-calls.ts')
          .should()
          .notExist()
          .check()
      }).toThrow(ArchRuleError)
    })

    it('works with function expression callbacks', () => {
      expect(() => {
        calls(p)
          .that()
          .onObject('router')
          .and()
          .withMethod('post')
          .and()
          .resideInFile('**/nested-callbacks.ts')
          .should()
          .haveCallbackContaining(call('validateInput'))
          .check()
      }).not.toThrow()
    })
  })

  describe('real-world rule patterns from spec', () => {
    it('routes.should().haveCallbackContaining(call("handleError"))', () => {
      const routes = calls(p)
        .that()
        .onObject('app')
        .and()
        .withMethod(/^(get|post|put|delete|patch)$/)
        .and()
        .resideInFile('**/express-routes.ts')

      // Not all routes have handleError
      expect(() => {
        routes.should().haveCallbackContaining(call('handleError')).check()
      }).toThrow(ArchRuleError)
    })

    it('routes.should().haveCallbackContaining(call("normalizePagination")) for specific GET', () => {
      expect(() => {
        calls(p)
          .that()
          .onObject('app')
          .and()
          .withMethod('get')
          .and()
          .withStringArg(0, '/api/users')
          .should()
          .haveCallbackContaining(call('normalizePagination'))
          .check()
      }).not.toThrow()
    })

    it('calls(p).that().onObject("db").should().notExist() in route files', () => {
      expect(() => {
        calls(p)
          .that()
          .onObject('db')
          .and()
          .resideInFile('**/express-routes.ts')
          .should()
          .notExist()
          .check()
      }).not.toThrow()
    })
  })

  describe('argument property conditions (plan 0034)', () => {
    it('Fastify schema enforcement: all route handlers must have schema', () => {
      expect(() => {
        calls(p)
          .that()
          .onObject('app')
          .and()
          .withMethod(/^(get|post)$/)
          .and()
          .resideInFile('**/route-options.ts')
          .should()
          .haveArgumentWithProperty('schema')
          .check()
      }).toThrow(ArchRuleError)
      // app.get('/health') has an empty object literal --- no schema property
    })

    it('multiple required properties: schema + preHandler', () => {
      try {
        calls(p)
          .that()
          .onObject('app')
          .and()
          .withMethod(/^(get|post)$/)
          .and()
          .resideInFile('**/route-options.ts')
          .should()
          .haveArgumentWithProperty('schema', 'preHandler')
          .check()
        expect.unreachable('should have thrown')
      } catch (error) {
        const archError = error as ArchRuleError
        // Several calls are missing preHandler or schema
        expect(archError.violations.length).toBeGreaterThanOrEqual(2)
      }
    })

    it('compose with withStringArg: only specific routes need schema', () => {
      expect(() => {
        calls(p)
          .that()
          .onObject('app')
          .and()
          .withMethod(/^(get|post)$/)
          .and()
          .withStringArg(0, '/users')
          .and()
          .resideInFile('**/route-options.ts')
          .should()
          .haveArgumentWithProperty('schema')
          .check()
      }).not.toThrow()
    })

    it('notHaveArgumentWithProperty detects forbidden property', () => {
      expect(() => {
        calls(p)
          .that()
          .onObject('app')
          .and()
          .resideInFile('**/route-options.ts')
          .should()
          .notHaveArgumentWithProperty('deprecated')
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('argument containing conditions (plan 0036)', () => {
    it('notHaveArgumentContaining detects nested additionalProperties: true', () => {
      try {
        calls(p)
          .that()
          .onObject('app')
          .and()
          .withMethod(/^(get|post)$/)
          .and()
          .resideInFile('**/nested-properties.ts')
          .should()
          .notHaveArgumentContaining(property('additionalProperties', true))
          .check()
        expect.unreachable('should have thrown')
      } catch (error) {
        const archError = error as ArchRuleError
        // /users has nested additionalProperties: true, /items has top-level
        // The two distinct call sites, by line — reporting one of them twice
        // also had length 2.
        expect(archError.violations.map((v) => v.line).sort((a, b) => a - b)).toEqual([8, 58])
      }
    })

    it('compose with withMethod: only POST routes checked', () => {
      try {
        calls(p)
          .that()
          .onObject('app')
          .and()
          .withMethod('post')
          .and()
          .resideInFile('**/nested-properties.ts')
          .should()
          .notHaveArgumentContaining(property('additionalProperties', true))
          .check()
        expect.unreachable('should have thrown')
      } catch (error) {
        const archError = error as ArchRuleError
        // /users and /items are both POST
        // The two distinct call sites, by line — reporting one of them twice
        // also had length 2.
        expect(archError.violations.map((v) => v.line).sort((a, b) => a - b)).toEqual([8, 58])
      }
    })

    it('haveArgumentContaining passes when property exists', () => {
      expect(() => {
        calls(p)
          .that()
          .onObject('app')
          .and()
          .withMethod('post')
          .and()
          .resideInFile('**/nested-properties.ts')
          .should()
          .haveArgumentContaining(property('type', 'object'))
          .check()
      }).not.toThrow()
    })

    it('property() with numeric value matches in nested schema', () => {
      expect(() => {
        calls(p)
          .that()
          .onObject('app')
          .and()
          .withMethod('get')
          .and()
          .withStringArg(0, '/list')
          .and()
          .resideInFile('**/nested-properties.ts')
          .should()
          .haveArgumentContaining(property('maximum', 100))
          .check()
      }).not.toThrow()
    })

    it('clean routes pass notHaveArgumentContaining', () => {
      expect(() => {
        calls(p)
          .that()
          .onObject('app')
          .and()
          .withStringArg(0, '/health')
          .and()
          .resideInFile('**/nested-properties.ts')
          .should()
          .notHaveArgumentContaining(property('additionalProperties', true))
          .check()
      }).not.toThrow()
    })
  })

  describe('custom predicates via .satisfy()', () => {
    it('definePredicate<ArchCall> works with CallRuleBuilder', () => {
      const hasGetMethod = definePredicate<ArchCall>(
        'call with get method',
        (archCall) => archCall.getMethodName() === 'get',
      )

      expect(() => {
        calls(p).that().satisfy(hasGetMethod).should().notExist().check()
      }).toThrow(ArchRuleError)
    })
  })
})

describe('an object-literal callback keeps its name (plan 0082)', () => {
  const p = loadTestProject()

  /** `basename:line`, so the assertions name elements rather than count them. */
  const identify = (fn: {
    getSourceFile: () => SourceFile
    getStartLineNumber: () => number
  }): string =>
    `${path.basename(fn.getSourceFile().getFilePath())}:${String(fn.getStartLineNumber())}`

  it('VACUITY: the fixture really has callbacks, measured WITHOUT using names', () => {
    // Name-independent on purpose. The first version of this row asserted that
    // `getName()` returned 'handler' — which is the thing under test, so it was a
    // second copy of the feature assertion wearing a vacuity label, and it reddened
    // under revert exactly like the rows it was supposed to be guarding.
    expect(within(calls(p)).functions().subjects().length).toBeGreaterThan(20)
  })

  it('the motivating rule selects the handler, and NOT its sibling', () => {
    // **This row passed with the feature completely reverted**, in the release that
    // introduced it saying "without this the plan proves a field is populated and
    // not that the gap is closed". Two reasons, both found by review:
    //
    //  1. `expect(handlers.length).toBeGreaterThan(0)` held either way, because the
    //     fixture already contained functions genuinely named `handler` — a method
    //     shorthand and a positional `function handler(...)`, both named long
    //     before this change. Reverting lost 4 of 6 selections, invisible to `> 0`.
    //  2. `expect([...new Set(names)]).toEqual(['handler'])` was a TAUTOLOGY: the
    //     set was already filtered by `/^handler$/`, so it could only be
    //     `['handler']` unless `haveNameMatching` itself broke. It guarded the
    //     predicate, not the naming.
    //
    // Fixed by asserting WHICH functions are selected. Reverting the one-line
    // change drops this from seven to two.
    const handlers = within(calls(p))
      .functions()
      .that()
      .haveNameMatching(/^handler$/)
      .subjects()
      .map(identify)
      .sort()

    expect(handlers).toEqual([
      'nested-callbacks.ts:23',
      'object-callbacks.ts:12',
      'object-callbacks.ts:19',
      'object-callbacks.ts:26',
      'object-callbacks.ts:38',
      'object-callbacks.ts:57',
      'object-callbacks.ts:71',
      // The named function expression added for 0.46.1: the property key wins, so
      // this is a `handler` too. Reverting the naming change drops it.
      'object-callbacks.ts:80',
    ])
  })

  it('ONLY the handler: its sibling on the same object literal is excluded', () => {
    // "ONLY" was in the old row's title and asserted nowhere — and could not be,
    // because no fixture had two differently-named function callbacks on one
    // object. `object-callbacks.ts:69` now does, so exclusion is demonstrable
    // rather than assumed.
    const onePair = within(calls(p))
      .functions()
      .subjects()
      // The `/pair` call site: `preHandler` at :68, `handler` at :71.
      .filter((fn) => /^object-callbacks\.ts:(68|71)$/.test(identify(fn)))
      .map((fn) => fn.getName())
      .sort()
    expect(onePair).toEqual(['handler', 'preHandler'])

    const selected = within(calls(p))
      .functions()
      .that()
      .haveNameMatching(/^handler$/)
      .subjects()
      .map((fn) => fn.getName())
    expect(selected).not.toContain('preHandler')
  })
})
