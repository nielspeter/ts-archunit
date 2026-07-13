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

export function dupOne(x: number): number {
  const a = x + 1
  const b = a * 2
  const c = b - 3
  return c
}

export function dupTwo(y: number): number {
  const a = y + 1
  const b = a * 2
  const c = b - 3
  return c
}
