export function runEval(code: string): unknown {
  return eval(code)
}

export function makeFn(body: string): unknown {
  return new Function(body)
}

export function swallow(): void {
  try {
    risky()
  } catch {
    // silently swallowed
  }
}

export function noop(): void {}

function risky(): void {
  throw new Error('boom')
}
