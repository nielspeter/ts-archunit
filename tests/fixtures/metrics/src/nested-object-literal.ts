/**
 * Bug 0068's fixture. Every shape here exists because a guard written without it
 * passed while the defect was live — the claims below are measured, not intended.
 *
 * 1. `makeAlpha` + its nested `errorResponseBuilder` — an object-literal function
 *    and its ENCLOSING function both breaching the same threshold. One per file
 *    cannot show the defect: the collision only exists when both findings fire,
 *    because the inner one was labelled with the outer one's name.
 * 2. `makeAlpha` takes FIVE parameters so the `parameters` metric forms a group
 *    too. Without this, `manyParams` and `takesFive` were merely two findings with
 *    two names, and the parameters row passed with its own fix reverted.
 * 3. `makeBeta` + `makeGamma` both return `{ build }` — two object-literal
 *    functions with the SAME own name in one file. `owningBindingName` refuses to
 *    prefix a literal returned from a factory, so both are named `build`; only the
 *    scope tells them apart.
 * 4. `makeDelta` + `makeEpsilon` return `{ build() {} }` in METHOD SHORTHAND.
 *    A shorthand is a `MethodDeclaration`, which HAS its own name — so
 *    `getElementName` returns `build` rather than walking to an ancestor, and a
 *    scope derived from it skipped the prefix. The arrow spelling above was
 *    guarded and this one was not: same code, two spellings, one guarded.
 * 5. `save` returns `{ save: … }` — an inner function whose name EQUALS its
 *    enclosing function's. An `own === scope` short-circuit reads that as "the
 *    scope is me" and drops the prefix, re-creating the original collision.
 */
export function makeAlpha(
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
): {
  errorResponseBuilder: (n: number) => string
  manyParams: (a: number, b: number, c: number, d: number, e: number) => number
} {
  const prefix = 'alpha' + String(a + b)
  const suffix = 'omega' + String(c + d)
  const separator = String(e)
  return {
    errorResponseBuilder: (n: number): string => {
      const head = prefix + separator
      const tail = separator + suffix
      const body = String(n)
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

export function makeBeta(): { build: (n: number) => string } {
  return {
    build: (n: number): string => {
      const one = String(n) + 'b'
      const two = one + 'e'
      const three = two + 't'
      return three + 'a'
    },
  }
}

export function makeGamma(): { build: (n: number) => string } {
  return {
    build: (n: number): string => {
      const one = String(n) + 'g'
      const two = one + 'a'
      const three = two + 'm'
      return three + 'ma'
    },
  }
}

export function makeDelta(): { build: (n: number) => string } {
  return {
    build(n: number): string {
      const one = String(n) + 'd'
      const two = one + 'e'
      const three = two + 'l'
      return three + 'ta'
    },
  }
}

export function makeEpsilon(): { build: (n: number) => string } {
  return {
    build(n: number): string {
      const one = String(n) + 'e'
      const two = one + 'p'
      const three = two + 's'
      return three + 'ilon'
    },
  }
}

export function save(): { save: (n: number) => string } {
  return {
    save: (n: number): string => {
      const one = String(n) + 's'
      const two = one + 'a'
      const three = two + 'v'
      return three + 'e'
    },
  }
}
