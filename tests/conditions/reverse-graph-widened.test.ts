/**
 * The reverse graph, after it stopped having its own idea of what an import is —
 * plan 0071 test-inventory item 20 and §3's last row.
 *
 * Three hand-rolled collectors became one `edgesOf` pass. The old dynamic-import
 * collector was bug 0014 in the reverse direction: it tried eight filename
 * candidates and skipped every non-relative specifier, so a module reachable only
 * via `import('some-installed-pkg')` looked dead.
 *
 * **Every kind counts here, including `require` and `type-expression`** — the
 * opposite of the forward conditions, because the two directions ask different
 * questions. Forward: "does this file depend on something banned?", where a
 * `require` finding has no usable remedy. Reverse: "is anything referencing this
 * file?", where a `require` means **yes**. Excluding it forward avoids an
 * unactionable finding; excluding it here would manufacture a wrong one.
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { modules, project } from '../../src/index.js'

const fixtureRoot = path.join(import.meta.dirname, '../fixtures/module-edge-conditions')
const p = project(path.join(fixtureRoot, 'tsconfig.json'))

/** Who the reverse graph says references `banned/secret.ts`. */
const importersOfSecret = (): string[] =>
  modules(p)
    .that()
    .resideInFile('**/module-edge-conditions/src/banned/*')
    .should()
    .onlyBeImportedVia('**/nothing-matches-this.ts')
    .violations()
    .map((v) => {
      // The message names the importer by PATH from the project root since the identity
      // release — two importers sharing a basename otherwise printed byte-identically, and
      // once they get separate baseline entries an adopter is handed a red they cannot
      // locate. Reduced to the basename HERE so these rows keep asserting which KINDS the
      // reverse graph counts, which is what this file is about; `identity-uniqueness` and
      // `baseline-portability` are where the path form itself is pinned.
      const match = /is imported by (\S+)/.exec(v.message)
      return (match?.[1] ?? '?').split('/').pop() ?? '?'
    })
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

describe('item 20 — one importer, one reverse edge', () => {
  /**
   * `addToGraph` took a `deduplicate` flag and static imports passed **false**, so
   * one file importing one target twice produced two byte-identical violations at
   * the same `file:line` — and therefore two identical baseline hashes for one
   * fact. `imports-twice.ts` is that shape: a value import and a type import of
   * the same module.
   */
  it('reports a file that imports one target twice exactly once', () => {
    const importers = importersOfSecret()

    expect(importers.filter((name) => name === 'imports-twice.ts')).toHaveLength(1)
    // Non-vacuity: the file really does carry two edges to that target, so "once"
    // is a dedup rather than a miss.
    expect(importers.length).toBeGreaterThan(5)
  })

  it('lists every referencing file exactly once', () => {
    const importers = importersOfSecret()
    expect(importers).toEqual([...new Set(importers)])
  })
})

describe('the reverse graph sees every kind', () => {
  it('counts a CJS require as a reference, so the target is not dead', () => {
    // Two spellings, both classified `require` and both excluded from the FORWARD
    // conditions. Here they must count, or `noDeadModules()` reports a module that
    // CJS code requires as an orphan.
    expect(importersOfSecret()).toContain('cjs-consumer.js')
    expect(importersOfSecret()).toContain('equals-consumer.d.ts')
  })

  it('counts a type expression as a reference', () => {
    // `type B = import('./banned/secret.js').SecretShape` is erased at runtime but
    // deleting the target breaks the build, so the module is not dead.
    expect(importersOfSecret()).toContain('consumer-type-expr.ts')
  })

  it('counts a dynamic import and a star re-export as references', () => {
    expect(importersOfSecret()).toContain('consumer-dynamic.ts')
    expect(importersOfSecret()).toContain('consumer-star.ts')
  })

  it('reports the full set, so a widening cannot quietly drop a kind', () => {
    // Full-set equality rather than a pile of `toContain`: those pass on a build
    // that also added something wrong. `clean.ts` and the banned module itself must
    // be absent — neither references `banned/secret.ts`.
    expect(importersOfSecret()).toEqual([
      'cjs-consumer.js',
      'consumer-dynamic.ts',
      'consumer-import.ts',
      'consumer-reexport-type.ts',
      'consumer-reexport.ts',
      'consumer-star.ts',
      'consumer-type-expr.ts',
      'equals-consumer.d.ts',
      'imports-twice.ts',
      'mixed.ts',
      'twice.ts',
    ])
  })
})
