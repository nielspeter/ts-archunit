// The CONTROL for bug 0029: the same two rules as `truncating.rules.ts`, in the
// array-export shape.
//
// An array export builds every rule before any of them runs, so no terminal fires
// at module scope and nothing can be truncated. This file must report BOTH rules'
// findings and must NOT carry a truncation notice — that second half is the
// discriminator. A fix that reported truncation for every rule file would satisfy
// the positive test and fail here.
import path from 'node:path'
import { project, functions, modules } from '../../../src/index.js'

const p = project(path.join(import.meta.dirname, '../poc/tsconfig.json'))

export default [
  modules(p)
    .that()
    .resideInFolder('**/no-such-folder-xyz/**')
    .expectNonEmpty()
    .should()
    .notHaveDefaultExport(),
  functions(p)
    .that()
    .haveNameMatching(/^parse/)
    .should()
    .notExist(),
]
