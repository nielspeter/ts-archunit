// Padded to distinctVocabulary >= 8 (plan 0103) — measured at 5 before padding,
// below the default `minDistinctVocabulary()` floor, and this fixture needs to
// keep pairing with feature-b/helper.ts for the noCopyPaste preset test.
export function helperA(): number {
  const x = 1
  const y = 2
  const z = x + y
  const total = z * 2
  const bonus = total + 3
  const factor = bonus * 2
  const result = factor - 1
  return result
}
