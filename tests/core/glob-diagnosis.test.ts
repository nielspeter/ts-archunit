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
import { describe, it, expect, onTestFinished } from 'vitest'
import { Project } from 'ts-morph'
import {
  diagnoseGlob,
  syntacticFault,
  FAULT_ADVICE,
  ON_DISK_ADVICE,
} from '../../src/core/glob-diagnosis.js'
import { pathUniverse } from '../../src/core/path-universe.js'
import { buildDiskSet, diskSet } from '../../src/core/disk-set.js'
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

/**
 * A throwaway directory that is cleaned up even when an assertion fails, and
 * whose `.git` marker pins `discoverIdentityRoot` to it.
 *
 * Both matter. `fs.rmSync` as the last statement of a test leaks the tree on
 * the failure path — which is the path these tests exist to take. And without
 * the marker the root discovery walks ancestors looking for `.git`, a
 * workspace marker or any `package.json`, so what gets walked depends on
 * where the OS put the temp directory.
 */
function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  onTestFinished(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })
  fs.writeFileSync(path.join(root, '.git'), '')
  return root
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
    const root = tempRoot('archunit-disk-')
    fs.mkdirSync(path.join(root, 'docs', 'nested'), { recursive: true })
    fs.writeFileSync(path.join(root, 'docs', 'nested', 'config.ts'), 'export const x = 1\n')
    fs.mkdirSync(path.join(root, 'assets'), { recursive: true })
    fs.writeFileSync(path.join(root, 'assets', 'logo.svg'), '<svg/>')
    fs.writeFileSync(path.join(root, 'tsconfig.json'), '{}')

    const disk = diskSet(emptyProject(path.join(root, 'tsconfig.json')))
    expect(disk.classify('**/docs')).toBe('holds-typescript')
    expect(disk.classify('**/assets')).toBe('no-typescript')
    expect(disk.classify('**/not-a-real-directory')).toBe('absent')
  })

  it('degrades to not-determined above the entry budget', () => {
    // The walk is unbounded in principle — a TypeScript monorepo may hold a
    // Rust `target/` or a Python `.venv` — and a FAILING run that then hangs
    // inside a 5s vitest timeout is worse than the false green this exists to
    // remove. Above the budget it must say "not determined" rather than
    // return a partial classification, which would be a confidently wrong
    // fact.
    const root = tempRoot('archunit-budget-')
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    for (let i = 0; i < 40; i++) {
      fs.writeFileSync(path.join(root, 'src', `f${String(i)}.ts`), 'export const x = 1\n')
    }
    fs.writeFileSync(path.join(root, 'tsconfig.json'), '{}')
    const project = emptyProject(path.join(root, 'tsconfig.json'))

    expect(buildDiskSet(project, 5).classify('**/src')).toBe('not-determined')
    // ...and with headroom it answers for real, so the test is about the
    // budget rather than about the temp directory being unreadable.
    expect(buildDiskSet(project, 10_000).classify('**/src')).toBe('holds-typescript')
  })

  it('counts .d.ts as TypeScript', () => {
    // A `types/` directory of pure declarations reported "this path exists but
    // contains no TypeScript", which is false. They ARE TypeScript for the
    // question this set answers.
    const root = tempRoot('archunit-dts-')
    fs.mkdirSync(path.join(root, 'types'), { recursive: true })
    fs.writeFileSync(path.join(root, 'types', 'global.d.ts'), 'declare const x: number\n')
    fs.writeFileSync(path.join(root, 'tsconfig.json'), '{}')
    expect(diskSet(emptyProject(path.join(root, 'tsconfig.json'))).classify('**/types')).toBe(
      'holds-typescript',
    )
  })

  it('does not call an existing non-TypeScript file absent', () => {
    // `absent` was derived from the TypeScript-only set, so any path holding a
    // .md or .json was reported as not existing — and `absent` carries no
    // advice, so the caller fell back to a cause list beginning "a path
    // segment is misspelled".
    const root = tempRoot('archunit-nonts-')
    fs.mkdirSync(path.join(root, 'notes'), { recursive: true })
    fs.writeFileSync(path.join(root, 'notes', 'readme.md'), '# hi')
    fs.writeFileSync(path.join(root, 'tsconfig.json'), '{}')
    const disk = diskSet(emptyProject(path.join(root, 'tsconfig.json')))
    expect(disk.classify('**/notes/readme.md')).toBe('no-typescript')
    expect(disk.classify('**/notes/nothing-here.md')).toBe('absent')
  })

  it('classifies per GLOB, so a glob straddling both categories reports the tsconfig cause', () => {
    // One glob routinely matches paths of both kinds — `**/tests/**` matched
    // 44 directories of mixed kind on the monorepo this was gated against.
    const root = tempRoot('archunit-straddle-')
    fs.mkdirSync(path.join(root, 'pkg', 'a'), { recursive: true })
    fs.mkdirSync(path.join(root, 'pkg', 'b'), { recursive: true })
    fs.writeFileSync(path.join(root, 'pkg', 'a', 'index.ts'), 'export const x = 1\n')
    fs.writeFileSync(path.join(root, 'pkg', 'b', 'notes.md'), '# notes')
    fs.writeFileSync(path.join(root, 'tsconfig.json'), '{}')

    expect(diskSet(emptyProject(path.join(root, 'tsconfig.json'))).classify('**/pkg/*')).toBe(
      'holds-typescript',
    )
  })
})

/**
 * Bug 0032 — a verified absence must not defer to a cause list it refutes.
 *
 * `ON_DISK_ADVICE['absent']` was `''`, so the caller fell through to
 * `FAULT_ADVICE['no-match']`, two of whose three causes are false when the walk
 * found nothing: there is no directory, so neither "append `/**`" nor "the
 * directory holds no source files" can apply.
 *
 * **These are constant-level facts only.** The string a reader actually
 * receives is assembled in `diagnose()`, and the first version of this block
 * reimplemented that assembly here — review measured two mutations of the real
 * selection that left the whole suite green, including one that appended the
 * refuted causes straight back on. The shipped-string assertions therefore live
 * in `diagnose.test.ts`, where they go through `diagnose()`. What stays here is
 * what belongs to the constant: that the two known-fact entries have their own
 * text and that `not-determined` deliberately does not.
 */
describe('the on-disk advice table (bug 0032)', () => {
  it('gives a verified absence its own text, refuting neither cause it cannot support', () => {
    const advice = ON_DISK_ADVICE.absent
    expect(advice).not.toBe('')
    // Scoped to the search, not to "disk". `absent` is the result of a BOUNDED
    // walk — measured false as a universal on two reachable inputs: a sibling
    // package outside the identity root, and a directory whose name contains
    // glob metacharacters.
    expect(advice).toContain('under the project root')
    expect(advice).not.toContain('nothing matching this exists on disk')
    // The two causes the fact refutes stay out, asserted by their own words —
    // `advice !== FAULT_ADVICE['no-match']` would pass for any rewording that
    // put them back.
    expect(advice).not.toContain('append')
    expect(advice).not.toContain('holds no source files')
  })

  it('does not tell a selector that a folder which does not exist yet is fine', () => {
    // Regression guard. A draft carried plan 0072's "banning one pre-emptively
    // is legitimate" here. 0072's case is a `notImportFrom` — a CONDITION glob
    // — and `diagnose()` drops condition and exclusion positions before this
    // string is reached, so it printed only for `selector` and `discovery`,
    // where a glob matching nothing means the rule has no subjects. That is
    // the false green 0069 is named after and R3b will fail the build on.
    expect(ON_DISK_ADVICE.absent).not.toContain('legitimate')
    expect(ON_DISK_ADVICE.absent).not.toContain('pre-emptive')
  })

  it('CONTROL: not-determined stays empty, because there no fact is known', () => {
    // The two empty strings looked alike and are not: here the walk was pruned,
    // so deferring to the cause list is honest. A fix that filled in every
    // blank would break this. The DEFERRAL itself is exercised end to end in
    // `diagnose.test.ts` — asserting `=== ''` here does not prove the caller
    // still falls back, which review measured as a real hole.
    expect(ON_DISK_ADVICE['not-determined']).toBe('')
  })

  it('CONTROL: the two facts that already had text still have their own', () => {
    // Bounds the change: replacing the whole map with one string passes the
    // assertions above and fails here.
    expect(ON_DISK_ADVICE['holds-typescript']).toContain('tsconfig include/exclude')
    expect(ON_DISK_ADVICE['no-typescript']).toContain('contains no TypeScript')
    expect(FAULT_ADVICE['no-match']).toContain('misspelled')
  })
})
