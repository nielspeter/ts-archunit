import { describe, it, expect } from 'vitest'
import { Project, SyntaxKind } from 'ts-morph'
import { fromCallExpression } from '../../src/models/arch-call.js'
import type { ArchCall } from '../../src/models/arch-call.js'
import {
  haveArgumentWithProperty,
  notHaveArgumentWithProperty,
  haveArgumentContaining,
  notHaveArgumentContaining,
} from '../../src/conditions/call.js'
import { property, call } from '../../src/helpers/matchers.js'
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

  describe('haveArgumentContaining', () => {
    it('passes when argument contains matching property at top level', () => {
      const archCall = makeTopLevelArchCall(`
        app.post('/items', {
          additionalProperties: true,
        })
      `)
      const violations = haveArgumentContaining(property('additionalProperties', true)).evaluate(
        [archCall],
        ctx,
      )
      expect(violations).toHaveLength(0)
    })

    it('passes when nested argument contains matching property', () => {
      const archCall = makeTopLevelArchCall(`
        app.post('/users', {
          schema: {
            body: {
              type: 'object',
              additionalProperties: true,
            },
          },
        })
      `)
      const violations = haveArgumentContaining(property('additionalProperties', true)).evaluate(
        [archCall],
        ctx,
      )
      expect(violations).toHaveLength(0)
    })

    it('fails when no argument contains match', () => {
      const archCall = makeTopLevelArchCall(`
        app.get('/health', {
          schema: { response: {} },
        })
      `)
      const violations = haveArgumentContaining(property('additionalProperties', true)).evaluate(
        [archCall],
        ctx,
      )
      expect(violations).toHaveLength(1)
      expect(violations[0]!.message).toContain("property 'additionalProperties' = true")
    })

    it('fails when value does not match', () => {
      const archCall = makeTopLevelArchCall(`
        app.post('/orders', {
          additionalProperties: false,
        })
      `)
      const violations = haveArgumentContaining(property('additionalProperties', true)).evaluate(
        [archCall],
        ctx,
      )
      expect(violations).toHaveLength(1)
    })

    it('works with any ExpressionMatcher, not just property()', () => {
      const archCall = makeTopLevelArchCall(`
        fn({ handler: validate() })
      `)
      const violations = haveArgumentContaining(call('validate')).evaluate([archCall], ctx)
      expect(violations).toHaveLength(0)
    })
  })

  describe('notHaveArgumentContaining', () => {
    it('passes when no argument contains match', () => {
      const archCall = makeTopLevelArchCall(`
        app.post('/orders', {
          additionalProperties: false,
        })
      `)
      const violations = notHaveArgumentContaining(property('additionalProperties', true)).evaluate(
        [archCall],
        ctx,
      )
      expect(violations).toHaveLength(0)
    })

    it('reports violation per match found', () => {
      const archCall = makeTopLevelArchCall(`
        app.post('/users', {
          schema: {
            body: {
              additionalProperties: true,
              properties: {
                metadata: {
                  additionalProperties: true,
                },
              },
            },
          },
        })
      `)
      const violations = notHaveArgumentContaining(property('additionalProperties', true)).evaluate(
        [archCall],
        ctx,
      )
      expect(violations).toHaveLength(2)
    })

    it('reports correct line number in violation', () => {
      const archCall = makeTopLevelArchCall(`
        app.post('/items', {
          additionalProperties: true,
        })
      `)
      const violations = notHaveArgumentContaining(property('additionalProperties', true)).evaluate(
        [archCall],
        ctx,
      )
      expect(violations).toHaveLength(1)
      expect(violations[0]!.message).toContain('at line')
    })

    it('finds deeply nested properties (3 levels)', () => {
      const archCall = makeTopLevelArchCall(`
        app.post('/deep', {
          level1: {
            level2: {
              level3: {
                additionalProperties: true,
              },
            },
          },
        })
      `)
      const violations = notHaveArgumentContaining(property('additionalProperties', true)).evaluate(
        [archCall],
        ctx,
      )
      expect(violations).toHaveLength(1)
    })

    it('works with call() matcher in arguments', () => {
      const archCall = makeTopLevelArchCall(`
        fn({ handler: validate() })
      `)
      const violations = notHaveArgumentContaining(call('validate')).evaluate([archCall], ctx)
      expect(violations).toHaveLength(1)
    })
  })
})
