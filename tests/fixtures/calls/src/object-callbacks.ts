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
