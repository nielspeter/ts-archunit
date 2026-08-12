// Majority folder — 4 of 5 files call this.normalize(). Plan 0102 fixture.
export class AdapterTwo {
  private raw = ''

  read(): string {
    return this.normalize(this.raw)
  }

  private normalize(value: string): string {
    return value.trim()
  }
}
