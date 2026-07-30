// A SECOND copy of `truncating.rules.ts`, used by ONE test.
//
// A rule file's module is cached after its first import, and `fresh` does not bust it
// under vitest's module runner (measured). So the double-print assertion only holds if
// its import is the FIRST for that path in the process — it saw two stderr writes when
// its test ran first and one when it ran third, i.e. it silently stopped testing
// anything depending on its position in the file. A dedicated fixture makes that
// independent of order.
//
// A SELF-EXECUTING rule file — the shape `init` scaffolds and `docs/cli.md`
// documents — whose first rule throws at module scope.
//
// `.expectNonEmpty()` on a dead selector is a configuration finding, and since
// v0.23.0 `.warn()` throws for those (plan 0069 R3a). A throw here aborts the
// module, so `rule2` below is never evaluated and its four violations never
// reach the report. Bug 0029.
//
// DO NOT convert this to an array export: the truncation is the property under
// test. `array-export.rules.ts` next door is the control.
import path from 'node:path'
import { project, functions, modules } from '../../../src/index.js'

const p = project(path.join(import.meta.dirname, '../poc/tsconfig.json'))

// rule1 — throws at import.
modules(p)
  .that()
  .resideInFolder('**/no-such-folder-xyz/**')
  .expectNonEmpty()
  .should()
  .notHaveDefaultExport()
  .warn()

// rule2 — four real violations in the fixture, and never evaluated.
functions(p)
  .that()
  .haveNameMatching(/^parse/)
  .should()
  .notExist()
  .check()
