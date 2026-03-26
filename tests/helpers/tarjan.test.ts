import { describe, it, expect } from 'vitest'
import { tarjanSCC, type AdjacencyList } from '../../src/helpers/tarjan.js'

describe('tarjanSCC', () => {
  it('returns empty for a DAG (no cycles)', () => {
    // 0 -> 1 -> 2
    const edges: AdjacencyList = new Map([
      [0, [1]],
      [1, [2]],
    ])
    const sccs = tarjanSCC(3, edges)
    expect(sccs).toHaveLength(0)
  })

  it('detects a simple two-node cycle', () => {
    // 0 -> 1 -> 0
    const edges: AdjacencyList = new Map([
      [0, [1]],
      [1, [0]],
    ])
    const sccs = tarjanSCC(2, edges)
    expect(sccs).toHaveLength(1)
    expect(sccs[0]).toHaveLength(2)
    expect(sccs[0]).toContain(0)
    expect(sccs[0]).toContain(1)
  })

  it('detects a three-node cycle', () => {
    // 0 -> 1 -> 2 -> 0
    const edges: AdjacencyList = new Map([
      [0, [1]],
      [1, [2]],
      [2, [0]],
    ])
    const sccs = tarjanSCC(3, edges)
    expect(sccs).toHaveLength(1)
    expect(sccs[0]).toHaveLength(3)
  })

  it('detects multiple independent cycles', () => {
    // Cycle 1: 0 <-> 1, Cycle 2: 2 <-> 3
    const edges: AdjacencyList = new Map([
      [0, [1]],
      [1, [0]],
      [2, [3]],
      [3, [2]],
    ])
    const sccs = tarjanSCC(4, edges)
    expect(sccs).toHaveLength(2)
  })

  it('ignores self-loops (size-1 SCC)', () => {
    // 0 -> 0 (self-loop)
    const edges: AdjacencyList = new Map([[0, [0]]])
    const sccs = tarjanSCC(1, edges)
    // Self-loops are SCCs of size 1 — filtered out
    expect(sccs).toHaveLength(0)
  })

  it('handles disconnected graph with no cycles', () => {
    const edges: AdjacencyList = new Map()
    const sccs = tarjanSCC(5, edges)
    expect(sccs).toHaveLength(0)
  })

  it('handles a complex graph with one cycle and acyclic branches', () => {
    // 0 -> 1 -> 2 -> 1 (cycle), 0 -> 3 (acyclic)
    const edges: AdjacencyList = new Map([
      [0, [1, 3]],
      [1, [2]],
      [2, [1]],
    ])
    const sccs = tarjanSCC(4, edges)
    expect(sccs).toHaveLength(1)
    expect(sccs[0]).toContain(1)
    expect(sccs[0]).toContain(2)
    expect(sccs[0]).not.toContain(0)
  })
})
