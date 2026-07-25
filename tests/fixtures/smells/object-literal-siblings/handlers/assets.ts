// Follows the sanctioned pattern — but inside an object-literal handler, which
// is the shape the detector could not see at all.
import { validateInput } from '../lib/shared.js'

export const assetsHandler = {
  run: async (raw: string): Promise<string> => {
    const trimmed = raw.trim()
    validateInput(trimmed)
    const upper = trimmed.toUpperCase()
    return upper
  },
}
