interface User {
  id: number
  name: string
}

export function listUsers(): { total: string; skip: number; limit: number; items: User[] } {
  return { total: 'many', skip: 0, limit: 10, items: [] }
}
