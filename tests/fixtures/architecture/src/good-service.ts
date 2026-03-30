import { UserRepository } from './user-repository.js'

/**
 * Fixture: service that calls a repository — passes mustCall(/Repository/).
 */
const repo = new UserRepository()

export function getUser(id: number): { id: number; name: string } {
  return repo.findById(id)
}
