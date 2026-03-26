import { describe, it, expect } from 'vitest'
import { Project, SyntaxKind } from 'ts-morph'
import { fromCallExpression } from '../../src/models/arch-call.js'
import { onObject, withMethod, withArgMatching, withStringArg } from '../../src/predicates/call.js'

function makeArchCall(code: string) {
  const project = new Project({ useInMemoryFileSystem: true })
  const sf = project.createSourceFile('test.ts', code)
  const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression)
  return fromCallExpression(calls[0]!)
}

describe('call predicates', () => {
  describe('onObject', () => {
    it('matches calls on the specified object', () => {
      const archCall = makeArchCall(`app.get('/users', handler)`)
      expect(onObject('app').test(archCall)).toBe(true)
    })

    it('does not match calls on a different object', () => {
      const archCall = makeArchCall(`app.get('/users', handler)`)
      expect(onObject('router').test(archCall)).toBe(false)
    })

    it('does not match bare function calls (no object)', () => {
      const archCall = makeArchCall(`handleError(err)`)
      expect(onObject('handleError').test(archCall)).toBe(false)
    })

    it('normalizes optional chaining: app?.get matches onObject("app")', () => {
      const archCall = makeArchCall(`app?.get('/users', handler)`)
      expect(onObject('app').test(archCall)).toBe(true)
    })

    it('handles chained objects: router.route matches onObject("router.route")', () => {
      const archCall = makeArchCall(`router.route.get('/path', handler)`)
      expect(onObject('router.route').test(archCall)).toBe(true)
    })
  })

  describe('withMethod', () => {
    it('string: matches exact method name', () => {
      const archCall = makeArchCall(`app.get('/users', handler)`)
      expect(withMethod('get').test(archCall)).toBe(true)
    })

    it('string: does not match different method name', () => {
      const archCall = makeArchCall(`app.get('/users', handler)`)
      expect(withMethod('post').test(archCall)).toBe(false)
    })

    it('regex: matches method name against pattern', () => {
      const archCall = makeArchCall(`app.get('/users', handler)`)
      expect(withMethod(/^(get|post)$/).test(archCall)).toBe(true)
    })

    it('regex: /^(get|post)$/ matches get and post, not getAll', () => {
      const getAll = makeArchCall(`app.getAll('/users')`)
      expect(withMethod(/^(get|post)$/).test(getAll)).toBe(false)
    })

    it('matches bare function name when no object', () => {
      const archCall = makeArchCall(`handleError(err)`)
      expect(withMethod('handleError').test(archCall)).toBe(true)
    })
  })

  describe('withArgMatching', () => {
    it('matches argument text at given index against regex', () => {
      const archCall = makeArchCall(`app.get('/api/users', handler)`)
      expect(withArgMatching(0, '/api/').test(archCall)).toBe(true)
    })

    it('does not match when index is out of bounds', () => {
      const archCall = makeArchCall(`app.get('/api/users')`)
      expect(withArgMatching(5, '/api/').test(archCall)).toBe(false)
    })

    it('matches string literal arguments', () => {
      const archCall = makeArchCall(`app.get('/users', handler)`)
      expect(withArgMatching(0, "'/users'").test(archCall)).toBe(true)
    })

    it('matches variable reference arguments', () => {
      const archCall = makeArchCall(`app.get(myPath, handler)`)
      expect(withArgMatching(0, 'myPath').test(archCall)).toBe(true)
    })
  })

  describe('withStringArg', () => {
    it('matches string literal at given index against glob', () => {
      const archCall = makeArchCall(`app.get('/api/users', handler)`)
      expect(withStringArg(0, '/api/**').test(archCall)).toBe(true)
    })

    it('glob "/api/users/**" matches "/api/users/123"', () => {
      const archCall = makeArchCall(`app.get('/api/users/123', handler)`)
      expect(withStringArg(0, '/api/users/**').test(archCall)).toBe(true)
    })

    it('does not match non-string-literal arguments', () => {
      const archCall = makeArchCall(`app.get(pathVariable, handler)`)
      expect(withStringArg(0, '/api/**').test(archCall)).toBe(false)
    })

    it('does not match when index is out of bounds', () => {
      const archCall = makeArchCall(`app.get('/api/users')`)
      expect(withStringArg(5, '/api/**').test(archCall)).toBe(false)
    })

    it('does not match template literals with substitutions', () => {
      const archCall = makeArchCall('app.get(`/api/${version}/users`, handler)')
      expect(withStringArg(0, '/api/**').test(archCall)).toBe(false)
    })
  })

  describe('combined predicates', () => {
    it('onObject("app").withMethod("get") narrows correctly', () => {
      const archCall = makeArchCall(`app.get('/users', handler)`)
      expect(onObject('app').test(archCall) && withMethod('get').test(archCall)).toBe(true)
    })

    it('triple filter: onObject + withMethod + withStringArg', () => {
      const archCall = makeArchCall(`app.get('/api/users', handler)`)
      expect(
        onObject('app').test(archCall) &&
          withMethod('get').test(archCall) &&
          withStringArg(0, '/api/**').test(archCall),
      ).toBe(true)
    })
  })
})
