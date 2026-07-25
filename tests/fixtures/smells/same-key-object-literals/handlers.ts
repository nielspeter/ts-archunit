// Several duplicate pairs from ONE rule in ONE file — the shape a collision
// guard needs. A fixture with a single finding cannot detect a collision at
// all, because one finding never collides with anything.
//
// `routeA.handler` and `routeB.handler` share a key name. Before the owning
// binding was included in the qualified name, both were reported as `handler`
// and their duplicate-pair identities merged: accepting one accepted the other.

const OFFSET = 1

export const routeA = {
  handler: async (n: number) => {
    const scaled = n * 3
    const shifted = scaled + OFFSET
    return { value: shifted, ok: true }
  },
}

export const routeB = {
  handler: async (n: number) => {
    const scaled = n * 3
    const shifted = scaled + OFFSET
    return { value: shifted, ok: true }
  },
}

export const routeC = {
  process: async (n: number) => {
    const scaled = n * 3
    const shifted = scaled + OFFSET
    return { value: shifted, ok: true }
  },
}
