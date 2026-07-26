/**
 * Plan 0069 — exhaustive model-check of the glob-tree evaluator.
 *
 * Three consecutive drafts shipped a version of this evaluator that returned a
 * false verdict, each time on a shape the author had not thought to try. The
 * algorithm is small enough to check completely, so it is checked completely
 * rather than argued about.
 *
 * SOUNDNESS is the property that matters. The evaluator knows only that a
 * `dead` site matches nothing; it cannot see what `live` sites or opaque
 * predicates select. So a fault is sound only if the expression selects the
 * empty set for EVERY possible assignment to the leaves it cannot see. A
 * missed emptiness is fail-open and acceptable; a false red is not.
 *
 * Two candidate rules are compared:
 *
 *   draft 6  `or()` propagates globs only when every input declares them;
 *            `and()` drops the inputs that do not.
 *   draft 7  a predicate declaring no globs contributes an OPAQUE leaf, which
 *            is never dead and is never dropped.
 *
 * Limitation, stated: distinct leaves are treated as independent, which is
 * exactly what the evaluator assumes. So `and(X, not(X))` — vacuous for every
 * X — is outside the space and is not detected. That is recorded in the plan
 * as a known non-detection.
 *
 * Usage: node spikes/0069-tree-model-check.mjs
 */
const U = 0b1111 // a 4-element universe, as a bitmask
const MAX_NODES = 3 // every expression with at most this many combinator nodes
const DEAD = 0
const LIVE = 1
const OPAQUE = 2

/** Every expression tree with exactly `n` combinator nodes. */
function build(n) {
  if (n === 0)
    return [
      { t: 'leaf', k: DEAD },
      { t: 'leaf', k: LIVE },
      { t: 'leaf', k: OPAQUE },
    ]
  const out = []
  for (const a of build(n - 1)) out.push({ t: 'not', c: [a] })
  for (let i = 0; i <= n - 1; i++) {
    for (const a of build(i)) {
      for (const b of build(n - 1 - i)) {
        out.push({ t: 'and', c: [a, b] }, { t: 'or', c: [a, b] })
      }
    }
  }
  return out
}

const assignIds = (e, ctr) =>
  e.t === 'leaf'
    ? e.k === DEAD
      ? e
      : { ...e, i: ctr.n++ }
    : { ...e, c: e.c.map((x) => assignIds(x, ctr)) }

const countLeaves = (e) =>
  e.t === 'leaf' ? (e.k === DEAD ? 0 : 1) : e.c.reduce((s, x) => s + countLeaves(x), 0)

// --- ground truth: plain set semantics ------------------------------------
function truth(e, env) {
  if (e.t === 'leaf') return e.k === DEAD ? 0 : env[e.i]
  if (e.t === 'not') return U & ~truth(e.c[0], env)
  const [a, b] = e.c.map((x) => truth(x, env))
  return e.t === 'and' ? a & b : a | b
}

function alwaysEmpty(e, leaves) {
  for (let k = 0; k < 1 << (4 * leaves); k++) {
    const env = []
    for (let j = 0; j < leaves; j++) env.push((k >> (4 * j)) & U)
    if (truth(e, env) !== 0) return false
  }
  return true
}

// --- the evaluator under test ---------------------------------------------
function toNode(e, mode) {
  if (e.t === 'leaf') {
    if (e.k === OPAQUE) return mode === 'draft7' ? { opaque: true } : null
    return { site: true, polarity: 'positive', unsat: e.k === DEAD }
  }
  if (e.t === 'not') {
    const inner = toNode(e.c[0], mode)
    return inner === null ? null : invert(inner)
  }
  const raw = e.c.map((x) => toNode(x, mode))
  if (e.t === 'or' && mode === 'draft6' && raw.some((x) => x === null)) return null
  const children = raw.filter((x) => x !== null)
  if (children.length === 0) return null
  return { op: e.t === 'and' ? 'all' : 'any', children }
}

/** `not()` is a full negation-normal-form push-down: polarity AND op. */
function invert(n) {
  if (n.opaque) return n
  if (n.site) return { ...n, polarity: n.polarity === 'positive' ? 'negative' : 'positive' }
  return { op: n.op === 'all' ? 'any' : 'all', children: n.children.map(invert) }
}

function isDead(n) {
  if (n === null || n.opaque) return false
  if (n.site) return n.polarity === 'positive' && n.unsat
  return n.op === 'all' ? n.children.some(isDead) : n.children.every(isDead)
}

const show = (e) =>
  e.t === 'leaf'
    ? ['DEAD', 'live', 'opaque'][e.k]
    : e.t === 'not'
      ? `not(${show(e.c[0])})`
      : `${e.t}(${e.c.map(show).join(', ')})`

const pool = []
for (let n = 0; n <= MAX_NODES; n++) pool.push(...build(n))

for (const mode of ['draft6', 'draft7']) {
  let falseReds = 0
  let misses = 0
  let checked = 0
  const examples = []
  for (const raw of pool) {
    const e = assignIds(raw, { n: 0 })
    const leaves = countLeaves(e)
    if (leaves > 3) continue
    checked++
    const verdict = isDead(toNode(e, mode))
    const empty = alwaysEmpty(e, leaves)
    if (verdict && !empty) {
      falseReds++
      if (examples.length < 4) examples.push(show(e))
    }
    if (!verdict && empty) misses++
  }
  const label =
    mode === 'draft6' ? 'draft 6  or:total-prop, and:drops ' : 'draft 7  opaque leaf retained   '
  console.log(
    `${label} expressions ${checked}   FALSE REDS ${falseReds}   fail-open misses ${misses}`,
  )
  for (const x of examples) console.log(`      false red: ${x}`)
}
