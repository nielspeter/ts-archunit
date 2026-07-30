import picomatch from 'picomatch'
import { type SourceFile, type Project, Node } from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { edgesOf } from '../core/module-edges.js'

// ─── Reverse import graph (cached per ts-morph Project) ──────────

type ReverseImportGraph = Map<string, SourceFile[]>

const graphCache = new WeakMap<Project, ReverseImportGraph>()

/**
 * Build or retrieve the reverse import graph for a project.
 *
 * Maps each file path to the list of files that import it.
 * Cached per ts-morph Project instance — multiple rules in the same
 * test suite share the same graph. Cache is cleared automatically
 * when resetProjectCache() creates new ArchProject instances (WeakMap GC).
 */
/**
 * Add an edge to the reverse import graph: `targetPath` is referenced by `sf`.
 *
 * **Always deduplicated, on `(importer, target)`.** It used to take a flag, and
 * static imports passed `false`: one target, one importer, two static imports
 * produced **two byte-identical violations at the same `file:line`** — measured —
 * and therefore two identical baseline hashes for one fact. The flag existed
 * because re-exports were indexed in a second pass that could re-add the same
 * pair; now that every kind comes from one `edgesOf` pass, one file referencing
 * one target N ways is one reverse edge.
 */
function addToGraph(graph: ReverseImportGraph, targetPath: string, sf: SourceFile): void {
  const existing = graph.get(targetPath)
  if (existing) {
    if (!existing.includes(sf)) existing.push(sf)
  } else {
    graph.set(targetPath, [sf])
  }
}

/**
 * Index every module edge leaving `sf` into the reverse graph.
 *
 * Replaces three hand-rolled collectors — static imports via
 * `getModuleSpecifierSourceFile()`, re-exports the same way, and dynamic imports
 * via a bespoke `resolveDynamicImport` that tried eight filename candidates and
 * skipped every non-relative specifier. That last one was bug 0014 in the reverse
 * direction: `import('some-installed-pkg')` resolved to nothing, so a module
 * reachable only that way looked dead.
 *
 * **Every kind counts here, `require` and `type-expression` included** — which is
 * the opposite of the forward conditions, and deliberately so. The two directions
 * ask different questions:
 *
 * | direction | question                                  | a `require` edge means            |
 * | --------- | ----------------------------------------- | --------------------------------- |
 * | forward   | does this file depend on something banned? | a finding with no usable remedy   |
 * | reverse   | is anything referencing this file?         | **yes** — it is not dead          |
 *
 * Excluding `require` here would report a module that CJS code requires as an
 * orphan, and excluding `type-expression` would report one that only a type
 * position references — both are false positives, and deleting either module
 * breaks the build. The forward exclusion avoids an unactionable finding; the same
 * exclusion here would manufacture a wrong one.
 */
function indexEdges(graph: ReverseImportGraph, sf: SourceFile): void {
  for (const edge of edgesOf(sf)) {
    if (edge.resolvedPath === undefined) continue
    addToGraph(graph, edge.resolvedPath, sf)
  }
}

function getReverseImportGraph(sourceFiles: SourceFile[]): ReverseImportGraph {
  if (sourceFiles.length === 0) return new Map()

  const firstFile = sourceFiles[0]
  if (!firstFile) return new Map()
  const project = firstFile.getProject()
  const cached = graphCache.get(project)
  if (cached) return cached

  const graph: ReverseImportGraph = new Map()

  for (const sf of sourceFiles) {
    indexEdges(graph, sf)
  }

  graphCache.set(project, graph)
  return graph
}

// ─── Conditions ──────────────────────────────────────────────────

/**
 * Every file that imports this module must match at least one of the globs.
 *
 * Enforces barrel/facade patterns: internal modules should only be
 * imported through their public API (e.g., index.ts).
 *
 * Modules with zero importers pass vacuously. Chain `.andShould().beImported()`
 * if you also want to catch orphaned files.
 *
 * Both static `import` declarations and dynamic `import()` expressions with
 * string-literal specifiers are resolved. `require()` calls are not resolved.
 */
export function onlyBeImportedVia(...globs: string[]): Condition<SourceFile> {
  const matchers = globs.map((g) => picomatch(g))
  const quotedGlobs = globs.map((g) => `"${g}"`).join(', ')
  return {
    description: `only be imported via ${quotedGlobs}`,
    evaluate(elements: SourceFile[], context: ConditionContext): ArchViolation[] {
      // Build graph from ALL project files, not just the filtered elements
      const first = elements[0]
      const allFiles = first ? first.getProject().getSourceFiles() : []
      const graph = getReverseImportGraph(allFiles)
      const violations: ArchViolation[] = []

      for (const sf of elements) {
        const importers = graph.get(sf.getFilePath()) ?? []
        for (const importer of importers) {
          const importerPath = importer.getFilePath()
          if (!matchers.some((m) => m(importerPath))) {
            violations.push({
              rule: context.rule,
              element: sf.getBaseName(),
              file: sf.getFilePath(),
              line: 1,
              message: `${sf.getBaseName()} is imported by ${importer.getBaseName()} which does not match [${globs.join(', ')}]`,
              because: context.because,
            })
          }
        }
      }

      return violations
    },
  }
}

/**
 * Module must be imported by at least one other file in the project.
 *
 * Detects dead/orphaned modules that nobody references.
 * Use `.excluding('index.ts', 'main.ts')` to skip entry points.
 *
 * Both static `import` declarations and dynamic `import()` expressions with
 * string-literal specifiers are resolved. Modules loaded via `require()` or
 * dynamic imports with computed specifiers will still be falsely reported.
 */
export function beImported(): Condition<SourceFile> {
  return {
    description: 'be imported by at least one other module',
    evaluate(elements: SourceFile[], context: ConditionContext): ArchViolation[] {
      const first = elements[0]
      const allFiles = first ? first.getProject().getSourceFiles() : []
      const graph = getReverseImportGraph(allFiles)
      const violations: ArchViolation[] = []

      for (const sf of elements) {
        const importers = graph.get(sf.getFilePath()) ?? []
        if (importers.length === 0) {
          violations.push({
            rule: context.rule,
            element: sf.getBaseName(),
            file: sf.getFilePath(),
            line: 1,
            message: `${sf.getBaseName()} is not imported by any other module`,
            because: context.because,
          })
        }
      }

      return violations
    },
  }
}

/**
 * Every named export in the module must be referenced by at least one other file.
 *
 * Uses ts-morph's findReferencesAsNodes() per export symbol.
 * Short-circuits after first external reference is found.
 *
 * More expensive than file-level checks — scope with `.that().resideInFolder()`
 * to limit the search space.
 *
 * **Note:** Default exports are excluded from this check. Use `beImported()` for
 * file-level dead code detection. Only named exports are analyzed.
 */
/**
 * Scan a single source file for unused named exports, returning violations.
 */
function findUnusedExportsInFile(sf: SourceFile, context: ConditionContext): ArchViolation[] {
  const violations: ArchViolation[] = []
  const exportMap = sf.getExportedDeclarations()

  for (const [name, declarations] of exportMap) {
    if (name === 'default') continue
    if (declarations.length === 0) continue

    const firstDecl = declarations[0]!
    if (!hasExternalReference(firstDecl, sf)) {
      const line = Node.isNode(firstDecl) ? firstDecl.getStartLineNumber() : 1
      violations.push({
        rule: context.rule,
        element: sf.getBaseName(),
        file: sf.getFilePath(),
        line,
        message: `${sf.getBaseName()} exports "${name}" which is not referenced by any other file`,
        because: context.because,
      })
    }
  }

  return violations
}

export function haveNoUnusedExports(): Condition<SourceFile> {
  return {
    description: 'have no unused exports',
    evaluate(elements: SourceFile[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const sf of elements) {
        violations.push(...findUnusedExportsInFile(sf, context))
      }
      return violations
    },
  }
}

/**
 * Check if a declaration has at least one reference from a different file.
 * Short-circuits on first external reference found.
 *
 * Uses the project's LanguageService.findReferencesAsNodes() which accepts
 * any Node (unlike the ReferenceFindableNode mixin which only some types have).
 */
function hasExternalReference(declaration: Node, sourceFile: SourceFile): boolean {
  const selfPath = sourceFile.getFilePath()
  const languageService = sourceFile.getProject().getLanguageService()

  try {
    const refs = languageService.findReferencesAsNodes(declaration)
    for (const ref of refs) {
      if (ref.getSourceFile().getFilePath() !== selfPath) {
        return true // short-circuit
      }
    }
  } catch {
    // Some nodes (e.g., shorthand property assignments in re-exports) may fail
    // Treat as "referenced" to avoid false positives
    return true
  }

  return false
}
