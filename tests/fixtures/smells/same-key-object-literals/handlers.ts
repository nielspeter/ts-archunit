// Several duplicate pairs from ONE rule in ONE file — the shape a collision
// guard needs. A fixture with a single finding cannot detect a collision at
// all, because one finding never collides with anything.
//
// `routeA.handler` and `routeB.handler` share a key name. Before the owning
// binding was included in the qualified name, both were reported as `handler`
// and their duplicate-pair identities merged: accepting one accepted the other.
//
// Padded to distinctVocabulary >= 20 (plan 0103, Phase 0 Problem A) — measured
// at 7 before padding, below every candidate floor that plan's triage tested.
// All three bodies stay byte-identical to each other, so they keep pairing at
// ~100% similarity; only the vocabulary size changed.

const OFFSET = 1
const MULTIPLIER = 3
const BONUS = 2
const LIMIT = 100

export const routeA = {
  handler: async (n: number) => {
    const scaled = n * MULTIPLIER
    const shifted = scaled + OFFSET
    const boosted = shifted + BONUS
    const capped = boosted > LIMIT ? LIMIT : boosted
    const rounded = Math.round(capped)
    const flagged = rounded > 0
    const label = flagged ? 'active' : 'inactive'
    return { value: rounded, ok: flagged, extra: label, note: 'done' }
  },
}

export const routeB = {
  handler: async (n: number) => {
    const scaled = n * MULTIPLIER
    const shifted = scaled + OFFSET
    const boosted = shifted + BONUS
    const capped = boosted > LIMIT ? LIMIT : boosted
    const rounded = Math.round(capped)
    const flagged = rounded > 0
    const label = flagged ? 'active' : 'inactive'
    return { value: rounded, ok: flagged, extra: label, note: 'done' }
  },
}

export const routeC = {
  process: async (n: number) => {
    const scaled = n * MULTIPLIER
    const shifted = scaled + OFFSET
    const boosted = shifted + BONUS
    const capped = boosted > LIMIT ? LIMIT : boosted
    const rounded = Math.round(capped)
    const flagged = rounded > 0
    const label = flagged ? 'active' : 'inactive'
    return { value: rounded, ok: flagged, extra: label, note: 'done' }
  },
}
