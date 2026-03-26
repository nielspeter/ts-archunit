import { describe, it, expect } from 'vitest'
import { Project, SyntaxKind } from 'ts-morph'
import { extractCallbacks } from '../../src/helpers/callback-extractor.js'

function getFirstCallExpression(code: string) {
  const project = new Project({ useInMemoryFileSystem: true })
  const sf = project.createSourceFile('test.ts', code)
  // Get only the first top-level call expression (not nested ones)
  const statements = sf.getStatements()
  for (const stmt of statements) {
    if (stmt.getKind() === SyntaxKind.ExpressionStatement) {
      const expr = stmt.getChildAtIndex(0)
      if (expr.getKind() === SyntaxKind.CallExpression) {
        return expr.asKindOrThrow(SyntaxKind.CallExpression)
      }
    }
  }
  // Fallback: first call expression in file
  return sf.getDescendantsOfKind(SyntaxKind.CallExpression)[0]!
}

describe('extractCallbacks', () => {
  it('extracts arrow function callbacks', () => {
    const callExpr = getFirstCallExpression(`
      app.get('/users', (req, res) => {
        res.json([])
      })
    `)
    const callbacks = extractCallbacks(callExpr)
    expect(callbacks).toHaveLength(1)
    expect(callbacks[0]!.argIndex).toBe(1)
    expect(callbacks[0]!.fn.isAsync()).toBe(false)
    expect(callbacks[0]!.fn.getParameters()).toHaveLength(2)
  })

  it('extracts async arrow function callbacks', () => {
    const callExpr = getFirstCallExpression(`
      app.post('/orders', async (req, res) => {
        await createOrder(req.body)
      })
    `)
    const callbacks = extractCallbacks(callExpr)
    expect(callbacks).toHaveLength(1)
    expect(callbacks[0]!.fn.isAsync()).toBe(true)
  })

  it('extracts function expression callbacks', () => {
    const callExpr = getFirstCallExpression(`
      app.get('/items', function handler(req, res) {
        res.json([])
      })
    `)
    const callbacks = extractCallbacks(callExpr)
    expect(callbacks).toHaveLength(1)
    expect(callbacks[0]!.fn.getName()).toBe('handler')
  })

  it('extracts multiple callbacks from a single call', () => {
    const callExpr = getFirstCallExpression(`
      app.get('/users', (req, res, next) => { next() }, (req, res) => {
        res.json([])
      })
    `)
    const callbacks = extractCallbacks(callExpr)
    expect(callbacks).toHaveLength(2)
    expect(callbacks[0]!.argIndex).toBe(1)
    expect(callbacks[1]!.argIndex).toBe(2)
  })

  it('ignores non-function arguments', () => {
    const callExpr = getFirstCallExpression(`
      app.get('/users', authenticate, (req, res) => { res.json([]) })
    `)
    const callbacks = extractCallbacks(callExpr)
    // 'authenticate' is an identifier, not an inline function --- skipped
    expect(callbacks).toHaveLength(1)
    expect(callbacks[0]!.argIndex).toBe(2)
  })

  it('returns empty array for calls with no function arguments', () => {
    const callExpr = getFirstCallExpression(`
      console.log('hello', 42, true)
    `)
    const callbacks = extractCallbacks(callExpr)
    expect(callbacks).toHaveLength(0)
  })

  it('extracts body for body analysis', () => {
    const callExpr = getFirstCallExpression(`
      app.get('/users', async (req, res) => {
        const data = normalizePagination(req.query)
        res.json(data)
      })
    `)
    const callbacks = extractCallbacks(callExpr)
    const body = callbacks[0]!.fn.getBody()
    expect(body).toBeDefined()
    // Body should contain the normalizePagination call
    const bodyText = body!.getText()
    expect(bodyText).toContain('normalizePagination')
  })

  it('anonymous arrow callbacks have getName() returning undefined', () => {
    const callExpr = getFirstCallExpression(`
      app.get('/test', (req, res) => { res.send('ok') })
    `)
    const callbacks = extractCallbacks(callExpr)
    expect(callbacks[0]!.fn.getName()).toBeUndefined()
  })

  it('callbacks are never exported', () => {
    const callExpr = getFirstCallExpression(`
      app.get('/test', (req, res) => { res.send('ok') })
    `)
    const callbacks = extractCallbacks(callExpr)
    expect(callbacks[0]!.fn.isExported()).toBe(false)
  })

  it('callSite reference points back to original call expression', () => {
    const callExpr = getFirstCallExpression(`
      app.get('/test', (req, res) => { res.send('ok') })
    `)
    const callbacks = extractCallbacks(callExpr)
    expect(callbacks[0]!.callSite).toBe(callExpr)
  })
})
