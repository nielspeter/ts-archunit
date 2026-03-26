interface User {
  id: number
  name: string
}

export async function listUsers(): Promise<{
  total: number
  skip: number
  limit: number
  items: User[]
}> {
  return { total: 100, skip: 0, limit: 10, items: [] }
}
