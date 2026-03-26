import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { calls } from '../../src/builders/call-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import { call } from '../../src/helpers/matchers.js'
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
