/**
 * Fixture: class service that does NOT call a repository — fails classMustCall.
 */
export class UserService {
  getUser(id: number): { id: number; name: string } {
    return { id, name: 'Hardcoded' }
  }
}
