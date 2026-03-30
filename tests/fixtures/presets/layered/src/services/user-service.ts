import { findUser } from '../repositories/user-repo.js'

export function getUser(id: number): { id: number; created: string } {
  return findUser(id)
}
