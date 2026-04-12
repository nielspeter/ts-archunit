import picomatch from 'picomatch'
import nodePath from 'node:path'
import { type SourceFile, type Project, Node, SyntaxKind } from 'ts-morph'
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

/**
 * Resolve a dynamic import specifier to a project source file.
 *
 * Handles relative specifiers with ESM extension mappings (.js→.ts, .jsx→.tsx,
 * .mjs→.mts) and directory index imports. Non-relative specifiers (bare packages)
 * are skipped — they resolve to node_modules, which are outside the project.
 */
function resolveDynamicImport(fromFile: SourceFile, specifier: string): SourceFile | undefined {
  if (!specifier.startsWith('.')) return undefined

  const dirPath = fromFile.getDirectory().getPath()
  const project = fromFile.getProject()

  // Try the specifier as-is, with ESM extension mappings, and as a directory index
  const candidates = [
    specifier,
    specifier.replace(/\.js$/, '.ts'),
    specifier.replace(/\.jsx$/, '.tsx'),
    specifier.replace(/\.mjs$/, '.mts'),
    specifier + '.ts',
    specifier + '.tsx',
    specifier + '/index.ts',
    specifier + '/index.tsx',
  ]

  for (const candidate of candidates) {
    const absolutePath = nodePath.resolve(dirPath, candidate)
    const resolved = project.getSourceFile(absolutePath)
    if (resolved) return resolved
  }

  return undefined
}

/** Index static import declarations from a source file into the reverse graph. */
function indexStaticImports(graph: ReverseImportGraph, sf: SourceFile): void {
  for (const decl of sf.getImportDeclarations()) {
    const resolved = decl.getModuleSpecifierSourceFile()
    if (!resolved) continue
    addToGraph(graph, resolved.getFilePath(), sf, false)
  }
}

/** Index re-export declarations from a source file into the reverse graph. */
function indexReExports(graph: ReverseImportGraph, sf: SourceFile): void {
  for (const decl of sf.getExportDeclarations()) {
    const resolved = decl.getModuleSpecifierSourceFile()
    if (!resolved) continue
    addToGraph(graph, resolved.getFilePath(), sf, true)
  }
}

/** Index dynamic import() expressions from a source file into the reverse graph. */
function indexDynamicImports(graph: ReverseImportGraph, sf: SourceFile): void {
  for (const callExpr of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (callExpr.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue
    const args = callExpr.getArguments()
    if (args.length === 0) continue

    const arg = args[0]
    if (!arg) continue
    let specifier: string | undefined
    if (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) {
      specifier = arg.getLiteralValue()
    }

    if (specifier === undefined) continue

    const resolved = resolveDynamicImport(sf, specifier)
    if (resolved) {
      addToGraph(graph, resolved.getFilePath(), sf, true)
    }
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
    indexStaticImports(graph, sf)
    indexReExports(graph, sf)
    indexDynamicImports(graph, sf)
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
