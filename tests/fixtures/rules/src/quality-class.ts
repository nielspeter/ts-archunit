/**
 * Fixture: a class with code quality violations.
 * Used by tests/rules/code-quality.test.ts
 */
export class BadQualityService {
  // Public mutable field — should be private
  public counter = 0

  // Public field without explicit scope — also a violation
  name: string

  // Static readonly — should NOT be a violation
  static readonly VERSION = '1.0'

  // Protected field — should NOT be a public-field violation
  protected status = 'active'

  constructor(name: string) {
    this.name = name
    this.counter = 99 // magic number in constructor (not scanned by noMagicNumbers)
  }

  // Public method without JSDoc — violation
  increment(): void {
    this.counter += 42 // magic number
  }

  // Protected method without JSDoc — should NOT be a JSDoc violation
  protected update(): void {
    this.counter += 1
  }

  /** Documented method — no JSDoc violation */
  getCount(): number {
    return this.counter * 1000 // magic number
  }

  private reset(): void {
    this.counter = 0 // 0 is allowed
  }
}

export class WellDocumentedService {
  private readonly data: string

  constructor(data: string) {
    this.data = data
  }

  /** Returns the data. */
  getData(): string {
    return this.data
  }
}
