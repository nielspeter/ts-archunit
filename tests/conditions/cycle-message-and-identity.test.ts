/**
 * A cycle finding says only what it can substantiate —
 * [bug 0055](../../bugs/fixed/0055-a-cycle-finding-names-edges-that-do-not-exist.md),
 * [bug 0056](../../bugs/fixed/0056-a-cycle-identity-changes-when-imports-are-reordered.md), and
 * [plan 0104](../../plans/completed/0104-a-cycle-waiver-names-the-edge-it-waives.md).
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
 *
 * Plan 0104 goes one step further: `beFreeOfCycles` used to emit **one violation for the
 * whole component**, naming one example edge only — so `.excluding()`, which matches
 * `element`, could only ever waive the entire tangle, and a brand-new edge between two
 * already-waived members was silently absorbed (the KNOWN LIMIT test below, before it
 * inverted). Every internal edge of the component now gets its own violation, `element`,
 * and `identity`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
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
  it('a 4-ring reports every real edge, with no invented arrows', () => {
    const found = cyclesOf(ring(['a', 'b', 'c', 'd']), ['a', 'b', 'c', 'd'])
    // One violation per internal edge (plan 0104), not one for the whole component.
    expect(found.map((v) => v.element)).toEqual(['a -> b', 'b -> c', 'c -> d', 'd -> a'])

    // The old output was `Cycle detected: a -> d -> c -> b -> a` — an invented, reversed
    // path. Every edge below is a real, substantiated fact about that specific edge, not
    // an "e.g." example of the component.
    expect(found.map((v) => v.message)).toEqual([
      'Cycle detected: "a" imports "b" at index.ts:1, part of a cycle with: a, b, c, d',
      'Cycle detected: "b" imports "c" at index.ts:1, part of a cycle with: a, b, c, d',
      'Cycle detected: "c" imports "d" at index.ts:1, part of a cycle with: a, b, c, d',
      'Cycle detected: "d" imports "a" at index.ts:1, part of a cycle with: a, b, c, d',
    ])
    // No arrow notation in the message at all — the structural guarantee rather than a
    // spot check: a message that cannot render a path cannot render a wrong one.
    for (const v of found) expect(v.message).not.toContain('->')
  })

  it("every one of a 4-ring's edges is LOCATED at a real site, not unknown:0", () => {
    // The row plan 0085 thought it had: its version used a TWO-slice cycle, where
    // `members[0] -> members[1]` is necessarily an edge, so it never covered the shape that
    // breaks. Checked on EVERY violation, not just `found[0]` — index-0-only would stay
    // green whether every edge locates correctly or only the first one does.
    const found = cyclesOf(ring(['a', 'b', 'c', 'd']), ['a', 'b', 'c', 'd'])
    expect(found).toHaveLength(4)
    for (const v of found) {
      expect(v.file).not.toBe('unknown')
      expect(v.file).toMatch(/src\/[a-d]\/index\.ts$/)
      expect(v.line).toBe(1)
    }
  })

  it('every edge is DETERMINISTIC, not filesystem-dependent', () => {
    // Found by bug 0010's portability test while writing this: taking the first matching
    // edge made the message depend on the file-walk order, so a reversed walk turned
    // "a imports b" into "c imports a". One finding, two messages, and `.excluding()`
    // matches the message. Checked over the WHOLE array, not one representative edge —
    // the property that made the pre-0104 single-edge selection need this fix in the
    // first place now has to hold for every edge, not just one.
    const forward = cyclesOf(ring(['a', 'b', 'c']), ['a', 'b', 'c'])
    const reversed = cyclesOf(ring(['a', 'b', 'c']), ['c', 'b', 'a'])
    expect(forward.map((v) => v.element)).toEqual(['a -> b', 'b -> c', 'c -> a'])
    expect(reversed.map((v) => v.element)).toEqual(forward.map((v) => v.element))
    expect(reversed.map((v) => v.message)).toEqual(forward.map((v) => v.message))
  })

  it('a two-slice cycle produces two independently-EXCLUDABLE edges', () => {
    // The smallest-blast-radius-looking case is actually the most affected: every
    // 2-slice cycle test in the suite doubles its violation count under plan 0104. And
    // this is the case this plan's whole premise depends on: waive ONE direction, not
    // both — proven live, not merely by two distinct `element` strings existing.
    const p = ring(['a', 'b'])
    const found = cyclesOf(p, ['a', 'b'])
    expect(found.map((v) => v.element)).toEqual(['a -> b', 'b -> a'])
    expect(found[0]!.message).toContain('Cycle detected: "a" imports "b"')
    expect(found[1]!.message).toContain('Cycle detected: "b" imports "a"')

    const filtered = slices(p)
      .assignedFrom(definition(['a', 'b']))
      .should()
      .beFreeOfCycles()
      .rule({ id: 'test/no-cycles', because: 'cycles break module init order' })
      .excluding('a -> b')
      .violations()
      .filter((v) => v.bypassFilters !== true)
    // Absent, not merely that the other remains — a no-op `.excluding()` would also
    // leave `'b -> a'` present.
    expect(filtered.map((v) => v.element)).toEqual(['b -> a'])
  })

  it('the historical 4-slice/6-edge shape (bug 0055) produces 6 distinct violations, 6 distinct identities', () => {
    // Reconstructed from bug 0055's ground-truth table, not our own live source (which
    // has since changed): builders -> {conditions, helpers, predicates}, conditions ->
    // helpers, helpers -> builders, predicates -> helpers. One SCC, 6 real edges — the
    // case this plan exists to fix, asserted at the granularity the fix targets.
    const names = ['builders', 'conditions', 'helpers', 'predicates']
    const tsm = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { module: ts.ModuleKind.ESNext },
    })
    tsm.createSourceFile(
      '/src/builders/index.ts',
      "import { c } from '../conditions/index.js'\n" +
        "import { h } from '../helpers/index.js'\n" +
        "import { p } from '../predicates/index.js'\n" +
        'export const b = c + h + p\n',
    )
    tsm.createSourceFile(
      '/src/conditions/index.ts',
      "import { h } from '../helpers/index.js'\nexport const c = h\n",
    )
    tsm.createSourceFile(
      '/src/helpers/index.ts',
      "import { b } from '../builders/index.js'\nexport const h = b\n",
    )
    tsm.createSourceFile(
      '/src/predicates/index.ts',
      "import { h } from '../helpers/index.js'\nexport const p = h\n",
    )
    const p: ArchProject = {
      tsConfigPath: '/tsconfig.json',
      _project: tsm,
      getSourceFiles: () => tsm.getSourceFiles(),
    }
    const found = cyclesOf(p, names)

    expect(found.map((v) => v.element)).toEqual([
      'builders -> conditions',
      'builders -> helpers',
      'builders -> predicates',
      'conditions -> helpers',
      'helpers -> builders',
      'predicates -> helpers',
    ])
    expect(new Set(found.map((v) => v.identity)).size).toBe(6)
  })
})

describe('a cycle identity is a function of its edges (bug 0056, plan 0104)', () => {
  it('reordering imports changes neither the elements nor the hashes', () => {
    // The fail-RED half of bug 0056. Before this, reordering two imports moved the element
    // from `[a, c, b]` to `[a, b, c]`, reddening CI on the edit "organize imports" performs
    // and printing "it may be stale after a rename" about a rename that never happened.
    // Checked over the whole array — plan 0104 multiplies one component into N edges, and
    // the order-independence has to hold for every one of them.
    //
    // Simulated by prefixing every file with comment lines, which shifts the walk and the
    // line numbers without changing a single edge.
    const plain = cyclesOf(ring(['a', 'b', 'c']), ['a', 'b', 'c'])
    const shifted = cyclesOf(ring(['a', 'b', 'c'], '// nothing to do with the graph\n'), [
      'a',
      'b',
      'c',
    ])

    expect(plain.map((v) => v.element)).toEqual(['a -> b', 'b -> c', 'c -> a'])
    expect(shifted.map((v) => v.element)).toEqual(plain.map((v) => v.element))
    expect(shifted.map((v) => hashViolation(v))).toEqual(plain.map((v) => hashViolation(v)))
  })

  it('the identity is per edge, and a member joining changes only the affected edges', () => {
    // Both directions: stable under noise, sensitive to a REAL change. The 3-ring and the
    // 4-ring share their first two edges (a imports b, b imports c) — only the ring's
    // closing edge differs (c -> a becomes c -> d, d -> a). The minimal-diff property plan
    // 0104 exists to deliver: the two SHARED edges keep byte-identical identity and
    // element; only the edges that actually changed move. (A fuller fixture — a ring plus
    // a 4th slice joining via one genuinely new edge, with all THREE original edges
    // untouched — is below, in "the minimal-diff property, on a real fixture".)
    const three = cyclesOf(ring(['a', 'b', 'c']), ['a', 'b', 'c'])
    const four = cyclesOf(ring(['a', 'b', 'c', 'd']), ['a', 'b', 'c', 'd'])

    expect(three.map((v) => v.element)).toEqual(['a -> b', 'b -> c', 'c -> a'])
    expect(four.map((v) => v.element)).toEqual(['a -> b', 'b -> c', 'c -> d', 'd -> a'])

    const shared = (found: ArchViolation[]) =>
      found.filter((v) => v.element === 'a -> b' || v.element === 'b -> c')
    // `identity` AND `element` both — a sabotage that decorates one field but not the
    // other must not pass this test.
    expect(shared(four).map((v) => v.identity)).toEqual(shared(three).map((v) => v.identity))
    expect(shared(four).map((v) => v.element)).toEqual(shared(three).map((v) => v.element))

    // The closing edge is what actually changed, and it gets a new identity.
    expect(three.map((v) => v.identity)).toContain('cycle-edge::c->a')
    expect(four.map((v) => v.identity)).not.toContain('cycle-edge::c->a')
    expect(hashViolation(four.find((v) => v.element === 'd -> a')!)).not.toBe(
      hashViolation(three.find((v) => v.element === 'c -> a')!),
    )
  })

  it('the minimal-diff property, on a real fixture: a slice joining leaves every pre-existing edge untouched', () => {
    // A 3-member ring (a -> b -> c -> a) plus a 4th slice `d` that joins via ONE new edge
    // (`d` imports `a`, and `c` now imports `d` instead of `a` directly)... is still not
    // quite it, because `c`'s target changes. Build the fixture directly instead of via
    // `ring()`, so all three original edges survive untouched and `d` adds exactly one new
    // edge into the existing cycle: `d` imports `a` (closing a NEW cycle `a -> b -> c ->
    // ... `) — no: the simplest genuine superset is `d` importing into the ring without
    // removing any existing edge, i.e. `c` gains a second import, of `d`, and `d` imports
    // `a`. That leaves `a -> b`, `b -> c`, `c -> a` all present, unchanged, and adds `c ->
    // d`, `d -> a` as two genuinely new edges — proving the table in plan 0104's "Why
    // per-edge": an edit that changes part of a component invalidates only the edges that
    // changed, not the whole component's identity.
    const before = cyclesOf(ring(['a', 'b', 'c']), ['a', 'b', 'c'])

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
      "import { va } from '../a/index.js'\nimport { vd } from '../d/index.js'\nexport const vc = va + vd\n",
    )
    tsm.createSourceFile(
      '/src/d/index.ts',
      "import { va } from '../a/index.js'\nexport const vd = va\n",
    )
    const withD: ArchProject = {
      tsConfigPath: '/tsconfig.json',
      _project: tsm,
      getSourceFiles: () => tsm.getSourceFiles(),
    }
    const after = cyclesOf(withD, ['a', 'b', 'c', 'd'])

    expect(before.map((v) => v.element)).toEqual(['a -> b', 'b -> c', 'c -> a'])
    expect(after.map((v) => v.element)).toEqual(['a -> b', 'b -> c', 'c -> a', 'c -> d', 'd -> a'])

    // Every pre-existing edge's identity AND element are byte-identical before and after.
    const preExisting = (found: ArchViolation[]) => found.slice(0, 3)
    expect(preExisting(after).map((v) => v.identity)).toEqual(
      preExisting(before).map((v) => v.identity),
    )
    expect(preExisting(after).map((v) => v.element)).toEqual(
      preExisting(before).map((v) => v.element),
    )
    // (Not `hashViolation` here: `before`/`after` are built from two DIFFERENT
    // `assignedFrom()` slice definitions — 3 slices vs. 4 — so `context.rule`'s own
    // description text legitimately differs between them, which alone would move every
    // hash regardless of `identity`. `identity`/`element` are the fields that isolate the
    // per-edge claim from that unrelated difference; the dedicated
    // "reordering imports..." and "identity survives a message rewrite" tests above
    // already prove `hashViolation` tracks `identity` correctly within ONE fixed rule.)
    // Only the two new edges are new.
    expect(after.slice(3).map((v) => v.identity)).toEqual(['cycle-edge::c->d', 'cycle-edge::d->a'])
  })

  it('a departing slice makes only its own edges stale', () => {
    // The reverse of the above: start with 4 members, remove one so the SCC narrows to 3;
    // the 3 surviving edges are unchanged and only the departed slice's edges disappear.
    const four = cyclesOf(ring(['a', 'b', 'c', 'd']), ['a', 'b', 'c', 'd'])
    const three = cyclesOf(ring(['a', 'b', 'c']), ['a', 'b', 'c'])

    const surviving = (found: ArchViolation[]) =>
      found.filter((v) => v.element === 'a -> b' || v.element === 'b -> c')
    expect(surviving(three).map((v) => v.identity)).toEqual(surviving(four).map((v) => v.identity))
    expect(surviving(three).map((v) => v.element)).toEqual(surviving(four).map((v) => v.element))

    expect(four.map((v) => v.identity)).toEqual(
      expect.arrayContaining(['cycle-edge::c->d', 'cycle-edge::d->a']),
    )
    expect(three.map((v) => v.identity)).not.toContain('cycle-edge::c->d')
    expect(three.map((v) => v.identity)).not.toContain('cycle-edge::d->a')
  })

  it('location is per-edge, not shared across edges in one component', () => {
    // A regression this plan's per-edge loop could silently reintroduce by reusing a
    // hoisted `site` variable: two distinct edges in one SCC must report their OWN
    // file/line, not both point at the same one.
    const found = cyclesOf(ring(['a', 'b', 'c']), ['a', 'b', 'c'])
    const files = found.map((v) => v.file)
    expect(new Set(files).size).toBe(files.length)
  })

  it('identity survives a message rewrite', () => {
    // The same invariant plan 0088's own test inventory demanded for the original
    // component-scoped identity field, re-proven for the edge-scoped one: the hash reads
    // `identity` when present and ignores `message` entirely.
    const [violation] = cyclesOf(ring(['a', 'b']), ['a', 'b'])
    const rewritten: ArchViolation = { ...violation!, message: 'a completely different sentence' }
    expect(hashViolation(rewritten)).toBe(hashViolation(violation!))
  })

  it('the identity prefix is distinct at the point of collision, not just in the abstract', () => {
    // An old-format `cycle::` entry must not accidentally "match" a new-format
    // `cycle-edge::` finding by coincidence — and this has to be a MINIMAL pair
    // (same edge spec, only the prefix differs), or the test proves hash
    // injectivity over two arbitrary strings instead of prefix-sensitivity
    // (review: testing — comparing against `'cycle::a,b'`, the OLD
    // member-list notation, differs from the real identity in both prefix AND
    // notation, so the assertion would still pass even if `slice.ts` were
    // sabotaged to reuse the `cycle::` prefix on the NEW edge notation — the
    // exact sabotage row this test is named for. Verified: reverting the
    // prefix to `cycle::` in `slice.ts` now reds this test; it did not before).
    const [violation] = cyclesOf(ring(['a', 'b']), ['a', 'b'])
    // Derived from `element` (unaffected by the sabotage row this guards),
    // NOT by string-editing `violation!.identity` — deriving from `identity`
    // would make this comparator track whatever prefix production code
    // happens to use, defeating the whole point of an independent check.
    const edgeSpec = violation!.element.replace(' -> ', '->')
    const samePrefixOldScheme: ArchViolation = { ...violation!, identity: `cycle::${edgeSpec}` }
    expect(hashViolation(samePrefixOldScheme)).not.toBe(hashViolation(violation!))
  })

  it('the message still starts with "Cycle detected"', () => {
    // Protects tests/presets/cycle-claims-match-behaviour.test.ts's existing
    // `message.startsWith('Cycle detected')` filter.
    const found = cyclesOf(ring(['a', 'b']), ['a', 'b'])
    for (const v of found) expect(v.message.startsWith('Cycle detected')).toBe(true)
  })

  it('THE FIX: a new cycle inside an already-waived component is now REPORTED, not absorbed', () => {
    // Bug 0056's fail-OPEN half, and its own prediction: "the row inverts when waiver
    // granularity lands." Before plan 0104, `beFreeOfCycles` emitted ONE violation per
    // SCC, so a new edge between two slices already in the component left the (whole-
    // component) element byte-identical and an existing `.excluding()` silenced it. This
    // is that inversion, proved live — not just by hash inequality, which alone would not
    // show `.excluding()` actually fails closed (Problem point 3: `.excluding()` never
    // read `identity`, only `element`/`file`/`message`).
    const names = ['a', 'b', 'c']
    const ringOnly = cyclesOf(ring(names), names)
    expect(ringOnly.map((v) => v.element)).toEqual(['a -> b', 'b -> c', 'c -> a'])

    // Same ring plus a redundant back-edge `c -> b`: a genuinely new cycle (b <-> c)
    // inside the same component.
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

    // A 4th edge, genuinely new — not merely "also present alongside the ring".
    expect(both.map((v) => v.element)).toEqual(['a -> b', 'b -> c', 'c -> a', 'c -> b'])
    expect(ringOnly.map((v) => v.identity)).not.toContain('cycle-edge::c->b')
    expect(both.map((v) => v.identity)).toContain('cycle-edge::c->b')

    // A `.excluding()` chain naming only the ring's 3 edges must NOT waive the new one —
    // and must prove REMOVAL, not merely that the 4th edge is "also" present, which a
    // completely no-op `.excluding()` would also satisfy.
    const filtered = slices(withExtraCycle)
      .assignedFrom(definition(names))
      .should()
      .beFreeOfCycles()
      .rule({ id: 'test/no-cycles', because: 'cycles break module init order' })
      .excluding('a -> b', 'b -> c', 'c -> a')
      .violations()
      .filter((v) => v.bypassFilters !== true)

    expect(filtered.map((v) => v.element)).toEqual(['c -> b'])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('a loose regex over the message clause warns against REAL beFreeOfCycles output, not just a synthetic fixture', () => {
    // The mechanical over-broad-exclusion check (execute-rule.ts) has its own
    // unit test in tests/core/excluding-matching.test.ts, built from a
    // hand-maintained `cycleEdge()` helper whose identity/element/message are a
    // copy of the producer's shape (review: architect + testing, independently
    // — nothing exercised the check against the REAL producer's actual output,
    // so a future drift between the two copies — e.g. `slice.ts` renaming the
    // `cycle-edge::` prefix — would silently stop firing while that unit test
    // stayed green). This is that missing integration test: a real 3-ring,
    // through the real chain, with the exact loose-regex loophole the plan's
    // own Problem section names.
    const names = ['a', 'b', 'c']
    const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const filtered = slices(ring(names))
      .assignedFrom(definition(names))
      .should()
      .beFreeOfCycles()
      .rule({ id: 'test/no-cycles', because: 'cycles break module init order' })
      .excluding(/part of a cycle with: a, b, c/)
      .violations()
      .filter((v) => v.bypassFilters !== true)

    // The loose regex still silently absorbs all three edges — that half of
    // the loophole is real and unchanged by the mechanical check.
    expect(filtered).toEqual([])

    const text = warn.mock.calls.map((call) => String(call[0])).join('\n')
    expect(text).toContain('matched 3 distinct cycle edges')
    expect(text).toContain('a -> b')
    expect(text).toContain('b -> c')
    expect(text).toContain('c -> a')
    expect(text).toContain(".excluding('a -> b', 'b -> c', 'c -> a')")
  })
})
