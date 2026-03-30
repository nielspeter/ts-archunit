/**
 * Fixture: a repository — services should call it.
 */
export class UserRepository {
  findById(id: number): { id: number; name: string } {
    return { id, name: 'User' }
  }
}
