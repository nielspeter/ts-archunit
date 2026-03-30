/* eslint-disable no-eval */

/**
 * Fixture: functions with security violations.
 */
export function evaluateCode(code: string): unknown {
  return eval(code)
}

export function createDynamic(body: string): Function {
  return new Function(body)
}

export function readEnv(key: string): string | undefined {
  return process.env[key]
}

export function logMessage(msg: string): void {
  console.log(msg)
}

export function warnUser(msg: string): void {
  console.warn(msg)
}

export function debugInfo(msg: string): void {
  console.debug(msg)
}

export function parsePayload(json: string): unknown {
  return JSON.parse(json)
}

/**
 * Clean function — no violations.
 */
export function cleanFunction(x: number): number {
  return x * 2
}
