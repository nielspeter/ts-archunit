/**
 * Presets forward `importOptions` to every condition that takes one — plan 0089.
 *
 * ## Why the option exists, and why it is ONE bag
 *
 * The conditions disagree by default, deliberately. `beFreeOfCycles` ignores
 * type-only imports because it asks whether the module is *evaluated*, and an
 * erased import cannot contribute to an initialization cycle. `respectLayerOrder`
 * and `notDependOn` count them because they ask whether the code is *coupled*,
 * and a shared type is coupling.
 *
 * Holding a builder that distinction is visible and you choose per condition.
 * Through a preset it is invisible — and plan 0089 was filed because a preset
 * user could not align the two even when their project wanted them aligned. So
 * the bag means one thing: this project's answer to "is a type-only edge a
 * dependency?", applied everywhere. Splitting it into two fields would preserve
 * the disagreement and leave the filed problem unsolved.
 *
 * ## What these rows must prove
 *
 * The plan is explicit, and names the mistake it is guarding against: prove the
 * option **where it changes the answer**, because "a row asserting the same
 * result either way proves nothing — that mistake was made and caught in plan
 * 0085". Every row below therefore asserts a DIFFERENT outcome per value.
 */
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import type { ArchProject } from '../../src/core/project.js'
import { layeredArchitecture } from '../../src/presets/layered.js'
import { strictBoundaries } from '../../src/presets/boundaries.js'

const typeEdgeDir = path.resolve(import.meta.dirname, '../fixtures/presets/layered-type-edge')
const typeEdgeTsconfig = path.join(typeEdgeDir, 'tsconfig.json')

/** Services (inner) imports a TYPE from routes (outer) — an erased outward edge. */
function typeEdgeProject(): ArchProject {
  const tsm = new Project({ tsConfigFilePath: typeEdgeTsconfig })
  return {
    tsConfigPath: typeEdgeTsconfig,
    _project: tsm,
    getSourceFiles: () => tsm.getSourceFiles(),
  }
}

/** Two slices whose only mutual edges are the spellings passed in. */
function twoSlices(aImportsB: string, bImportsA: string): ArchProject {
  const tsm = new Project({ useInMemoryFileSystem: true })
  tsm.createSourceFile(
    '/src/a/index.ts',
    `${aImportsB}\nexport type Alpha = { n: number }\nexport const alpha = 1\n`,
  )
  tsm.createSourceFile(
    '/src/b/index.ts',
    `${bImportsA}\nexport type Beta = { n: number }\nexport const beta = 1\n`,
  )
  return {
    tsConfigPath: '/tsconfig.json',
    _project: tsm,
    getSourceFiles: () => tsm.getSourceFiles(),
  }
}

const ruleIds = (rules: { violations: () => { ruleId?: string; bypassFilters?: boolean }[] }[]) =>
  rules
    .flatMap((r) => r.violations())
    .filter((v) => v.bypassFilters !== true)
    .map((v) => v.ruleId)

describe('importOptions reaches the layer conditions (plan 0089)', () => {
  const layers = { routes: '**/routes/**', services: '**/services/**' }

  it('flips whether a type-only outward edge is a layer violation', () => {
    const p = typeEdgeProject()
    // Default: layering counts the erased edge, because coupling is the question.
    expect(ruleIds(layeredArchitecture(p, { layers }))).toContain('preset/layered/layer-order')
    // The option reaches the condition and changes the answer.
    expect(
      ruleIds(layeredArchitecture(p, { layers, importOptions: { ignoreTypeImports: true } })),
    ).not.toContain('preset/layered/layer-order')
  })

  it('an explicit false is today’s behaviour — the additive claim, asserted', () => {
    const p = typeEdgeProject()
    expect(
      ruleIds(layeredArchitecture(p, { layers, importOptions: { ignoreTypeImports: false } })),
    ).toContain('preset/layered/layer-order')
  })

  it('CONTROL: the fixture’s only cross-layer edge really is type-only', () => {
    // If a value import appeared in this fixture, the row above would pass for
    // the wrong reason — the violation would survive `ignoreTypeImports: true`
    // and the option would look broken rather than the fixture wrong.
    const p = typeEdgeProject()
    const text = p
      .getSourceFiles()
      .map((f) => f.getFullText())
      .join('\n')
    expect(text).toContain('import type { HandlerContext }')
    expect(text).not.toMatch(/^import \{/m)
  })
})

describe('importOptions reaches beFreeOfCycles (plan 0089)', () => {
  const TYPE_ONLY_CYCLE = {
    a: "import type { Beta } from '../b/index.js'",
    b: "import type { Alpha } from '../a/index.js'",
  }

  it('flips whether a type-only cycle is reported, through strictBoundaries', () => {
    const p = twoSlices(TYPE_ONLY_CYCLE.a, TYPE_ONLY_CYCLE.b)
    const opts = { folders: '**/src/*' }
    // Default: the cycle rule ignores erased edges, so a type-only cycle is not
    // a cycle — nothing to report.
    expect(ruleIds(strictBoundaries(p, opts))).not.toContain('preset/boundaries/no-cycles')
    // Asking for type edges to count makes it one. This is the direction that
    // STRENGTHENS, and it is the half a preset user could not reach before.
    expect(
      ruleIds(strictBoundaries(p, { ...opts, importOptions: { ignoreTypeImports: false } })),
    ).toContain('preset/boundaries/no-cycles')
  })

  it('flips it through layeredArchitecture too — the split-row twin', () => {
    // `boundaries`' textually identical edit was covered and `layered`'s was not.
    // ADR-008: if a revert row touches more than one call site it is at least two
    // rows — split, one half was unguarded, and the plan's own Test inventory
    // item 1 says "reaches `beFreeOfCycles` in BOTH presets".
    const p = twoSlices(TYPE_ONLY_CYCLE.a, TYPE_ONLY_CYCLE.b)
    const layers = { a: '**/src/a/**', b: '**/src/b/**' }
    expect(ruleIds(layeredArchitecture(p, { layers }))).not.toContain('preset/layered/no-cycles')
    expect(
      ruleIds(layeredArchitecture(p, { layers, importOptions: { ignoreTypeImports: false } })),
    ).toContain('preset/layered/no-cycles')
  })

  it('CONTROL: the same two slices in a VALUE cycle report either way', () => {
    // Proves the row above turns on the erasure rather than on the cycle
    // detection being off in this fixture.
    const p = twoSlices(
      "import { beta } from '../b/index.js'\nvoid beta",
      "import { alpha } from '../a/index.js'\nvoid alpha",
    )
    const opts = { folders: '**/src/*' }
    expect(ruleIds(strictBoundaries(p, opts))).toContain('preset/boundaries/no-cycles')
    expect(
      ruleIds(strictBoundaries(p, { ...opts, importOptions: { ignoreTypeImports: true } })),
    ).toContain('preset/boundaries/no-cycles')
  })
})

/**
 * The rules the bag reached only in the documentation.
 *
 * `docs/presets.md` names "the layer / **isolation** rules" in its table and
 * both option docstrings said "**every** rule this preset constructs". Measured,
 * the bag reached `respectLayerOrder` and `beFreeOfCycles` and nothing else: the
 * four rules below took their conditions' defaults whatever was passed.
 *
 * The sharpest one is `innermost-isolation`. With `{ ignoreTypeImports: true }`
 * the SAME erased edge cleared `layer-order` and still failed
 * `innermost-isolation` — one preset call answering the project's one question
 * both ways, which is the exact disagreement plan 0089 was filed to end.
 *
 * Each row asserts a DIFFERENT outcome per value, per the plan's standard: a row
 * that reads the same either way proves nothing.
 */
describe('importOptions reaches the isolation conditions too (plan 0089)', () => {
  const inMemory = (files: Record<string, string>): ArchProject => {
    const tsm = new Project({ useInMemoryFileSystem: true })
    for (const [name, text] of Object.entries(files)) tsm.createSourceFile(name, text)
    return {
      tsConfigPath: '/tsconfig.json',
      _project: tsm,
      getSourceFiles: () => tsm.getSourceFiles(),
    }
  }

  it('layered: innermost-isolation — the rule that disagreed with layer-order', () => {
    const p = inMemory({
      '/src/routes/h.ts': 'export type Ctx = { n: number }\nexport const h = 1\n',
      '/src/core/c.ts': "import type { Ctx } from '../routes/h.js'\nexport type Z = Ctx\n",
    })
    const opts = { layers: { routes: '**/routes/**', core: '**/core/**' }, strict: true }
    expect(ruleIds(layeredArchitecture(p, opts))).toContain('preset/layered/innermost-isolation')
    const ignored = ruleIds(
      layeredArchitecture(p, { ...opts, importOptions: { ignoreTypeImports: true } }),
    )
    expect(ignored).not.toContain('preset/layered/innermost-isolation')
    // And it now agrees with layer-order rather than contradicting it.
    expect(ignored).not.toContain('preset/layered/layer-order')
  })

  it('layered: restricted-packages', () => {
    const p = inMemory({
      '/src/routes/h.ts': "import type { Knex } from 'knex'\nexport type Z = Knex\n",
      '/src/repositories/r.ts': 'export const r = 1\n',
    })
    const opts = {
      layers: { routes: '**/routes/**', repositories: '**/repositories/**' },
      restrictedPackages: { '**/repositories/**': ['knex'] },
    }
    expect(ruleIds(layeredArchitecture(p, opts))).toContain('preset/layered/restricted-packages')
    expect(
      ruleIds(layeredArchitecture(p, { ...opts, importOptions: { ignoreTypeImports: true } })),
    ).not.toContain('preset/layered/restricted-packages')
  })

  it('boundaries: no-cross-boundary', () => {
    const p = inMemory({
      '/src/a/index.ts': "import type { Beta } from '../b/index.js'\nexport type R = Beta\n",
      '/src/b/index.ts': 'export type Beta = { n: number }\nexport const beta = 1\n',
    })
    const opts = { folders: '**/src/*' }
    expect(ruleIds(strictBoundaries(p, opts))).toContain('preset/boundaries/no-cross-boundary')
    expect(
      ruleIds(strictBoundaries(p, { ...opts, importOptions: { ignoreTypeImports: true } })),
    ).not.toContain('preset/boundaries/no-cross-boundary')
  })

  it('boundaries: shared-isolation', () => {
    const p = inMemory({
      '/src/shared/s.ts': "import type { Beta } from '../b/index.js'\nexport type R = Beta\n",
      '/src/b/index.ts': 'export type Beta = { n: number }\nexport const beta = 1\n',
    })
    const opts = { folders: '**/src/b', shared: ['**/shared/**'] }
    expect(ruleIds(strictBoundaries(p, opts))).toContain('preset/boundaries/shared-isolation')
    expect(
      ruleIds(strictBoundaries(p, { ...opts, importOptions: { ignoreTypeImports: true } })),
    ).not.toContain('preset/boundaries/shared-isolation')
  })

  it('boundaries: test-isolation', () => {
    const p = inMemory({
      '/src/a/a.test.ts': "import type { F } from '../b/b.test.js'\nexport type R = F\n",
      '/src/b/b.test.ts': 'export type F = { n: number }\nexport const f = 1\n',
    })
    const opts = { folders: '**/src/*', isolateTests: true }
    expect(ruleIds(strictBoundaries(p, opts))).toContain('preset/boundaries/test-isolation')
    expect(
      ruleIds(strictBoundaries(p, { ...opts, importOptions: { ignoreTypeImports: true } })),
    ).not.toContain('preset/boundaries/test-isolation')
  })
})
