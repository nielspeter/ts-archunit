// TWO static imports of one target from one file — the shape that produced two
// byte-identical reverse-graph violations at the same file:line, and therefore two
// identical baseline hashes for one fact. `addToGraph` used to pass
// `deduplicate: false` for static imports.
import { SECRET } from './banned/secret.js'
import type { SecretShape } from './banned/secret.js'
export const twiceOver: SecretShape = { key: SECRET }
