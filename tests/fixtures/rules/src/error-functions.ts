/**
 * Fixture: functions with error violations.
 */
export function throwGeneric(msg: string): never {
  throw new Error(msg)
}

export function throwTypeError(msg: string): never {
  throw new TypeError(msg)
}

export class CustomError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CustomError'
  }
}

export function throwCustom(msg: string): never {
  throw new CustomError(msg)
}
