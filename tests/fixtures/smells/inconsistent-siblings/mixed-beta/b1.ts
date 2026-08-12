// Inert folder — only 1 of 5 files calls this.normalize(). Plan 0102 fixture.
// editsToMajority = ceil(0.6*5) - 1 = 2 > 1, so this folder alone is genuinely
// inert: no folder within one edit of a majority.
export class WidgetOne {
  private raw = ''

  read(): string {
    return this.normalize(this.raw)
  }

  private normalize(value: string): string {
    return value.trim()
  }
}
