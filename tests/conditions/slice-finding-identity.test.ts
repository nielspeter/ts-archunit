/**
 * A slice finding identifies itself —
 * [plan 0088](../../plans/0088-a-slice-finding-identifies-itself.md).
 *
 * No slice condition set `ArchViolation.identity`, so `hashViolation` fell back to
 * `` `${element}::${message}` ``. That one fact caused three separate defects:
 *
 *  1. **Barrel findings collapsed to one baseline entry.** `notDependOn` pushes one
 *     violation per dependency *site*, with `element` = the basename and a message naming
 *     only the slice pair — so thirty re-exports into one forbidden slice were thirty
 *     findings with **one** hash, and one baseline entry accepted all thirty. Measured
 *     before this fix: 3 sites at lines 1, 2 and 3, **1 distinct hash.**
 *  2. **The cycle message could not be improved**, because the message text *was* the
 *     hash. `edgeVerb()` had returned `'re-exports'` since v0.28.0 and no slice condition
 *     could use it without invalidating every baseline.
 *  3. The cycle identity carried traversal order —
 *     [bug 0056](../../bugs/fixed/0056-a-cycle-identity-changes-when-imports-are-reordered.md).
 *
 * This is [bug 0028](../../bugs/fixed/0028-two-findings-in-one-file-can-share-a-baseline-identity.md)'s
 * shape in the family that never got the fix. `docs/upgrading.md`'s own 0.28.0 row says it
 * for the dependency conditions — *"**Do not baseline a barrel**: 46.5% of its findings
 * share an identity with a sibling"* — and v0.48.0 is the release that made barrels
 * *slice*-dependency-bearing.
 */
import { describe, it, expect } from 'vitest'
import { Project, ts } from 'ts-morph'
import type { ArchProject } from '../../src/core/project.js'
import type { ArchViolation } from '../../src/core/violation.js'
import { slices } from '../../src/builders/slice-rule-builder.js'
import { hashViolation } from '../../src/helpers/baseline.js'

function barrelProject(): ArchProject {
  const tsm = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { module: ts.ModuleKind.ESNext },
  })
  tsm.createSourceFile(
    '/src/legacy/index.ts',
    'export const a = 1\nexport const b = 2\nexport const c = 3\n',
  )
  // Three sites, ONE target slice, ONE specifier — differing only in the name crossing
  // the edge. That is what makes this the hard case: neither the file nor the specifier
  // separates them, so an identity built from those alone still collapses.
  tsm.createSourceFile(
    '/src/barrel/index.ts',
    "export { a } from '../legacy/index.js'\n" +
      "export { b } from '../legacy/index.js'\n" +
      "export { c } from '../legacy/index.js'\n",
  )
  return {
    tsConfigPath: '/tsconfig.json',
    _project: tsm,
    getSourceFiles: () => tsm.getSourceFiles(),
  }
}

const forbidden = (p: ArchProject): ArchViolation[] =>
  slices(p)
    .assignedFrom({ barrel: '**/src/barrel/**', legacy: '**/src/legacy/**' })
    .should()
    .notDependOn('legacy')
    .rule({ id: 'test/no-legacy', because: 'legacy is being retired' })
    .violations()
    .filter((v) => v.bypassFilters !== true)

describe('a barrel’s dependency sites are distinct findings (plan 0088)', () => {
  it('three sites produce three DISTINCT hashes', () => {
    const found = forbidden(barrelProject())

    // Non-vacuity: the collapse and a total absence of findings are indistinguishable
    // through a "distinct hashes" assertion alone.
    expect(found.map((v) => v.line)).toEqual([1, 2, 3])

    // The row that reds before the fix: 3 findings that used to share 1 hash.
    //
    // Asserted as "no duplicates", NOT as `new Set(hashes).size === 3` — this repo's own
    // cardinality scanner (plan 0079) flagged that spelling in this file, correctly: a
    // count is satisfiable by the wrong three hashes, and the number would need editing
    // every time the fixture grows.
    const hashes = found.map((v) => hashViolation(v))
    expect(hashes).toEqual([...new Set(hashes)])
  })

  it('the identity is built from the edge, not from the line', () => {
    // Asserted explicitly because it is the design decision, and because plan 0088's own
    // Phase 1 sketch got it wrong — it proposed `from→to@relpath:line`. A line is exactly
    // what `ArchViolation.identity` exists to survive: "a coordinate — `at line 12` moves
    // when anything above it is edited". `src/conditions/dependency.ts` omits it for that
    // reason, and this follows that scheme rather than inventing a second one.
    const found = forbidden(barrelProject())
    expect(found.map((v) => v.identity)).toEqual([
      'barrel->legacy::/src/barrel/index.ts::reexport::../legacy/index.js::a',
      'barrel->legacy::/src/barrel/index.ts::reexport::../legacy/index.js::b',
      'barrel->legacy::/src/barrel/index.ts::reexport::../legacy/index.js::c',
    ])
    for (const v of found) expect(v.identity).not.toMatch(/\d+$/)
  })

  it('two files sharing a BASENAME are distinct findings', () => {
    // The collision my first version shipped, found by reviewing it rather than by any
    // test. The identity used `getBaseName()` — copied from the dependency family — so two
    // sibling feature folders each with an `index.ts` re-exporting the same name from the
    // same specifier produced ONE identity for TWO violations, and one baseline entry
    // accepted both.
    //
    // That is plan 0088's own defect in a different shape, in the release that fixed it,
    // and the layout is the commonest there is. The dependency family still has it —
    // [bug 0063](../../bugs/fixed/0063-a-dependency-identity-collides-across-files-sharing-a-basename.md).
    const tsm = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { module: ts.ModuleKind.ESNext },
    })
    tsm.createSourceFile('/src/legacy/index.ts', 'export const x = 1\n')
    tsm.createSourceFile(
      '/src/features/alpha/index.ts',
      "export { x } from '../../legacy/index.js'\n",
    )
    tsm.createSourceFile(
      '/src/features/beta/index.ts',
      "export { x } from '../../legacy/index.js'\n",
    )
    const p: ArchProject = {
      tsConfigPath: '/tsconfig.json',
      _project: tsm,
      getSourceFiles: () => tsm.getSourceFiles(),
    }

    const found = slices(p)
      .assignedFrom({ features: '**/src/features/**', legacy: '**/src/legacy/**' })
      .should()
      .notDependOn('legacy')
      .rule({ id: 'test/no-legacy', because: 'legacy is being retired' })
      .violations()
      .filter((v) => v.bypassFilters !== true)

    // Same basename, same specifier, same names, same slice pair — everything the old
    // identity looked at was equal.
    expect(found.map((v) => v.file)).toEqual([
      '/src/features/alpha/index.ts',
      '/src/features/beta/index.ts',
    ])
    const hashes = found.map((v) => hashViolation(v))
    expect(hashes).toEqual([...new Set(hashes)])
  })

  it('inserting a line above the sites does NOT change their identities', () => {
    // The property the scheme was chosen for, and the one a line-based identity fails.
    const before = forbidden(barrelProject()).map((v) => hashViolation(v))

    const tsm = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { module: ts.ModuleKind.ESNext },
    })
    tsm.createSourceFile(
      '/src/legacy/index.ts',
      'export const a = 1\nexport const b = 2\nexport const c = 3\n',
    )
    tsm.createSourceFile(
      '/src/barrel/index.ts',
      '// a comment nobody thought about\n' +
        '// and another\n' +
        "export { a } from '../legacy/index.js'\n" +
        "export { b } from '../legacy/index.js'\n" +
        "export { c } from '../legacy/index.js'\n",
    )
    const shifted: ArchProject = {
      tsConfigPath: '/tsconfig.json',
      _project: tsm,
      getSourceFiles: () => tsm.getSourceFiles(),
    }

    const after = forbidden(shifted)
    // The lines moved…
    expect(after.map((v) => v.line)).toEqual([3, 4, 5])
    // …and every baseline entry still matches.
    expect(after.map((v) => hashViolation(v))).toEqual(before)
  })

  it('the identity survives a MESSAGE rewrite — the property Phase 3 depends on', () => {
    // The whole point of setting `identity`: the message becomes editable. Until this
    // shipped, improving the cycle message invalidated every cycle baseline, which is what
    // blocked bug 0055.
    //
    // Asserted by rewriting the message on a real finding and checking the hash holds. A
    // test that only compared two runs of the same code could not distinguish "identity is
    // independent of the message" from "the message happened not to change".
    const found = forbidden(barrelProject())
    expect(found.length).toBeGreaterThan(0)

    const reworded: ArchViolation = {
      ...found[0]!,
      message: 'a completely different sentence about the same dependency',
    }
    expect(hashViolation(reworded)).toBe(hashViolation(found[0]!))

    // And the control: a different EDGE is a different finding. Without this the row above
    // is satisfied by an identity that ignores everything.
    const otherEdge: ArchViolation = { ...found[0]!, identity: found[1]!.identity }
    expect(hashViolation(otherEdge)).not.toBe(hashViolation(found[0]!))
  })

  it('MIGRATION, measured: every slice finding’s hash moves exactly once', () => {
    // What the upgrade note claims, as a measurement rather than a hope — the row plan
    // 0084 omitted and paid for with a wrong migration note.
    //
    // The pre-0088 hash is reconstructible: it was `element::message` with no identity.
    const found = forbidden(barrelProject())
    const asBefore = found.map((v) => hashViolation({ ...v, identity: undefined }))
    const asNow = found.map((v) => hashViolation(v))

    // Every entry moves…
    for (const [i, before] of asBefore.entries()) expect(asNow[i]).not.toBe(before)
    // …and the old scheme really did collapse all three, which is why it had to. Stated as
    // identities rather than counts: every old hash was the SAME one, and no new hash
    // repeats.
    expect([...new Set(asBefore)]).toEqual([asBefore[0]])
    expect(asNow).toEqual([...new Set(asNow)])
  })
})
