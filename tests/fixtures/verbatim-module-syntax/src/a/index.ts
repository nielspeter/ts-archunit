// `import { type Beta }` — every specifier inline-typed, no `import type` prefix.
//
// Under this fixture's `verbatimModuleSyntax: true` TypeScript emits
// `import {} from '../b/index.js'`: the specifiers are erased, the MODULE REQUEST is
// not. So `b` is evaluated when `a` is, and with b importing a by value this is a
// genuine runtime initialization cycle.
import { type Beta } from '../b/index.js'

export type Alpha = { n: number }
export const alpha: number = 1
export const widen = (b: Beta): number => b.n
