import picomatch from 'picomatch'
import type { SourceFile } from 'ts-morph'
import type { Predicate } from '../core/predicate.js'
import { globAnyOf } from '../core/glob-site.js'
import type { ImportOptions } from '../core/import-options.js'
import { splitGlobArgs } from '../core/import-options.js'
import { candidatesFor } from '../core/import-candidates.js'
import { edgesOf, FORWARD_EDGE_KINDS } from '../core/module-edges.js'
import { rootOf } from '../core/project-relative.js'

/**
 * Which edge kinds these predicates see.
 *
 * The **same set as the conditions** (`DEPENDENCY_KINDS` in
 * `conditions/dependency.ts`), and it has to be: `notImportFrom` is one
 * identifier with two definitions chosen by chain position, so a predicate that
 * disagreed with its own condition about what an import is would be this plan's
 * Problem statement inside one method name.
 */
const PREDICATE_KINDS = FORWARD_EDGE_KINDS

/**
 * Every string a glob may be matched against, across every edge in the file.
 *
 * Flattened rather than grouped per edge: these predicates only ask "does ANY
 * edge match", so which edge a candidate came from is not needed. See
 * `candidatesFor` for why one edge can contribute two strings.
 *
 * **Two consumers, moving subjects in opposite directions** (plan 0071 §3), which
 * is why widening this is in scope rather than an implementation detail:
 *
 * - `notImportFrom` is **anti-monotone** — a file with a matching re-export now
 *   fails the predicate and drops out of the selection, so rules select FEWER
 *   subjects and report FEWER findings. Losing findings is the one direction this
 *   release claims cannot happen, so it is asserted by identity.
 * - `importFrom` is **monotone-increasing** — more files match, more subjects,
 *   more findings.
 *
 * The condition-layer measurement ("0 findings lost") cannot see either: this
 * repo's own rules use `notImportFrom` in condition position 16 times and
 * predicate position zero, so the corpus structurally cannot show the loss.
 */
function importCandidatePaths(sourceFile: SourceFile, ignoreTypeImports = false): string[] {
  return (
    edgesOf(sourceFile)
      .filter((edge) => {
        if (!PREDICATE_KINDS[edge.kind]) return false
        if (!ignoreTypeImports) return true
        return !edge.typeOnly
      })
      // The importing file's root, so a project-relative import glob works here
      // exactly as it does in the condition family (bugs 0037, 0036). Measured
      // before this: `importFrom('src/domain/**')` selected 0 modules where the
      // anchored spelling selected 5.
      .flatMap((edge) => [...candidatesFor(edge.specifier, edge.resolvedPath, rootOf(sourceFile))])
  )
}

/**
 * Matches modules that import from a path matching any of the given globs.
 *
 * Each import contributes the resolved absolute path **and**, when the
 * specifier is non-relative, the specifier as written; a glob matches the
 * import if it matches either. So a bare package name works whether or not the
 * package is installed. See `importCandidates` for why.
 *
 * @example
 * modules(p).that().importFrom('** /infrastructure/**')
 * modules(p).that().importFrom('fastify', 'knex', 'bullmq')
 */
export function importFrom(globs: string[], options: ImportOptions): Predicate<SourceFile>
export function importFrom(...globs: string[]): Predicate<SourceFile>
export function importFrom(...args: [string[], ImportOptions] | string[]): Predicate<SourceFile> {
  const { globs, options } = splitGlobArgs(args)
  const ignoreType = options?.ignoreTypeImports === true
  const matchers = globs.map((g) => picomatch(g))
  return {
    globs: globAnyOf(globs, 'import-target'),
    description: 'import from ' + globs.map((g) => `"${g}"`).join(', '),
    test: (sourceFile) =>
      importCandidatePaths(sourceFile, ignoreType).some((p) => matchers.some((m) => m(p))),
  }
}

/**
 * Matches modules that do NOT import from any path matching the given globs.
 *
 * @example
 * modules(p).that().notImportFrom('** /legacy/**')
 * modules(p).that().notImportFrom('fastify', 'knex', 'bullmq')
 */
export function notImportFrom(globs: string[], options: ImportOptions): Predicate<SourceFile>
export function notImportFrom(...globs: string[]): Predicate<SourceFile>
export function notImportFrom(
  ...args: [string[], ImportOptions] | string[]
): Predicate<SourceFile> {
  const { globs, options } = splitGlobArgs(args)
  const ignoreType = options?.ignoreTypeImports === true
  const matchers = globs.map((g) => picomatch(g))
  return {
    // `import-target` is never checked against the path universe: an installed
    // package resolves into node_modules, which is outside the project by
    // construction, so checking it would fail every correct dependency rule.
    globs: globAnyOf(globs, 'import-target'),
    description: 'not import from ' + globs.map((g) => `"${g}"`).join(', '),
    test: (sourceFile) =>
      !importCandidatePaths(sourceFile, ignoreType).some((p) => matchers.some((m) => m(p))),
  }
}

/**
 * Matches modules that export a symbol with the given name.
 *
 * Checks the module's exported declarations for a matching name.
 *
 * @example
 * modules(p).that().exportSymbolNamed('default')
 */
export function exportSymbolNamed(name: string): Predicate<SourceFile> {
  return {
    description: `export symbol named "${name}"`,
    test: (sourceFile) => sourceFile.getExportedDeclarations().has(name),
  }
}
