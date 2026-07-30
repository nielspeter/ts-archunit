// Every edge-carrying form, one per line where identity depends on it.
// `declare module 'ambient-only' {}` lives in ambient.d.ts: inside a module file it
// is an AUGMENTATION and must resolve, which is a typecheck error, not a fixture.
// Plan 0071 §1's table, as code. Line numbers are asserted, so DO NOT reflow.
import { RUNTIME } from './target.js'
import type { Erased } from './target.js'
import { type Second } from './target.js'
import './target.js'
import {} from './target.js'
import * as NS from './target.js'
import DEF from './target.js'
import MIXED, { type Erased as E2 } from './target.js'
import { RUNTIME as ALIASED } from './target.js'
export { OTHER } from './target.js'
export { OTHER as OUTWARD } from './target.js'
export * from './target.js'
export * as STAR_NS from './target.js'
export {} from './target.js'
export type { Erased as ErasedOut } from './target.js'
export { type Second as SecondOut } from './target.js'
export type * from './target.js'
const dynamic1 = import('./target.js')
const dynamic2 = import(`./target.js`)
type FromType = import('./target.js').Erased
const computed = import('./tar' + 'get.js')
export { RUNTIME as NoSpecifier }
// A multi-line form of each kind, so a line taken from the literal fails.
import {
  OTHER as MULTILINE_IMPORT,
} from './target.js'
export {
  OTHER as MULTILINE_REEXPORT,
} from './target.js'
const multilineDynamic = import(
  './target.js'
)
type MultilineType = import(
  './target.js'
).Second
export const used = [
  RUNTIME,
  NS,
  DEF,
  MIXED,
  ALIASED,
  dynamic1,
  dynamic2,
  computed,
  multilineDynamic,
]
export type Used = Erased | Second | E2 | FromType | MultilineType
export const alsoUsed = MULTILINE_IMPORT
