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
import type { SourceFile } from 'ts-morph'

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
  if (/(?:^|\/)\.\//.test(glob)) return false
  return !glob.startsWith('/') && !glob.startsWith('**/') && !glob.startsWith('*/')
}

/**
 * The directory holding the tsconfig this element's project was loaded from.
 *
 * Forward slashes, no trailing separator — the same normalization
 * `path-universe.ts` applies, so the two cannot disagree about what the root
 * is. `undefined` when the project has no tsconfig.
 */
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
  return lastSlash === -1 ? undefined : normalized.slice(0, lastSlash)
}

/** `absolutePath` relative to `root`, or `undefined` when it sits outside. */
export function relativeToGivenRoot(root: string, absolutePath: string): string | undefined {
  const prefix = `${root}/`
  return absolutePath.startsWith(prefix) ? absolutePath.slice(prefix.length) : undefined
}

export function rootOf(sourceFile: SourceFile): string | undefined {
  const configFilePath = sourceFile.getProject().getCompilerOptions().configFilePath
  if (typeof configFilePath !== 'string' || configFilePath === '') return undefined
  const normalized = configFilePath.replaceAll('\\', '/')
  const lastSlash = normalized.lastIndexOf('/')
  return lastSlash === -1 ? undefined : normalized.slice(0, lastSlash)
}

/**
 * `absolutePath` relative to the project root, or `undefined` when it sits
 * outside the root or the root is unknown.
 *
 * Never `path.relative`, which emits `../../..` for a path above the root and
 * so encodes the root's depth — machine-dependent, and the mistake
 * `path-universe.ts` documents avoiding for the same reason.
 */
export function relativeToRoot(sourceFile: SourceFile, absolutePath: string): string | undefined {
  const root = rootOf(sourceFile)
  if (root === undefined) return undefined
  const prefix = `${root}/`
  return absolutePath.startsWith(prefix) ? absolutePath.slice(prefix.length) : undefined
}
