/**
 * Glob diagnosis (plan 0069 R2a).
 *
 * The rule these tests exist to hold: a fault names a cause ONLY when the fix
 * is a transformation that can be verified. Earlier revisions of this message
 * asserted "the directory does not exist" and "append `/**`", and each was
 * false on a reachable input. Under ADR-008 a confidently wrong cause is worse
 * than an honest list, because the agent acts on it.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { diagnoseGlob, syntacticFault, FAULT_ADVICE } from '../../src/core/glob-diagnosis.js'
import { pathUniverse } from '../../src/core/path-universe.js'
import { diskSet } from '../../src/core/disk-set.js'
import type { GlobSite } from '../../src/core/glob-site.js'
import type { ArchProject } from '../../src/core/project.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/modules')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

/** A project with no files, for exercising the disk-set guards. */
function emptyProject(tsConfigPath: string): ArchProject {
  return {
    tsConfigPath,
    _project: new Project({ useInMemoryFileSystem: true }),
    getSourceFiles: () => [],
  }
}

const site = (glob: string, kind: GlobSite['kind'] = 'file-path'): GlobSite => ({
  glob,
  kind,
  position: 'selector',
  origin: `test("${glob}")`,
})

describe('syntactic faults', () => {
  it('a "./" segment anywhere, not just leading', () => {
    expect(syntacticFault('./src/**', 'file-path')).toBe('dot-segment')
    expect(syntacticFault('**/./src/**', 'file-path')).toBe('dot-segment')
  })

  it('unanchored, and the advice does not contradict itself', () => {
    expect(syntacticFault('src/**', 'file-path')).toBe('unanchored')
    // The dot-segment advice must not suggest a fix the anchor rule rejects.
    expect(FAULT_ADVICE['dot-segment']).toContain('**/')
  })

  it('an already-anchored glob is not reported unanchored', () => {
    expect(syntacticFault('**/src/**', 'file-path')).toBeUndefined()
    expect(syntacticFault('/abs/src/**', 'file-path')).toBeUndefined()
    expect(syntacticFault('C:/abs/src/**', 'file-path')).toBeUndefined()
  })

  it('a bare package specifier is exempt — it is a working rule, not an unanchored glob', () => {
    // After the bug 0014 fix `notImportFrom('fastify')` works. Reporting it as
    // unanchored would tell the user to break a rule that is correct.
    expect(syntacticFault('fastify', 'import-target')).toBeUndefined()
    expect(syntacticFault('@scope/pkg', 'specifier')).toBeUndefined()
    expect(syntacticFault('handleRequest', 'literal')).toBeUndefined()
  })
})

describe('file-not-folder', () => {
  const p = loadProject()
  const universe = pathUniverse(p)

  it('a parent-dir glob that matches a file and no directory', () => {
    // The measured shape from bug 0011: `resideInFolder` reads the directory
    // portion, so a glob written at a file can never match — and the rule
    // passed vacuously for as long as it existed.
    const filePath = universe.filePaths[0]
    expect(filePath).toBeDefined()
    const asGlob = `**/${path.basename(filePath ?? '')}`
    expect(diagnoseGlob(site(asGlob, 'parent-dir'), universe).fault).toBe('file-not-folder')
  })

  it('and the reverse: a file-path glob that matches only a directory', () => {
    const dir = universe.parentDirs[0]
    expect(dir).toBeDefined()
    const asGlob = `**/${path.basename(dir ?? '')}`
    expect(diagnoseGlob(site(asGlob, 'file-path'), universe).fault).toBe('file-not-folder')
  })

  it('a glob that matches nothing at all is no-match, not file-not-folder', () => {
    expect(diagnoseGlob(site('**/definitely-not-here/**'), universe).fault).toBe('no-match')
  })
})

describe('the disk set', () => {
  it('is not consulted on a project whose tsconfig path is not absolute', () => {
    // `path.dirname('in-memory')` is '.', which would walk the real CWD and
    // make the fault depend on where the suite was run. Two doubles in this
    // repo's own suite use exactly that value.
    expect(diskSet(emptyProject('in-memory')).classify('**/anything/**')).toBe('not-determined')
  })

  it('is not consulted on an absolute path that does not exist', () => {
    // Six of the eight synthetic doubles are this shape — /repo, /virtual,
    // /mem. `isAbsolute` waves all six through, so the existence check is the
    // half that actually stops `readdirSync` throwing from inside a guard.
    expect(diskSet(emptyProject('/repo/tsconfig.json')).classify('**/anything/**')).toBe(
      'not-determined',
    )
  })

  it('classifies containment TRANSITIVELY, not by immediate parent', () => {
    // The `docs/` case. A directory whose only TypeScript lives one level down
    // must not be reported as containing none — that is a false statement in
    // the one message whose entire defence is that it states only facts.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archunit-disk-'))
    fs.mkdirSync(path.join(root, 'docs', 'nested'), { recursive: true })
    fs.writeFileSync(path.join(root, 'docs', 'nested', 'config.ts'), 'export const x = 1\n')
    fs.mkdirSync(path.join(root, 'assets'), { recursive: true })
    fs.writeFileSync(path.join(root, 'assets', 'logo.svg'), '<svg/>')
    fs.writeFileSync(path.join(root, 'tsconfig.json'), '{}')

    const disk = diskSet(emptyProject(path.join(root, 'tsconfig.json')))
    expect(disk.classify('**/docs')).toBe('holds-typescript')
    expect(disk.classify('**/assets')).toBe('no-typescript')
    expect(disk.classify('**/not-a-real-directory')).toBe('absent')

    fs.rmSync(root, { recursive: true, force: true })
  })

  it('classifies per GLOB, so a glob straddling both categories reports the tsconfig cause', () => {
    // One glob routinely matches paths of both kinds — `**/tests/**` matched
    // 44 directories of mixed kind on the monorepo this was gated against.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archunit-straddle-'))
    fs.mkdirSync(path.join(root, 'pkg', 'a'), { recursive: true })
    fs.mkdirSync(path.join(root, 'pkg', 'b'), { recursive: true })
    fs.writeFileSync(path.join(root, 'pkg', 'a', 'index.ts'), 'export const x = 1\n')
    fs.writeFileSync(path.join(root, 'pkg', 'b', 'notes.md'), '# notes')
    fs.writeFileSync(path.join(root, 'tsconfig.json'), '{}')

    expect(diskSet(emptyProject(path.join(root, 'tsconfig.json'))).classify('**/pkg/*')).toBe(
      'holds-typescript',
    )

    fs.rmSync(root, { recursive: true, force: true })
  })
})
