import { describe, it, expect } from 'vitest'
import { setCorrespondence } from '../../src/core/correspondence-core.js'

describe('setCorrespondence (F2 — shared set-difference + non-vacuity core)', () => {
  it('reports missing = A \\ B (coverage gaps) by identity', () => {
    const r = setCorrespondence(['a', 'b', 'c'], ['a', 'c'])
    expect(r.missing).toEqual(['b'])
    expect(r.orphans).toEqual([])
  })

  it('reports orphans = B \\ A', () => {
    const r = setCorrespondence(['a'], ['a', 'x', 'y'])
    expect(r.missing).toEqual([])
    expect(r.orphans).toEqual(['x', 'y'])
  })

  it('bijection: identical sets produce no missing and no orphans', () => {
    const r = setCorrespondence(['a', 'b'], ['b', 'a'])
    expect(r.missing).toEqual([])
    expect(r.orphans).toEqual([])
    expect(r.aEmpty).toBe(false)
    expect(r.bEmpty).toBe(false)
  })

  it('flags an empty side (the non-vacuity signal the caller acts on)', () => {
    const empty = setCorrespondence([], ['a'])
    expect(empty.aEmpty).toBe(true)
    expect(empty.bEmpty).toBe(false)
    // vacuous "coverage": A is empty so it is trivially covered — missing is []
    expect(empty.missing).toEqual([])

    const both = setCorrespondence([], [])
    expect(both.aEmpty).toBe(true)
    expect(both.bEmpty).toBe(true)
  })

  it('collapses duplicate keys within a side (set semantics)', () => {
    const r = setCorrespondence(['a', 'a', 'b'], ['a'])
    expect(r.missing).toEqual(['b'])
  })

  it('detects identity change even when cardinality is unchanged (the cardinality trap)', () => {
    // Same count on both sides (3 vs 3), but one key dropped and another added.
    const r = setCorrespondence(['a', 'b', 'c'], ['a', 'b', 'd'])
    expect(r.missing).toEqual(['c']) // c present in A, gone from B
    expect(r.orphans).toEqual(['d']) // d present in B, absent from A
    // A pure count check (3 === 3) would have reported "consistent" — this does not.
  })

  it('preserves first-appearance order for stable output', () => {
    const r = setCorrespondence(['z', 'y', 'x'], [])
    expect(r.missing).toEqual(['z', 'y', 'x'])
  })
})
