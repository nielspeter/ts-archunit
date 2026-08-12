// Inert folder — does not call this.normalize(). Plan 0102 fixture.
export class WidgetFour {
  private raw = ''

  read(): string {
    return this.raw.trim()
  }
}
