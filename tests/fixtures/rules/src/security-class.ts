/* eslint-disable no-eval */

/**
 * Fixture: class with security violations for testing security rules.
 */
export class SecurityViolationClass {
  evaluate(code: string): unknown {
    return eval(code)
  }

  createFunction(body: string): Function {
    return new Function(body)
  }

  getConfig(key: string): string | undefined {
    return process.env[key]
  }

  debug(message: string): void {
    console.log(message)
  }
}
