// A route whose ONLY cross-layer edges are erased: an `import type` and a type-only
// re-export of the same module. Under `typeImportsAllowed: ['**/routes/**']` neither
// may be reported.
//
// Item 19 exists because nothing previously pinned WHICH import is exempt —
// `type-imports-only` was asserted only by `.some(v => v.ruleId === …)` at four
// sites, which passes for whatever set of findings the rule produces.
import type { getUser } from '../services/user-service.js'
export type { getUser }
export type UserOf = ReturnType<typeof getUser>
