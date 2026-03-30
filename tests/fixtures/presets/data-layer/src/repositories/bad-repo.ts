// Does not extend BaseRepository — violates extend-base
export class OrderRepository {
  findById(id: number): { id: number } {
    return { id }
  }

  save(): void {
    // Throws generic Error — violates typed-errors
    throw new Error('Not implemented')
  }
}
