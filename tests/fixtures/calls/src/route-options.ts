// Fastify-style route registrations with options objects
declare const app: {
  get(path: string, opts: Record<string, unknown>, handler: Function): void
  post(path: string, opts: Record<string, unknown>, handler: Function): void
  delete(path: string, handler: Function): void
}

declare function authenticate(req: unknown): void
declare const schema: { response: Record<string, unknown> }

// Has both schema and preHandler
app.get(
  '/users',
  {
    schema: { response: {} },
    preHandler: [authenticate],
  },
  (req: unknown) => req,
)

// Has schema only, missing preHandler
app.post(
  '/orders',
  {
    schema: { body: {} },
  },
  (req: unknown) => req,
)

// No options object at all (callback only)
app.get('/health', {}, (req: unknown) => req)

// Shorthand property: { schema } instead of { schema: ... }
app.post(
  '/items',
  {
    schema,
    preHandler: [authenticate],
  },
  (req: unknown) => req,
)

// Has deprecated property (forbidden)
app.get(
  '/legacy',
  {
    schema: { response: {} },
    deprecated: true,
  },
  (req: unknown) => req,
)

// No object literal argument at all
app.delete('/temp', (req: unknown) => req)
