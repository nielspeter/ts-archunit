// Module-scope process.env access
const dbUrl = process.env['DB_URL'] ?? 'localhost'

export function getDbUrl(): string {
  return dbUrl
}
