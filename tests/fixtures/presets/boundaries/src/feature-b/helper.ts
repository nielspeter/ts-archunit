// Padded to distinctVocabulary >= 8 (plan 0103) — measured at 5 before padding.
// See feature-a/helper.ts for why.
export function helperB(): number {
  const x = 1
  const y = 2
  const z = x + y
  const total = z * 2
  const bonus = total + 3
  const factor = bonus * 2
  const result = factor - 1
  return result
}
