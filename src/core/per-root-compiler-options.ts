import { Project as TsMorphProject } from 'ts-morph'
import type { SourceFile } from 'ts-morph'
import { rootOf } from './project-relative.js'

/**
 * Compiler options that differ **per package** inside one `workspace()`.
 *
 * [Bug 0058](../../bugs/fixed/0058-workspace-applies-one-packages-compiler-flag-to-all.md):
 * `workspace()` builds ONE ts-morph `Project` from the alphabetically-first tsconfig and
 * then only *adds files* from the rest — `addSourceFilesFromTsConfig` adds files, not
 * options. So `sourceFile.getProject().getCompilerOptions()` answers for the tie-break
 * winner, whatever package the file is actually in.
 *
 * Measured before this fix, on two fixtures differing only in `verbatimModuleSyntax`:
 * the flag-`true` package's real cycle **vanished** when loaded through `workspace()`,
 * and forcing the opposite sort order gave the flag-`false` package a **phantom** cycle —
 * one that reds CI with a remedy ("extract shared code to a lower-level module") that
 * cannot remediate it, because there is nothing to extract.
 *
 * This is [bug 0035](../../bugs/fixed/0035-a-workspace-has-no-single-root.md)'s shape one
 * field over, and `project-relative.ts` already solved the "which package owns this file"
 * half — `rootOf()` returns the registered root that contains a file, longest first, so a
 * nested package wins over the repository. This module reuses that answer rather than
 * deriving a second one.
 */

/** Per-root compiler facts, keyed by the ts-morph project that registered them. */
interface RootOptions {
  readonly verbatimModuleSyntax: boolean
}

const optionsByProject = new WeakMap<TsMorphProject, ReadonlyMap<string, RootOptions>>()

/**
 * Read one tsconfig's options **without loading its files**.
 *
 * `skipAddingFilesFromTsConfig` is the load-bearing part: a `workspace()` of ten packages
 * would otherwise parse every package's sources ten times over to answer one boolean.
 * Going through ts-morph rather than reading the JSON is also deliberate — `extends` has
 * to resolve, and hand-rolling that is how a monorepo whose packages inherit a base
 * config gets the wrong answer (ADR-002: ts-morph owns this).
 */
function readRootOptions(tsConfigPath: string): RootOptions {
  const parsed = new TsMorphProject({
    tsConfigFilePath: tsConfigPath,
    skipAddingFilesFromTsConfig: true,
  })
  return { verbatimModuleSyntax: parsed.getCompilerOptions().verbatimModuleSyntax === true }
}

/**
 * Record each config's options against the root directory it governs.
 *
 * Called by `workspace()` with every resolved tsconfig path — **every** one, not just the
 * primary, which is the whole point. `project()` does not need it: one config governs one
 * project, so the project-wide lookup is already correct there.
 */
export function registerRootCompilerOptions(
  tsMorphProject: TsMorphProject,
  tsConfigPaths: readonly string[],
): void {
  const byRoot = new Map<string, RootOptions>()
  for (const configPath of tsConfigPaths) {
    const normalized = configPath.replaceAll('\\', '/')
    const root = normalized.replace(/\/[^/]*$/, '') || '/'
    byRoot.set(root, readRootOptions(configPath))
  }
  if (byRoot.size > 0) optionsByProject.set(tsMorphProject, byRoot)
}

/**
 * `verbatimModuleSyntax` for the package that owns this file.
 *
 * Falls back to the project-wide value, which is correct for `project()` and for any
 * project built without going through `workspace()` — an in-memory test double, for
 * instance. The fallback is the OLD behaviour, so a file the registry does not cover
 * answers exactly as it did before bug 0058.
 */
export function verbatimModuleSyntaxFor(sourceFile: SourceFile): boolean {
  const byRoot = optionsByProject.get(sourceFile.getProject())
  if (byRoot !== undefined) {
    const root = rootOf(sourceFile)
    if (root !== undefined) {
      const owned = byRoot.get(root)
      if (owned !== undefined) return owned.verbatimModuleSyntax
    }
  }
  return sourceFile.getProject().getCompilerOptions().verbatimModuleSyntax === true
}
