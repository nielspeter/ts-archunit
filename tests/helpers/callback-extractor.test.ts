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
      // The DOTTED path, which is what `fromObjectLiteralFunction` produces for the
      // same node at the other call site. Plan 0082 chose to match it rather than
      // pin a bare `onRequest`: two surfaces disagreeing about one node's identity
      // would make `.excluding()` patterns depend on which surface reported.
      expect(callbacks.map((c) => c.fn.getName()).sort()).toEqual(['handler', 'hooks.onRequest'])
    })

    it('ignores non-function properties', () => {
      const callExpr = getFirstCallExpression(`
        app.post('/items', {
          schema: { type: 'object', properties: { name: { type: 'string' } } },
          handler: (req: unknown) => req,
        })
      `)
      const callbacks = extractCallbacks(callExpr)
      // Not `schema` — which a length-1 assertion could not tell apart.
      expect(callbacks.map((c) => c.fn.getName())).toEqual(['handler'])
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
      // `handler` at depth 0, NOT `default` at depth 3 — and the count could not
      // tell those apart, since extracting the wrong one is also one callback.
      // This block was hidden from plan 0079's scan by an over-broad
      // element-boolean signal, and surfaced by the false-negative check a review
      // asked for. It is the only class C the correction found.
      expect(callbacks.map((c) => c.fn.getName())).toEqual(['handler'])
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
      expect(callbacks.map((c) => c.fn.getName()).sort()).toEqual(['handler', 'preHandler'])
    })

    it('direct inline callbacks still work alongside object extraction', () => {
      const callExpr = getFirstCallExpression(`
        app.get('/mixed', {}, (req: unknown) => { return 'ok' })
      `)
      const callbacks = extractCallbacks(callExpr)
      // The slot matters: `{}` sits at index 1 and must not be extracted.
      // A POSITIONAL callback has no name, and that is the honest answer rather
      // than a defect — `argIndex` is its identity. Asserted so the absent case is
      // pinned, not assumed (plan 0082, test inventory row 2).
      expect(callbacks.map((c) => c.fn.getName())).toEqual([undefined])
      expect(callbacks.map((c) => c.argIndex)).toEqual([2])
    })
  })

  describe('ArchFunction wrapper methods — arrow functions', () => {
    it('getSourceFile returns the source file containing the arrow', () => {
      const callExpr = getFirstCallExpression(`
        app.get('/test', (req, res) => { res.send('ok') })
      `)
      const callbacks = extractCallbacks(callExpr)
      const sf = callbacks[0]!.fn.getSourceFile()
      expect(sf.getFilePath()).toContain('test.ts')
    })

    it('getReturnType returns the return type of the arrow', () => {
      const callExpr = getFirstCallExpression(`
        app.get('/test', (x: number) => x + 1)
      `)
      const callbacks = extractCallbacks(callExpr)
      const returnType = callbacks[0]!.fn.getReturnType()
      expect(returnType).toBeDefined()
    })

    it('getStartLineNumber returns a positive line number', () => {
      const callExpr = getFirstCallExpression(`
        app.get('/test', (req, res) => { res.send('ok') })
      `)
      const callbacks = extractCallbacks(callExpr)
      expect(callbacks[0]!.fn.getStartLineNumber()).toBeGreaterThan(0)
    })

    it('getScope always returns public for callbacks', () => {
      const callExpr = getFirstCallExpression(`
        app.get('/test', (req, res) => { res.send('ok') })
      `)
      const callbacks = extractCallbacks(callExpr)
      expect(callbacks[0]!.fn.getScope()).toBe('public')
    })

    it('getNode returns the arrow function node', () => {
      const callExpr = getFirstCallExpression(`
        app.get('/test', (req, res) => { res.send('ok') })
      `)
      const callbacks = extractCallbacks(callExpr)
      const node = callbacks[0]!.fn.getNode()
      expect(node.getKind()).toBe(SyntaxKind.ArrowFunction)
    })
  })

  describe('ArchFunction wrapper methods — function expressions', () => {
    it('getSourceFile returns the source file', () => {
      const callExpr = getFirstCallExpression(`
        app.get('/test', function handler(req, res) { res.send('ok') })
      `)
      const callbacks = extractCallbacks(callExpr)
      const sf = callbacks[0]!.fn.getSourceFile()
      expect(sf.getFilePath()).toContain('test.ts')
    })

    it('getReturnType returns the return type', () => {
      const callExpr = getFirstCallExpression(`
        app.get('/test', function(x: number) { return x + 1 })
      `)
      const callbacks = extractCallbacks(callExpr)
      const returnType = callbacks[0]!.fn.getReturnType()
      expect(returnType).toBeDefined()
    })

    it('getStartLineNumber returns a positive line number', () => {
      const callExpr = getFirstCallExpression(`
        app.get('/test', function(req, res) { res.send('ok') })
      `)
      const callbacks = extractCallbacks(callExpr)
      expect(callbacks[0]!.fn.getStartLineNumber()).toBeGreaterThan(0)
    })

    it('getScope always returns public', () => {
      const callExpr = getFirstCallExpression(`
        app.get('/test', function(req, res) { res.send('ok') })
      `)
      const callbacks = extractCallbacks(callExpr)
      expect(callbacks[0]!.fn.getScope()).toBe('public')
    })

    it('getNode returns the function expression node', () => {
      const callExpr = getFirstCallExpression(`
        app.get('/test', function handler(req, res) { res.send('ok') })
      `)
      const callbacks = extractCallbacks(callExpr)
      const node = callbacks[0]!.fn.getNode()
      expect(node.getKind()).toBe(SyntaxKind.FunctionExpression)
    })

    it('getName returns undefined for anonymous function expressions', () => {
      const callExpr = getFirstCallExpression(`
        app.get('/test', function(req, res) { res.send('ok') })
      `)
      const callbacks = extractCallbacks(callExpr)
      expect(callbacks[0]!.fn.getName()).toBeUndefined()
    })

    it('isAsync detects async function expressions', () => {
      const callExpr = getFirstCallExpression(`
        app.get('/test', async function(req, res) { await fetch('/api') })
      `)
      const callbacks = extractCallbacks(callExpr)
      expect(callbacks[0]!.fn.isAsync()).toBe(true)
    })

    it('isExported returns false for function expression callbacks', () => {
      const callExpr = getFirstCallExpression(`
        app.get('/test', function handler(req, res) { res.send('ok') })
      `)
      const callbacks = extractCallbacks(callExpr)
      expect(callbacks[0]!.fn.isExported()).toBe(false)
    })

    it('getBody returns the function body', () => {
      const callExpr = getFirstCallExpression(`
        app.get('/test', function(req, res) { res.send('hello') })
      `)
      const callbacks = extractCallbacks(callExpr)
      const body = callbacks[0]!.fn.getBody()
      expect(body).toBeDefined()
      expect(body!.getText()).toContain('hello')
    })

    it('getParameters returns parameters list', () => {
      const callExpr = getFirstCallExpression(`
        app.get('/test', function(a, b, c) { return a })
      `)
      const callbacks = extractCallbacks(callExpr)
      expect(callbacks[0]!.fn.getParameters()).toHaveLength(3)
    })
  })

  describe('ArchFunction wrapper methods — method declarations', () => {
    it('getSourceFile returns the source file', () => {
      const callExpr = getFirstCallExpression(`
        app.get('/test', { handler(req, res) { res.send('ok') } })
      `)
      const callbacks = extractCallbacks(callExpr)
      const sf = callbacks[0]!.fn.getSourceFile()
      expect(sf.getFilePath()).toContain('test.ts')
    })

    it('getReturnType returns the return type', () => {
      const callExpr = getFirstCallExpression(`
        app.get('/test', { compute(x: number) { return x * 2 } })
      `)
      const callbacks = extractCallbacks(callExpr)
      const returnType = callbacks[0]!.fn.getReturnType()
      expect(returnType).toBeDefined()
    })

    it('getStartLineNumber returns a positive line number', () => {
      const callExpr = getFirstCallExpression(`
        app.get('/test', { handler(req, res) { res.send('ok') } })
      `)
      const callbacks = extractCallbacks(callExpr)
      expect(callbacks[0]!.fn.getStartLineNumber()).toBeGreaterThan(0)
    })

    it('getScope always returns public', () => {
      const callExpr = getFirstCallExpression(`
        app.get('/test', { handler(req, res) { res.send('ok') } })
      `)
      const callbacks = extractCallbacks(callExpr)
      expect(callbacks[0]!.fn.getScope()).toBe('public')
    })

    it('getNode returns the method declaration node', () => {
      const callExpr = getFirstCallExpression(`
        app.get('/test', { handler(req, res) { res.send('ok') } })
      `)
      const callbacks = extractCallbacks(callExpr)
      const node = callbacks[0]!.fn.getNode()
      expect(node.getKind()).toBe(SyntaxKind.MethodDeclaration)
    })

    it('getName returns the method name', () => {
      const callExpr = getFirstCallExpression(`
        app.get('/test', { myHandler(req, res) { res.send('ok') } })
      `)
      const callbacks = extractCallbacks(callExpr)
      expect(callbacks[0]!.fn.getName()).toBe('myHandler')
    })

    it('isAsync detects async methods', () => {
      const callExpr = getFirstCallExpression(`
        app.get('/test', { async handler(req, res) { await fetch('/api') } })
      `)
      const callbacks = extractCallbacks(callExpr)
      expect(callbacks[0]!.fn.isAsync()).toBe(true)
    })

    it('isExported returns false for method declaration callbacks', () => {
      const callExpr = getFirstCallExpression(`
        app.get('/test', { handler(req, res) { res.send('ok') } })
      `)
      const callbacks = extractCallbacks(callExpr)
      expect(callbacks[0]!.fn.isExported()).toBe(false)
    })

    it('getBody returns the method body', () => {
      const callExpr = getFirstCallExpression(`
        app.get('/test', { handler(req, res) { res.send('world') } })
      `)
      const callbacks = extractCallbacks(callExpr)
      const body = callbacks[0]!.fn.getBody()
      expect(body).toBeDefined()
      expect(body!.getText()).toContain('world')
    })

    it('getParameters returns parameters list', () => {
      const callExpr = getFirstCallExpression(`
        app.get('/test', { handler(a, b) { return a } })
      `)
      const callbacks = extractCallbacks(callExpr)
      expect(callbacks[0]!.fn.getParameters()).toHaveLength(2)
    })
  })

  describe('edge cases — object literal extraction', () => {
    it('skips property assignments with no initializer', () => {
      // TypeScript shorthand property: { x } — PropertyAssignment with no initializer
      // Actually in ts-morph this would be a ShorthandPropertyAssignment, not PropertyAssignment
      // So this should just not crash
      const callExpr = getFirstCallExpression(`
        const x = 1
        app.get('/test', { x })
      `)
      const callbacks = extractCallbacks(callExpr)
      // Shorthand properties are not PropertyAssignment, so they're skipped
      expect(callbacks).toHaveLength(0)
    })

    it('handles empty object literal argument', () => {
      const callExpr = getFirstCallExpression(`
        app.get('/test', {})
      `)
      const callbacks = extractCallbacks(callExpr)
      expect(callbacks).toHaveLength(0)
    })

    it('handles call with no arguments', () => {
      const callExpr = getFirstCallExpression(`
        doSomething()
      `)
      const callbacks = extractCallbacks(callExpr)
      expect(callbacks).toHaveLength(0)
    })
  })
})

describe('a NAMED function expression: the property key wins (plan 0082, second arm)', () => {
  // The arm nobody declared. Plan 0082, the CHANGELOG and `docs/upgrading.md` all
  // described the change as `<anonymous>` → name. There is a second direction:
  // `{ handler: function legacyName(req) {} }` reported **legacyName** before
  // v0.46.0 and reports **handler** after. Found by review; the sabotage that
  // restores the old behaviour for function expressions only was MISSED by the
  // whole suite, because neither side was pinned.
  //
  // The new behaviour is right — the property key is how a reader and a rule refer
  // to the callback, and it matches what `fromObjectLiteralFunction` produces at
  // the other call site. Being right is not the same as being declared.
  it("reports the property name, not the function expression's own identifier", () => {
    const callExpr = getFirstCallExpression(`
      app.post('/named', {
        handler: function legacyName(req: unknown) { validateInput(req) },
      })
    `)
    expect(extractCallbacks(callExpr).map((c) => c.fn.getName())).toEqual(['handler'])
  })

  it('CONTROL: a named function expression NOT on a property keeps its own name', () => {
    // So the row above is about the property winning, not about names being lost.
    const callExpr = getFirstCallExpression(`
      app.get('/positional', function ownName(req: unknown) { validateInput(req) })
    `)
    expect(extractCallbacks(callExpr).map((c) => c.fn.getName())).toEqual(['ownName'])
  })
})
