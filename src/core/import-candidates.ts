import type picomatch from 'picomatch'
import type { ImportDeclaration } from 'ts-morph'

/**
 * Every string an import glob may be matched against, primary first.
 *
 * Non-empty by construction, and `[0]` is the primary — see `importCandidates`.
 */
export type ImportCandidates = readonly [primary: string, ...alternates: string[]]

/**
 * Every string a glob may legitimately be matched against for one import.
 *
 * The old rule was "the resolved path, **or** the raw specifier if it does not
 * resolve" — which is backwards. An installed package with types resolves, so
 * `notImportFrom('fastify')` was compared against
 * `/…/node_modules/@types/fastify/index.d.ts` and never matched. The documented
 * way to ban a dependency worked only on dependencies you had not installed
 * (bug 0014).
 *
 * So: match against **both**, and a glob matches the import if it matches
 * either. Path globs keep working, because the resolved path is still tested.
 *
 * The specifier is offered only when it is **non-relative**. A relative
 * specifier (`'../services/foo.js'`) carries no information the resolved path
 * lacks, and testing it as a string would let `'**\/services/**'` match an
 * import that resolves somewhere else entirely. Bare package names and path
 * aliases (`'@/lib/x'`) are the cases this exists for, and both are
 * non-relative.
 *
 * **`[0]` is the primary candidate, and it is exactly what the old
 * `resolveImportPath` returned.** That is load-bearing rather than incidental:
 * violation messages interpolate it, `hashViolation` hashes the message, and a
 * changed message silently invalidates every baselined dependency violation.
 * Keeping the primary stable means only genuinely *new* findings get new text.
 * A test asserts the equivalence across the whole fixture corpus.
 */
export function importCandidates(decl: ImportDeclaration): ImportCandidates {
  return candidatesFor(
    decl.getModuleSpecifierValue(),
    decl.getModuleSpecifierSourceFile()?.getFilePath(),
  )
}

/**
 * The same candidates, from the two values a `ModuleEdge` already carries.
 *
 * This is why `ModuleEdge` has **no `candidates` field** (plan 0071 §1):
 * candidates are a function of `specifier` and `resolvedPath`, so storing them
 * beside their own two inputs would be two representations of one fact, free to
 * disagree. The function is exposed instead.
 *
 * `importCandidates` above is now a thin wrapper over this, which is what lets
 * `tests/core/module-edges-corpus.test.ts` compare the two derivations across
 * the whole repository: same rule, reached from a declaration on one side and
 * from an edge on the other.
 */
export function candidatesFor(
  specifier: string,
  resolvedPath: string | undefined,
  projectRoot?: string,
): ImportCandidates {
  if (resolvedPath === undefined) return [specifier]
  const alternates: string[] = isRelativeSpecifier(specifier) ? [] : [specifier]
  // The resolved path named from the project root, **appended** — bug 0037.
  //
  // An import glob is matched against an ABSOLUTE resolved path, so a
  // project-relative one could never match it: measured,
  // `layeredArchitecture({ shared: ['src/shared/**'] })` reported a violation
  // on a correct architecture, because `shared` also reaches
  // `onlyImportFrom(...)`. A **false red**, with no configuration finding and a
  // silent `doctor` — worse than a false green for an agent, which will edit
  // real imports to satisfy a broken allowlist.
  //
  // Appended, never prepended: `[0]` is the primary candidate that violation
  // messages interpolate and `hashViolation` hashes, so putting the relative
  // form first would rewrite every baselined dependency finding.
  //
  // Bare specifiers are untouched — they have no `resolvedPath`, and returning
  // early above is what keeps `notImportFrom('fastify')` working (bug 0014).
  const fromRoot = relativeTo(projectRoot, resolvedPath)
  if (fromRoot !== undefined) alternates.push(fromRoot)
  return [resolvedPath, ...alternates]
}

/** `absolutePath` named from `root`, or `undefined` when it is outside or unknown. */
function relativeTo(root: string | undefined, absolutePath: string): string | undefined {
  if (root === undefined) return undefined
  const prefix = root === '/' ? '/' : `${root}/`
  return absolutePath.startsWith(prefix) ? absolutePath.slice(prefix.length) : undefined
}

/**
 * The first candidate matching any matcher, or `undefined` if none do.
 *
 * "First" is what keeps messages stable: the primary is tested before the
 * specifier, so an import that already matched on its resolved path reports
 * the same string it reported before this fix.
 */
export function matchedCandidate(
  candidates: ImportCandidates,
  matchers: readonly picomatch.Matcher[],
): string | undefined {
  // Never `candidates.some(matcher)` — picomatch reads the array index as its
  // second argument and returns a truthy object from index 1 on.
  return candidates.find((candidate) => matchers.some((isMatch) => isMatch(candidate)))
}

/** A specifier that names a location relative to the importing file. */
function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('.') || specifier.startsWith('/')
}
