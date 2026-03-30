import { BaseRepository } from '../base-repository.js'

export class UserRepository extends BaseRepository {
  constructor() {
    super('users')
  }

  findById(id: number): { id: number } {
    return { id }
  }
}
