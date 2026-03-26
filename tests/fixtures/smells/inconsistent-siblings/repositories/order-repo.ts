// Uses extractCount (the majority pattern)
export class OrderRepository {
  private db: Record<string, unknown>[] = []

  getCount(): number {
    const raw = this.db.length
    return this.extractCount(raw)
  }

  private extractCount(value: unknown): number {
    return typeof value === 'number' ? value : 0
  }
}
