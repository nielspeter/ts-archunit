import picomatch from 'picomatch'
import { type SourceFile, type Project, Node } from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'

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
 * Add an edge to the reverse import graph: targetPath is imported by sf.
 * Deduplicates entries when `deduplicate` is true (used for re-exports
 * where the same file may appear via both import and export declarations).
 */
function addToGraph(
  graph: ReverseImportGraph,
  targetPath: string,
  sf: SourceFile,
  deduplicate: boolean,
): void {
  const existing = graph.get(targetPath)
  if (existing) {
    if (!deduplicate || !existing.includes(sf)) {
      existing.push(sf)
    }
  } else {
    graph.set(targetPath, [sf])
  }
}

function getReverseImportGraph(sourceFiles: SourceFile[]): ReverseImportGraph {
  if (sourceFiles.length === 0) return new Map()

  const project = sourceFiles[0]!.getProject()
  const cached = graphCache.get(project)
  if (cached) return cached

  const graph: ReverseImportGraph = new Map()

  for (const sf of sourceFiles) {
    // Static import declarations
    for (const decl of sf.getImportDeclarations()) {
      const resolved = decl.getModuleSpecifierSourceFile()
      if (!resolved) continue
      addToGraph(graph, resolved.getFilePath(), sf, false)
    }

    // Re-export declarations (export { x } from './y') — these reference
    // another module but appear as ExportDeclaration, not ImportDeclaration
    for (const decl of sf.getExportDeclarations()) {
      const resolved = decl.getModuleSpecifierSourceFile()
      if (!resolved) continue
      addToGraph(graph, resolved.getFilePath(), sf, true)
    }
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
 * **Limitation:** Only considers static `import` declarations. Dynamic `import()`
 * expressions and `require()` calls are not resolved.
 */
export function onlyBeImportedVia(...globs: string[]): Condition<SourceFile> {
  const matchers = globs.map((g) => picomatch(g))
  const quotedGlobs = globs.map((g) => `"${g}"`).join(', ')
  return {
    description: `only be imported via ${quotedGlobs}`,
    evaluate(elements: SourceFile[], context: ConditionContext): ArchViolation[] {
      // Build graph from ALL project files, not just the filtered elements
      const allFiles = elements.length > 0 ? elements[0]!.getProject().getSourceFiles() : []
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
 * **Limitation:** Only considers static `import` declarations. Modules loaded
 * via dynamic `import()` or `require()` will be falsely reported as dead.
 */
export function beImported(): Condition<SourceFile> {
  return {
    description: 'be imported by at least one other module',
    evaluate(elements: SourceFile[], context: ConditionContext): ArchViolation[] {
      const allFiles = elements.length > 0 ? elements[0]!.getProject().getSourceFiles() : []
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
