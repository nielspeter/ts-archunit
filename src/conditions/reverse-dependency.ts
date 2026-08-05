import picomatch from 'picomatch'
import { type SourceFile, type Project, Node } from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { moduleEdges } from '../core/module-edges.js'
import { recordEdgeCoverage } from '../core/edge-coverage.js'
import { globAnyOf } from '../core/glob-site.js'
import { relativeToRoot } from '../core/project-relative.js'

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

function getReverseImportGraph(sourceFiles: SourceFile[]): ReverseImportGraph {
  if (sourceFiles.length === 0) return new Map()

  const firstFile = sourceFiles[0]
  if (!firstFile) return new Map()
  const project = firstFile.getProject()
  const cached = graphCache.get(project)
  if (cached) return cached

  const graph: ReverseImportGraph = new Map()

  // **Every kind counts here, `require` and `type-expression` included** — the
  // opposite of the forward conditions, and deliberately so. The two directions
  // ask different questions:
  //
  // | direction | question                                   | a `require` edge means          |
  // | --------- | ------------------------------------------ | ------------------------------- |
  // | forward   | does this file depend on something banned? | a finding with no usable remedy |
  // | reverse   | is anything referencing this file?          | **yes** — it is not dead        |
  //
  // Excluding `require` here would report a module that CJS code requires as an
  // orphan, and excluding `type-expression` would report one that only a type
  // position references — both false positives, and deleting either module breaks
  // the build. The forward exclusion avoids an unactionable finding; the same
  // exclusion here would manufacture a wrong one.
  //
  // The one caller that genuinely has a file SET, so it is the one that uses the
  // bulk entry point. `moduleEdges` was previously called by nothing in `src/` —
  // every site used the per-file `edgesOf`, including this loop — which made its
  // "one crossing rather than N" docstring a claim about code that did not exist.
  const byFile = moduleEdges(sourceFiles)
  for (const importer of sourceFiles) {
    for (const edge of byFile.get(importer.getFilePath()) ?? []) {
      if (edge.resolvedPath === undefined) continue
      addToGraph(graph, edge.resolvedPath, importer)
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
 * **Every kind of reference counts here**: `import`, `export … from`, `import()`,
 * `type X = import('…').Y`, and **`require()`** — both `require('s')` in a `.js`
 * file and `import x = require('s')`. Only a computed specifier
 * (`import('./' + name)`) is invisible, because there is no specifier to
 * resolve, along with a `declare module './rel.js'` augmentation.
 *
 * That is wider than the *forward* dependency conditions, which exclude
 * `require` — deliberately, and see `indexEdges` for why the same exclusion
 * would be wrong here.
 */
export function onlyBeImportedVia(...globs: string[]): Condition<SourceFile> {
  const matchers = globs.map((g) => picomatch(g))
  const quotedGlobs = globs.map((g) => `"${g}"`).join(', ')
  return {
    // `file-path`, NOT `import-target` — and this is the row to get right. The glob
    // names the FILES ALLOWED TO IMPORT the subject, matched against an importer's own
    // path, so unlike the four dependency conditions it is a genuine path glob with
    // real path-universe views. Declaring it as `import-target` would hand a checkable
    // glob to machinery that has no views for that kind, which fails silently in the
    // direction that looks fine (plan 0073).
    globs: globAnyOf(globs, 'file-path'),
    description: `only be imported via ${quotedGlobs}`,
    evaluate(elements: SourceFile[], context: ConditionContext): ArchViolation[] {
      // Build graph from ALL project files, not just the filtered elements
      const first = elements[0]
      const allFiles = first ? first.getProject().getSourceFiles() : []
      const graph = getReverseImportGraph(allFiles)
      const violations: ArchViolation[] = []

      // Bug 0015: the mirror case — a module with no importers passes however
      // broken the allowlist. This condition already documented the behaviour
      // ("Modules with zero importers pass vacuously") without treating it as a
      // gap; the tally is what turns that note into something a reader sees.
      let tested = 0
      for (const sf of elements) {
        const importers = graph.get(sf.getFilePath()) ?? []
        for (const importer of importers) {
          tested++
          const importerPath = importer.getFilePath()
          // Also the importer's path named from the project root — bug 0036.
          // This glob is matched against an ABSOLUTE path, so a
          // project-relative one could never match and every importer was
          // reported: measured, `onlyBeImportedVia('src/**')` produced 5
          // violations where `'**/src/**'` produced none. A false red, the same
          // shape as bug 0037 one layer over.
          const fromRoot = relativeToRoot(importer, importerPath)
          const matched =
            matchers.some((m) => m(importerPath)) ||
            (fromRoot !== undefined && matchers.some((m) => m(fromRoot)))
          if (!matched) {
            violations.push({
              rule: context.rule,
              element: sf.getBaseName(),
              file: sf.getFilePath(),
              line: 1,
              // The importer by PATH, not by basename — and the message is the only place it
              // can appear, because `element`, `file` and `line` all describe the TARGET.
              //
              // Two importers sharing a filename produced findings that were byte-identical on
              // screen: same element, same file, same line, same message. Measured, and worse
              // in the two surfaces that matter most — `check --format json` emitted two
              // identical objects, and `format-github` emitted two identical `::error` lines,
              // which GitHub renders as ONE annotation, so in a PR's Files view the second
              // finding did not exist at all.
              //
              // That was survivable while the two shared a baseline entry and only one was
              // ever reported. Once `disambiguateIdentities` gives them separate entries the
              // hidden sibling surfaces — and an adopter is handed a red identical to one they
              // already accepted, pointing at the victim rather than the offender, with no way
              // to tell which importer is new. The release that makes a finding visible owns
              // making it readable.
              //
              // `element` is deliberately left as the basename: `.excluding()` matches on
              // `element`/`file`/`message`, so promoting it to a path would silently break
              // every `.excluding('index.ts')` in the wild. Changing the MESSAGE breaks an
              // exact-string message exclusion, which surfaces as an unused-pattern warning
              // rather than failing open — the acceptable direction, and stated in the
              // upgrading row.
              message: `${sf.getBaseName()} is imported by ${fromRoot ?? importerPath} which does not match [${globs.join(', ')}]`,
              because: context.because,
            })
          }
        }
      }

      recordEdgeCoverage(context.rule, elements.length, tested)
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
 * **A module referenced by any kind of edge is not dead**, including
 * `export … from`, `import()`, a type-only reference, and `require()` in either
 * spelling. Since v0.28.0 that means **fewer** false orphans than before — if
 * you carry `.excluding()` entries for modules only reachable via `require()` or
 * a re-export, they are no longer needed.
 *
 * Two shapes are still invisible and will be falsely reported: a computed
 * specifier (`import('./' + name)`), and a module referenced only from a
 * `declare module './rel.js'` augmentation.
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
