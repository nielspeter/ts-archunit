import picomatch from 'picomatch'
import type { GlobSite } from './glob-site.js'
import type { PathUniverse } from './path-universe.js'
import { viewsFor } from './path-universe.js'
import type { DiskSet } from './disk-set.js'

/**
 * Why a glob matches nothing.
 *
 * Two of these name a cause, and only because the fix is a transformation that
 * can be *verified*: removing `./`, and adding the `**\/` anchor. A third,
 * `file-not-folder`, is verifiable in the other direction — the glob matches a
 * file and no directory, and the predicate reads directories. Everything else
 * falls into `no-match`, which lists likely causes without asserting one.
 *
 * That restraint is deliberate and was learned the hard way. Earlier revisions
 * asserted a specific cause — "the directory does not exist", "append `/**`" —
 * and each was false on a reachable input: a glob targeting a file, a
 * directory whose name ends in `]`, a path that plainly existed. Under ADR-008
 * a confidently wrong cause is worse than an honest list, because the agent
 * acts on it.
 */
export type GlobFault = 'dot-segment' | 'unanchored' | 'file-not-folder' | 'no-match'

/**
 * What the filesystem says about a glob that the compiler's file set does not.
 *
 * Only populated for `no-match` — the other faults are syntactic and the disk
 * has nothing to add. `not-determined` is the honest answer above the walk's
 * entry budget.
 */
export type OnDisk = 'holds-typescript' | 'no-typescript' | 'absent' | 'not-determined'

export interface GlobDiagnosis {
  readonly fault: GlobFault
  readonly onDisk?: OnDisk
}

/** Where the glob conventions these messages talk about are documented. */
export const GLOB_DOCS = 'https://nielspeter.github.io/ts-archunit/slices'

/**
 * Whether a glob can already match an absolute path, so the `**\/` hint would
 * be a no-op (or worse). Covers POSIX-absolute and Windows drive-absolute
 * globs as well as an explicit globstar.
 */
export function isAnchored(glob: string): boolean {
  return glob.startsWith('**/') || glob.startsWith('/') || /^[A-Za-z]:\//.test(glob)
}

/**
 * The faults decidable from the glob string alone, with no project to compare
 * against.
 *
 * Split out because two callers need exactly this and nothing more: the
 * `assignedFrom()` message, which groups entries by cause before any universe
 * is available, and `diagnoseGlob` below. One source of truth for the syntax
 * rules, so the two can never drift into disagreeing about what `./src/**` is.
 */
export function syntacticFault(
  glob: string,
  kind: GlobSite['kind'],
  base: GlobSite['base'] = 'absolute',
): 'dot-segment' | 'unanchored' | undefined {
  // A './' anywhere — not just leading — makes the glob unmatchable, and
  // adding '**/' in front of it does not help ('**/./src/**' still matches
  // nothing). True for every base.
  if (/(?:^|\/)\.\//.test(glob)) return 'dot-segment'

  // Exempt for the kinds that are not paths: after the bug 0014 fix,
  // `notImportFrom('fastify')` is a working rule and `isAnchored('fastify')`
  // is false.
  const isPathKind = kind === 'file-path' || kind === 'parent-dir'

  // And exempt for the bases where a relative glob is the CORRECT spelling.
  // `slices().matching()` strips and re-adds the anchor, and `resolvers()`
  // resolves against the tsconfig directory; telling either of them to anchor
  // would be telling the user to break a working rule.
  if (isPathKind && base === 'absolute' && !isAnchored(glob)) return 'unanchored'
  return undefined
}

/**
 * Diagnose one unsatisfiable glob.
 *
 * Call only on a site already known to be dead — this explains a fault, it
 * does not detect one. Keeping detection (`isDeadSite`) and explanation apart
 * is what stops the disk walk from ever becoming a *trigger*: a project with
 * no faults never touches the filesystem.
 *
 * Each fault has a different fix, so they are reported separately. A message
 * that lumps them together, or reports only the first kind it finds, sends the
 * caller through repeated failing runs.
 */
export function diagnoseGlob(
  site: GlobSite,
  universe: PathUniverse,
  diskSet?: DiskSet,
): GlobDiagnosis {
  const syntactic = syntacticFault(site.glob, site.kind, site.base)
  if (syntactic) return { fault: syntactic }

  // A `parent-dir` glob that matches a FILE and no directory is the
  // `resideInFolder` mistake: the predicate reads the directory portion, so a
  // glob written at a file can never match. Verifiable, and therefore safe to
  // assert — measured instance: '**/src/predicates/module**' matches 1 file
  // and 0 parent directories.
  if (site.kind === 'parent-dir' && matchesAny(site.glob, universe.filePaths)) {
    return { fault: 'file-not-folder' }
  }
  if (site.kind === 'file-path' && matchesAny(site.glob, universe.parentDirs)) {
    return { fault: 'file-not-folder' }
  }

  return { fault: 'no-match', onDisk: diskSet?.classify(site.glob) ?? 'not-determined' }
}

/**
 * The remedy for each fault, or an honest list of causes where no remedy is
 * verifiable.
 */
export const FAULT_ADVICE: Readonly<Record<GlobFault, string>> = {
  'dot-segment':
    'a "./" segment never occurs in an absolute file path — remove it and anchor instead ("./src/x/**" -> "**/src/x/**")',
  unanchored:
    'these are matched against ABSOLUTE file paths, so a project-relative glob matches nothing — prefix these with "**/"',
  'file-not-folder':
    'this matches a FILE but is used where a directory is read, so it can never match — use resideInFile() for a file, or append "/**" to name the files inside a directory',
  'no-match':
    'these are anchored but matched no file. Common causes: the glob names a directory rather than the files inside it (append "/**"), a path segment is misspelled, or the directory holds no source files',
}

/**
 * What the filesystem adds, when it adds anything.
 *
 * Stated as a fact and never as a remedy. Every candidate remedy here is wrong
 * on a reachable input: "add it to your tsconfig `include`" is wrong for
 * `dist/`, for codegen output, and absurd for the Rust crate that a real
 * TypeScript monorepo turned out to contain. So this contributes the fact and
 * its own two causes, rather than deferring to `no-match`'s list — two of
 * whose three causes are refuted by the fact printed one line above.
 */
export const ON_DISK_ADVICE: Readonly<Record<OnDisk, string>> = {
  'holds-typescript':
    'this path exists and contains TypeScript, but your tsconfig include/exclude keeps it out of the project',
  'no-typescript': 'this path exists but contains no TypeScript',
  absent: '',
  'not-determined': '',
}

function matchesAny(glob: string, candidates: readonly string[]): boolean {
  const isMatch = picomatch(glob)
  // Never `candidates.some(isMatch)` — picomatch reads the array index as its
  // second argument and returns a truthy object from index 1 onwards.
  return candidates.some((candidate) => isMatch(candidate))
}

/** The union of views a glob of this kind is checked against. */
export function candidatesFor(site: GlobSite, universe: PathUniverse): readonly string[] {
  return viewsFor(universe, site.kind).flat()
}
