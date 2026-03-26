import { describe, it, expect } from 'vitest'
import { Project, SyntaxKind } from 'ts-morph'
import path from 'node:path'
import { call, access, newExpr, expression } from '../../src/helpers/matchers.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')

describe('ExpressionMatcher helpers', () => {
  const project = new Project({
    tsConfigFilePath: path.join(fixturesDir, 'tsconfig.json'),
  })

  // Get a known CallExpression node for testing
  function getCallNode(className: string, methodName: string, callText: string) {
    const cls = project
      .getSourceFiles()
      .flatMap((sf) => sf.getClasses())
      .find((c) => c.getName() === className)!
    const method = cls.getMethod(methodName)!
    return method
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .find((c) => c.getExpression().getText() === callText)!
  }

  function getNewExprNode(className: string, methodName: string, ctorText: string) {
    const cls = project
      .getSourceFiles()
      .flatMap((sf) => sf.getClasses())
      .find((c) => c.getName() === className)!
    const method = cls.getMethod(methodName)!
    return method
      .getDescendantsOfKind(SyntaxKind.NewExpression)
      .find((n) => n.getExpression().getText() === ctorText)!
  }

  describe('call()', () => {
    it('matches parseInt CallExpression with exact string', () => {
      const node = getCallNode('ProductService', 'getTotal', 'parseInt')
      expect(call('parseInt').matches(node)).toBe(true)
    })

    it('rejects non-matching call name', () => {
      const node = getCallNode('ProductService', 'getTotal', 'parseInt')
      expect(call('parseFloat').matches(node)).toBe(false)
    })

    it('matches this.normalizeCount with exact string', () => {
      const node = getCallNode('OrderService', 'getTotal', 'this.normalizeCount')
      expect(call('this.normalizeCount').matches(node)).toBe(true)
    })

    it('normalizes optional chaining: this?.normalizeCount matches this.normalizeCount', () => {
      // EdgeCaseService.withOptionalChain calls this?.normalizeCount
      const cls = project
        .getSourceFiles()
        .flatMap((sf) => sf.getClasses())
        .find((c) => c.getName() === 'EdgeCaseService')!
      const method = cls.getMethod('withOptionalChain')!
      const calls = method.getDescendantsOfKind(SyntaxKind.CallExpression)
      const optionalCall = calls.find((c) =>
        c.getExpression().getText().includes('normalizeCount'),
      )!
      // User writes 'this.normalizeCount' — should match optional chaining too
      expect(call('this.normalizeCount').matches(optionalCall)).toBe(true)
    })

    it('matches with regex', () => {
      const node = getCallNode('ProductService', 'getTotal', 'parseInt')
      expect(call(/^parse/).matches(node)).toBe(true)
    })

    it('regex does not match unrelated call', () => {
      const node = getCallNode('OrderService', 'getTotal', 'this.normalizeCount')
      expect(call(/^parse/).matches(node)).toBe(false)
    })

    it('does not match NewExpression nodes', () => {
      const node = getNewExprNode('ProductService', 'findById', 'Error')
      expect(call('Error').matches(node)).toBe(false)
    })

    it('has syntaxKinds for CallExpression', () => {
      expect(call('foo').syntaxKinds).toEqual([SyntaxKind.CallExpression])
    })

    it('has meaningful description for string', () => {
      expect(call('parseInt').description).toBe("call to 'parseInt'")
    })

    it('has meaningful description for regex', () => {
      expect(call(/^parse/).description).toBe('call matching /^parse/')
    })
  })

  describe('newExpr()', () => {
    it('matches new Error with exact string', () => {
      const node = getNewExprNode('ProductService', 'findById', 'Error')
      expect(newExpr('Error').matches(node)).toBe(true)
    })

    it('distinguishes Error from DomainError', () => {
      const node = getNewExprNode('OrderService', 'findById', 'DomainError')
      expect(newExpr('Error').matches(node)).toBe(false)
      expect(newExpr('DomainError').matches(node)).toBe(true)
    })

    it('matches with regex', () => {
      const node = getNewExprNode('OrderService', 'findById', 'DomainError')
      expect(newExpr(/Error$/).matches(node)).toBe(true)
    })

    it('does not match CallExpression nodes', () => {
      const node = getCallNode('ProductService', 'getTotal', 'parseInt')
      expect(newExpr('parseInt').matches(node)).toBe(false)
    })

    it('has syntaxKinds for NewExpression', () => {
      expect(newExpr('Error').syntaxKinds).toEqual([SyntaxKind.NewExpression])
    })
  })

  describe('access()', () => {
    it('has syntaxKinds for PropertyAccessExpression', () => {
      expect(access('process.env').syntaxKinds).toEqual([SyntaxKind.PropertyAccessExpression])
    })

    it('has meaningful description', () => {
      expect(access('process.env').description).toBe("access to 'process.env'")
    })
  })

  describe('expression()', () => {
    it('has no syntaxKinds (walks all nodes)', () => {
      expect(expression('eval').syntaxKinds).toBeUndefined()
    })

    it('has meaningful description for string', () => {
      expect(expression('eval').description).toBe("expression containing 'eval'")
    })

    it('has meaningful description for regex', () => {
      expect(expression(/eval/).description).toBe('expression matching /eval/')
    })
  })
})
