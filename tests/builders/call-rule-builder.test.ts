import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { calls, CallRuleBuilder } from '../../src/builders/call-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import { call } from '../../src/helpers/matchers.js'
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

describe('CallRuleBuilder', () => {
  const p = loadTestProject()

  it('returns a CallRuleBuilder from calls()', () => {
    expect(calls(p)).toBeInstanceOf(CallRuleBuilder)
  })

  describe('predicate chaining', () => {
    it('.that().onObject("app") filters to object calls', () => {
      // There are app.get, app.post, app.use calls in express-routes.ts
      expect(() => {
        calls(p).that().onObject('app').should().notExist().check()
      }).toThrow(ArchRuleError)
    })

    it('.that().onObject("app").and().withMethod("get") combines predicates', () => {
      expect(() => {
        calls(p).that().onObject('app').and().withMethod('get').should().notExist().check()
      }).toThrow(ArchRuleError)
    })

    it('.that().withStringArg(0, "/api/**") filters by route path', () => {
      expect(() => {
        calls(p).that().withStringArg(0, '/api/**').should().notExist().check()
      }).toThrow(ArchRuleError)
    })

    it('.that().resideInFile("**/express-routes.ts") uses identity predicates', () => {
      expect(() => {
        calls(p)
          .that()
          .onObject('app')
          .and()
          .resideInFile('**/express-routes.ts')
          .should()
          .notExist()
          .check()
      }).toThrow(ArchRuleError)
    })

    it('.that().haveNameMatching(/^app\\./) uses name matching', () => {
      expect(() => {
        calls(p)
          .that()
          .haveNameMatching(/^app\./)
          .should()
          .notExist()
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('condition evaluation', () => {
    it('.should().haveCallbackContaining(call("handleError")).check() passes for matching routes', () => {
      // The first app.get route contains handleError
      expect(() => {
        calls(p)
          .that()
          .onObject('app')
          .and()
          .withMethod('get')
          .and()
          .withStringArg(0, '/api/users')
          .should()
          .haveCallbackContaining(call('handleError'))
          .check()
      }).not.toThrow()
    })

    it('.should().haveCallbackContaining(call("handleError")).check() throws on violation', () => {
      // app.post('/api/users') does NOT contain handleError
      expect(() => {
        calls(p)
          .that()
          .onObject('app')
          .and()
          .withMethod('post')
          .and()
          .resideInFile('**/express-routes.ts')
          .should()
          .haveCallbackContaining(call('handleError'))
          .check()
      }).toThrow(ArchRuleError)
    })

    it('.should().notExist().check() passes when no calls match', () => {
      expect(() => {
        calls(p).that().onObject('nonexistent').should().notExist().check()
      }).not.toThrow()
    })

    it('.should().notExist().check() throws when calls match', () => {
      expect(() => {
        calls(p).that().onObject('app').and().withMethod('use').should().notExist().check()
      }).toThrow(ArchRuleError)
    })

    it('.warn() logs but does not throw', () => {
      expect(() => {
        calls(p)
          .that()
          .onObject('app')
          .and()
          .withMethod('post')
          .should()
          .haveCallbackContaining(call('handleError'))
          .warn()
      }).not.toThrow()
    })
  })

  describe('named selections (reusable queries)', () => {
    it('predicate chain can be saved and reused across rules', () => {
      const appRoutes = calls(p)
        .that()
        .onObject('app')
        .and()
        .withMethod(/^(get|post)$/)

      // Rule 1: should not exist (will throw --- routes exist)
      expect(() => {
        appRoutes.should().notExist().check()
      }).toThrow(ArchRuleError)

      // Rule 2: check handleError (independent fork)
      // Not all have handleError, but this tests that both rules run independently
      expect(() => {
        appRoutes.should().haveCallbackContaining(call('handleError')).check()
      }).toThrow(ArchRuleError)
    })

    it('.should() forks correctly for multiple conditions', () => {
      const routes = calls(p)
        .that()
        .onObject('app')
        .and()
        .withMethod('get')
        .and()
        .resideInFile('**/express-routes.ts')
      const rule1 = routes.should().notExist()
      const rule2 = routes.should().haveCallbackContaining(call('handleError'))

      // rule1 throws (routes exist)
      expect(() => rule1.check()).toThrow(ArchRuleError)
      // rule2 passes: both GET routes in express-routes.ts have handleError
      expect(() => rule2.check()).not.toThrow()
    })
  })

  describe('additional predicate wiring', () => {
    it('.haveNameStartingWith() filters by name prefix', () => {
      expect(() => {
        calls(p).that().haveNameStartingWith('app.').should().notExist().check()
      }).toThrow(ArchRuleError)
    })

    it('.haveNameEndingWith() filters by name suffix', () => {
      expect(() => {
        calls(p).that().haveNameEndingWith('.get').should().notExist().check()
      }).toThrow(ArchRuleError)
    })

    it('.resideInFolder() filters by folder glob', () => {
      expect(() => {
        calls(p)
          .that()
          .onObject('app')
          .and()
          .resideInFolder('**/src/**')
          .should()
          .notExist()
          .check()
      }).toThrow(ArchRuleError)

      expect(() => {
        calls(p)
          .that()
          .onObject('app')
          .and()
          .resideInFolder('**/nonexistent/**')
          .should()
          .notExist()
          .check()
      }).not.toThrow()
    })

    it('.withArgMatching() filters calls by argument text', () => {
      // Argument text includes quotes: '/api/users'
      expect(() => {
        calls(p)
          .that()
          .onObject('app')
          .and()
          .withArgMatching(0, /\/api/)
          .should()
          .notExist()
          .check()
      }).toThrow(ArchRuleError)
    })

    it('.withMethod() with regex matches multiple methods', () => {
      expect(() => {
        calls(p)
          .that()
          .onObject('app')
          .and()
          .withMethod(/^(get|post)$/)
          .should()
          .notExist()
          .check()
      }).toThrow(ArchRuleError)
    })

    it('.notHaveCallbackContaining() passes when callback does NOT contain match', () => {
      expect(() => {
        calls(p)
          .that()
          .onObject('app')
          .and()
          .withMethod('get')
          .and()
          .withStringArg(0, '/api/users')
          .should()
          .notHaveCallbackContaining(call('db.query'))
          .check()
      }).not.toThrow()
    })

    it('.notHaveCallbackContaining() fails when callback DOES contain match', () => {
      expect(() => {
        calls(p)
          .that()
          .onObject('app')
          .and()
          .withMethod('get')
          .and()
          .withStringArg(0, '/api/users')
          .should()
          .notHaveCallbackContaining(call('handleError'))
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('getProject and getMatchedCalls', () => {
    it('getProject() returns the project', () => {
      const builder = calls(p)
      expect(builder.getProject()).toBe(p)
    })

    it('getMatchedCalls() returns ArchCall elements matching predicates', () => {
      const builder = calls(p).that().onObject('app').and().withMethod('get')
      const matched = builder.getMatchedCalls()
      expect(matched.length).toBeGreaterThan(0)
      for (const archCall of matched) {
        expect(archCall.getObjectName()).toBe('app')
        expect(archCall.getMethodName()).toBe('get')
      }
    })

    it('getMatchedCalls() returns empty for non-matching predicates', () => {
      const builder = calls(p).that().onObject('nonexistent')
      const matched = builder.getMatchedCalls()
      expect(matched).toHaveLength(0)
    })
  })
})
