// Imports AND re-exports the same banned module. Before §4's per-kind verbs the
// two findings were byte-identical, so the re-export was absorbed by the import's
// baseline entry and never reported as new.
import { SECRET } from './banned/secret.js'
export { SECRET as Reexported } from './banned/secret.js'
export const both = SECRET
// An ALIASED import, so item 9 has something positive to find. Without this the
// fixture contained no `import { x as y }` at all, and a test titled "flags the
// aliased import" made two toEqual([]) assertions — it would have passed if the
// condition returned [] unconditionally.
import { SECRET as Hidden } from './banned/secret.js'
export const hidden = Hidden
