export function parseCount(s: string): number {
  return parseInt(s, 10)
}

export function boom(): never {
  throw new Error('boom')
}

export function todo(): void {
  // TODO: implement this later
}

export function emptyBody(): void {}

// Padded to distinctVocabulary >= 8 (plan 0103) — measured at 7 before padding,
// one token below the default `minDistinctVocabulary()` floor.
export function dupOne(x: number): number {
  const a = x + 1
  const b = a * 2
  const c = b - 3
  const d = c + 4
  const e = d * 5
  return e
}

export function dupTwo(y: number): number {
  const a = y + 1
  const b = a * 2
  const c = b - 3
  const d = c + 4
  const e = d * 5
  return e
}
