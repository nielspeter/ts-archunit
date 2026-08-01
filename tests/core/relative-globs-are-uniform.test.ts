import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { modules, slices } from '../../src/index.js'
import { resideInFile, resideInFolder, havePathMatching } from '../../src/predicates/identity.js'
import { atPath } from '../../src/presets/shared.js'
import { resolveByDefinition } from '../../src/models/slice.js'
import { diagnose } from '../../src/core/diagnose.js'
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

  it.each(surfaces)('$name still selects nothing for a genuinely absent folder', ({ count }) => {
    // The control. Normalizing everything into a match would satisfy both
    // assertions above.
    expect(count('src/no-such-folder/**')).toBe(0)
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

  it('CONTROL: an anchored glob keeps meaning "anywhere" on every surface', () => {
    for (const { name, count } of surfaces) {
      expect(count('**/domain/**'), name).toBeGreaterThan(0)
    }
  })
})
