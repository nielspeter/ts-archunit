/**
 * Make a project-relative glob work, instead of failing loudly — plan 0067 C.
 *
 * Globs are matched against **absolute** file paths, so `'src/domain/**'`
 * matches nothing. That is the single commonest real mistake with this library:
 * it is the shape 0.18.1 was released for, and as of **0.34.0** it is a hard
 * build failure telling the author to prefix `'**\/'`.
 *
 * Prefixing works but says something different. `'**\/src/domain/**'` matches a
 * `src/domain` **anywhere** — including `vendor/thing/src/domain`, and
 * including a second `src/` nested inside a monorepo package. What the author
 * meant was the one at the project root. 0067 called normalization "the root
 * cause" fix for that reason, and 0069 sequenced it directly after R3b.
 *
 * So an unanchored glob is matched against the path **relative to the
 * tsconfig's directory**, in addition to the absolute path. Both spellings keep
 * working and they mean different things:
 *
 * | glob                  | matches                                     |
 * | --------------------- | ------------------------------------------- |
 * | `'src/domain/**'`     | that folder **at the project root**         |
 * | `'**\/src/domain/**'` | a `src/domain` **anywhere** in the project  |
 * | `'/abs/src/domain/**'`| exactly that absolute path                  |
 *
 * ## Why the root comes from the element, not from the builder
 *
 * A predicate is constructed two ways that must not diverge:
 * `.that().resideInFolder(g)`, where the builder knows the project, and
 * `.that().satisfy(resideInFolder(g))`, where nothing does.
 * `tests/core/glob-declaration.test.ts` exists to assert the two spellings
 * agree, and threading the root through only the first would break that.
 *
 * Every `Located` element can reach its own `SourceFile`, and ts-morph carries
 * the tsconfig it was loaded from on the project's compiler options. So the
 * root is derived where the match happens, from the element itself, and both
 * spellings get it for free.
 *
 * `configFilePath` is `undefined` for a project built in memory or without a
 * tsconfig. That is a genuine "no root known" and normalization is skipped —
 * the glob keeps its absolute-only meaning rather than being matched against
 * something invented.
 */
import type { Project as TsMorphProject, SourceFile } from 'ts-morph'

/**
 * Whether a glob can already match an absolute path, so the `**\/` hint would
 * be a no-op (or worse). Covers POSIX-absolute and Windows drive-absolute
 * globs as well as an explicit globstar.
 *
 * Lives here rather than in `glob-diagnosis.ts` (which re-exports it) because
 * `isProjectRelative` below is defined as its negation, and this module sits
 * under the one that diagnoses.
 */
export function isAnchored(glob: string): boolean {
  return glob.startsWith('**/') || glob.startsWith('/') || /^[A-Za-z]:\//.test(glob)
}

/**
 * Does this glob name a location relative to the project root?
 *
 * Only an **unanchored, relative** glob is normalized. `'**\/x'` is explicitly
 * "anywhere" and must keep meaning that; `'/abs/x'` is already absolute. So
 * this is the same population `syntacticFault` calls `unanchored`, which is
 * what makes the two consistent: a glob stops being reported dead for being
 * unanchored exactly when it starts working.
 */
export function isProjectRelative(glob: string): boolean {
  // A `./` segment is excluded, and that exclusion is load-bearing rather than
  // fussy. `syntacticFault` reports `dot-segment` for a `./` anywhere in a
  // glob, so normalizing one would make the rule MATCH at runtime while the
  // gate still reported it dead — two derivations disagreeing about the same
  // glob, which is the failure this project spends most of its guards on.
  // Measured before this line existed: `'./src/domain/**'` selected 3 subjects
  // and produced a dead-selector finding in the same run.
  //
  // `./` is a mistake in both worlds — it never occurs in an absolute path and
  // it says nothing extra in a relative one — so the honest fix is to leave it
  // failing, with advice that says to remove it.
  // `..` is not relative-to-the-root in any usable sense: containment returns
  // `undefined` for anything above the root, deliberately, so a `../`
  // glob would normalize to nothing and be reported dead with three false
  // causes. Excluded alongside `./` — both are mistakes in both readings.
  if (/(?:^|\/)\.\.?\//.test(glob)) return false
  // Derived from `isAnchored`, not restated. They were two lists and disagreed:
  // `isAnchored` recognises a drive-absolute `C:/x/**` and this did not, so a
  // Windows path was declared project-relative. Benign today — it still matches
  // the absolute path — but `base` is a function of this at three sites now,
  // and `base` affects the verdict.
  // `isAnchored` covers `/x`, `**/x` and a drive-absolute `C:/x` — the last of
  // which this used to miss, declaring a Windows path project-relative.
  if (isAnchored(glob)) return false
  // `*/x/**` is deliberately NOT normalized, even though it is unanchored.
  // Normalizing it would make it match, which sounds like an improvement until
  // you notice it is the LAST reachable `unanchored` fault for a path glob —
  // the anchor advice, and the whole `ANCHOR_ADVICE` grouping in the slice
  // discovery message, would become unreachable code. Left failing, with a
  // remedy that works: `'**/x/**'`.
  return !glob.startsWith('*/')
}

/**
 * The directory holding the tsconfig this element's project was loaded from.
 *
 * Forward slashes, no trailing separator — the same normalization
 * `path-universe.ts` applies, so the two cannot disagree about what the root
 * is. `undefined` when the project has no tsconfig.
 */
/**
 * Every directory a project was loaded from, by ts-morph `Project`.
 *
 * A **workspace has no single root.** `workspace([a, b])` sets
 * `ArchProject.tsConfigPath` to the alphabetically first config, so resolving
 * "the project root" from it silently meant *that one package*: measured on a
 * two-package workspace, `'src/api/**'` matched `packages/alpha` and not
 * `packages/beta`, and adding a package named `aaa` would have changed which
 * one it meant. That is the machine-dependent shape bug 0011 already cost this
 * project once — a rule scoped by a name nobody chose deliberately.
 *
 * So a file resolves against **the root that contains it**, and every root is
 * kept. For a single-tsconfig project there is one, and the behaviour is
 * exactly what it was.
 *
 * A `WeakMap` on the ts-morph project, because a predicate sees only an
 * element: `sourceFile.getProject()` is the one handle both the predicate and
 * the slice resolver can reach, and ts-morph itself records only the primary
 * config.
 */
const rootsByProject = new WeakMap<TsMorphProject, readonly string[]>()

/**
 * Record the directories a project was loaded from.
 *
 * Load-bearing for `workspace()`, which has several. For a single-tsconfig
 * `project()` it is **defence in depth and not independently observable**:
 * removing that call leaves every test green, because `rootOf` then falls
 * through to ts-morph's `configFilePath`, which agrees. Recorded rather than
 * papered over — a sabotage row that survives because the behaviour is
 * genuinely redundant is a different thing from a missing guard, and the next
 * person to see it green should not go hunting for a test to write.
 */
export function registerProjectRoots(
  tsMorphProject: TsMorphProject,
  tsConfigPaths: readonly string[],
): void {
  const roots = tsConfigPaths
    .map((configPath) => rootFromTsConfigPath(configPath))
    .filter((root): root is string => root !== undefined)
  if (roots.length > 0) rootsByProject.set(tsMorphProject, roots)
}

/**
 * The project root implied by a tsconfig path.
 *
 * Preferred wherever the caller holds the `ArchProject`, because it is the path
 * the user named rather than what ts-morph recorded — `getCompilerOptions()
 * .configFilePath` is `undefined` for an in-memory project even when the
 * `ArchProject` carries a perfectly good path, and normalization then silently
 * did not happen. The predicates cannot use this (they see only an element, by
 * design, so the builder and `.satisfy()` spellings cannot diverge); the slice
 * resolver can.
 */
export function rootFromTsConfigPath(tsConfigPath: string): string | undefined {
  if (tsConfigPath === '') return undefined
  const normalized = tsConfigPath.replaceAll('\\', '/')
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash === -1) return undefined
  // A tsconfig AT the filesystem root gives `'/'`, not `''`. Returning `''`
  // overloaded one value with two meanings — "no root known" and "the root is
  // `/`" — and the three copies of this derivation disagreed about which:
  // measured on `/tsconfig.json`, the rule discovered its file and `diagnose()`
  // called the same glob dead, in one run. Reachable in a container that mounts
  // the repository at `/`.
  return lastSlash === 0 ? '/' : normalized.slice(0, lastSlash)
}

/** The prefix a path under `root` starts with. `'/'` is its own prefix. */
function prefixOf(root: string): string {
  return root === '/' ? '/' : `${root}/`
}

export function rootOf(sourceFile: SourceFile, fallbackTsConfigPath?: string): string | undefined {
  const filePath = sourceFile.getFilePath().replaceAll('\\', '/')

  // The registered root that CONTAINS this file, longest first — a nested
  // package's tsconfig must win over the repository's, or every file in it
  // resolves against the outer root and the inner one never applies.
  const registered = rootsByProject.get(sourceFile.getProject())
  if (registered !== undefined) {
    const containing = registered
      .filter((root) => filePath.startsWith(prefixOf(root)))
      .sort((a, b) => b.length - a.length)
    const best = containing[0]
    if (best !== undefined) return best
  }

  // A project built without going through `project()`/`workspace()` — a test
  // double, or an in-memory project, where ts-morph records no config path.
  if (fallbackTsConfigPath !== undefined) return rootFromTsConfigPath(fallbackTsConfigPath)
  const configFilePath = sourceFile.getProject().getCompilerOptions().configFilePath
  return typeof configFilePath === 'string' ? rootFromTsConfigPath(configFilePath) : undefined
}

/**
 * `absolutePath` relative to the project root, or `undefined` when it sits
 * outside the root or the root is unknown.
 *
 * Never `path.relative`, which emits `../../..` for a path above the root and
 * so encodes the root's depth — machine-dependent, and the mistake
 * `path-universe.ts` documents avoiding for the same reason.
 */
export function relativeToRoot(
  sourceFile: SourceFile,
  absolutePath: string,
  fallbackTsConfigPath?: string,
): string | undefined {
  const root = rootOf(sourceFile, fallbackTsConfigPath)
  if (root === undefined) return undefined
  const prefix = prefixOf(root)
  return absolutePath.startsWith(prefix) ? absolutePath.slice(prefix.length) : undefined
}
