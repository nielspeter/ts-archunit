// Top-level query implementations

interface QueryResult<T> {
  total: number
  items: T[]
}

export function allUsers(): QueryResult<unknown> {
  return { total: 0, items: [] }
}

export function allPosts(): QueryResult<unknown> {
  return { total: 0, items: [] }
}

export const createUser = (name: string, email: string): unknown => {
  return { name, email }
}
