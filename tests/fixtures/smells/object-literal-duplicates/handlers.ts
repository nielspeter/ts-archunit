// Handler-map idiom: the functions are object-literal property values, not
// declarations. This is the dominant shape in GraphQL resolvers, Bun.serve /
// Hono route maps and reducer maps — and the detectors were blind to all of it.

export const routes = {
  createUser: async (input: { name: string }) => {
    const trimmed = input.name.trim()
    if (!trimmed) throw new Error('name is required')
    const id = Math.round(trimmed.length * 7)
    return { id, name: trimmed, kind: 'user' }
  },

  // Byte-identical to createUser — the duplicate that must be reported.
  createTeam: async (input: { name: string }) => {
    const trimmed = input.name.trim()
    if (!trimmed) throw new Error('name is required')
    const id = Math.round(trimmed.length * 7)
    return { id, name: trimmed, kind: 'user' }
  },

  // Method shorthand, also duplicated.
  async createGroup(input: { name: string }) {
    const trimmed = input.name.trim()
    if (!trimmed) throw new Error('name is required')
    const id = Math.round(trimmed.length * 7)
    return { id, name: trimmed, kind: 'user' }
  },

  // Genuinely different — must NOT be reported, or the detector is just noisy.
  deleteUser: async (id: number) => {
    if (id < 0) throw new Error('bad id')
    const audited = `deleted:${String(id)}`
    return { audited, ok: true }
  },
}
