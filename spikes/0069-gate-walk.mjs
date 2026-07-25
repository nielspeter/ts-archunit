/**
 * Plan 0069 gate walk — how much TypeScript on disk is outside the project?
 *
 * Compares two independently derived sets:
 *   - the compiler's file list, via ts-morph loading a tsconfig
 *   - a pruned recursive filesystem walk from that tsconfig's directory
 *
 * That axis — filesystem vs compiler — is the second derivation ADR-008 rule 5
 * asks for, and it is the same one `outside-project` uses to distinguish "your
 * glob is misspelled" from "your project does not contain this path".
 *
 * Usage: node spikes/0069-gate-walk.mjs [path/to/tsconfig.json]
 */
import fs from 'node:fs'
import path from 'node:path'
import { Project } from 'ts-morph'

/**
 * Directories never worth walking. `node_modules` and `.git` are the two that
 * dominate the cost; the build-output names are excluded because a walk that
 * reports `dist/` as "absent from the project" is noise, not a finding.
 */
const PRUNE = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next'])

const TS_EXT = /\.(m|c)?tsx?$/

function walk(dir, files = [], dirs = []) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return { files, dirs } // unreadable or gone — not a finding, just not walkable
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (PRUNE.has(entry.name)) continue
      dirs.push(full)
      walk(full, files, dirs)
    } else if (TS_EXT.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      files.push(full)
    }
  }
  return { files, dirs }
}

const tsconfig = path.resolve(process.argv[2] ?? 'tsconfig.json')
const root = path.dirname(tsconfig)

const started = process.hrtime.bigint()
const { files: diskFiles, dirs: diskDirs } = walk(root)
const walkMs = Number(process.hrtime.bigint() - started) / 1e6

const project = new Project({ tsConfigFilePath: tsconfig })
const projectFiles = new Set(project.getSourceFiles().map((f) => f.getFilePath()))

// A directory counts as "in the project" if it is an ancestor of any project
// file — the same all-ancestors universe PathUniverse materializes.
const projectDirs = new Set()
for (const file of projectFiles) {
  const parts = file.split('/')
  for (let i = parts.length - 1; i > 1; i--) projectDirs.add(parts.slice(0, i).join('/'))
}

const absentDirs = diskDirs.filter((d) => !projectDirs.has(d))

// The two categories gate run 2 produced, discriminated from the walk alone:
// a directory that holds TypeScript is excluded by config; one that holds none
// simply has no TypeScript in it. No tsconfig parsing required.
const holdsTs = new Set(diskFiles.map((f) => path.dirname(f)))
const excludedByConfig = absentDirs.filter((d) => holdsTs.has(d))
const noTypeScript = absentDirs.filter((d) => !holdsTs.has(d))

console.log(`tsconfig                       ${tsconfig}`)
console.log(`.ts files on disk (pruned)     ${diskFiles.length}`)
console.log(`files in the project           ${projectFiles.size}`)
console.log(`directories on disk            ${diskDirs.length}   (walk ${walkMs.toFixed(0)}ms)`)
console.log(`directories absent             ${absentDirs.length}`)
console.log(`  holds TypeScript             ${excludedByConfig.length}   -> excluded by config`)
console.log(`  holds no TypeScript          ${noTypeScript.length}`)
console.log('\nabsent directories holding no TypeScript:')
for (const d of noTypeScript) console.log(`  ${path.relative(root, d)}`)
