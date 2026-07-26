/**
 * Plan 0069 glob census — which path globs in a rule file match nothing?
 *
 * The point of this script is that `kind` names **the string the matcher is
 * applied to**, not what the API is called. Two revisions of it got that wrong,
 * and each time the census reported a vacuous rule as satisfiable:
 *
 *   1. One flat universe of files + directories. It reported
 *      `resideInFolder('**\/src/predicates/module**')` as satisfiable; that glob
 *      matches a file and no directory, which is the whole bug.
 *   2. `inFolder: 'folder'`. `SmellBuilder.inFolder()` matches the **full file
 *      path** (`src/smells/duplicate-bodies.ts:52`), so the name lies.
 *
 * Derived rather than assumed: of every glob-taking selector in `src/`, exactly
 * one — `resideInFolder` (`src/predicates/identity.ts:96`) — matches the
 * immediate parent directory. Every other one matches the whole path.
 *
 * Usage: node spikes/0069-glob-census.mjs [path/to/rule-file.ts]
 */
import fs from 'node:fs'
import picomatch from 'picomatch'
import { Project } from 'ts-morph'

/**
 * Which string each selector's glob is matched against.
 *
 * `import-target` globs are matched against resolved module paths, which are
 * outside the project by construction — checking them against a path universe
 * would fail every correct dependency rule in existence.
 */
const TARGET_BY_SELECTOR = {
  resideInFolder: 'parent-dir',
  resideInFile: 'file-path',
  havePathMatching: 'file-path',
  assignedFrom: 'file-path',
  matching: 'file-path',
  inFolder: 'file-path', // SmellBuilder — matches the full path despite the name
  layer: 'file-path',
  importFrom: 'import-target',
  notImportFrom: 'import-target',
  importFromCondition: 'import-target',
  notImportFromCondition: 'import-target',
  onlyImportFrom: 'import-target',
}

const project = new Project({ tsConfigFilePath: 'tsconfig.json' })
const filePaths = project.getSourceFiles().map((f) => f.getFilePath())

// Immediate parents only — that is what `resideInFolder` tests. An
// all-ancestors set over-approximates: `**\/tests/fixtures` matches an ancestor
// but is not any file's parent, so a `resideInFolder` there can never select
// anything while an all-ancestors universe calls it satisfiable.
const parentDirs = [...new Set(filePaths.map((f) => f.substring(0, f.lastIndexOf('/'))))]

const universe = { 'file-path': filePaths, 'parent-dir': parentDirs }

const target = process.argv[2] ?? 'tests/archunit/arch-rules.test.ts'
const lines = fs.readFileSync(target, 'utf-8').split('\n')

const sites = []
lines.forEach((line, index) => {
  // Skip comments. A rule file legitimately quotes a broken glob as a
  // counter-example — the JSDoc in `tests/archunit/arch-rules.test.ts` does
  // exactly that — and counting it inflates the site total and would print a
  // DEAD line for a comment from a differently-named checkout. This is the
  // same code-fence problem the plan sizes for the R2b markdown scanner, and
  // the third time this script has been wrong about which strings are globs.
  const text = line.trim()
  if (text.startsWith('*') || text.startsWith('//')) return
  for (const match of text.matchAll(/\.?(\w+)\(\s*'([^']*\*[^']*)'/g)) {
    const kind = TARGET_BY_SELECTOR[match[1]]
    if (kind === undefined) continue
    sites.push({ selector: match[1], glob: match[2], kind, line: index + 1 })
  }
})

let dead = 0
let exempt = 0
for (const site of sites) {
  if (site.kind === 'import-target') {
    exempt++
    continue
  }
  // Never `universe[kind].some(matcher)` — picomatch reads the array index as
  // its `returnObject` argument and returns a truthy object from index 1 on.
  const isMatch = picomatch(site.glob)
  const hits = universe[site.kind].filter((p) => isMatch(p)).length
  if (hits === 0) {
    dead++
    console.log(`DEAD  ${target}:${site.line}  ${site.selector}('${site.glob}')  [${site.kind}]`)
  }
}

console.log(
  `\nfiles ${filePaths.length}   parent dirs ${parentDirs.length}` +
    `\npath-glob sites ${sites.length - exempt}   (import-target sites exempt: ${exempt})` +
    `\nmatching nothing: ${dead}`,
)
