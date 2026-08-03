// Fastify-style route with handler in options object
declare const app: {
  post(path: string, opts: Record<string, unknown>, handler?: Function): void
  get(path: string, opts: Record<string, unknown>, handler?: Function): void
}
declare function validateInput(req: unknown): void
declare function authenticate(req: unknown): void

// Arrow function in object property
app.post('/users', {
  schema: { body: { type: 'object' } },
  handler: async (req: unknown) => {
    validateInput(req)
  },
})

// Function expression in object property
app.post('/orders', {
  handler: function (req: unknown) {
    validateInput(req)
  },
})

// Method shorthand in object property
app.get('/health', {
  handler(req: unknown) {
    return { status: 'ok' }
  },
})

// Nested: hooks.onRequest is 2 levels deep
app.post('/admin', {
  hooks: {
    onRequest: (req: unknown) => {
      authenticate(req)
    },
  },
  handler: async (req: unknown) => {
    validateInput(req)
  },
})

// Direct inline callback (existing pattern — must still work)
app.get('/ping', {}, (req: unknown) => {
  return 'pong'
})

// Deep schema default — should NOT be extracted (depth > 3)
app.post('/deep', {
  schema: {
    response: {
      200: {
        default: () => ({ status: 'ok' }),
      },
    },
  },
  handler: async (req: unknown) => {
    validateInput(req)
  },
})

// Plan 0082's motivating shape: two function callbacks on ONE object literal,
// with different property names. Before the fix both came back anonymous and
// shared the object's argIndex, so `/^handler$/` could not tell them apart —
// and no fixture in this suite contained the case, which is why the integration
// row could pass with the feature reverted.
app.post('/pair', {
  preHandler: (req: unknown) => {
    authenticate(req)
  },
  handler: (req: unknown) => {
    validateInput(req)
  },
})

// A NAMED function expression as a property. Before v0.46.0 the extractor
// reported its own identifier (`legacyName`); since, the property key wins.
// Undeclared and unguarded when it shipped — pinned here so the choice is visible.
app.post('/named', {
  handler: function legacyName(req: unknown) {
    validateInput(req)
  },
})
