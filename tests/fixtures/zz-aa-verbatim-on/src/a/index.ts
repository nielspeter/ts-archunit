// `import { type Beta }` — every specifier inline-typed, no `import type` prefix.
//
// Whether this is a runtime edge depends ENTIRELY on the tsconfig beside it, which is
// the whole point of the pair — this same file exists twice, byte for byte, under
// `verbatim-module-syntax/` and `verbatim-module-syntax-off/`.
//
// With `verbatimModuleSyntax: true` TypeScript emits `import {} from '../b/index.js'`:
// the specifiers are erased, the MODULE REQUEST is not, so `b` is evaluated when `a` is
// and — with b importing a by value — this is a genuine initialization cycle. With the
// flag off the statement is elided entirely and there is no cycle.
//
// So do NOT "correct" either tsconfig to match this comment: the differing flag values
// ARE the test. The byte-identity of these two files is itself asserted, which is why
// this text has to be written flag-agnostically.
import { type Beta } from '../b/index.js'

export type Alpha = { n: number }
export const alpha: number = 1
export const widen = (b: Beta): number => b.n
