import { describe, it, expect } from 'vitest'
import { Project, SyntaxKind } from 'ts-morph'
import { fromCallExpression } from '../../src/models/arch-call.js'
import type { ArchCall } from '../../src/models/arch-call.js'
import {
  notExist,
  haveCallbackContaining,
  notHaveCallbackContaining,
} from '../../src/conditions/call.js'
import { call, access, newExpr } from '../../src/helpers/matchers.js'
import type { ConditionContext } from '../../src/core/condition.js'

function makeArchCalls(code: string): ArchCall[] {
  const project = new Project({ useInMemoryFileSystem: true })
  const sf = project.createSourceFile('test.ts', code)
  // Get only top-level call expressions (not nested)
  const allCalls = sf.getDescendantsOfKind(SyntaxKind.CallExpression)
  return allCalls.map((c) => fromCallExpression(c))
}

function makeTopLevelArchCall(code: string): ArchCall {
  const project = new Project({ useInMemoryFileSystem: true })
  const sf = project.createSourceFile('test.ts', code)
  // Get only top-level call expressions
  const statements = sf.getStatements()
  const allCalls: ArchCall[] = []
  for (const stmt of statements) {
    if (stmt.getKind() === SyntaxKind.ExpressionStatement) {
      const expr = stmt.getChildAtIndex(0)
      if (expr.getKind() === SyntaxKind.CallExpression) {
        allCalls.push(fromCallExpression(expr.asKindOrThrow(SyntaxKind.CallExpression)))
      }
    }
  }
  return allCalls[0]!
}

const ctx: ConditionContext = { rule: 'test rule' }

describe('call conditions', () => {
  describe('notExist', () => {
    it('returns a violation for each matching call', () => {
      const calls = makeArchCalls(`app.get('/a', handler)\napp.post('/b', handler)`)
      const appCalls = calls.filter((c) => c.getObjectName() === 'app')
      const violations = notExist().evaluate(appCalls, ctx)
      expect(violations.length).toBeGreaterThanOrEqual(2)
    })

    it('returns empty array when no calls match', () => {
      const violations = notExist().evaluate([], ctx)
      expect(violations).toHaveLength(0)
    })
  })

  describe('haveCallbackContaining', () => {
    it('passes when callback contains the specified call', () => {
      const archCall = makeTopLevelArchCall(`
        app.get('/users', (req, res) => {
          handleError(req, res)
          res.json([])
        })
      `)
      const violations = haveCallbackContaining(call('handleError')).evaluate([archCall], ctx)
      expect(violations).toHaveLength(0)
    })

    it('fails when callback does not contain the specified call', () => {
      const archCall = makeTopLevelArchCall(`
        app.get('/users', (req, res) => {
          res.json([])
        })
      `)
      const violations = haveCallbackContaining(call('handleError')).evaluate([archCall], ctx)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.message).toContain('handleError')
    })

    it('searches all function-like arguments (not just last)', () => {
      const archCall = makeTopLevelArchCall(`
        app.get('/users', (req, res, next) => {
          handleError(req, res)
          next()
        }, (req, res) => {
          res.json([])
        })
      `)
      // handleError is in the first callback
      const violations = haveCallbackContaining(call('handleError')).evaluate([archCall], ctx)
      expect(violations).toHaveLength(0)
    })

    it('handles arrow function callbacks', () => {
      const archCall = makeTopLevelArchCall(`
        app.get('/users', (req, res) => {
          validate(req)
        })
      `)
      const violations = haveCallbackContaining(call('validate')).evaluate([archCall], ctx)
      expect(violations).toHaveLength(0)
    })

    it('handles function expression callbacks', () => {
      const archCall = makeTopLevelArchCall(`
        app.get('/users', function handler(req, res) {
          validate(req)
        })
      `)
      const violations = haveCallbackContaining(call('validate')).evaluate([archCall], ctx)
      expect(violations).toHaveLength(0)
    })

    it('ignores non-function arguments (strings, identifiers)', () => {
      const archCall = makeTopLevelArchCall(`
        app.get('/users', authenticate, (req, res) => {
          res.json([])
        })
      `)
      // `haveCallbackContaining` emits at most ONE violation per ArchCall, so the
      // count here cannot distinguish "the identifier was skipped" from "the
      // identifier was searched and contained nothing" — `authenticate` contains
      // no `handleError` under either reading. Review flagged that the block's
      // name claims more than any assertion over this fixture can show. The
      // skipping property is genuinely covered by `argIndex` at
      // `callback-extractor.test.ts`; what this block actually asserts is the
      // outcome, so it asserts the outcome by identity.
      const violations = haveCallbackContaining(call('handleError')).evaluate([archCall], ctx)
      expect(violations.map((v) => v.element)).toEqual(['app.get'])
    })

    it('works with call() matcher', () => {
      const archCall = makeTopLevelArchCall(`
        app.get('/users', (req, res) => {
          handleError(req, res)
        })
      `)
      expect(haveCallbackContaining(call('handleError')).evaluate([archCall], ctx)).toHaveLength(0)
    })

    it('works with access() matcher', () => {
      const archCall = makeTopLevelArchCall(`
        app.get('/users', (req, res) => {
          const x = process.env
        })
      `)
      expect(haveCallbackContaining(access('process.env')).evaluate([archCall], ctx)).toHaveLength(
        0,
      )
    })

    it('works with newExpr() matcher', () => {
      const archCall = makeTopLevelArchCall(`
        app.get('/users', (req, res) => {
          throw new Error('fail')
        })
      `)
      expect(haveCallbackContaining(newExpr('Error')).evaluate([archCall], ctx)).toHaveLength(0)
    })
  })

  describe('notHaveCallbackContaining', () => {
    it('passes when callback does NOT contain the specified call', () => {
      const archCall = makeTopLevelArchCall(`
        app.get('/users', (req, res) => {
          res.json([])
        })
      `)
      const violations = notHaveCallbackContaining(call('db.query')).evaluate([archCall], ctx)
      expect(violations).toHaveLength(0)
    })

    it('fails with violation for each matching node in callbacks', () => {
      const archCall = makeTopLevelArchCall(`
        app.get('/users', (req, res) => {
          db.query('SELECT 1')
          db.query('SELECT 2')
        })
      `)
      const violations = notHaveCallbackContaining(call('db.query')).evaluate([archCall], ctx)
      // "for each matching node" — two DISTINCT nodes, which a count of 2
      // cannot distinguish from the same node reported twice.
      expect(violations.map((v) => v.message).sort()).toEqual([
        "app.get has callback containing call to 'db.query' at line 3",
        "app.get has callback containing call to 'db.query' at line 4",
      ])
    })

    it('reports correct line numbers for violations', () => {
      const archCall = makeTopLevelArchCall(`
        app.get('/users', (req, res) => {
          db.query('SELECT 1')
        })
      `)
      const violations = notHaveCallbackContaining(call('db.query')).evaluate([archCall], ctx)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.message).toContain('line')
    })
  })
})
