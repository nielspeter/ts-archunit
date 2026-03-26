// Express-style route registrations
declare const app: {
  get(path: string, ...handlers: Function[]): void
  post(path: string, ...handlers: Function[]): void
  put(path: string, ...handlers: Function[]): void
  delete(path: string, ...handlers: Function[]): void
  use(...args: unknown[]): void
}

declare function cors(): unknown
declare const apiRouter: unknown
declare function authenticate(req: unknown): void
declare function handleError(req: unknown, res: unknown): void
declare function fetchUsers(): unknown[]
declare function createUser(body: unknown): unknown
declare function getSettings(): unknown
declare function normalizePagination(query: unknown): { skip: number; limit: number }

app.get('/api/users', (req: unknown, res: { json: Function }) => {
  handleError(req, res)
  normalizePagination(req)
  const data = fetchUsers()
  res.json(data)
})

app.post('/api/users', (req: { body: unknown }, res: { json: Function }) => {
  // Missing handleError --- should be caught by rules
  const user = createUser(req.body)
  res.json(user)
})

app.get('/api/admin/settings', (req: unknown, res: { json: Function }) => {
  authenticate(req)
  handleError(req, res)
  res.json(getSettings())
})

app.use(cors())
app.use('/api', apiRouter)
