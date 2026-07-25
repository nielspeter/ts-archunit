/**
 * Plan 0069 glob census — which path globs in a rule file match nothing?
 *
 * The point of this script is the `kind` split. An earlier version tested every
 * glob against one flat universe of files + directories and reported
 * `resideInFolder('**\/src/predicates/module**')` as satisfiable. It is not:
 * `resideInFolder` matches the DIRECTORY portion, and that glob matches a file.
 * The flat universe hid the exact bug the census was written to find.
 *
 * So: folder globs are tested against directories only, file globs against
 * files only, and import-target globs are not tested at all — `node_modules` is
 * outside the project by construction, so every correct dependency rule would
 * red against a path universe.
 *
 * Usage: node spikes/0069-glob-census.mjs [path/to/rule-file.ts]
 */
import fs from 'node:fs'
import picomatch from 'picomatch'
import { Project } from 'ts-morph'

/** Which universe a predicate's glob argument is matched against. */
const KIND_BY_PREDICATE = {
  resideInFolder: 'folder',
  inFolder: 'folder',
  resideInFile: 'file',
  inFile: 'file',
  havePathMatching: 'file',
  assignedFrom: 'file',
  importFrom: 'import-target',
  notImportFrom: 'import-target',
  importFromCondition: 'import-target',
  notImportFromCondition: 'import-target',
  onlyImportFrom: 'import-target',
}

const project = new Project({ tsConfigFilePath: 'tsconfig.json' })
const files = project.getSourceFiles().map((f) => f.getFilePath())

// All ancestors, not just immediate parents — an exact-directory glob with no
// trailing `/**` needs the grandparents too.
const dirs = new Set()
for (const file of files) {
  const parts = file.split('/')
  for (let i = parts.length - 1; i > 1; i--) dirs.add(parts.slice(0, i).join('/'))
}
const universe = { file: files, folder: [...dirs] }

const target = process.argv[2] ?? 'tests/archunit/arch-rules.test.ts'
const lines = fs.readFileSync(target, 'utf-8').split('\n')

const sites = []
lines.forEach((line, index) => {
  for (const match of line.matchAll(/\.?(\w+)\(\s*'([^']*\*[^']*)'/g)) {
    const kind = KIND_BY_PREDICATE[match[1]]
    if (kind === undefined) continue
    sites.push({ predicate: match[1], glob: match[2], kind, line: index + 1 })
  }
})

let dead = 0
let skipped = 0
for (const site of sites) {
  if (site.kind === 'import-target') {
    skipped++
    continue
  }
  // Never `universe[kind].some(matcher)` — picomatch reads the array index as
  // its `returnObject` argument and returns a truthy object from index 1 on.
  const isMatch = picomatch(site.glob)
  const hits = universe[site.kind].filter((p) => isMatch(p)).length
  if (hits === 0) {
    dead++
    console.log(`DEAD  ${target}:${site.line}  ${site.predicate}('${site.glob}')  [${site.kind}]`)
  }
}

console.log(
  `\nfiles ${files.length}   ancestor dirs ${universe.folder.length}` +
    `\npath-glob sites ${sites.length - skipped}   (import-target sites exempt: ${skipped})` +
    `\nmatching nothing: ${dead}`,
)
