/**
 * Proposal 022 — score every candidate signal against the 153 hand labels.
 *
 * This is the spike that matters most, because the proposal's central negative claims are
 * unreproducible without it: "the similarity score carries no information about whether two
 * functions do the same thing" and "cohesion is +0.0". Someone re-deriving those numbers has
 * to be able to disagree with a label and see what changes.
 *
 * Labels live in `022-labels.json`, with every signal precomputed per pair, so scoring needs
 * no corpus and no ts-morph. Flip a label in that file and re-run.
 *
 * The number to read is LIFT (accuracy above the base rate), not accuracy. With 130 SAME and
 * 23 DIFF, "always guess SAME" already scores 85%, so any signal reported as "85% accurate"
 * has learned nothing at all.
 *
 * Usage: node spikes/022-signals-scored.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const file = path.join(import.meta.dirname, '022-labels.json')
const data = JSON.parse(fs.readFileSync(file, 'utf8'))
const rows = data.pairs
const P = rows.filter((r) => r.label === 'SAME')
const N = rows.filter((r) => r.label === 'DIFF')
const base = Math.max(P.length, N.length) / rows.length

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? 0
}

console.log(`corpus   ${data.corpus.repo} @ ${data.corpus.sha.slice(0, 7)}`)
console.log(
  `detector ts-archunit ${data.detector.version}, minLines(${String(data.detector.minLines)}), sim >= ${String(data.detector.minSimilarity)}`,
)
console.log(
  `labels   ${String(rows.length)} pairs — ${String(P.length)} SAME, ${String(N.length)} DIFF`,
)
console.log(`base rate (always guess SAME): ${(base * 100).toFixed(1)}%\n`)

const SIGNALS = [
  ['kinds similarity (SHIPPED)', 'kinds'],
  ['exact call match', 'exactCalls'],
  ['rename score', 'rename'],
  ['call vocabulary', 'callVocab'],
  ['call op-vocabulary', 'opVocab'],
  ['function-name similarity', 'fnNameSim'],
  ['body lines', 'minLines'],
  ['AST nodes', 'minNodes'],
  ['call count', 'nCalls'],
]

console.log('signal                        SAME(med)  DIFF(med)     acc    lift   recall@95prec')
for (const [label, key] of SIGNALS) {
  const p = P.map((r) => r.signals[key])
  const n = N.map((r) => r.signals[key])
  const cands = [...new Set([...p, ...n])].sort((a, b) => a - b)
  let best = { acc: 0 }
  for (const t of cands) {
    const acc = (p.filter((v) => v >= t).length + n.filter((v) => v < t).length) / rows.length
    if (acc > best.acc) best = { acc }
  }
  // The operating point that would matter for a filter: keep how much true signal while
  // discarding 95% of the noise?
  let recall = 0
  for (const t of cands)
    if (n.filter((v) => v >= t).length / n.length <= 0.05)
      recall = Math.max(recall, p.filter((v) => v >= t).length / p.length)

  const lift = (best.acc - base) * 100
  console.log(
    label.padEnd(30) +
      median(p).toFixed(2).padStart(9) +
      median(n).toFixed(2).padStart(11) +
      `${(best.acc * 100).toFixed(1)}%`.padStart(8) +
      `${lift >= 0 ? '+' : ''}${lift.toFixed(1)}`.padStart(8) +
      `${(recall * 100).toFixed(0)}%`.padStart(14),
  )
}

console.log(`
Reading this table:

  kinds similarity is what ships today. +0.0 lift means it does not distinguish "these do
  the same thing" from "these share a framework skeleton" at all — which is proposal 022's
  central claim and the reason a better THRESHOLD is not the fix.

  rename score is the best of nine at +4.6, and still not worth shipping: at the operating
  point that discards 95% of DIFF it keeps 45% of SAME. Removing a 15% noise floor by
  discarding 55% of real findings is a bad trade.

  Note the medians can look well separated while lift is 0 — the distributions overlap, and
  with an 85/15 class split no threshold beats guessing. Report lift, never accuracy.

  Cohesion (cluster density) is NOT in this table because it is a property of a group, not a
  pair; it was scored separately at +0.0 and must not be presented as a confidence score.
`)
