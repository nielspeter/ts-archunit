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

  describe('object literal callback extraction (plan 0039)', () => {
    it('extracts arrow function from object property', () => {
      const callExpr = getFirstCallExpression(`
        app.post('/users', {
          handler: async (req: unknown) => { validateInput(req) },
        })
      `)
      const callbacks = extractCallbacks(callExpr)
      expect(callbacks).toHaveLength(1)
      expect(callbacks[0]!.fn.isAsync()).toBe(true)
    })

    it('extracts function expression from object property', () => {
      const callExpr = getFirstCallExpression(`
        app.post('/orders', {
          handler: function(req: unknown) { return req },
        })
      `)
      const callbacks = extractCallbacks(callExpr)
      expect(callbacks).toHaveLength(1)
    })

    it('extracts method shorthand from object literal', () => {
      const callExpr = getFirstCallExpression(`
        app.get('/health', {
          handler(req: unknown) { return { status: 'ok' } },
        })
      `)
      const callbacks = extractCallbacks(callExpr)
      expect(callbacks).toHaveLength(1)
      expect(callbacks[0]!.fn.getName()).toBe('handler')
    })

    it('extracts nested callbacks (2 levels deep)', () => {
      const callExpr = getFirstCallExpression(`
        app.post('/admin', {
          hooks: {
            onRequest: (req: unknown) => { authenticate(req) },
          },
          handler: async (req: unknown) => { validateInput(req) },
        })
      `)
      const callbacks = extractCallbacks(callExpr)
      // handler + hooks.onRequest
      expect(callbacks).toHaveLength(2)
    })

    it('ignores non-function properties', () => {
      const callExpr = getFirstCallExpression(`
        app.post('/items', {
          schema: { type: 'object', properties: { name: { type: 'string' } } },
          handler: (req: unknown) => req,
        })
      `)
      const callbacks = extractCallbacks(callExpr)
      // Only handler, not schema
      expect(callbacks).toHaveLength(1)
    })

    it('respects depth limit (MAX_OBJECT_DEPTH = 3)', () => {
      const callExpr = getFirstCallExpression(`
        app.post('/deep', {
          schema: {
            response: {
              200: {
                default: () => ({ status: 'ok' }),
              },
            },
          },
          handler: async (req: unknown) => { validateInput(req) },
        })
      `)
      const callbacks = extractCallbacks(callExpr)
      // handler is extracted (depth 0), default at depth 3 is NOT extracted
      expect(callbacks).toHaveLength(1)
      expect(callbacks[0]!.fn.isAsync()).toBe(true)
    })

    it('extracts multiple function properties from same object', () => {
      const callExpr = getFirstCallExpression(`
        app.post('/multi', {
          preHandler: (req: unknown) => { authenticate(req) },
          handler: (req: unknown) => { validateInput(req) },
        })
      `)
      const callbacks = extractCallbacks(callExpr)
      expect(callbacks).toHaveLength(2)
    })

    it('direct inline callbacks still work alongside object extraction', () => {
      const callExpr = getFirstCallExpression(`
        app.get('/mixed', {}, (req: unknown) => { return 'ok' })
      `)
      const callbacks = extractCallbacks(callExpr)
      // Direct callback at index 2
      expect(callbacks).toHaveLength(1)
    })
  })
})
