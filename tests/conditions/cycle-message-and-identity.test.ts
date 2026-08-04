/**
 * A cycle finding says only what it can substantiate —
 * [bug 0055](../../bugs/fixed/0055-a-cycle-finding-names-edges-that-do-not-exist.md) and
 * [bug 0056](../../bugs/0056-a-cycle-identity-changes-when-imports-are-reordered.md).
 *
 * `beFreeOfCycles` printed a strongly-connected **component** as if it were a **path**:
 * `[...members, members[0]].join(' -> ')`. An SCC is a set, and `tarjanSCC` pops in
 * reverse-finish order, so for three or more members the sequence is not a traversal at
 * all. Measured on a true ring `a→b→c→d→a`: `Cycle detected: a -> d -> c -> b -> a` —
 * **every arrow reversed** — and on this repository's own source, two of the four arrows
 * in its flagship cycle finding named edges that do not exist.
 *
 * It also could not locate itself. `findSliceDependencyDetails(members[0], members[1])`
 * asks about the first two members of a *set*, which need not be an edge: on a 4-ring that
 * produced `unknown:0`, and when the pair happened to be an edge the location was a
 * perfectly **legal** import.
 *
 * Both are fixed here, and both fixes were only possible because
 * [plan 0088](../../plans/0088-a-slice-finding-identifies-itself.md) gave these findings an
 * `identity` — until then the message text *was* the baseline hash, so improving the
 * sentence invalidated every entry.
 */
import { describe, it, expect } from 'vitest'
import { Project, ts } from 'ts-morph'
import type { ArchProject } from '../../src/core/project.js'
import type { ArchViolation } from '../../src/core/violation.js'
import { slices } from '../../src/builders/slice-rule-builder.js'
import { hashViolation } from '../../src/helpers/baseline.js'

/** A ring: each slice imports the next, the last imports the first. */
function ring(names: readonly string[], leading = ''): ArchProject {
  const tsm = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { module: ts.ModuleKind.ESNext },
  })
  names.forEach((name, i) => {
    const next = names[(i + 1) % names.length]!
    tsm.createSourceFile(
      `/src/${name}/index.ts`,
      `${leading}import { v${next} } from '../${next}/index.js'\nexport const v${name} = v${next}\n`,
    )
  })
  return {
    tsConfigPath: '/tsconfig.json',
    _project: tsm,
    getSourceFiles: () => tsm.getSourceFiles(),
  }
}

const definition = (names: readonly string[]): Record<string, string> =>
  Object.fromEntries(names.map((n) => [n, `**/src/${n}/**`]))

const cyclesOf = (p: ArchProject, names: readonly string[]): ArchViolation[] =>
  slices(p)
    .assignedFrom(definition(names))
    .should()
    .beFreeOfCycles()
    .rule({ id: 'test/no-cycles', because: 'cycles break module init order' })
    .violations()
    .filter((v) => v.bypassFilters !== true)

describe('the cycle message asserts only real edges (bug 0055)', () => {
  it('a 4-ring names its members and ONE REAL edge, with no invented arrows', () => {
    const found = cyclesOf(ring(['a', 'b', 'c', 'd']), ['a', 'b', 'c', 'd'])
    expect(found.map((v) => v.element)).toEqual(['[a, b, c, d]'])

    // The old output was `Cycle detected: a -> d -> c -> b -> a`. Two claims now: the member
    // list, and one example edge that exists. `a -> b` is a real edge of this ring; the
    // reversed `a -> d` that the old code printed is not.
    expect(found[0]!.message).toBe(
      'Cycle detected between: a, b, c, d (e.g. a imports b at index.ts:1)',
    )
    // No arrow notation at all, which is the structural guarantee rather than a spot check:
    // a message that cannot render a path cannot render a wrong one.
    expect(found[0]!.message).not.toContain('->')
  })

  it('a 4-ring is LOCATED at a real edge, not unknown:0', () => {
    // The row plan 0085 thought it had: its version used a TWO-slice cycle, where
    // `members[0] -> members[1]` is necessarily an edge, so it never covered the shape that
    // breaks.
    const found = cyclesOf(ring(['a', 'b', 'c', 'd']), ['a', 'b', 'c', 'd'])
    expect(found[0]!.file).not.toBe('unknown')
    expect(found[0]!.file).toMatch(/src\/a\/index\.ts$/)
    expect(found[0]!.line).toBe(1)
  })

  it('the example edge is DETERMINISTIC, not filesystem-dependent', () => {
    // Found by bug 0010's portability test while writing this: taking the first matching
    // edge made the message depend on the file-walk order, so a reversed walk turned
    // "a imports b" into "c imports a". One finding, two messages, and `.excluding()`
    // matches the message.
    //
    // Asserted by building the same ring with the slices declared in reverse.
    const forward = cyclesOf(ring(['a', 'b', 'c']), ['a', 'b', 'c'])
    const reversed = cyclesOf(ring(['a', 'b', 'c']), ['c', 'b', 'a'])
    expect(reversed.map((v) => v.message)).toEqual(forward.map((v) => v.message))
    expect(reversed.map((v) => v.element)).toEqual(forward.map((v) => v.element))
  })

  it('a two-slice cycle still works — the easy case is not lost', () => {
    const found = cyclesOf(ring(['a', 'b']), ['a', 'b'])
    expect(found.map((v) => v.element)).toEqual(['[a, b]'])
    expect(found[0]!.message).toContain('Cycle detected between: a, b')
  })
})

describe('a cycle identity is a function of membership (bug 0056)', () => {
  it('reordering imports changes neither the element nor the hash', () => {
    // The fail-RED half of bug 0056. Before this, reordering two imports moved the element
    // from `[a, c, b]` to `[a, b, c]`, reddening CI on the edit "organize imports" performs
    // and printing "it may be stale after a rename" about a rename that never happened.
    //
    // Simulated by prefixing every file with comment lines, which shifts the walk and the
    // line numbers without changing a single edge.
    const plain = cyclesOf(ring(['a', 'b', 'c']), ['a', 'b', 'c'])
    const shifted = cyclesOf(ring(['a', 'b', 'c'], '// nothing to do with the graph\n'), [
      'a',
      'b',
      'c',
    ])

    expect(plain.map((v) => v.element)).toEqual(['[a, b, c]'])
    expect(shifted.map((v) => v.element)).toEqual(plain.map((v) => v.element))
    expect(shifted.map((v) => hashViolation(v))).toEqual(plain.map((v) => hashViolation(v)))
  })

  it('the identity is the sorted member set, and a member joining CHANGES it', () => {
    // Both directions: stable under noise, sensitive to membership. Without the second half
    // the identity could be a constant and the first half would still pass.
    const three = cyclesOf(ring(['a', 'b', 'c']), ['a', 'b', 'c'])
    const four = cyclesOf(ring(['a', 'b', 'c', 'd']), ['a', 'b', 'c', 'd'])

    expect(three.map((v) => v.identity)).toEqual(['cycle::a,b,c'])
    expect(four.map((v) => v.identity)).toEqual(['cycle::a,b,c,d'])
    expect(hashViolation(four[0]!)).not.toBe(hashViolation(three[0]!))
  })

  it('KNOWN LIMIT: a new cycle inside an already-waived component is still absorbed', () => {
    // Bug 0056's fail-OPEN half, which sorting does **not** fix and this release does not
    // claim to. It is not an ordering problem: `beFreeOfCycles` emits **one violation per
    // SCC**, so a new edge between two slices already in the component leaves the member set
    // byte-identical and an existing `.excluding()` silences it.
    //
    // Pinned as current behaviour so the limit is a decision rather than a surprise, and so
    // the row inverts when waiver granularity lands (plan 0088 Phase 4). Our own waiver
    // covers four of six gated slices, which is the blast radius of this limit.
    const names = ['a', 'b', 'c']
    const ringOnly = cyclesOf(ring(names), names)

    // Same ring plus a redundant back-edge `c -> b`: a genuinely new cycle (b↔c) inside the
    // same component.
    const tsm = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { module: ts.ModuleKind.ESNext },
    })
    tsm.createSourceFile(
      '/src/a/index.ts',
      "import { vb } from '../b/index.js'\nexport const va = vb\n",
    )
    tsm.createSourceFile(
      '/src/b/index.ts',
      "import { vc } from '../c/index.js'\nexport const vb = vc\n",
    )
    tsm.createSourceFile(
      '/src/c/index.ts',
      "import { va } from '../a/index.js'\nimport { vb } from '../b/index.js'\nexport const vc = va + vb\n",
    )
    const withExtraCycle: ArchProject = {
      tsConfigPath: '/tsconfig.json',
      _project: tsm,
      getSourceFiles: () => tsm.getSourceFiles(),
    }
    const both = cyclesOf(withExtraCycle, names)

    // Identical element and identical hash — so one baseline entry or one exclusion covers
    // both graphs. THIS IS THE LIMIT, not the fix.
    expect(both.map((v) => v.element)).toEqual(ringOnly.map((v) => v.element))
    expect(both.map((v) => hashViolation(v))).toEqual(ringOnly.map((v) => hashViolation(v)))
  })
})
