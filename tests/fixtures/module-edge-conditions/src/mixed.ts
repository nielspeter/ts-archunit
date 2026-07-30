// Imports AND re-exports the same banned module. Before §4's per-kind verbs the
// two findings were byte-identical, so the re-export was absorbed by the import's
// baseline entry and never reported as new.
import { SECRET } from './banned/secret.js'
export { SECRET as Reexported } from './banned/secret.js'
export const both = SECRET
