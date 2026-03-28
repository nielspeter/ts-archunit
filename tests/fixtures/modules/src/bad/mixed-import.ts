// Mixed import from one source: type format (type-only) + parse (runtime)
// This has a runtime dependency because `parse` is a value import
import { type format, parse } from '../shared/utils.js'

export function mixedUser(): unknown {
  return parse('{}')
}

export type Formatter = typeof format
