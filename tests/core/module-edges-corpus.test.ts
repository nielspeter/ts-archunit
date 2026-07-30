/**
 * The walk, checked against differently-derived values over the whole
 * repository — plan 0071 test-inventory items 15 and 22.
 *
 * Both tests here answer ADR-008 rule 5: a derivation is unguarded until a
 * *differently*-derived value disagrees with it. The fixture tests next door
 * assert what the walk produces on 24 hand-written forms; these assert that it
 * agrees with two independent computations across 1900+ real edges.
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { Project } from 'ts-morph'
import { edgesOf } from '../../src/core/module-edges.js'
import { importCandidates } from '../../src/core/import-candidates.js'
import { candidatesFor } from '../../src/core/import-candidates.js'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const project = new Project({ tsConfigFilePath: path.join(repoRoot, 'tsconfig.json') })
const sourceFiles = project.getSourceFiles()

describe('item 15 — the import half is unchanged, per edge, over the whole repo', () => {
  /**
   * `moduleEdges` filtered to `kind === 'import'` must be sequence-equal to
   * `getImportDeclarations()` over `{line, candidates}`.
   *
   * **`typeOnly` is deliberately NOT compared.** Both sides would call the same
   * `isTypeOnlyImport`, so the comparison is `f(x) === f(x)` — verified: it
   * survives that function losing its `getDefaultImport()` guard, which is the
   * exact defect §2 calls load-bearing. `module-edges-forms.test.ts` line 12
   * carries that property instead, as an explicit expected value.
   *
   * What this DOES catch, measured: `line` taken from the literal, `resolvedPath`
   * always undefined, `resolvedPath` set to the importer's own path, and reversed
   * per-file edge order.
   *
   * **And what it does NOT, for the same reason `typeOnly` was dropped:**
   * `importCandidates` is now a wrapper over `candidatesFor`, so both sides of the
   * `candidates` comparison call one function and the *candidates rule* is
   * `f(x) === f(x)` too. Reverting `candidatesFor`'s relative-specifier branch is
   * caught by `tests/conditions/bare-package-imports.test.ts`, **not** here.
   *
   * What remains genuinely cross-derived is the two **inputs**: `getSymbol()` on
   * one side against `getModuleSpecifierSourceFile()` on the other. That is the
   * real content of this test, and it is worth having — but the docstring used to
   * enumerate what it catches while omitting this, which is the same tautology it
   * explicitly rescoped `typeOnly` out for one paragraph above.
   */
  it('agrees with getImportDeclarations() on line and candidates', () => {
    const mismatches: string[] = []
    let checked = 0

    for (const sf of sourceFiles) {
      const fromEdges = edgesOf(sf)
        .filter((e) => e.kind === 'import')
        .map((e) => ({
          line: e.line,
          candidates: [...candidatesFor(e.specifier, e.resolvedPath)].join('|'),
        }))
      const fromDeclarations = sf.getImportDeclarations().map((d) => ({
        line: d.getStartLineNumber(),
        candidates: [...importCandidates(d)].join('|'),
      }))

      if (fromEdges.length !== fromDeclarations.length) {
        mismatches.push(
          `${sf.getBaseName()}: ${String(fromEdges.length)} edges vs ${String(fromDeclarations.length)} declarations`,
        )
        continue
      }
      for (const [i, expected] of fromDeclarations.entries()) {
        const actual = fromEdges[i]
        checked += 1
        if (actual === undefined) {
          mismatches.push(`${sf.getBaseName()}[${String(i)}]: missing`)
        } else if (actual.line !== expected.line || actual.candidates !== expected.candidates) {
          mismatches.push(
            `${sf.getBaseName()}[${String(i)}]: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`,
          )
        }
      }
    }

    // Non-vacuity: if the filter or the walk returned nothing, both sides go
    // empty and every comparison holds. Measured at ~1750 import declarations.
    expect(checked).toBeGreaterThan(500)
    expect(mismatches).toEqual([])
  })

  /**
   * `importCandidates` and `isTypeOnlyImport` have **no production caller left**
   * after this release — the first only via this test's comparison, the second
   * only from inside `module-edges.ts`. Recorded so a later cleanup does not
   * delete the comparison's other half in good faith and leave `f(x) === f(x)`
   * with nothing to compare against.
   */
  it('keeps importCandidates reachable, which is this test`s whole premise', () => {
    const anyImport = sourceFiles
      .flatMap((sf) => sf.getImportDeclarations())
      .find((d) => d.getModuleSpecifierSourceFile() !== undefined)
    expect(anyImport).toBeDefined()
    if (anyImport) expect(importCandidates(anyImport).length).toBeGreaterThan(0)
  })
})

describe('item 22 — a relative specifier resolves to where the path says', () => {
  /**
   * The cheapest guard in the inventory, and the only one that checks a **star
   * edge's target** without importing anything.
   *
   * Draft 3 cut the dynamic half of the runtime independence guard and observed,
   * correctly, that "residual scope is relative specifiers, where both sides
   * reduce to a path join" — then cut the residual too. Two reviewers then found
   * that item 7 as specified passed with a star edge resolving to the **wrong
   * file** and with two star edges' targets **swapped**, because set equality is
   * symmetric under a swap and a star has no names to key on.
   *
   * This closes both, for every kind rather than re-exports only: the compiler's
   * resolution on one side, `resolve(dirname(importer), specifier)` on the other.
   * Measured to fail under a star/star swap and under `resolvedPath: undefined`.
   *
   * Scoped to relative specifiers because a bare or aliased specifier does NOT
   * reduce to a path join — that is what `paths` and `node_modules` lookup are
   * for, and asserting a join there would encode the resolver's algorithm rather
   * than check it.
   */
  it('agrees with a path join, for every kind', () => {
    const mismatches: string[] = []
    let checked = 0

    for (const sf of sourceFiles) {
      const importerDir = path.dirname(sf.getFilePath())
      for (const edge of edgesOf(sf)) {
        if (!edge.specifier.startsWith('.')) continue
        // Unresolved relative specifiers are skipped so this test stays about the
        // joined path. The test below asserts only that each kind has at least ONE
        // resolved relative edge — so it catches TOTAL per-kind unresolution and not
        // a partial one. Stated because "asserted below" overclaimed it.
        if (edge.resolvedPath === undefined) continue
        checked += 1

        // The declared `.js` specifier maps to the `.ts` source it was written
        // from — the same rewrite vite performs, and the reason the independence
        // guard's fixture uses `.js` specifiers.
        const joined = path.resolve(importerDir, edge.specifier)
        const candidates = [
          joined,
          joined.replace(/\.js$/, '.ts'),
          joined.replace(/\.js$/, '.tsx'),
          joined.replace(/\.js$/, '.d.ts'),
          // A directory specifier resolves to its index file.
          path.join(joined, 'index.ts'),
        ]
        if (!candidates.includes(edge.resolvedPath)) {
          mismatches.push(
            `${sf.getBaseName()}:${String(edge.line)} ${edge.kind} "${edge.specifier}" -> ${edge.resolvedPath}`,
          )
        }
      }
    }

    // Non-vacuity: `continue` on both branches above means a walk returning
    // nothing checks nothing.
    expect(checked).toBeGreaterThan(500)
    expect(mismatches).toEqual([])
  })

  it('covers more than one kind, or it is an import-only test wearing a label', () => {
    const kinds = new Set<string>()
    for (const sf of sourceFiles) {
      for (const edge of edgesOf(sf)) {
        if (edge.specifier.startsWith('.') && edge.resolvedPath !== undefined) kinds.add(edge.kind)
      }
    }
    // `import` and `reexport` are present in `src/` by the hundred and `dynamic`
    // by the handful. `require` and `type-expression` appear **zero** times in
    // `src/` — measured — so `tests/fixtures/module-edge-forms/` is what puts them
    // in the root program and makes "for every kind" true rather than aspirational.
    // If that fixture is ever moved out of the program, this drops to three and
    // says so instead of quietly narrowing.
    expect([...kinds].sort()).toEqual([
      'dynamic',
      'import',
      'reexport',
      'require',
      'type-expression',
    ])
  })
})

/**
 * Item 18 — the positive control the dogfood suite could not be.
 *
 * `tests/archunit/arch-rules.test.ts` passes **39/39 with `edgesOf` returning
 * `[]`** — measured, both before and after this release. Those are this repo's own
 * architecture rules, and they are the one place the walk could be checked against
 * real code at corpus scale; instead nothing there notices if it collects nothing.
 *
 * **Count floors and named structural edges, not a `relpath:line` snapshot.** Draft
 * 3 specified a list derived from `src/` after the widening, which is a snapshot pin
 * (ADR-008) — it churns on any import moving, and the cheapest way to green a churn
 * is to regenerate it, which is how a guard stops guarding.
 */
describe('item 18 — the walk sees this repository`s own real edges', () => {
  const srcEdges = (): { kind: string; from: string; to: string | undefined }[] => {
    const rows: { kind: string; from: string; to: string | undefined }[] = []
    for (const sf of sourceFiles) {
      const from = sf.getFilePath()
      if (!from.includes('/src/') || from.includes('/tests/')) continue
      for (const edge of edgesOf(sf)) {
        rows.push({ kind: edge.kind, from, to: edge.resolvedPath })
      }
    }
    return rows
  }

  it('meets a floor for every kind `src/` actually contains', () => {
    const rows = srcEdges()
    const count = (kind: string): number => rows.filter((r) => r.kind === kind).length

    // Floors, well below the measured 607 / 153, so ordinary churn does not move
    // them and a collapse to zero cannot hide.
    expect(count('import')).toBeGreaterThan(400)
    expect(count('reexport')).toBeGreaterThan(100)
    // `src/` contains zero of the other three — asserted so that a future one
    // arrives visibly rather than silently.
    expect(count('dynamic')).toBe(0)
    expect(count('require')).toBe(0)
    expect(count('type-expression')).toBe(0)
  })

  it('sees named structural edges that survive unrelated code moving', () => {
    const rows = srcEdges()
    const has = (fromEnds: string, toEnds: string, kind: string): boolean =>
      rows.some(
        (r) => r.from.endsWith(fromEnds) && r.to?.endsWith(toEnds) === true && r.kind === kind,
      )

    // The barrel re-exporting the project loader: structural, and the shape this
    // whole release exists to see. It was invisible before v0.28.0.
    expect(has('/src/index.ts', '/src/core/project.ts', 'reexport')).toBe(true)
    // A plain import that has to exist for the library to function at all.
    expect(has('/src/conditions/dependency.ts', '/src/core/module-edges.ts', 'import')).toBe(true)
    expect(
      has('/src/conditions/reverse-dependency.ts', '/src/core/module-edges.ts', 'import'),
    ).toBe(true)
  })

  it('resolves nearly every edge in `src/`, so a silent resolution failure shows', () => {
    const rows = srcEdges()
    const unresolved = rows.filter((r) => r.to === undefined)
    // Bare package specifiers legitimately do not resolve, so this is a ratio rather
    // than zero — but a broken `getSymbol()` would send it toward 100%.
    expect(unresolved.length / rows.length).toBeLessThan(0.2)
  })
})
