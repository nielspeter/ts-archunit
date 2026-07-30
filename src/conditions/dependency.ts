import picomatch from 'picomatch'
import type { SourceFile, ImportDeclaration } from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { candidatesFor, matchedCandidate } from '../core/import-candidates.js'
import {
  edgeTypeOnlyRemedy,
  edgeValuePhrase,
  edgeVerb,
  edgesOf,
  type ModuleEdge,
  type ModuleEdgeKind,
} from '../core/module-edges.js'

export type { ImportOptions } from '../core/import-options.js'
import type { ImportOptions } from '../core/import-options.js'

/**
 * Which edge kinds a forward dependency condition reports on.
 *
 * **An exhaustive `Record`, not an allowlist filter** (plan 0071 §3). "Each site
 * filters to the kinds it handles" is fail-open for a sixth kind: one added in a
 * later release would be silently excluded everywhere, which is the same false
 * green this release closes. A full `Record<ModuleEdgeKind, boolean>` makes a new
 * union member a compile error here.
 *
 * `require` is **false at every site**. The kind exists so a 4-way branch cannot
 * mark a CJS runtime dependency as erased, not to enforce CJS — that is a
 * different upgrade story, whose reds land in interop and generated `.d.ts` where
 * the remedy is usually "nothing you can do". The trade is a known false
 * negative over a mislabelled true positive, and it is stated in
 * `docs/standard-rules.md` and `docs/modules.md` rather than sold as coverage.
 */
const DEPENDENCY_KINDS: Record<ModuleEdgeKind, boolean> = {
  import: true,
  reexport: true,
  dynamic: true,
  'type-expression': true,
  require: false,
}

/**
 * Which kinds `onlyHaveTypeImportsFrom` reports on.
 *
 * Excludes `dynamic` on ADR-008 rule 2: the condition's remedy is "make the
 * dependency erased", and there is **no** way to do that for `await import(…)`.
 * A finding whose remedy cannot be followed is not a finding.
 *
 * Keeps `reexport`, where a remedy does exist but is not purely local — see
 * {@link edgeTypeOnlyRemedy}. Excludes `type-expression` because it is already
 * erased and can never violate a type-only rule, so the row is unreachable
 * rather than a judgement.
 */
const TYPE_IMPORT_KINDS: Record<ModuleEdgeKind, boolean> = {
  import: true,
  reexport: true,
  dynamic: false,
  'type-expression': false,
  require: false,
}

/** The strings this edge's globs may be matched against, primary first. */
function edgeCandidates(edge: ModuleEdge): ReturnType<typeof candidatesFor> {
  return candidatesFor(edge.specifier, edge.resolvedPath)
}

/**
 * Create a violation for one module edge.
 *
 * `line` comes from the edge, which is the **statement** line — the same value
 * `decl.getStartLineNumber()` produced before this release for `kind ===
 * 'import'`, so no existing finding moves.
 */
function edgeViolation(
  sourceFile: SourceFile,
  edge: ModuleEdge,
  message: string,
  context: ConditionContext,
): ArchViolation {
  return {
    rule: context.rule,
    element: sourceFile.getBaseName(),
    file: sourceFile.getFilePath(),
    line: edge.line,
    message,
    because: context.because,
  }
}

/**
 * Create a violation for a source file with a specific offending import.
 */
function importViolation(
  sourceFile: SourceFile,
  importDecl: ImportDeclaration,
  message: string,
  context: ConditionContext,
): ArchViolation {
  return {
    rule: context.rule,
    element: sourceFile.getBaseName(),
    file: sourceFile.getFilePath(),
    line: importDecl.getStartLineNumber(),
    message,
    because: context.because,
  }
}

/**
 * Every import in the module must match at least one of the globs — against its
 * resolved path or, for a non-relative specifier, the specifier as written.
 * Imports that match no glob produce violations.
 *
 * @example
 * modules(p)
 *   .that().resideInFolder('** /domain/** ')
 *   .should().onlyImportFrom('** /domain/** ', '** /shared/** ')
 *   .check()
 */
export function onlyImportFrom(globs: string[], options: ImportOptions): Condition<SourceFile>
export function onlyImportFrom(...globs: string[]): Condition<SourceFile>
export function onlyImportFrom(
  ...args: [string[], ImportOptions] | string[]
): Condition<SourceFile> {
  // ADR-005: as casts required — TS cannot narrow tuple union rest params after Array.isArray
  const globs: string[] = Array.isArray(args[0]) ? args[0] : (args as string[])
  const options = Array.isArray(args[0]) && args.length > 1 ? (args[1] as ImportOptions) : undefined
  const ignoreType = options?.ignoreTypeImports === true
  const matchers = globs.map((g) => picomatch(g))
  const quotedGlobs = globs.map((g) => `"${g}"`).join(', ')
  return {
    description: `only import from ${quotedGlobs}`,
    evaluate(sourceFiles: SourceFile[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const sf of sourceFiles) {
        for (const edge of edgesOf(sf)) {
          if (!DEPENDENCY_KINDS[edge.kind]) continue
          if (ignoreType && edge.typeOnly) continue
          const candidates = edgeCandidates(edge)
          const importPath = candidates[0]
          if (matchedCandidate(candidates, matchers) === undefined) {
            violations.push(
              edgeViolation(
                sf,
                edge,
                `${sf.getBaseName()} ${edgeVerb(edge.kind)} "${importPath}" which does not match any of [${globs.join(', ')}]`,
                context,
              ),
            )
          }
        }
      }
      return violations
    },
  }
}

/**
 * No import in the module may match any of the globs — against its resolved
 * path or, for a non-relative specifier, the specifier as written.
 * Imports that match a glob produce violations.
 *
 * @example
 * modules(p)
 *   .that().resideInFolder('** /features/** ')
 *   .should().notImportFrom('** /legacy/** ')
 *   .check()
 */
export function notImportFrom(globs: string[], options: ImportOptions): Condition<SourceFile>
export function notImportFrom(...globs: string[]): Condition<SourceFile>
export function notImportFrom(
  ...args: [string[], ImportOptions] | string[]
): Condition<SourceFile> {
  // ADR-005: as casts required — TS cannot narrow tuple union rest params after Array.isArray
  const globs: string[] = Array.isArray(args[0]) ? args[0] : (args as string[])
  const options = Array.isArray(args[0]) && args.length > 1 ? (args[1] as ImportOptions) : undefined
  const ignoreType = options?.ignoreTypeImports === true
  const matchers = globs.map((g) => picomatch(g))
  const quotedGlobs = globs.map((g) => `"${g}"`).join(', ')
  return {
    description: `not import from ${quotedGlobs}`,
    evaluate(sourceFiles: SourceFile[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const sf of sourceFiles) {
        for (const edge of edgesOf(sf)) {
          if (!DEPENDENCY_KINDS[edge.kind]) continue
          if (ignoreType && edge.typeOnly) continue
          const importPath = matchedCandidate(edgeCandidates(edge), matchers)
          if (importPath !== undefined) {
            violations.push(
              edgeViolation(
                sf,
                edge,
                `${sf.getBaseName()} ${edgeVerb(edge.kind)} "${importPath}" which matches forbidden [${globs.join(', ')}]`,
                context,
              ),
            )
          }
        }
      }
      return violations
    },
  }
}

/**
 * Module must import from at least one path matching a glob.
 * Completes the import-condition family: onlyImportFrom (all),
 * notImportFrom (none), dependOn (at least one).
 *
 * Only considers static `import` declarations. Dynamic `import()`
 * expressions are not checked — use `beImported()` for import-graph
 * analysis that includes dynamic imports.
 *
 * @example
 * modules(p)
 *   .that().resideInFolder('** /services/** ')
 *   .should().satisfy(dependOn('** /logging/** '))
 *   .check()
 */
export function dependOn(globs: string[], options: ImportOptions): Condition<SourceFile>
export function dependOn(...globs: string[]): Condition<SourceFile>
export function dependOn(...args: [string[], ImportOptions] | string[]): Condition<SourceFile> {
  // ADR-005: as casts required — TS cannot narrow tuple union rest params after Array.isArray
  const globs: string[] = Array.isArray(args[0]) ? args[0] : (args as string[])
  const options = Array.isArray(args[0]) && args.length > 1 ? (args[1] as ImportOptions) : undefined
  const ignoreType = options?.ignoreTypeImports === true
  const matchers = globs.map((g) => picomatch(g))
  const quotedGlobs = globs.map((g) => `"${g}"`).join(', ')
  return {
    description:
      globs.length === 1 ? `depend on ${quotedGlobs}` : `depend on at least one of ${quotedGlobs}`,
    evaluate(sourceFiles: SourceFile[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const sf of sourceFiles) {
        const hasMatch = edgesOf(sf).some((edge) => {
          if (!DEPENDENCY_KINDS[edge.kind]) return false
          // `typeOnly` means something DIFFERENT per kind on this one condition,
          // and that asymmetry is deliberate (plan 0071 §3).
          //
          // For `import`, behaviour is exactly as before: an `import type` of the
          // target SATISFIES `dependOn`, and `{ ignoreTypeImports: true }` is the
          // shipped opt-in that makes it fail. Requiring runtime here would be a
          // green→red change to a contract that already has an opt-out — a docs
          // gap, not a behaviour gap.
          //
          // For the new kinds it must require runtime, or this release CREATES a
          // false green: `export type { SecurityConfig } from './security.js'`
          // would satisfy `dependOn('**/security/**')` while the server installs
          // nothing. Measured against `docs/modules.md`'s own teaching example, a
          // naive widening turns a real violation into a pass — and on the
          // baseline side that reads as "the violation was fixed".
          if (edge.kind === 'import' ? ignoreType && edge.typeOnly : edge.typeOnly) return false
          return matchedCandidate(edgeCandidates(edge), matchers) !== undefined
        })
        if (!hasMatch) {
          violations.push({
            rule: context.rule,
            element: sf.getBaseName(),
            file: sf.getFilePath(),
            line: 1,
            message: `${sf.getBaseName()} does not import from any path matching [${globs.join(', ')}]`,
            because: context.because,
          })
        }
      }
      return violations
    },
  }
}

/**
 * No import in the module may use an aliased named specifier (`import { x as y }`).
 * Each aliased specifier produces a violation.
 * Does not flag namespace imports (`import * as Foo`) — only named specifier aliases.
 *
 * To scope the check to specific import sources, filter with
 * `.that().importFrom(...)` predicates.
 *
 * @example
 * modules(p)
 *   .that().resideInFolder('** /src/** ')
 *   .should().notHaveAliasedImports()
 *   .because('aliases hide API design problems')
 *   .check()
 */
export function notHaveAliasedImports(): Condition<SourceFile> {
  return {
    description: 'not have aliased imports',
    evaluate(sourceFiles: SourceFile[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const sf of sourceFiles) {
        for (const decl of sf.getImportDeclarations()) {
          for (const specifier of decl.getNamedImports()) {
            const alias = specifier.getAliasNode()
            if (alias) {
              violations.push(
                importViolation(
                  sf,
                  decl,
                  `${sf.getBaseName()} aliases "${specifier.getName()}" as "${alias.getText()}"`,
                  context,
                ),
              )
            }
          }
        }
      }
      return violations
    },
  }
}

/**
 * Imports from paths matching the given globs must use `import type`, not `import`.
 * Non-matching imports are ignored. Matching imports that are not type-only produce violations.
 *
 * @example
 * modules(p)
 *   .that().resideInFolder('** /api/** ')
 *   .should().onlyHaveTypeImportsFrom('** /domain/entities/** ')
 *   .check()
 */
export function onlyHaveTypeImportsFrom(...globs: string[]): Condition<SourceFile> {
  const matchers = globs.map((g) => picomatch(g))
  const quotedGlobs = globs.map((g) => `"${g}"`).join(', ')
  return {
    description: `only have type imports from ${quotedGlobs}`,
    evaluate(sourceFiles: SourceFile[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const sf of sourceFiles) {
        for (const edge of edgesOf(sf)) {
          if (!TYPE_IMPORT_KINDS[edge.kind]) continue
          const importPath = matchedCandidate(edgeCandidates(edge), matchers)
          if (importPath !== undefined && !edge.typeOnly) {
            violations.push({
              ...edgeViolation(
                sf,
                edge,
                `${sf.getBaseName()} has ${edgeValuePhrase(edge.kind)} "${importPath}" which should be a type-only import`,
                context,
              ),
              // Per-kind, because a re-export's remedy removes a runtime export
              // and the reader has to know that before following it.
              suggestion: edgeTypeOnlyRemedy(edge.kind),
            })
          }
        }
      }
      return violations
    },
  }
}
