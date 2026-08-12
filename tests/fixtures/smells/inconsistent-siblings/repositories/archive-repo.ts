// Uses parseInt instead of extractCount — second parseInt caller, plan 0102.
// Makes the parseInt pattern 2-of-5 (canFireSoon), not 1-of-4 (inert): one more
// adopter reaches the 60% majority, so the "no majority exists" control is one
// edit away from firing rather than structurally incapable of it.
export class ArchiveRepository {
  private db: Record<string, unknown>[] = []

  getCount(): number {
    const raw = String(this.db.length)
    return parseInt(raw, 10)
  }
}
