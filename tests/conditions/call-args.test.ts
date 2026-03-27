import { describe, it, expect } from 'vitest'
import { Project, SyntaxKind } from 'ts-morph'
import { fromCallExpression } from '../../src/models/arch-call.js'
import type { ArchCall } from '../../src/models/arch-call.js'
import { haveArgumentWithProperty, notHaveArgumentWithProperty } from '../../src/conditions/call.js'
import type { ConditionContext } from '../../src/core/condition.js'

function makeTopLevelArchCall(code: string): ArchCall {
  const project = new Project({ useInMemoryFileSystem: true })
  const sf = project.createSourceFile('test.ts', code)
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

describe('call argument property conditions', () => {
  describe('haveArgumentWithProperty', () => {
    it('passes when argument has all named properties', () => {
      const archCall = makeTopLevelArchCall(`
        app.get('/users', {
          schema: { response: {} },
          preHandler: [authenticate],
        })
      `)
      const violations = haveArgumentWithProperty('schema', 'preHandler').evaluate([archCall], ctx)
      expect(violations).toHaveLength(0)
    })

    it('fails when argument is missing a property', () => {
      const archCall = makeTopLevelArchCall(`
        app.post('/orders', {
          schema: { body: {} },
        })
      `)
      const violations = haveArgumentWithProperty('schema', 'preHandler').evaluate([archCall], ctx)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.message).toContain('schema')
      expect(violations[0]!.message).toContain('preHandler')
    })

    it('fails when no object literal argument exists', () => {
      const archCall = makeTopLevelArchCall(`
        app.get('/health', (req, res) => {
          res.json({ status: 'ok' })
        })
      `)
      const violations = haveArgumentWithProperty('schema').evaluate([archCall], ctx)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.message).toContain('schema')
    })

    it('works with single name', () => {
      const archCall = makeTopLevelArchCall(`
        app.get('/users', {
          schema: { response: {} },
          preHandler: [authenticate],
        })
      `)
      const violations = haveArgumentWithProperty('schema').evaluate([archCall], ctx)
      expect(violations).toHaveLength(0)
    })

    it('handles shorthand properties', () => {
      const archCall = makeTopLevelArchCall(`
        declare const schema: object
        app.post('/items', {
          schema,
          preHandler: [authenticate],
        })
      `)
      const violations = haveArgumentWithProperty('schema').evaluate([archCall], ctx)
      expect(violations).toHaveLength(0)
    })

    it('throws on zero arguments', () => {
      expect(() => haveArgumentWithProperty()).toThrow(
        'haveArgumentWithProperty requires at least one property name',
      )
    })
  })

  describe('notHaveArgumentWithProperty', () => {
    it('passes when no argument has forbidden property', () => {
      const archCall = makeTopLevelArchCall(`
        app.get('/users', {
          schema: { response: {} },
        })
      `)
      const violations = notHaveArgumentWithProperty('deprecated').evaluate([archCall], ctx)
      expect(violations).toHaveLength(0)
    })

    it('reports violation per forbidden property found', () => {
      const archCall = makeTopLevelArchCall(`
        app.get('/legacy', {
          deprecated: true,
          schema: { response: {} },
        })
      `)
      const violations = notHaveArgumentWithProperty('deprecated').evaluate([archCall], ctx)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.message).toContain('forbidden property "deprecated"')
    })

    it('reports multiple violations for multiple forbidden properties', () => {
      const archCall = makeTopLevelArchCall(`
        app.get('/legacy', {
          deprecated: true,
          internal: true,
        })
      `)
      const violations = notHaveArgumentWithProperty('deprecated', 'internal').evaluate(
        [archCall],
        ctx,
      )
      expect(violations).toHaveLength(2)
    })

    it('throws on zero arguments', () => {
      expect(() => notHaveArgumentWithProperty()).toThrow(
        'notHaveArgumentWithProperty requires at least one property name',
      )
    })
  })
})
