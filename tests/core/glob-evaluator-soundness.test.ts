/**
 * Exhaustive soundness check of the glob-tree evaluator (plan 0069).
 *
 * Three consecutive drafts of this algorithm returned a false verdict, each
 * caught by a reviewer on a shape the author had not tried: a flat array that
 * could not express `every`; `or()` as concatenation; a polarity flip without
 * an `op` inversion; and dropping globless children under `any`. It is six
 * lines and it broke four times, so it is enumerated rather than reasoned
 * about.
 *
 * `spikes/0069-tree-model-check.mjs` ran the same enumeration against a *model*
 * of the algorithm while the plan was being written. This runs it against the
 * shipped code, which is the only version that matters.
 *
 * SOUNDNESS is the property. The evaluator knows only that a `dead` site
 * matches nothing; it cannot see what `live` sites or opaque predicates
 * select. So a fault is justified only if the expression selects the empty set
 * for **every** possible assignment to the leaves it cannot see. A missed
 * emptiness is fail-open and acceptable; a false red is not.
 *
 * Stated limitation, and it is the evaluator's own assumption: distinct leaves
 * are independent. `and(X, not(X))` is vacuous for every X and is outside this
 * space — recorded in the plan as a known non-detection.
 */
import { describe, it, expect } from 'vitest'
import type { GlobNode, GlobSite } from '../../src/core/glob-site.js'
import { combineGlobs, globNode, negateGlobs } from '../../src/core/glob-site.js'
import { isDeadGlobTree } from '../../src/core/glob-evaluator.js'
import type { PathUniverse } from '../../src/core/path-universe.js'

/** A universe where `'live'` matches and `'dead'` does not. */
const universe: PathUniverse = {
  filePaths: ['/repo/src/live.ts'],
  parentDirs: ['/repo/src'],
  tsconfigRelativeFilePaths: ['src/live.ts'],
  tsconfigRelativeParentDirs: ['src'],
}

const site = (glob: string): GlobSite => ({
  glob,
  kind: 'file-path',
  position: 'selector',
  origin: `test(${glob})`,
})
const LIVE = site('**/live.ts')
const DEAD = site('**/nothing-here.ts')

// --- expression trees, built with the production combinator helpers ---------

type Expr =
  | { t: 'dead' }
  | { t: 'live'; i: number }
  | { t: 'opaque'; i: number }
  | { t: 'and' | 'or'; c: [Expr, Expr] }
  | { t: 'not'; c: [Expr] }

/** Every expression with exactly `n` combinator nodes. */
function build(n: number): Expr[] {
  if (n === 0) return [{ t: 'dead' }, { t: 'live', i: 0 }, { t: 'opaque', i: 0 }]
  const out: Expr[] = []
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

/** Give each free leaf a distinct index so the truth model can vary them. */
function assignIds(e: Expr, counter: { n: number }): Expr {
  if (e.t === 'live' || e.t === 'opaque') return { ...e, i: counter.n++ }
  if (e.t === 'dead') return e
  if (e.t === 'not') return { t: 'not', c: [assignIds(e.c[0], counter)] }
  return { t: e.t, c: [assignIds(e.c[0], counter), assignIds(e.c[1], counter)] }
}

function countFreeLeaves(e: Expr): number {
  if (e.t === 'dead') return 0
  if (e.t === 'live' || e.t === 'opaque') return 1
  if (e.t === 'not') return countFreeLeaves(e.c[0])
  return countFreeLeaves(e.c[0]) + countFreeLeaves(e.c[1])
}

// --- ground truth: plain set semantics over a 4-element universe ------------

const U = 0b1111

function truth(e: Expr, env: readonly number[]): number {
  if (e.t === 'dead') return 0
  if (e.t === 'live' || e.t === 'opaque') return env[e.i] ?? 0
  if (e.t === 'not') return U & ~truth(e.c[0], env)
  const a = truth(e.c[0], env)
  const b = truth(e.c[1], env)
  return e.t === 'and' ? a & b : a | b
}

/** True when the expression selects nothing for EVERY value of its free leaves. */
function alwaysEmpty(e: Expr, freeLeaves: number): boolean {
  for (let bits = 0; bits < 1 << (4 * freeLeaves); bits++) {
    const env: number[] = []
    for (let j = 0; j < freeLeaves; j++) env.push((bits >> (4 * j)) & U)
    if (truth(e, env) !== 0) return false
  }
  return true
}

// --- the production evaluator ------------------------------------------------

/**
 * Build the tree the way production does — through `combineGlobs`, with an
 * opaque input represented as `undefined`, exactly as a predicate that
 * declares no globs reaches a combinator.
 *
 * Constructing `{ op, children }` literals here instead would test the
 * evaluator while leaving the construction rule — "a missing declaration
 * becomes a retained opaque leaf" — completely unguarded. That rule is where
 * draft 6's bug lived, and an earlier version of this test could not see it.
 */
function toTree(e: Expr): GlobNode | undefined {
  if (e.t === 'dead') return globNode(DEAD)
  if (e.t === 'live') return globNode(LIVE)
  if (e.t === 'opaque') return undefined
  if (e.t === 'not') {
    const inner = toTree(e.c[0])
    return inner === undefined ? undefined : negateGlobs(inner)
  }
  return combineGlobs(e.t === 'and' ? 'all' : 'any', [toTree(e.c[0]), toTree(e.c[1])])
}

/** A rule declaring no globs at all has nothing to fault. */
function evaluate(e: Expr): boolean {
  const tree = toTree(e)
  return tree === undefined ? false : isDeadGlobTree(tree, universe)
}

function show(e: Expr): string {
  if (e.t === 'dead') return 'DEAD'
  if (e.t === 'live') return 'live'
  if (e.t === 'opaque') return 'opaque'
  if (e.t === 'not') return `not(${show(e.c[0])})`
  return `${e.t}(${show(e.c[0])}, ${show(e.c[1])})`
}

const MAX_NODES = 3

describe('glob tree evaluator — exhaustive soundness', () => {
  const pool: Expr[] = []
  for (let n = 0; n <= MAX_NODES; n++) pool.push(...build(n))

  it('never reports a fault for an expression that can select something', () => {
    const falseReds: string[] = []
    let checked = 0
    for (const raw of pool) {
      const e = assignIds(raw, { n: 0 })
      const freeLeaves = countFreeLeaves(e)
      if (freeLeaves > 3) continue
      checked++
      if (evaluate(e) && !alwaysEmpty(e, freeLeaves)) {
        falseReds.push(show(e))
      }
    }
    // Guard the guard: a build() that returned nothing would pass trivially.
    expect(checked).toBeGreaterThan(4000)
    expect(falseReds).toEqual([])
  })

  it('reports a fault for every expression that provably selects nothing', () => {
    // Not required for correctness — fail-open is the safe direction — but the
    // model check showed the retained-opaque rule is exact over this space, so
    // any regression to a weaker rule shows up here rather than silently
    // reducing coverage.
    const missed: string[] = []
    for (const raw of pool) {
      const e = assignIds(raw, { n: 0 })
      const freeLeaves = countFreeLeaves(e)
      if (freeLeaves > 3) continue
      if (!evaluate(e) && alwaysEmpty(e, freeLeaves)) {
        missed.push(show(e))
      }
    }
    expect(missed).toEqual([])
  })

  it('an empty node is never dead', () => {
    // `[].every()` is `true`, so an empty `any` node would fault a rule that
    // declares no globs at all. Asserted directly rather than through
    // `combineGlobs`, which cannot produce one — every input contributes a
    // child, opaque or not. That unreachability is the argument for the guard,
    // not a reason to omit it: it holds only as long as nothing else ever
    // builds a node by hand.
    expect(isDeadGlobTree({ op: 'any', children: [] }, universe)).toBe(false)
    expect(isDeadGlobTree({ op: 'all', children: [] }, universe)).toBe(false)
  })

  it('the four shapes that broke earlier revisions', () => {
    const dead = (e: Expr) => evaluate(e)
    const D: Expr = { t: 'dead' }
    const L: Expr = { t: 'live', i: 0 }
    const O: Expr = { t: 'opaque', i: 0 }

    // or() as concatenation: one dead branch is not enough.
    expect(dead({ t: 'or', c: [D, L] })).toBe(false)
    // and(): one dead branch IS enough.
    expect(dead({ t: 'and', c: [D, L] })).toBe(true)
    // A polarity flip without inverting op: false red.
    expect(dead({ t: 'not', c: [{ t: 'and', c: [L, { t: 'not', c: [D] }] }] })).toBe(false)
    // ...and the mirror, which a polarity flip alone would miss.
    expect(dead({ t: 'not', c: [{ t: 'or', c: [L, { t: 'not', c: [D] }] }] })).toBe(true)
    // Dropping a globless sibling under `any`: false red.
    expect(dead({ t: 'or', c: [D, O] })).toBe(false)
    // ...and via the `all` -> `any` inversion, which is how it actually bit.
    expect(dead({ t: 'not', c: [{ t: 'and', c: [{ t: 'not', c: [D] }, O] }] })).toBe(false)
    // Double negation restores polarity.
    expect(dead({ t: 'not', c: [{ t: 'not', c: [D] }] })).toBe(true)
  })
})
