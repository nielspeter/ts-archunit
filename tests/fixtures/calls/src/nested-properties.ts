// Fastify-style route registrations with nested JSON schema definitions
declare const app: {
  get(path: string, opts: Record<string, unknown>, handler: Function): void
  post(path: string, opts: Record<string, unknown>, handler: Function): void
}

// additionalProperties: true nested 3 levels deep (should violate)
app.post(
  '/users',
  {
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          metadata: {
            type: 'object',
            additionalProperties: true,
          },
        },
      },
    },
  },
  (req: unknown) => req,
)

// additionalProperties: false (should NOT violate)
app.post(
  '/orders',
  {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          item: { type: 'string' },
        },
      },
    },
  },
  (req: unknown) => req,
)

// No additionalProperties at all (clean)
app.get(
  '/health',
  {
    schema: {
      response: {
        200: { type: 'object', properties: { status: { type: 'string' } } },
      },
    },
  },
  (req: unknown) => req,
)

// Top-level additionalProperties: true (should violate)
app.post(
  '/items',
  {
    schema: {
      body: {
        type: 'object',
        additionalProperties: true,
      },
    },
  },
  (req: unknown) => req,
)

// Numeric property value: maximum: 100
app.get(
  '/list',
  {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number', maximum: 100 },
        },
      },
    },
  },
  (req: unknown) => req,
)
