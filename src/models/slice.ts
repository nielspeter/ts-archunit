import picomatch from 'picomatch'
import { isProjectRelative, relativeToRoot } from '../core/project-relative.js'
import type { SourceFile } from 'ts-morph'
import type { ArchProject } from '../core/project.js'

/**
 * A slice groups source files into a logical unit.
 * Slices are the nodes in the slice dependency graph.
 */
export interface Slice {
  /** Slice name — directory name for matching(), key name for assignedFrom() */
  readonly name: string
  /** Source files belonging to this slice */
  readonly files: SourceFile[]
}

/**
 * A mapping of slice names to glob patterns.
 * Used by `assignedFrom()` to define slices explicitly.
 *
 * @example
 * const layers: SliceDefinition = {
 *   presentation: 'src/controllers/**',
 *   application: 'src/services/**',
 *   domain: 'src/domain/**',
 * }
 */
export type SliceDefinition = Record<string, string>

/**
 * Characters that make a segment non-literal for prefix purposes.
 *
 * Only `*` and `?`. Brackets and braces are excluded deliberately: `[slug]`,
 * `(marketing)` and `{a,b}` occur as real directory names, and a `baseDir` cut
 * before them is located in the path literally — which is what makes those routes
 * resolve correctly. Cutting at `*`/`?` matters for partial wildcards
 * (`src/feature-*\/x/*`), where keeping the segment would put a `*` inside
 * `baseDir` and no path could ever contain it.
 */
const WILDCARD_CHARS = /[*?]/

/**
 * The two things a `matching()` glob has to yield, derived from **one**
 * normalization of the input.
 *
 * Deriving them from differently-normalized inputs is what made bug 0009
 * possible: the picomatch pattern accepted spellings whose `baseDir` could never
 * be found in a path, so files matched and were then silently discarded during
 * slice-name extraction. Both now come from the same `normalized` string, which
 * removes that divergence class — though they remain distinct derivations (for
 * `'src/features'` the pattern's base is `src/features` while `baseDir` is
 * `src/`, by design: the final segment is a name filter, not a directory).
 */
interface MatchingGlob {
  /** Absolute-path pattern handed to picomatch. */
  readonly fullGlob: string
  /** Wildcard-free literal directory prefix, located in the path to name slices. */
  readonly baseDir: string
}

/**
 * Normalize a `matching()` glob so every spelling of one intent agrees.
 *
 * Redundant and therefore stripped: a leading `**\/` (patterns are matched against
 * absolute paths anyway), a leading `./` (never present in an absolute path), and a
 * trailing `/` once the glob already contains a wildcard segment.
 *
 * A trailing `/` on a wildcard-free glob becomes an explicit `*`, so `'src/features/'`
 * ("the things inside features") is exactly `'src/features/*'`. These are all
 * equivalent — `'src/features/*'`, `'src/features/*\/'`, `'src/features/'`,
 * `'**\/src/features/*'`, `'./src/features/*'` — while `'src/features'` (no slash) is
 * deliberately different: its final segment is a name filter, yielding one slice.
 */
function parseMatchingGlob(glob: string): MatchingGlob {
  let normalized = glob
  // Loop over BOTH redundant prefixes together: './' and '**/' can appear in
  // either order ('**/./src/*'), and stripping one kind to exhaustion before the
  // other left a residual that made the whole glob unmatchable.
  while (normalized.startsWith('./') || normalized.startsWith('**/')) {
    normalized = normalized.startsWith('./') ? normalized.slice(2) : normalized.slice(3)
  }

  // A trailing '/' is redundant once the glob already contains a wildcard segment:
  // that wildcard is the slice level, and the pattern appends its own '*/**'. Left
  // in, it demanded one directory MORE than baseDir implies, so every file sitting
  // directly in the matched directory was silently dropped ('src/feature-*/' lost
  // each feature's index.ts; 'packages/*/src/' lost everything directly in src).
  //
  // With no wildcard anywhere the slash is meaningful and stays: 'src/features/'
  // means "the directories inside features". The test is about the glob as a whole,
  // not the final segment's shape — `[slug]` and `(marketing)` are real directory
  // names, and testing them for metacharacters is what broke them before.
  if (normalized.endsWith('/')) {
    const withoutSlash = normalized.slice(0, -1)
    const hasWildcardSegment = withoutSlash.split('/').some((seg) => WILDCARD_CHARS.test(seg))
    // With a wildcard already present that wildcard IS the slice level, so the
    // slash is noise. Otherwise 'dir/' means "the things inside dir", which is
    // exactly 'dir/*' — make it explicit so both spellings take the same path and
    // a flat directory (files, no subdirectories) resolves for both.
    normalized = hasWildcardSegment ? withoutSlash : normalized + '*'
  }

  const segments = normalized.split('/').filter((segment) => segment !== '')

  // The slice level is the first wildcard segment; everything literal before it is
  // the directory prefix we locate in the path. A trailing '/' has already been
  // turned into an explicit '*', so the remaining no-wildcard case is a bare
  // 'src/feature-', where the final segment is a NAME FILTER rather than a
  // directory — which is what distinguishes it from 'src/features/'.
  const wildcardIdx = segments.findIndex((segment) => WILDCARD_CHARS.test(segment))
  const prefixSegments = wildcardIdx >= 0 ? segments.slice(0, wildcardIdx) : segments.slice(0, -1)
  const baseDir = prefixSegments.length > 0 ? prefixSegments.join('/') + '/' : ''

  // The pattern keeps the glob's own shape (interior segments included) so that
  // `packages/*/src/*` still requires the `/src/` level, and `dir/*` still matches
  // files sitting directly in `dir` as well as subdirectories. Only `baseDir` is
  // segment-derived — it is the part that has to be findable in a real path.
  const fullGlob = (normalized.startsWith('/') ? normalized : '**/' + normalized) + '*/**'

  return { fullGlob, baseDir }
}

/**
 * The literal directory prefix a `matching()` glob would search for, or `''` when
 * it has none (`'*'`, `'src'`, `'{a,b}/x/*'`). Exposed so the rule builder can
 * state the *actual* cause of an empty result instead of guessing at one.
 */
export function matchingGlobPrefix(glob: string): string {
  return parseMatchingGlob(glob).baseDir
}

/**
 * The glob `matching()` actually hands to picomatch.
 *
 * Exposed for glob diagnosis (plan 0069), which must declare **the string the
 * matcher receives** — the same rule `GlobKind` states for what a glob is
 * matched against. Declaring the author's spelling instead makes the whole
 * mechanism wrong for this entry point: `'src/features/*'` is rewritten to
 * `'**\/src/features/**\/*'`-shaped, so the author's string matches nothing in
 * either view and every nested-layout `matching()` rule — the shape the docs
 * teach — is reported dead. It also made `'./src/features/*'`, which
 * `parseMatchingGlob` deliberately supports, report a `dot-segment` fault with
 * a remedy that would break a working rule.
 */
export function matchingGlobPattern(glob: string): string {
  return parseMatchingGlob(glob).fullGlob
}

/**
 * Resolve slices by matching a glob pattern against source file paths.
 *
 * The segment following the glob's literal prefix names each slice. That segment
 * is a **directory** when files are nested under it, and otherwise each matching
 * **file** name — `matching('src/features/*')` over `features/billing/order.ts`
 * yields a `billing` slice, while over a flat `services/order.service.ts` it
 * yields an `order.service.ts` slice.
 *
 * Every spelling of the same intent agrees: `'src/features/*'`,
 * `'src/features/*\/'`, `'src/features/'` and `'**\/src/features/*'` are equivalent.
 *
 * @param project - The loaded ArchProject
 * @param glob - A glob whose literal prefix locates the slices; the next segment names them
 * @returns Array of slices, one per distinct name
 *
 * @example
 * resolveByMatching(project, 'src/features/*')
 * // => [{ name: 'auth', files: [...] }, { name: 'billing', files: [...] }]
 */
export function resolveByMatching(project: ArchProject, glob: string): Slice[] {
  const { fullGlob, baseDir } = parseMatchingGlob(glob)

  // No literal directory prefix (e.g. '*', '**', 'src' with no '/'). Bail rather
  // than search for '' in the path: `indexOf('')` is 0, so the "slice name" would
  // be the path's first segment — empty on POSIX (harmless by accident) but the
  // drive letter on Windows, which would mint ONE slice holding every file and
  // silently pass every inter-slice condition. Returning no slices makes the
  // discovery guard fire instead (ADR-008).
  if (baseDir === '') return []
  const isMatch = picomatch(fullGlob)
  const sourceFiles = project.getSourceFiles()
  const sliceMap = new Map<string, SourceFile[]>()

  for (const sf of sourceFiles) {
    const filePath = sf.getFilePath()
    if (!isMatch(filePath)) continue

    // Extract the slice name: the first directory segment after baseDir
    const baseDirIdx = filePath.indexOf(baseDir)
    if (baseDirIdx === -1) continue
    const relativePart = filePath.slice(baseDirIdx + baseDir.length)
    const sliceName = relativePart.split('/')[0]
    if (!sliceName) continue

    const existing = sliceMap.get(sliceName)
    if (existing) {
      existing.push(sf)
    } else {
      sliceMap.set(sliceName, [sf])
    }
  }

  return Array.from(sliceMap.entries()).map(([name, files]) => ({ name, files }))
}

/**
 * Resolve slices from an explicit name-to-glob mapping.
 * Each key becomes a slice name, and files matching its glob are assigned to it.
 *
 * A file matching multiple globs is assigned to the FIRST matching slice.
 * Files matching no glob are excluded from all slices.
 *
 * @param project - The loaded ArchProject
 * @param definition - Map of slice names to glob patterns
 * @returns Array of slices in definition key order
 *
 * @example
 * resolveByDefinition(project, {
 *   presentation: 'src/controllers/**',  // relative: those folders AT THE ROOT
 *   domain: '**\/domain/**',             // anchored: a domain/ anywhere
 * })
 */
export function resolveByDefinition(project: ArchProject, definition: SliceDefinition): Slice[] {
  const sourceFiles = project.getSourceFiles()
  const entries = Object.entries(definition)
  const matchers = entries.map(
    ([name, glob]): {
      name: string
      isMatch: picomatch.Matcher
      relative: boolean
      files: SourceFile[]
    } => ({
      name,
      isMatch: picomatch(glob),
      // Bug 0033. A project-relative glob matched nothing here while the path
      // predicates and `matching()` both accepted one — so `layers: { api:
      // 'src/api/**' }` failed beside a `shared: ['src/shared/**']` that worked,
      // in the same preset call. Same rule as the predicates (plan 0067 C):
      // relative means **from the project root**, which is narrower and more
      // accurate than the `'**/src/api/**'` the old advice prescribed.
      relative: isProjectRelative(glob),
      files: [],
    }),
  )

  for (const sf of sourceFiles) {
    const filePath = sf.getFilePath()
    // Per FILE, not once per project: a workspace has several roots and each
    // file belongs to one of them (bug 0035). `project.tsConfigPath` is only
    // the fallback, for a project built without `project()`/`workspace()` —
    // an in-memory test double, where ts-morph records no config path either.
    const fromRoot = relativeToRoot(sf, filePath, project.tsConfigPath)
    for (const matcher of matchers) {
      const hit =
        matcher.isMatch(filePath) ||
        (matcher.relative && fromRoot !== undefined && matcher.isMatch(fromRoot))
      if (hit) {
        matcher.files.push(sf)
        break // first match wins
      }
    }
  }

  return matchers.map(({ name, files }) => ({ name, files }))
}
