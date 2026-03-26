// User resolver — uses DataLoader for relations (good practice)

interface User {
  id: string
  name: string
  email: string
}

interface DataLoader<K, V> {
  load(key: K): Promise<V>
}

const loader: DataLoader<string, User> = {} as DataLoader<string, User>

export function users(): Promise<User[]> {
  return loader.load('all-users') as unknown as Promise<User[]>
}

export function user(id: string): Promise<User> {
  return loader.load(id)
}

export const resolveUserPosts = async (userId: string): Promise<unknown[]> => {
  return loader.load(userId) as unknown as Promise<unknown[]>
}
