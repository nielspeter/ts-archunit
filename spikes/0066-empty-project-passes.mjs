/**
 * Bug 0066 — a smell detector over zero source files passes.
 *
 * Reproduces the `.check()` table in the bug report. Self-contained: writes a
 * solution-style tsconfig (`"files": []` + `"references"`), which ts-morph loads as an
 * empty program, and a populated one beside it as the control.
 *
 * The control is the point. A probe that reports "everything passed" is indistinguishable
 * from a probe that cannot see a throw, so the populated project must throw before the
 * empty project's passes mean anything (ADR-008 rule 5's vacuity corollary).
 *
 * Usage: npm run build && node spikes/0066-empty-project-passes.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { project, smells } from '../dist/index.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archunit-0066-'))
fs.mkdirSync(path.join(root, 'src'), { recursive: true })

// A solution-style tsconfig delegates to references and loads nothing itself.
fs.writeFileSync(
  path.join(root, 'tsconfig.json'),
  JSON.stringify({ files: [], references: [{ path: './tsconfig.app.json' }] }, null, 2),
)
fs.writeFileSync(
  path.join(root, 'tsconfig.app.json'),
  JSON.stringify({ compilerOptions: { noEmit: true }, include: ['src/**/*'] }, null, 2),
)

// Two duplicate bodies, so the control has something real to find.
const body = (tag) => `
export function ${tag}One(xs) {
  let total = 0
  for (const x of xs) {
    if (x > 0) { total += x } else { total -= x }
  }
  if (total > 100) { total = 100 }
  return total
}
export function ${tag}Two(ys) {
  let sum = 0
  for (const y of ys) {
    if (y > 0) { sum += y } else { sum -= y }
  }
  if (sum > 100) { sum = 100 }
  return sum
}
`
fs.writeFileSync(path.join(root, 'src', 'a.ts'), body('alpha'))

const empty = project(path.join(root, 'tsconfig.json'))
const real = project(path.join(root, 'tsconfig.app.json'))

const attempt = (label, run) => {
  try {
    run()
    return ['PASSED', label]
  } catch {
    return ['threw ', label]
  }
}

const rows = [
  attempt('bare .check()', () => smells.duplicateBodies(empty).check()),
  attempt('.ignoreTests().check()', () => smells.duplicateBodies(empty).ignoreTests().check()),
  attempt(".ignorePaths('**/x/**').check()", () =>
    smells.duplicateBodies(empty).ignorePaths('**/x/**').check(),
  ),
  attempt(".inFolder('**/src/**').check()", () =>
    smells.duplicateBodies(empty).inFolder('**/src/**').check(),
  ),
]

console.log(`empty project : ${String(empty.getSourceFiles().length)} source files`)
console.log(`control       : ${String(real.getSourceFiles().length)} source files\n`)
for (const [verdict, label] of rows) console.log(`  ${verdict}  ${label}`)

const [controlVerdict] = attempt('control, bare .check()', () =>
  smells.duplicateBodies(real).minLines(5).withMinSimilarity(0.9).check(),
)
console.log(`\n  ${controlVerdict}  control (populated project), bare .check()`)

const silentPasses = rows.filter(([v]) => v === 'PASSED').length
console.log(
  `\n${String(silentPasses)} of ${String(rows.length)} configurations pass over a project that loaded 0 files.`,
)
if (controlVerdict === 'PASSED') {
  console.log(
    'CONTROL DID NOT THROW — this probe cannot see a failure; the result above means nothing.',
  )
  process.exitCode = 1
}
fs.rmSync(root, { recursive: true, force: true })
