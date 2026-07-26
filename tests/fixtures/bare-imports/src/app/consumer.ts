// A RELATIVE specifier. Its raw string must never be offered to a glob: a
// relative glob like '../services/*' matches nothing against an absolute path
// — that is the `unanchored` fault plan 0069 diagnoses — and matching it
// against the specifier would make relative globs silently half-work and mask
// the diagnosis.
import { help } from '../services/helper.js'

export const greeting = help()
