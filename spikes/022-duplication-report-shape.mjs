/**
 * Proposal 022 — the shape of what `duplicateBodies` reports, measured on a real corpus.
 *
 * Derives the four counts the proposal rests on:
 *
 *   1. pairs reported                              (the current unit)
 *   2. groups, by union-find over the pair graph   (the proposed unit)
 *   3. the largest single-file contribution        (the volume problem, concentrated)
 *   4. how many findings carry a `suggestion`      (the agent contract)
 *
 * Point it at any repository. Numbers in the proposal came from cmless @ 1481446; the shape
 * of the result — pairs greatly exceeding groups, and `suggestion` null throughout — is the
 * claim, not the specific figures.
 *
 * Usage: npm run build && node spikes/022-duplication-report-shape.mjs <repo> [tsconfig ...]
 *   e.g. node spikes/022-duplication-report-shape.mjs ../cmless apps/api/tsconfig.json
 *        (with no tsconfigs given, every packages/ * and apps/ * tsconfig.json is used)
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  project,
  smells,
  collectFunctions,
  buildFingerprint,
  computeSimilarity,
} from '../dist/index.js'

const REPO = path.resolve(process.argv[2] ?? '.')
const MIN_LINES = 10
const MIN_SIM = 0.9
const NOISE = [
  '**/archive/**',
  '**/backups/**',
  '**/examples/**',
  '**/migrations/**',
  '**/tests/**',
  '**/test/**',
  '**/fixtures/**',
  '**/generated/**',
  '**/dist/**',
]

function discover() {
  const given = process.argv.slice(3)
  if (given.length > 0) return given.map((g) => path.join(REPO, g))
  const out = []
  for (const group of ['packages', 'apps']) {
    const dir = path.join(REPO, group)
    if (!fs.existsSync(dir)) continue
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      // A solution-style tsconfig loads nothing (bug 0066) — prefer a referenced one.
      for (const name of ['tsconfig.app.json', 'tsconfig.json']) {
        const c = path.join(dir, e.name, name)
        if (fs.existsSync(c)) {
          out.push(c)
          break
        }
      }
    }
  }
  return out
}

const parent = new Map()
const find = (x) => {
  if (!parent.has(x)) parent.set(x, x)
  while (parent.get(x) !== x) {
    parent.set(x, parent.get(parent.get(x)))
    x = parent.get(x)
  }
  return x
}
const union = (a, b) => {
  const ra = find(a),
    rb = find(b)
  if (ra !== rb) parent.set(ra, rb)
}

const ep = (f) => `${f.getSourceFile().getFilePath()}#${f.getName() ?? '<anon>'}`
const seen = new Set()
const perFile = new Map()
let pairs = 0,
  withSuggestion = 0,
  totalFindings = 0

for (const cfg of discover()) {
  if (!fs.existsSync(cfg)) {
    console.log(`skip (missing) ${cfg}`)
    continue
  }
  const p = project(cfg)
  const violations = smells
    .duplicateBodies(p)
    .minLines(MIN_LINES)
    .withMinSimilarity(MIN_SIM)
    .ignoreTests()
    .ignorePaths(...NOISE)
    .violations()
  totalFindings += violations.length
  withSuggestion += violations.filter((v) => v.suggestion != null).length
  for (const v of violations) perFile.set(v.file, (perFile.get(v.file) ?? 0) + 1)

  const keep = new Set(violations.map((v) => v.identity))
  const items = []
  for (const sf of p.getSourceFiles())
    for (const fn of collectFunctions(sf, { includeObjectLiteralFunctions: true })) {
      const b = fn.getBody()
      if (!b || b.getText().split('\n').length < MIN_LINES) continue
      items.push({ fn, fp: buildFingerprint(b) })
    }
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i],
        b = items[j]
      const mx = Math.max(a.fp.nodeCount, b.fp.nodeCount),
        mn = Math.min(a.fp.nodeCount, b.fp.nodeCount)
      if (mx > 0 && mn / mx < MIN_SIM) continue
      if (computeSimilarity(a.fp, b.fp) < MIN_SIM) continue
      const ka = ep(a.fn),
        kb = ep(b.fn)
      if (!keep.has(`duplicate-pair::${[ka, kb].sort().join('::')}`)) continue
      pairs++
      seen.add(ka)
      seen.add(kb)
      union(ka, kb)
    }
}

const groups = new Set([...seen].map(find))
const worst = [...perFile.entries()].sort((a, b) => b[1] - a[1])[0]

console.log(`\ncorpus ${REPO}\n`)
console.log(`pairs reported (current unit)   ${String(pairs).padStart(6)}`)
console.log(`functions involved              ${String(seen.size).padStart(6)}`)
console.log(`GROUPS (proposed unit)          ${String(groups.size).padStart(6)}`)
console.log(`ratio pairs:groups              ${(pairs / Math.max(1, groups.size)).toFixed(1)}:1`)
if (worst)
  console.log(
    `\nlargest single-file contribution ${String(worst[1])} findings ` +
      `(${((worst[1] / Math.max(1, totalFindings)) * 100).toFixed(0)}% of the corpus) — ` +
      `${path.relative(REPO, worst[0])}`,
  )
console.log(
  `\nfindings carrying a \`suggestion\`  ${String(withSuggestion)} of ${String(totalFindings)}`,
)
console.log('  (the CLI\'s agent block instructs: "fix each one using its `suggestion`")')

if (pairs === 0) {
  console.log('\nNO PAIRS FOUND — nothing was measured. Check the corpus path and tsconfigs.')
  process.exitCode = 1
}
