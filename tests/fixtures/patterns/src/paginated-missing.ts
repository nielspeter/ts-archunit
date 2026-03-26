interface User {
  id: number
  name: string
}

export function listUsers(): { total: number; items: User[] } {
  return { total: 50, items: [] }
}
