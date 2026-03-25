import { describe, it, expect } from 'vitest'
import { Project, SyntaxKind } from 'ts-morph'
import path from 'node:path'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')

describe('Probe 2: Body Analysis — inspect method bodies for calls and constructors', () => {
  const project = new Project({
    tsConfigFilePath: path.join(fixturesDir, 'tsconfig.json'),
  })

  // Helper: find classes extending a given base class name
  function findSubclasses(baseName: string) {
    return project
      .getSourceFiles()
      .flatMap((sf) => sf.getClasses())
      .filter((cls) => cls.getExtends()?.getExpression().getText() === baseName)
  }

  // Helper: find CallExpression by expression text in a method
  function findCalls(cls: ReturnType<typeof findSubclasses>[number], methodName: string) {
    const method = cls.getMethod(methodName)
    if (!method) return []
    return method.getDescendantsOfKind(SyntaxKind.CallExpression)
  }

  // Helper: find NewExpression by expression text in a method
  function findNewExprs(cls: ReturnType<typeof findSubclasses>[number], methodName: string) {
    const method = cls.getMethod(methodName)
    if (!method) return []
    return method.getDescendantsOfKind(SyntaxKind.NewExpression)
  }

  describe('finding classes by extends', () => {
    it('finds all BaseService subclasses', () => {
      const subclasses = findSubclasses('BaseService')
      const names = subclasses.map((cls) => cls.getName())
      expect(names).toContain('OrderService')
      expect(names).toContain('ProductService')
      expect(names).toContain('EdgeCaseService')
      expect(names).toHaveLength(3)
    })
  })

  describe('CallExpression matching', () => {
    it('finds parseInt in ProductService.getTotal()', () => {
      const [productService] = findSubclasses('BaseService').filter(
        (cls) => cls.getName() === 'ProductService',
      )
      expect(productService).toBeDefined()

      const calls = findCalls(productService!, 'getTotal')
      const callTexts = calls.map((c) => c.getExpression().getText())
      expect(callTexts).toContain('parseInt')
    })

    it('finds this.normalizeCount in OrderService.getTotal()', () => {
      const [orderService] = findSubclasses('BaseService').filter(
        (cls) => cls.getName() === 'OrderService',
      )
      expect(orderService).toBeDefined()

      const calls = findCalls(orderService!, 'getTotal')
      const callTexts = calls.map((c) => c.getExpression().getText())
      expect(callTexts).toContain('this.normalizeCount')
    })

    it('does NOT find parseInt in OrderService.getTotal()', () => {
      const [orderService] = findSubclasses('BaseService').filter(
        (cls) => cls.getName() === 'OrderService',
      )
      expect(orderService).toBeDefined()

      const calls = findCalls(orderService!, 'getTotal')
      const callTexts = calls.map((c) => c.getExpression().getText())
      expect(callTexts).not.toContain('parseInt')
    })

    it('documents optional chaining getText() behavior', () => {
      const [edgeCase] = findSubclasses('BaseService').filter(
        (cls) => cls.getName() === 'EdgeCaseService',
      )
      expect(edgeCase).toBeDefined()

      const calls = findCalls(edgeCase!, 'withOptionalChain')
      const callTexts = calls.map((c) => c.getExpression().getText())

      // Document what getText() returns for this?.normalizeCount(result)
      // This tells us whether we need special handling for optional chaining
      const hasOptionalText = callTexts.some((t) => t.includes('normalizeCount'))
      expect(hasOptionalText).toBe(true)

      // Log the exact text for findings
      console.warn('[Probe 2] Optional chaining getText():', callTexts)
    })

    it('destructured call does NOT have this. prefix', () => {
      const [edgeCase] = findSubclasses('BaseService').filter(
        (cls) => cls.getName() === 'EdgeCaseService',
      )
      expect(edgeCase).toBeDefined()

      const calls = findCalls(edgeCase!, 'withDestructuring')
      const callTexts = calls.map((c) => c.getExpression().getText())

      // Should NOT contain 'this.normalizeCount' — it's destructured
      expect(callTexts).not.toContain('this.normalizeCount')

      // Log what it IS for findings
      console.warn('[Probe 2] Destructured call getText():', callTexts)
    })

    it('finds parseInt even when nested inside other calls', () => {
      const [edgeCase] = findSubclasses('BaseService').filter(
        (cls) => cls.getName() === 'EdgeCaseService',
      )
      expect(edgeCase).toBeDefined()

      const calls = findCalls(edgeCase!, 'withNesting')
      const callTexts = calls.map((c) => c.getExpression().getText())
      expect(callTexts).toContain('parseInt')
    })
  })

  describe('NewExpression matching', () => {
    it('finds new Error in ProductService.findById()', () => {
      const [productService] = findSubclasses('BaseService').filter(
        (cls) => cls.getName() === 'ProductService',
      )
      expect(productService).toBeDefined()

      const newExprs = findNewExprs(productService!, 'findById')
      const exprTexts = newExprs.map((n) => n.getExpression().getText())
      expect(exprTexts).toContain('Error')
    })

    it('finds new DomainError (not Error) in OrderService.findById()', () => {
      const [orderService] = findSubclasses('BaseService').filter(
        (cls) => cls.getName() === 'OrderService',
      )
      expect(orderService).toBeDefined()

      const newExprs = findNewExprs(orderService!, 'findById')
      const exprTexts = newExprs.map((n) => n.getExpression().getText())
      expect(exprTexts).toContain('DomainError')
      expect(exprTexts).not.toContain('Error')
    })

    it('finds new URLSearchParams in ProductService.buildUrl()', () => {
      const [productService] = findSubclasses('BaseService').filter(
        (cls) => cls.getName() === 'ProductService',
      )
      expect(productService).toBeDefined()

      const newExprs = findNewExprs(productService!, 'buildUrl')
      const exprTexts = newExprs.map((n) => n.getExpression().getText())
      expect(exprTexts).toContain('URLSearchParams')
    })

    it('OrderService has no Error or URLSearchParams constructors', () => {
      const [orderService] = findSubclasses('BaseService').filter(
        (cls) => cls.getName() === 'OrderService',
      )
      expect(orderService).toBeDefined()

      const allNewExprs = orderService!
        .getMethods()
        .flatMap((m) => m.getDescendantsOfKind(SyntaxKind.NewExpression))
        .map((n) => n.getExpression().getText())

      expect(allNewExprs).not.toContain('Error')
      expect(allNewExprs).not.toContain('URLSearchParams')
    })

    it('finds multiple violations in EdgeCaseService.withMultiple()', () => {
      const [edgeCase] = findSubclasses('BaseService').filter(
        (cls) => cls.getName() === 'EdgeCaseService',
      )
      expect(edgeCase).toBeDefined()

      const calls = findCalls(edgeCase!, 'withMultiple')
      const callTexts = calls.map((c) => c.getExpression().getText())
      expect(callTexts).toContain('parseInt')

      const newExprs = findNewExprs(edgeCase!, 'withMultiple')
      const newTexts = newExprs.map((n) => n.getExpression().getText())
      expect(newTexts).toContain('URLSearchParams')
      expect(newTexts).toContain('Error')
    })
  })
})
