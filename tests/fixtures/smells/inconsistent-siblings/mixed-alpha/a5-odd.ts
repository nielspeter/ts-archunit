// Majority folder — the odd one out, does NOT call this.normalize(). Plan 0102 fixture.
export class AdapterFive {
  private raw = ''

  read(): string {
    return this.raw.trim()
  }
}
