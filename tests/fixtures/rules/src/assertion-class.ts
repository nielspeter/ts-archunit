/**
 * Fixture: class with `as` type assertions for testing noTypeAssertions.
 */
export class AssertionClass {
  process(input: unknown): string {
    const value = input as string
    return value.toUpperCase()
  }

  castNumber(input: unknown): number {
    return input as number
  }

  safeConst(): readonly string[] {
    return ['a', 'b'] as const
  }
}
