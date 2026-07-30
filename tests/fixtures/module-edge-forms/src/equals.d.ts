// `import x = require('s')`: parent ExternalModuleReference, and RUNTIME.
// A 4-way branch ending in `else -> type-expression` marks this erased.
import eq = require('./target.js')
export declare const fromEquals: typeof eq
