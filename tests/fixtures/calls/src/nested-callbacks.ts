// Nested callbacks and multiple inline functions
declare const router: {
  get(path: string, ...handlers: Function[]): void
  post(path: string, ...handlers: Function[]): void
}
declare function next(): void
declare function validateInput(req: unknown): void
declare function handleError(req: unknown, res: unknown): void

// Multiple inline callbacks (middleware pattern)
router.get(
  '/api/items',
  (req: unknown, _res: unknown, _next: Function) => {
    next()
  },
  (req: unknown, res: { json: Function }) => {
    handleError(req, res)
    res.json([])
  },
)

// Function expression callback
router.post('/api/items', function handler(req: unknown, res: { json: Function }) {
  validateInput(req)
  handleError(req, res)
  res.json({ ok: true })
})
