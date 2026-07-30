// A module augmentation for a RELATIVE specifier. `getImportStringLiterals()`
// structurally cannot see this — the binder routes it to `moduleAugmentations` —
// so it is a stated hole (plan 0071 Out of scope), not a correct exclusion.
declare module './target.js' {
  export const INJECTED: number
}
export {}
