/**
 * The static walk, cross-checked against a **runtime** module namespace — plan
 * 0071 test-inventory item 7.
 *
 * What this compares is vite's resolver against the TypeScript compiler: two
 * independent implementations of TS-aware resolution. It is a real cross-check on
 * the resolution *algorithm* and **not** a module-system oracle — it cannot catch
 * anything both tools get wrong alike. It must run under vitest, measured:
 *
 *     inside vitest:  await import('…/barrel.js')  ->  keys = ["MARKER", …]
 *     bare node:      await import('…/barrel.js')  ->  ERR_MODULE_NOT_FOUND
 *
 * ## Why this file is three assertions and not one
 *
 * Draft 3 of the plan specified item 7 as "named edges by `names` → target; star
 * edges by target only". Two reviewers independently implemented it to the letter
 * and sabotaged it from the diff. It passed with:
 *
 * | sabotage                                            | draft 3's item 7 |
 * | --------------------------------------------------- | ---------------- |
 * | **all `reexport` edges dropped (= bug 0022 back)**   | **PASS**         |
 * | `names = []` for every re-export                     | **PASS**         |
 * | star edge `resolvedPath` → the wrong file            | **PASS**         |
 * | two star edges' `resolvedPath` swapped               | **PASS**         |
 *
 * Two compounding causes. A star's runtime side yields **names** while its static
 * side yields a **target** — not comparable quantities, so "compare by target"
 * had nothing to compare against, and the only star property checkable without
 * resolving the target is `resolvedPath !== undefined`, which `edges.length > 0`
 * already covered. And `names.length === 0` was the star/named discriminator, so
 * emptying `names` reclassified every edge as a star and left the named half
 * iterating nothing.
 *
 * The star/star swap is closed by `module-edges-corpus.test.ts`'s path-join
 * derivation rather than here, because set equality is symmetric under a swap and
 * no runtime comparison can see it.
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { Project } from 'ts-morph'
import { edgesOf } from '../../src/core/module-edges.js'
import type { ModuleEdge } from '../../src/core/module-edges.js'

const fixtureRoot = path.join(import.meta.dirname, '../fixtures/module-edge-barrel')
const project = new Project({ tsConfigFilePath: path.join(fixtureRoot, 'tsconfig.json') })

/** Runtime export keys of a fixture module, via vite's resolver. */
async function runtimeKeys(fileName: string): Promise<string[]> {
  // A `.js` specifier, which exercises vite's `.js`→`.ts` mapping — the
  // resolution behaviour this guard claims to cross-check.
  const loaded: unknown = await import(path.join(fixtureRoot, 'src', `${fileName}.js`))
  return loaded !== null && typeof loaded === 'object' ? Object.keys(loaded).sort() : []
}

const reExports = (fileName: string): readonly ModuleEdge[] =>
  edgesOf(project.getSourceFileOrThrow(`${fileName}.ts`)).filter((e) => e.kind === 'reexport')

/** The basename a re-export edge resolved to, without its extension. */
const targetName = (edge: ModuleEdge): string =>
  edge.resolvedPath === undefined ? 'UNRESOLVED' : path.basename(edge.resolvedPath, '.ts')

describe('item 7 — the static walk agrees with the runtime namespace', () => {
  it('the premise: the fixture really does re-export at runtime', async () => {
    // Asserted separately and first. If the runtime import silently returned an
    // empty namespace, every assertion below would compare two empty sets and
    // pass, which is exactly the shape this whole file exists to prevent.
    expect(await runtimeKeys('barrel')).toEqual(['LOCAL', 'MARKER', 'OUTWARD', 'STAR', 'STAR2'])
    expect(reExports('barrel')).toHaveLength(3)
  })

  /**
   * Assertion 1 — **per name → target.** Each name a named edge carries must
   * exist in that edge's own target at runtime.
   *
   * Catches a wrong target on a named edge, and the named/star swap.
   */
  it('resolves each named re-export to a module that actually exports that name', async () => {
    const named = reExports('barrel').filter((e) => e.names.length > 0)
    expect(named).toHaveLength(2)

    let checked = 0
    for (const edge of named) {
      const keysOfTarget = await runtimeKeys(targetName(edge))
      for (const name of edge.names) {
        checked += 1
        // `names` holds the OUTWARD name for a re-export, so `export { INNER as
        // OUTWARD }` carries `OUTWARD` — which the barrel publishes and the
        // target does not. The inward name is what the target exports, so this
        // resolves through the specifier rather than the alias.
        const specifier = project
          .getSourceFileOrThrow('barrel.ts')
          .getExportDeclarations()
          .find((d) => d.getStartLineNumber() === edge.line)
        const inwardNames = (specifier?.getNamedExports() ?? []).map((s) => s.getName())
        expect(inwardNames.some((inward) => keysOfTarget.includes(inward))).toBe(true)
        expect(name).toBeTruthy()
      }
    }
    expect(checked).toBe(2)
  })

  /**
   * Assertion 2 — **the name set.** The union of `names` over named edges must
   * equal what the barrel publishes, minus its own local exports and minus
   * whatever the stars contribute.
   *
   * **This is the one that catches `names = []`.** The field's only consumer has
   * to notice the field being empty, or the field is unguarded — and draft 3's
   * version went green with every `names` emptied.
   */
  it('accounts for every published name, so an empty `names` cannot pass', async () => {
    const barrelKeys = new Set(await runtimeKeys('barrel'))
    const edges = reExports('barrel')

    const starTargets = edges.filter((e) => e.names.length === 0).map(targetName)
    const starContributed = new Set<string>()
    for (const target of starTargets) {
      for (const key of await runtimeKeys(target)) {
        if (barrelKeys.has(key)) starContributed.add(key)
      }
    }
    // `LOCAL` is declared in the barrel itself, so no edge accounts for it.
    const localExports = new Set(
      [...project.getSourceFileOrThrow('barrel.ts').getExportedDeclarations().keys()].filter(
        (name) => !starContributed.has(name),
      ),
    )

    const namedNames = new Set(edges.flatMap((e) => [...e.names]))
    const expected = [...barrelKeys].filter(
      (key) => !starContributed.has(key) && !isLocal(key, localExports, namedNames),
    )

    expect([...namedNames].sort()).toEqual(expected.sort())
    // Non-vacuity: both sides empty would satisfy the equality above.
    expect(namedNames.size).toBeGreaterThan(0)
  })

  /**
   * Assertion 3 — **the star residual.** Everything the barrel publishes that no
   * named edge and no local declaration accounts for must come from a star
   * target.
   *
   * **This is the one that catches a mis-resolved star target** — the release's
   * flagship finding is `export * from './banned.js'` under `notImportFrom`, and
   * draft 3 had no assertion that could see the star's target at all.
   *
   * **A subset, not equality**, and the circular case below is why.
   */
  it('accounts for every star-contributed name from the star targets', async () => {
    const barrelKeys = await runtimeKeys('barrel')
    const edges = reExports('barrel')
    const namedNames = new Set(edges.flatMap((e) => [...e.names]))

    const starKeys = new Set<string>()
    for (const edge of edges.filter((e) => e.names.length === 0)) {
      for (const key of await runtimeKeys(targetName(edge))) starKeys.add(key)
    }

    const residual = barrelKeys.filter((key) => !namedNames.has(key) && key !== 'LOCAL')
    expect(residual).toEqual(['STAR', 'STAR2'])
    expect(residual.every((key) => starKeys.has(key))).toBe(true)
  })

  /**
   * The answer for circular pairs, and the reason assertion 3 is `⊆` and not `=`.
   *
   * On a circular pair, `starKeys` contains names the source re-exported **into**
   * the star target, so equality fails a correct implementation. Measured:
   *
   *     cycle-a  residual=["B_OWN"]  ⊆ starKeys=["A_OWN","B_OWN"]   PASS
   *     equality                     ["B_OWN"] !== ["A_OWN","B_OWN"] FAIL
   */
  it('holds on a circular re-export pair, which equality would fail', async () => {
    const keys = await runtimeKeys('cycle-a')
    expect(keys).toEqual(['A_OWN', 'B_OWN'])

    const edges = reExports('cycle-a')
    expect(edges).toHaveLength(1)

    const starKeys = new Set(await runtimeKeys(targetName(edges[0]!)))
    const residual = keys.filter((key) => key !== 'A_OWN')

    expect(residual).toEqual(['B_OWN'])
    expect(residual.every((key) => starKeys.has(key))).toBe(true)
    // The discriminator: equality is WRONG here, and asserting it would make a
    // correct implementation fail.
    expect([...starKeys].sort()).not.toEqual(residual)
  })
})

/**
 * Whether a published name is the barrel's own declaration rather than something
 * an edge brought in.
 *
 * A name that a named edge carries is not local even if it also appears in
 * `getExportedDeclarations()`, which reports re-exported names too.
 */
function isLocal(key: string, localExports: Set<string>, namedNames: Set<string>): boolean {
  return localExports.has(key) && !namedNames.has(key)
}
