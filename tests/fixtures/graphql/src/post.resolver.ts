// Post resolver — intentionally missing DataLoader (violation)

interface Post {
  id: string
  title: string
  body: string
  authorId: string
}

interface User {
  id: string
  name: string
}

// Bad: direct DB access instead of DataLoader
async function findUserById(id: string): Promise<User> {
  return { id, name: 'test' }
}

export function posts(): Post[] {
  return []
}

export function post(id: string): Post {
  return { id, title: '', body: '', authorId: '' }
}

// This resolver does NOT use loader.load — intentional violation
export const resolvePostAuthor = async (authorId: string): Promise<User> => {
  return findUserById(authorId)
}
