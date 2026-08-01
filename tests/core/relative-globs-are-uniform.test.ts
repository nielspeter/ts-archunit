import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { modules, slices, crossLayer, haveMatchingCounterpart } from '../../src/index.js'
import { resideInFile, resideInFolder, havePathMatching } from '../../src/predicates/identity.js'
import { atPath } from '../../src/presets/shared.js'
import { resolveByDefinition } from '../../src/models/slice.js'
import { diagnose } from '../../src/core/diagnose.js'
import { onlyImportFrom } from '../../src/conditions/dependency.js'
import { onlyBeImportedVia } from '../../src/conditions/reverse-dependency.js'
import { importFrom } from '../../src/predicates/module.js'
import { candidatesFor } from '../../src/core/import-candidates.js'
import type { ArchProject } from '../../src/core/project.js'

const tsconfigPath = path.resolve(import.meta.dirname, '../fixtures/modules/tsconfig.json')

function loadProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

const p = loadProject()

/**
 * Every surface that takes a path glob accepts the same two spellings — bug
 * 0033.
 *
 * Plan 0067 part C normalized the path predicates and left `assignedFrom()`
 * behind, so `layers: { api: 'src/api/**' }` failed beside a
 * `shared: ['src/shared/**']` that worked, **in the same preset call**. The
 * gap was found while writing 0067's docs, which had to ship a table of which
 * surface accepted what.
 *
 * A **table over the surfaces**, not one test each, and that is the point: a
 * per-surface test cannot fail when a NEW surface is added without
 * normalization, which is exactly how this gap appeared.
 */
describe('a project-relative path glob means the same thing everywhere (bug 0033)', () => {
  /** Each surface, as "select with this glob and tell me how many subjects". */
  const surfaces: readonly { name: string; count: (glob: string) => number }[] = [
    {
      name: 'resideInFolder',
      count: (g) => modules(p).that().satisfy(resideInFolder(g)).subjects().length,
    },
    {
      name: 'resideInFile',
      count: (g) => modules(p).that().satisfy(resideInFile(g)).subjects().length,
    },
    {
      name: 'havePathMatching',
      count: (g) => modules(p).that().satisfy(havePathMatching(g)).subjects().length,
    },
    {
      name: 'atPath (preset options)',
      count: (g) => modules(p).that().satisfy(atPath(g)).subjects().length,
    },
    {
      name: 'slices().assignedFrom',
      count: (g) => resolveByDefinition(p, { s: g })[0]?.files.length ?? 0,
    },
  ]

  it.each(surfaces)('$name selects the root folder from a relative glob', ({ count }) => {
    expect(count('src/domain/**')).toBeGreaterThan(0)
  })

  it.each(surfaces)('$name agrees with the absolute spelling of the same folder', ({ count }) => {
    // Not merely "both non-empty": the same COUNT. A surface that normalized to
    // "anywhere" instead of "at the root" would pass the test above and be
    // wrong on any project with a nested `src/`.
    expect(count('src/domain/**')).toBe(count(`${path.dirname(tsconfigPath)}/src/domain/**`))
  })

  it.each(surfaces)('$name means the ROOT folder, not any folder of that name', ({ count }) => {
    // The discriminator, and it was missing. The fixture had exactly one
    // `src/domain`, so relative and "anywhere" selected the same set and an
    // implementation using the looser rewrite `matching()` uses would have
    // passed every row. A nested second copy separates them: 3 against 4.
    expect(count('src/domain/**')).toBeLessThan(count('**/src/domain/**'))
  })

  it.each(surfaces)('$name still selects nothing for a genuinely absent folder', ({ count }) => {
    // The control. Normalizing everything into a match would satisfy both
    // assertions above.
    expect(count('src/no-such-folder/**')).toBe(0)
  })

  it('an IMPORT glob accepts the relative spelling too (bug 0037)', () => {
    // The false red this closed: `shared` in `layeredArchitecture` reaches
    // `onlyImportFrom(...)`, an import-target glob matched against the
    // ABSOLUTE resolved path — so `'src/shared/**'` could never match and a
    // correct architecture reported a violation. No configuration finding, and
    // `diagnose()` silent, because condition-position globs are exempt by
    // design. For an agent that is worse than a false green: it edits real
    // imports to satisfy a broken allowlist.
    const relative = modules(p)
      .that()
      .resideInFolder('**/domain/**')
      .should()
      .satisfy(onlyImportFrom('src/**'))
      .violations().length
    const anchored = modules(p)
      .that()
      .resideInFolder('**/domain/**')
      .should()
      .satisfy(onlyImportFrom('**/src/**'))
      .violations().length
    expect(relative).toBe(anchored)
  })

  it('CONTROL: a BARE specifier glob still matches, with no resolved path at all', () => {
    // Bug 0014's case, and the one the fix must not break: `'fastify'` names a
    // package, resolves to nothing inside the project, and has no root to be
    // relative to. The early return for `resolvedPath === undefined` is what
    // preserves it — assert through the real condition, not the helper.
    const candidates = candidatesFor('fastify', undefined, '/some/root')
    expect(candidates).toEqual(['fastify'])
  })

  it('CONTROL: the PRIMARY candidate is unchanged, so baselined findings do not move', () => {
    // The relative form is appended, never prepended. `[0]` is interpolated
    // into violation messages and hashed into baseline identities, so putting
    // it first would silently invalidate every existing dependency entry.
    const withRoot = candidatesFor('@scope/pkg', '/root/src/lib/a.ts', '/root')
    expect(withRoot[0]).toBe('/root/src/lib/a.ts')
    expect(withRoot).toContain('src/lib/a.ts')
    const withoutRoot = candidatesFor('@scope/pkg', '/root/src/lib/a.ts', undefined)
    expect(withoutRoot[0]).toBe(withRoot[0])
  })

  it('CONTROL: a target outside the root gets no relative candidate', () => {
    expect(candidatesFor('@scope/pkg', '/elsewhere/a.ts', '/root')).toEqual([
      '/elsewhere/a.ts',
      '@scope/pkg',
    ])
  })

  it('runtime and diagnosis agree for every surface', () => {
    // The split this fix nearly shipped with, twice — once in 0067 C for `./`,
    // once here: the glob RESOLVES but `diagnose()` still calls it dead, so
    // `doctor` reds a working rule and R3b's gate would fail the build.
    const relative = [
      modules(p).that().resideInFolder('src/domain/**').should().notImportFrom('**/x/**'),
      slices(p).assignedFrom({ domain: 'src/domain/**' }).should().beFreeOfCycles(),
    ]
    for (const rule of relative) {
      expect(diagnose([rule])).toEqual([])
      expect(rule.violations()).toEqual([])
    }
  })

  it('importFrom accepts the relative spelling (module predicate)', () => {
    // Measured before the fix: 0 modules selected where the anchored spelling
    // selected 5 — `predicates/module.ts` called `candidatesFor` without a root.
    const rel = modules(p).that().satisfy(importFrom('src/**')).subjects().length
    const anchored = modules(p).that().satisfy(importFrom('**/src/**')).subjects().length
    expect(rel).toBeGreaterThan(0)
    expect(rel).toBe(anchored)
  })

  it('crossLayer().layer stops reporting a relative glob as dead', () => {
    // Only the DIAGNOSIS is assertable here, and the gap is worth stating.
    // Measured: a `crossLayer` pair rule produces zero violations whether its
    // layer resolves three files or none, so the runtime half of this fix is
    // unobservable through the public API on any fixture — sabotaging it
    // survives, and no test I can write here would catch that.
    //
    // That is itself a finding, recorded in bug 0036: an empty `crossLayer`
    // layer is silent at check time and visible only to `doctor`, which is the
    // 0067-D/R3b discovery-fault shape one entry point over.
    const rule = (g: string) =>
      crossLayer(p)
        .layer('a', g)
        .layer('b', '**/services/**')
        .mapping(() => false)
        .forEachPair()
        .should(haveMatchingCounterpart([]))
    expect(diagnose([rule('src/domain/**')]).map((f) => f.glob)).not.toContain('src/domain/**')
    // The control that keeps the assertion above meaningful: a genuinely dead
    // layer glob IS still reported.
    expect(diagnose([rule('src/no-such-folder/**')]).map((f) => f.glob)).toContain(
      'src/no-such-folder/**',
    )
  })

  it('onlyBeImportedVia accepts the relative spelling — it was a false red', () => {
    // Measured before the fix: `'src/**'` produced 5 violations where
    // `'**/src/**'` produced none. The glob is matched against the IMPORTER's
    // absolute path, so a relative one rejected every importer — a false red,
    // the same shape as bug 0037 one layer over.
    const count = (g: string) =>
      modules(p)
        .that()
        .resideInFolder('**/domain/**')
        .should()
        .satisfy(onlyBeImportedVia(g))
        .violations().length
    expect(count('src/**')).toBe(count('**/src/**'))
  })

  it('CONTROL: an anchored glob keeps meaning "anywhere" on every surface', () => {
    for (const { name, count } of surfaces) {
      expect(count('**/domain/**'), name).toBeGreaterThan(0)
    }
  })
})
