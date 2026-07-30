// `require()` in .js under allowJs. The binder collects these into
// `sourceFile.imports` with parent CallExpression — the same parent kind as
// `import()`, which is why the ImportKeyword discriminator exists.
const a = require('./target.js')
const b = require(`./target.js`)
module.exports = { a, b }
