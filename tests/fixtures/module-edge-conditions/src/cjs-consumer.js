// `require()` of a banned module in .js under allowJs. Classified `require` and
// deliberately enforced by nothing (plan 0071 §3).
const s = require('./banned/secret.js')
module.exports = { s }
