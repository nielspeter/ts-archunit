// The odd one out: same object-literal shape, but skips validateInput.
export const legacyHandler = {
  run: async (raw: string): Promise<string> => {
    const trimmed = raw.trim()
    const upper = trimmed.toUpperCase()
    const suffixed = `${upper}!`
    return suffixed
  },
}
