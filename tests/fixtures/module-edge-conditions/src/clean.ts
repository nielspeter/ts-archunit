// Permitted edges of BOTH kinds. This file must be retained by every selector in
// the predicate tests — a full-set assertion where the only surviving member is a
// file with no edges at all would pass on a build that lost every subject.
import { OK } from './allowed/ok.js'
export { OK as Fine } from './allowed/ok.js'
export const clean = OK
