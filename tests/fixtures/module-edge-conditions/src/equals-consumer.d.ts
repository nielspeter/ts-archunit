// `import x = require()` of a banned module. Also `require`, also unenforced —
// and there is no sanctioned alternative that catches it, which the docs say.
import eq = require('./banned/secret.js')
export declare const viaEquals: typeof eq
