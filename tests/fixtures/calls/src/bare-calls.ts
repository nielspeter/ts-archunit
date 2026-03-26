// Bare function calls (not method calls) and database calls
declare function handleError(err: unknown): void
declare const db: { query(sql: string, ...args: unknown[]): unknown }

function processData() {
  handleError(new Error('test'))
}

function fetchFromDb() {
  db.query('SELECT * FROM users')
}
