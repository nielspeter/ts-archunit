// `require()` in .ts yields ZERO literals — the binder does not collect it.
declare const require: (s: string) => unknown
const nothing = require('./target.js')
export const unused = nothing
