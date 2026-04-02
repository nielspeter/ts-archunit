/* eslint-disable @typescript-eslint/no-unused-vars, no-empty */

// ─── Classes with violations ─────────────────────────────────────

export class SilentCatchNoBinding {
  run(): string {
    try {
      return 'ok'
    } catch {
      return 'fallback'
    }
  }
}

export class SilentCatchUnusedBinding {
  run(): string {
    try {
      return 'ok'
    } catch (err) {
      throw new Error('failed')
    }
  }
}

export class SilentCatchReturnNull {
  run(): string | null {
    try {
      return 'ok'
    } catch (err) {
      return null
    }
  }
}

export class SilentCatchUnderscorePrefix {
  run(): void {
    try {
      console.log('try')
    } catch (_err) {
      // empty
    }
  }
}

export class SilentCatchEmptyBody {
  run(): void {
    try {
      console.log('try')
    } catch (err) {}
  }
}

export class SilentCatchHardcodedLog {
  run(): void {
    try {
      console.log('try')
    } catch (err) {
      console.log('something went wrong')
    }
  }
}

// Destructured catch bindings are tested via in-memory projects
// because strict TypeScript does not allow catch ({ message })

// ─── Classes that pass (no violation) ────────────────────────────

export class CleanCatchRethrow {
  run(): string {
    try {
      return 'ok'
    } catch (err) {
      throw err
    }
  }
}

export class CleanCatchLog {
  run(): void {
    try {
      console.log('try')
    } catch (err) {
      console.error('failed', err)
    }
  }
}

export class CleanCatchPassToFunction {
  run(): void {
    try {
      console.log('try')
    } catch (err) {
      this.reportError(err)
    }
  }

  private reportError(err: unknown): void {
    console.error(err)
  }
}

export class CleanCatchInstanceOf {
  run(): void {
    try {
      console.log('try')
    } catch (err) {
      if (err instanceof TypeError) {
        console.error('type error', err)
      }
    }
  }
}

export class CleanCatchPropertyAccess {
  run(): void {
    try {
      console.log('try')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      throw new Error(msg)
    }
  }
}

// CleanCatchDestructuredUsed tested via in-memory project (strict TS disallows catch destructuring)

export class CleanNoCatch {
  run(): string {
    return 'ok'
  }
}

// ─── Constructor / getter / setter ───────────────────────────────

export class SilentCatchConstructor {
  constructor() {
    try {
      console.log('init')
    } catch {
      // silent in constructor
    }
  }
}

export class SilentCatchGetter {
  get value(): string {
    try {
      return 'ok'
    } catch {
      return 'fallback'
    }
  }
}

export class SilentCatchSetter {
  private _value = ''
  set value(v: string) {
    try {
      this._value = v
    } catch {
      // silent in setter
    }
  }
}

// ─── Edge cases ──────────────────────────────────────────────────

export class MultipleCatches {
  run(): void {
    try {
      console.log('a')
    } catch (err) {
      console.error(err) // references err — passes
    }

    try {
      console.log('b')
    } catch (err) {
      // does not reference err — violation
    }
  }
}

export class CatchInArrowInMethod {
  run(): void {
    const handler = () => {
      try {
        console.log('try')
      } catch {
        return null
      }
    }
    handler()
  }
}

export class CatchWithFinally {
  run(): void {
    try {
      console.log('try')
    } catch (err) {
      // silent — finally does not excuse ignoring the error
    } finally {
      console.log('cleanup')
    }
  }
}

// ─── Standalone functions ────────────────────────────────────────

export function silentCatchFunction(): string {
  try {
    return 'ok'
  } catch {
    return 'fallback'
  }
}

export function cleanCatchFunction(): string {
  try {
    return 'ok'
  } catch (err) {
    console.error(err)
    return 'fallback'
  }
}

export const expressionBodiedArrow = (): string => 'no try/catch possible'
