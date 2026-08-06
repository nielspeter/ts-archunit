/**
 * Bug 0068's fixture: an object-literal function AND its enclosing function
 * both breach the SAME threshold, in the same file.
 *
 * One per file cannot show the defect — the collision only exists when the
 * inner finding and the outer finding are both produced, because the inner one
 * was labelled with the outer one's name. Both `makeAlpha` and its nested
 * `errorResponseBuilder` exceed 3 lines and 4 parameters, so every function
 * metric produces two findings here that must stay distinguishable.
 */
export function makeAlpha(): {
  errorResponseBuilder: (a: number) => string
  manyParams: (a: number, b: number, c: number, d: number, e: number) => number
} {
  const prefix = 'alpha'
  const suffix = 'omega'
  const separator = '-'
  return {
    errorResponseBuilder: (a: number): string => {
      const head = prefix + separator
      const tail = separator + suffix
      const body = String(a)
      return head + body + tail
    },
    manyParams: (a: number, b: number, c: number, d: number, e: number): number => {
      return a + b + c + d + e
    },
  }
}

export function takesFive(a: number, b: number, c: number, d: number, e: number): number {
  const sum = a + b + c
  const rest = d + e
  return sum + rest
}
