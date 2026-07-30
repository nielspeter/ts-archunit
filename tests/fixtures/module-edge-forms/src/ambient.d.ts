// An ambient module declaration with an EMPTY body: correctly not an edge.
// `getImportStringLiterals()` returns nothing here, and that is right — no
// specifier is being resolved.
declare module 'ambient-only' {}

// A NON-empty ambient body IS a hole, not a correct exclusion: the binder routes
// the inner import to `moduleAugmentations`, so the walk structurally cannot see
// it (plan 0071, Out of scope). Weaker than the relative-specifier case in
// augment.ts, because TS will not resolve a relative specifier inside an ambient
// body anyway.
declare module 'ambient-with-import' {
  import type { Erased } from './target.js'
  export const injected: Erased
}
