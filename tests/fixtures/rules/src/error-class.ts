/**
 * Fixture: class with generic error throws for testing error rules.
 */
export class GenericErrorClass {
  validate(value: unknown): void {
    if (value === null) {
      throw new Error('Value is null')
    }
  }

  checkType(value: unknown): void {
    if (typeof value !== 'string') {
      throw new TypeError('Expected string')
    }
  }
}
