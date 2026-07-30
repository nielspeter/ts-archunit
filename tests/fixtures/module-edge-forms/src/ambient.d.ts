// Ambient module declarations, under a `@ts-archunit-fixture/` scope that cannot
// exist on npm.
//
// The root tsconfig includes `tests`, so these `.d.ts` declarations are resolvable
// **repo-wide** — `src/` could import them and typecheck clean. That is the same
// failure mode as the branch `fix/generated-probes-contaminate-the-program`.
// Unscoped names (`ambient-only`) would let a genuinely missing dependency slip
// past `tsc`; a name nobody would ever type cannot.
//
// An ambient module declaration with an EMPTY body: correctly not an edge.
// `getImportStringLiterals()` returns nothing here, and that is right — no
// specifier is being resolved.
declare module '@ts-archunit-fixture/ambient-only' {}

// A NON-empty ambient body IS a hole, not a correct exclusion: the binder routes
// the inner import to `moduleAugmentations`, so the walk structurally cannot see
// it (plan 0071, Out of scope). Weaker than the relative-specifier case in
// augment.ts, because TS will not resolve a relative specifier inside an ambient
// body anyway.
declare module '@ts-archunit-fixture/ambient-with-import' {
  import type { Erased } from './target.js'
  export const injected: Erased
}
