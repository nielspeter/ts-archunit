// Outside src/ — the default include ('**/src/**') must NOT reach this file.
export function scriptEval(code: string): unknown {
  return eval(code)
}
