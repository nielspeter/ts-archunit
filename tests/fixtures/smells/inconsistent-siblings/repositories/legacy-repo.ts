// Uses parseInt instead of extractCount (the odd one out)
export class LegacyRepository {
  private db: Record<string, unknown>[] = []

  getCount(): number {
    const raw = String(this.db.length)
    return parseInt(raw, 10)
  }
}
