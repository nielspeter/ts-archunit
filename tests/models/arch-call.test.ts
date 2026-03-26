import { describe, it, expect } from 'vitest'
import { Project, SyntaxKind } from 'ts-morph'
import { fromCallExpression, collectCalls } from '../../src/models/arch-call.js'

function getCallExpressions(code: string) {
  const project = new Project({ useInMemoryFileSystem: true })
  const sf = project.createSourceFile('test.ts', code)
  return sf.getDescendantsOfKind(SyntaxKind.CallExpression)
}

describe('ArchCall model', () => {
  describe('fromCallExpression', () => {
    it('getName() returns "app.get" for property access calls', () => {
      const calls = getCallExpressions(`app.get('/users', handler)`)
      const archCall = fromCallExpression(calls[0]!)
      expect(archCall.getName()).toBe('app.get')
    })

    it('getName() returns "handleError" for bare function calls', () => {
      const calls = getCallExpressions(`handleError(err)`)
      const archCall = fromCallExpression(calls[0]!)
      expect(archCall.getName()).toBe('handleError')
    })

    it('getObjectName() returns "app" for app.get()', () => {
      const calls = getCallExpressions(`app.get('/users', handler)`)
      const archCall = fromCallExpression(calls[0]!)
      expect(archCall.getObjectName()).toBe('app')
    })

    it('getObjectName() returns undefined for bare calls', () => {
      const calls = getCallExpressions(`handleError(err)`)
      const archCall = fromCallExpression(calls[0]!)
      expect(archCall.getObjectName()).toBeUndefined()
    })

    it('getMethodName() returns "get" for app.get()', () => {
      const calls = getCallExpressions(`app.get('/users', handler)`)
      const archCall = fromCallExpression(calls[0]!)
      expect(archCall.getMethodName()).toBe('get')
    })

    it('getMethodName() returns "handleError" for bare calls', () => {
      const calls = getCallExpressions(`handleError(err)`)
      const archCall = fromCallExpression(calls[0]!)
      expect(archCall.getMethodName()).toBe('handleError')
    })

    it('getSourceFile() returns the containing source file', () => {
      const calls = getCallExpressions(`app.get('/users', handler)`)
      const archCall = fromCallExpression(calls[0]!)
      expect(archCall.getSourceFile().getBaseName()).toBe('test.ts')
    })

    it('getStartLineNumber() returns correct line number', () => {
      const calls = getCallExpressions(`\n\napp.get('/users', handler)`)
      const archCall = fromCallExpression(calls[0]!)
      expect(archCall.getStartLineNumber()).toBe(3)
    })

    it('getArguments() returns all call arguments', () => {
      const calls = getCallExpressions(`app.get('/users', handler, middleware)`)
      const archCall = fromCallExpression(calls[0]!)
      expect(archCall.getArguments()).toHaveLength(3)
    })

    it('handles chained property access: router.route.get()', () => {
      const calls = getCallExpressions(`router.route.get('/users', handler)`)
      const archCall = fromCallExpression(calls[0]!)
      expect(archCall.getObjectName()).toBe('router.route')
      expect(archCall.getMethodName()).toBe('get')
      expect(archCall.getName()).toBe('router.route.get')
    })

    it('handles optional chaining: app?.get()', () => {
      const calls = getCallExpressions(`app?.get('/users', handler)`)
      const archCall = fromCallExpression(calls[0]!)
      // The raw text includes ?. — normalization is done in predicates
      expect(archCall.getMethodName()).toBe('get')
    })
  })

  describe('collectCalls', () => {
    it('collects all call expressions from a source file', () => {
      const project = new Project({ useInMemoryFileSystem: true })
      const sf = project.createSourceFile(
        'test.ts',
        `
        app.get('/a', handler)
        app.post('/b', handler)
        console.log('hello')
      `,
      )
      const calls = collectCalls(sf)
      expect(calls).toHaveLength(3)
    })

    it('includes nested calls inside callbacks', () => {
      const project = new Project({ useInMemoryFileSystem: true })
      const sf = project.createSourceFile(
        'test.ts',
        `
        app.get('/a', () => {
          handleError()
        })
      `,
      )
      const calls = collectCalls(sf)
      // app.get(...) and handleError() inside the callback
      expect(calls.length).toBeGreaterThanOrEqual(2)
    })

    it('returns empty array for files with no calls', () => {
      const project = new Project({ useInMemoryFileSystem: true })
      const sf = project.createSourceFile(
        'test.ts',
        `
        const x = 42
        const y = 'hello'
      `,
      )
      const calls = collectCalls(sf)
      expect(calls).toHaveLength(0)
    })
  })
})
