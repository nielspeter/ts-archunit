// eval inside a function body (not module scope)
export function dangerousEval(code: string): unknown {
  return eval(code)
}
