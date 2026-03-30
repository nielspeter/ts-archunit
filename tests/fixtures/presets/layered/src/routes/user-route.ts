import { getUser } from '../services/user-service.js'

export function handleGetUser(id: number): { id: number; created: string } {
  return getUser(id)
}
