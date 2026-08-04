#!/usr/bin/env node
/**
 * Every `exports` subpath resolves by package name, and every target actually ships.
 *
 * Plan 0083 Phase 3's first hard requirement. Before this, `package.json` declared **12
 * `exports` subpaths and not one of them was ever resolved by anything.** The two test
 * files that mention `@nielspeter/ts-archunit` treat it as a *string* —
 * `tests/cli/init.test.ts` asserts that the scaffolded rule file CONTAINS the text
 * `import { recommended } from '@nielspeter/ts-archunit/presets'`, which is the opposite
 * of resolving it. Had that subpath been missing from the map, the test still passed and
 * every scaffolded project failed on its first run. Six releases shipped across that gap.
 *
 * ## Why this is a script and not a test
 *
 * Both checks need `dist/`, and `npm run validate` runs the suite BEFORE `npm run build`.
 * A vitest row that skipped when `dist/` was absent would be a check that cannot fail —
 * the precise defect this repository exists to catch — so it lives here instead, wired
 * into CI and into `publish.yml` after the build. Fails loudly if `dist/` is missing
 * rather than skipping.
 *
 * ## Why not pack → install → import
 *
 * That is what plan 0083 proposed, and it is heavier than the risk requires. Node
 * **self-references** a package by its own name when the package declares `exports`, so
 * check 1 resolves the real map through the real algorithm with no install and no network.
 * Check 2 then covers the failure self-referencing cannot see — a target that resolves
 * locally but is absent from the tarball — by reading `npm pack --dry-run --json`.
 *
 * The pair is the point: check 1 alone passes on a `files[]` omission, and check 2 alone
 * passes on a subpath that points at a file that exists but exports nothing.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf-8'))
const failures = []

if (!existsSync(path.join(root, 'dist'))) {
  console.error(
    'dist/ is missing — run `npm run build` first. NOT skipping: a skip here is a false green.',
  )
  process.exit(1)
}

const subpaths = Object.keys(pkg.exports ?? {})
if (subpaths.length === 0) {
  console.error('package.json declares no `exports` — nothing to verify, which is itself wrong.')
  process.exit(1)
}

/** `.` -> the bare name; `./presets` -> `name/presets`. */
const specifierFor = (sub) => (sub === '.' ? pkg.name : `${pkg.name}${sub.slice(1)}`)

// ── Check 1: every subpath resolves by package name, and exports something ──
for (const sub of subpaths) {
  const spec = specifierFor(sub)
  try {
    const mod = await import(spec)
    const names = Object.keys(mod).filter((n) => n !== 'default')
    if (names.length === 0) {
      failures.push(`${spec} resolves but exports nothing — a subpath nobody can use`)
    }
  } catch (error) {
    failures.push(`${spec} does not resolve: ${error.code ?? error.message}`)
  }
}

// ── Check 2: every declared target ships in the tarball ──
const packed = JSON.parse(
  // `npm.cmd` on Windows: `execFileSync` does not go through a shell, so the bare name
  // fails with ENOENT there. CI is ubuntu, but a contributor running `npm run
  // verify:package` locally should not get a confusing spawn error.
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--dry-run', '--json'], {
    encoding: 'utf-8',
  }),
)
const shipped = new Set((packed[0]?.files ?? []).map((f) => f.path.replaceAll('\\', '/')))
if (shipped.size === 0) failures.push('`npm pack --dry-run --json` listed no files')

/** Every file path an exports entry points at, whatever nesting it uses. */
const targetsOf = (value) => {
  if (typeof value === 'string') return [value]
  if (value && typeof value === 'object') return Object.values(value).flatMap(targetsOf)
  return []
}

for (const [sub, value] of Object.entries(pkg.exports)) {
  for (const target of targetsOf(value)) {
    const rel = target.replace(/^\.\//, '')
    if (!shipped.has(rel)) {
      failures.push(
        `exports["${sub}"] -> "${target}" is NOT in the tarball (files[]: ${pkg.files})`,
      )
    }
  }
}

// `bin` is the other thing a consumer resolves by name, and it ships or the CLI is dead.
for (const binTarget of Object.values(
  typeof pkg.bin === 'string' ? { [pkg.name]: pkg.bin } : (pkg.bin ?? {}),
)) {
  const rel = binTarget.replace(/^\.\//, '')
  if (!shipped.has(rel)) failures.push(`bin -> "${binTarget}" is NOT in the tarball`)
}

// ── Check 3: every specifier the repo itself writes is IN the map ──
//
// Checks 1 and 2 verify what the map declares. Neither notices a subpath REMOVED — the
// remaining ones still resolve and still ship, so the script passes while
// `@nielspeter/ts-archunit/presets` (which `init` scaffolds into every new project, and
// which `tests/cli/init.test.ts` asserts as a STRING) resolves nowhere. Measured: deleting
// that subpath was caught by nothing until this check existed.
//
// Derived from the source and the docs, not hand-listed — a hand-listed set is the
// artifact that goes stale, and the scaffolder is the reason this matters.
const SPECIFIER = new RegExp(`${pkg.name.replace('/', '\\/')}(\\/[a-z0-9/-]+)?`, 'g')
// The stated escape hatch (ADR-008 rule 3: an escape hatch that is not documented is a
// trap, and one an agent can stamp anywhere is worse than none).
//
// Check 3 reds on any specifier the repo writes that is not a subpath — which is right
// almost always, and wrong for prose that MENTIONS a path deliberately: documenting a
// removed subpath in an upgrade note, say. Measured: adding an illustrative
// `…/rules/hypothetical` to `docs/index.md` fails the release.
//
// So a line may opt out by carrying `ts-archunit-allow-specifier`, which is narrow on
// purpose: per LINE, not per file, so it cannot silence a whole document, and greppable so
// every use is visible at once.
const ALLOW = 'ts-archunit-allow-specifier'

const searched = ['src', 'docs', 'README.md']
const referenced = new Map()

const walk = (target) => {
  const abs = path.join(root, target)
  if (!existsSync(abs)) return
  const stat = statSync(abs)
  if (stat.isDirectory()) {
    for (const entry of readdirSync(abs)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue
      walk(path.join(target, entry))
    }
    return
  }
  if (!/\.(ts|tsx|mjs|js|md)$/.test(target)) return
  const text = readFileSync(abs, 'utf-8')
  for (const line of text.split('\n')) {
    if (line.includes(ALLOW)) continue
    for (const [spec] of line.matchAll(SPECIFIER)) {
      if (!referenced.has(spec)) referenced.set(spec, target)
    }
  }
}
for (const target of searched) walk(target)
const declared = new Set(subpaths.map(specifierFor))
if (referenced.size < 2)
  failures.push(`only ${referenced.size} specifier(s) found in ${searched} — the scan is broken`)
for (const [spec, where] of referenced) {
  if (!declared.has(spec)) {
    failures.push(`"${spec}" is written in ${where} but is NOT an exports subpath`)
  }
}

if (failures.length > 0) {
  console.error(`\nverify-package: ${failures.length} problem(s)\n`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  console.error('')
  process.exit(1)
}

console.log(
  `verify-package: ${subpaths.length} exports subpaths resolve by package name and ship in the tarball ` +
    `(${shipped.size} files); ${referenced.size} specifiers written in src/docs all map to one`,
)
