// Class with complex constructor and getter (tests member coverage)

export class ConfigService {
  private readonly _value: string

  // Constructor complexity: 4 (if + else-if + else-if + ??)
  constructor(input: string | undefined, fallback: string | undefined) {
    const resolved = input ?? fallback
    if (resolved === 'production') {
      this._value = 'prod-config'
    } else if (resolved === 'staging') {
      this._value = 'staging-config'
    } else if (resolved === 'development') {
      this._value = 'dev-config'
    } else {
      this._value = 'default-config'
    }
  }

  // Getter complexity: 3 (if + &&)
  get value(): string {
    if (this._value.length > 0 && this._value !== 'default-config') {
      return this._value.toUpperCase()
    }
    return this._value
  }

  // Setter complexity: 1
  set value(_v: string) {
    // read-only in practice
  }
}
