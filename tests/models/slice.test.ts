import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { resolveByMatching, resolveByDefinition } from '../../src/models/slice.js'
import type { ArchProject } from '../../src/core/project.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/slices')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('resolveByMatching', () => {
  const p = loadTestProject()

  it('creates slices from directories matching the glob', () => {
    const result = resolveByMatching(p, 'src/feature-')
    const names = result.map((s) => s.name).sort()
    expect(names).toContain('feature-a')
    expect(names).toContain('feature-b')
    expect(names).toContain('feature-c')
  })

  it('assigns files to the correct slice', () => {
    const result = resolveByMatching(p, 'src/feature-')
    const featureA = result.find((s) => s.name === 'feature-a')
    expect(featureA).toBeDefined()
    expect(featureA!.files.length).toBeGreaterThan(0)
    expect(featureA!.files.some((f) => f.getBaseName() === 'index.ts')).toBe(true)
  })

  it('returns empty array when no directories match', () => {
    const result = resolveByMatching(p, 'src/nonexistent-*/')
    expect(result).toHaveLength(0)
  })
})

describe('resolveByMatching glob spellings (bug 0009)', () => {
  const p = loadTestProject()

  /**
   * Compare the full slice SET, not a projection of it. Asserting only on
   * downstream cycle messages let a mutant that silently drops a slice pass the
   * entire suite — `beFreeOfCycles` never mentions acyclic slices.
   */
  function sliceSet(glob: string) {
    return resolveByMatching(p, glob)
      .map((s) => ({ name: s.name, files: s.files.map((f) => f.getBaseName()).sort() }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  it('resolves the documented directory-level form (was 0 slices)', () => {
    // 'src/*/' is the spelling used across README/docs/examples; a trailing '/'
    // put the wildcard inside baseDir, which no absolute path ever contains.
    const names = sliceSet('src/*/').map((s) => s.name)
    expect(names).toContain('feature-a')
    expect(names).toContain('domain')
    expect(names.length).toBeGreaterThan(1)
  })

  it('treats every spelling of one intent as identical', () => {
    const canonical = sliceSet('src/*')
    expect(canonical.length).toBeGreaterThan(1) // non-vacuity anchor
    // A slice holding more than one file pins the FILE dimension too: comparing
    // only names let a mutant that drops files from slices pass the whole suite.
    expect(canonical).toContainEqual({ name: 'domain', files: ['entity.ts', 'value-object.ts'] })
    // './' and repeated '**/' are redundant spellings people really write (the
    // former comes straight out of tsconfig `include`).
    for (const spelling of [
      'src/*/',
      '**/src/*',
      '**/src/*/',
      './src/*',
      './src/*/',
      '**/./src/*',
      '**/**/src/*',
    ]) {
      expect(sliceSet(spelling), `spelling: ${spelling}`).toEqual(canonical)
    }
  })

  it('names one slice per FILE when files sit directly in the prefix dir', () => {
    // The shape from the bug report (56 flat service files -> 56 slices). The
    // message must not promise "directories".
    expect(sliceSet('src/domain/*').map((s) => s.name)).toEqual(['entity.ts', 'value-object.ts'])
    expect(sliceSet('**/src/domain/*')).toEqual(sliceSet('src/domain/*'))
  })

  it('keeps the literal-prefix form working', () => {
    expect(sliceSet('src/feature-').map((s) => s.name)).toEqual([
      'feature-a',
      'feature-b',
      'feature-c',
    ])
    expect(sliceSet('**/src/feature-')).toEqual(sliceSet('src/feature-'))
  })

  it('resolves nothing for globs with no literal prefix (stays a loud failure)', () => {
    // These must not accidentally yield a slice named '' or a drive root.
    for (const glob of ['**', '**/', '*', '']) {
      expect(resolveByMatching(p, glob), `glob: ${glob}`).toEqual([])
    }
  })
})

/**
 * Shapes the shared fixture cannot express: an interior wildcard (monorepo) and a
 * nested feature tree. Built in memory so the fixture stays small and these tests
 * do not couple to files other suites share.
 */
describe('resolveByMatching on shapes the fixture cannot express', () => {
  function inMemory(files: Record<string, string>): ArchProject {
    const project = new Project({ useInMemoryFileSystem: true })
    for (const [filePath, contents] of Object.entries(files)) {
      project.createSourceFile(filePath, contents)
    }
    return {
      tsConfigPath: '/repo/tsconfig.json',
      _project: project,
      getSourceFiles: () => project.getSourceFiles(),
    }
  }

  const monorepo = () =>
    inMemory({
      '/repo/packages/app-a/src/mod/x.ts': 'export const x = 1',
      '/repo/packages/app-b/src/mod/y.ts': 'export const y = 1',
    })

  const features = () =>
    inMemory({
      '/repo/src/features/billing/order.ts': "import '../auth/user.js'\nexport const o = 1",
      '/repo/src/features/auth/user.ts': "import '../billing/order.js'\nexport const u = 1",
    })

  it('cuts baseDir at the FIRST wildcard, not the last slash (interior wildcard)', () => {
    // Deriving baseDir up to the last '/' yields 'packages/*/src/' — a literal
    // '*' that occurs in no path — so every file is discarded and the rule
    // silently discovers nothing.
    expect(
      resolveByMatching(monorepo(), 'packages/*/src/*')
        .map((s) => s.name)
        .sort(),
    ).toEqual(['app-a', 'app-b'])
  })

  it('a wildcard-free trailing slash means "the directories inside", not one slice', () => {
    // Regression guard: stripping the trailing '/' unconditionally collapsed this
    // into a single slice named 'features'. One mega-slice makes beFreeOfCycles
    // structurally unable to fail (intra-slice edges are dropped), so a real
    // cycle went from red to green.
    expect(
      resolveByMatching(features(), 'src/features/')
        .map((s) => s.name)
        .sort(),
    ).toEqual(['auth', 'billing'])
  })

  it('agrees with the wildcard spellings of the same intent', () => {
    const p2 = features()
    const names = (glob: string) =>
      resolveByMatching(p2, glob)
        .map((s) => s.name)
        .sort()
    expect(names('src/features/')).toEqual(names('src/features/*'))
    expect(names('src/features/*/')).toEqual(names('src/features/*'))
  })

  it('cuts baseDir before a PARTIAL wildcard segment too', () => {
    // 'src/feature-*/x/*': keeping the 'feature-*' segment would put a '*' inside
    // baseDir, which no real path contains, so every file was discarded.
    const partial = inMemory({
      '/repo/src/feature-a/x/1.ts': 'export const a = 1',
      '/repo/src/feature-b/x/2.ts': 'export const b = 1',
    })
    expect(
      resolveByMatching(partial, 'src/feature-*/x/*')
        .map((s) => s.name)
        .sort(),
    ).toEqual(['feature-a', 'feature-b'])
  })

  it('treats a directory whose NAME contains glob metacharacters as literal', () => {
    // Next.js/Remix/SvelteKit dynamic routes: '[slug]', '(marketing)', '[...rest]'
    // are real directory names. Treating "segment contains a metacharacter" as
    // "segment is a wildcard" truncated baseDir mid-path, which merged the real
    // siblings into one slice and pulled in unrelated dirs (a '[slug]' character
    // class matches 's', 'l', 'u', 'g') — dropping the intra-slice edges
    // beFreeOfCycles needs and turning a real cycle green.
    const routes = inMemory({
      '/repo/src/app/[slug]/a/x.ts': "import '../b/y.js'\nexport const x = 1",
      '/repo/src/app/[slug]/b/y.ts': "import '../a/x.js'\nexport const y = 1",
      '/repo/src/app/settings/s.ts': 'export const s = 1',
      '/repo/src/app/login/l.ts': 'export const l = 1',
    })
    const names = (glob: string) =>
      resolveByMatching(routes, glob)
        .map((s) => s.name)
        .sort()

    // The slices are the directories INSIDE '[slug]', and nothing else.
    expect(names('src/app/[slug]/')).toEqual(['a', 'b'])
    expect(names('src/app/[slug]/*')).toEqual(['a', 'b'])
    // Sibling directories must not be dragged in by character-class matching.
    expect(names('src/app/[slug]/')).not.toContain('settings')
    expect(names('src/app/[slug]/')).not.toContain('login')
  })

  it('fails loudly rather than minting one slice per drive root', () => {
    // ts-morph reports Windows paths as 'C:/...'; an empty baseDir would make
    // indexOf('') return 0 and name the slice 'C:', holding every file.
    const windows = inMemory({ 'C:/repo/src/a.ts': 'export const a = 1' })
    for (const glob of ['*', '**', 'src']) {
      expect(resolveByMatching(windows, glob), `glob: ${glob}`).toEqual([])
    }
  })
})

describe('resolveByDefinition', () => {
  const p = loadTestProject()

  it('creates slices from explicit definitions', () => {
    const result = resolveByDefinition(p, {
      domain: '**/domain/**',
      services: '**/services/**',
      controllers: '**/controllers/**',
    })
    expect(result).toHaveLength(3)
    expect(result.map((s) => s.name)).toEqual(['domain', 'services', 'controllers'])
  })

  it('assigns files matching the glob to the correct slice', () => {
    const result = resolveByDefinition(p, {
      domain: '**/domain/**',
    })
    const domain = result[0]!
    expect(domain.files.map((f) => f.getBaseName()).sort()).toEqual([
      'entity.ts',
      'value-object.ts',
    ]) // entity.ts and value-object.ts
  })

  it('first match wins for overlapping globs', () => {
    const result = resolveByDefinition(p, {
      all: '**/*.ts',
      domain: '**/domain/**',
    })
    // domain files should go to 'all' (first match)
    const domain = result.find((s) => s.name === 'domain')!
    expect(domain.files).toHaveLength(0)
  })
})
