import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const srcDir = path.resolve(import.meta.dirname, '../../src')

/**
 * Every place in `src/` that declares a path glob, read off the source.
 *
 * The point of deriving rather than listing: bug 0036 exists because the
 * uniformity table in `relative-globs-are-uniform.test.ts` is an `it.each` over
 * a **hand-written** array, and its stated purpose is that "a new surface added
 * without normalization fails". It cannot do that — a new surface adds no row.
 * A table over a hand-maintained list has exactly the defect it was written to
 * remove.
 *
 * `tests/docs/doc-globs-are-anchored.test.ts` already solves this shape, and
 * says why: it "knows which APIs it is classifying, so a new one is not
 * silently unchecked".
 */
function pathGlobSurfaces(): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.ts')) {
        const text = fs.readFileSync(full, 'utf8')
        // Per FILE, not per line: a line-based scan missed
        // `cross-layer-builder.ts` the moment prettier split its `globAnyOf(`
        // call across lines, which is a scan that silently stops covering a
        // surface — the exact failure this census exists to prevent.
        //
        // Both conditions, so `path-universe.ts` — which names the kinds in a
        // signature but declares nothing — is not counted as a surface.
        // `glob-site.ts` DEFINES `globAnyOf`/`globNode`; it is the mechanism,
        // not a surface. Excluded by name so the exclusion is visible rather
        // than encoded in a cleverer pattern.
        if (path.relative(srcDir, full) === 'core/glob-site.ts') continue
        const declares = text.includes('globAnyOf(') || text.includes('globNode(')
        const pathKind = text.includes("'file-path'") || text.includes("'parent-dir'")
        if (declares && pathKind) found.push(path.relative(srcDir, full))
      }
    }
  }
  walk(srcDir)
  return found.sort()
}

/**
 * Every path-glob surface, and what a project-relative glob means there.
 *
 * `normalized` — resolves against the project root.
 * `rewritten`  — `matching()`, which prefixes `'**\/'` instead. Looser, and
 *                deliberately not aligned: `'src/x/*'` there also matches a
 *                nested `src/x`, so aligning it NARROWS existing matches and
 *                needs its own release rather than a ride along with a fix.
 * `fixed`      — the library's own constant, not user input.
 */
const CLASSIFIED: Readonly<Record<string, 'normalized' | 'rewritten' | 'fixed'>> = {
  'predicates/identity.ts': 'normalized',
  'conditions/structural.ts': 'normalized',
  'conditions/function.ts': 'normalized',
  'conditions/reverse-dependency.ts': 'normalized',
  'builders/cross-layer-builder.ts': 'normalized',
  'smells/smell-builder.ts': 'normalized',
  'builders/slice-rule-builder.ts': 'rewritten',
  'graphql/resolver-rule-builder.ts': 'rewritten',
  'core/define.ts': 'fixed',
}

describe('every path-glob surface is classified (bug 0036)', () => {
  it('the census finds the surfaces it is meant to', () => {
    // A floor and a known member, so a broken scan cannot report "nothing to
    // classify" and pass — which is how a census turns into decoration.
    const files = pathGlobSurfaces()
    expect(files.length).toBeGreaterThanOrEqual(8)
    expect(files).toContain('predicates/identity.ts')
    expect(files).toContain('builders/cross-layer-builder.ts')
  })

  it('no surface is unclassified', () => {
    // THE guard. Adding a path-glob entry point without deciding what a
    // relative spelling means there fails here, naming the file and line —
    // which is the one thing the hand-written table could never do.
    expect(pathGlobSurfaces().filter((f) => CLASSIFIED[f] === undefined)).toEqual([])
  })

  it('nothing is classified that no longer declares a path glob', () => {
    // The other direction: a stale entry makes the table look more complete
    // than it is, and would mask a surface that later stops normalizing.
    const files = new Set(pathGlobSurfaces())
    expect(Object.keys(CLASSIFIED).filter((f) => !files.has(f))).toEqual([])
  })
})
