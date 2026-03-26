/**
 * Fixture: class with non-null assertions for testing noNonNullAssertions.
 */
export class NonNullClass {
  private items: Map<string, string> = new Map()

  getItem(key: string): string {
    return this.items.get(key)!
  }

  getLength(value: string | undefined): number {
    return value!.length
  }
}
