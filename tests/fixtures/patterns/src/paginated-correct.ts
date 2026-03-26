interface User {
  id: number
  name: string
}

export function listUsers(): { total: number; skip: number; limit: number; items: User[] } {
  return { total: 100, skip: 0, limit: 10, items: [] }
}
