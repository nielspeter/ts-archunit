import { UserRepository } from './user-repository.js'

/**
 * Fixture: class service that calls a repository — passes classMustCall.
 */
export class UserService {
  private repo = new UserRepository()

  getUser(id: number): { id: number; name: string } {
    return this.repo.findById(id)
  }
}
