import picomatch from 'picomatch'
import type { SourceFile, ImportDeclaration } from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { candidatesFor, matchedCandidate } from '../core/import-candidates.js'
import { recordEdgeCoverage } from '../core/edge-coverage.js'
import { globAnyOf } from '../core/glob-site.js'
import {
  edgeTypeOnlyRemedy,
  edgeDiscriminator,
  edgeValuePhrase,
  edgeTypeOnlyNoun,
  edgeStream,
  edgeVerb,
  edgesOf,
  FORWARD_EDGE_KINDS,
  type ModuleEdge,
  type ModuleEdgeKind,
} from '../core/module-edges.js'

export type { ImportOptions } from '../core/import-options.js'
import type { ImportOptions } from '../core/import-options.js'
import { splitGlobArgs } from '../core/import-options.js'
import { rootOf } from '../core/project-relative.js'
import { byCodepoint } from '../core/violation.js'

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
const DEPENDENCY_KINDS = FORWARD_EDGE_KINDS

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
function edgeCandidates(
  edge: ModuleEdge,
  sourceFile: SourceFile,
): ReturnType<typeof candidatesFor> {
  // The IMPORTING file's root. In a workspace the target may live in another
  // package, whose absolute path is not under this root — then no relative
  // candidate is produced and matching falls back to the absolute form, which
  // is the honest answer: `'src/shared/**'` written in one package means that
  // package's `src/shared`.
  return candidatesFor(edge.specifier, edge.resolvedPath, rootOf(sourceFile))
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
    // `identity` — the canonical form that supersedes `element::message` in the
    // baseline hash. [Bug 0028](../../bugs/fixed/0028-two-findings-in-one-file-can-share-a-baseline-identity.md).
    //
    // The message carries the basename and the resolved target and nothing else, so
    // two edges from one file to one module are byte-identical and share a hash.
    // Measured on this repo's own barrel after v0.28.0 made barrels
    // dependency-bearing: `src/index.ts` produced **114 findings and 87 identities —
    // 26 colliding groups, 46.5% of findings sharing**. You could not accept one and
    // keep failing on its sibling, and a re-export added later was silently
    // pre-accepted by an entry written before it existed.
    //
    // **`names` is the discriminator, and the line is not.** Measured, adding `names`
    // takes those 114 edges to 114 distinct identities; adding the line does too, and
    // is rejected for the reason `baseline.ts` already excludes it — an accepted
    // violation has to survive its code moving. A sample colliding pair shows why
    // names work: same file, same target, same kind, `[project, workspace,
    // resetProjectCache]` against `[ArchProject]`.
    //
    // This is `ModuleEdge.names`' first production consumer. Until now its only
    // reader was the runtime independence test, which is a fair criticism of a field
    // that costs a per-kind rule to compute.
    //
    // **A residual, stated.** For `kind === 'import'` `names` is the INWARD name, so
    // `import { X } from 'm'` and `import { X as Y } from 'm'` in one file both carry
    // `['X']` and still share an identity. Separating them needs the local binding,
    // which `ModuleEdge` deliberately does not carry — the same reason
    // `notHaveAliasedImports` was never routed through the edge walk. That shape is
    // legal and unusual; the shape this fixes is the barrel, where re-exports use the
    // OUTWARD name and aliases therefore differ. Measured: 26 colliding groups on this
    // repo's barrel go to 0, and the aliased-import pair is what remains.
    identity: [
      // The FULL PATH, not the basename — [bug 0063](../../bugs/fixed/0063-a-dependency-identity-collides-across-files-sharing-a-basename.md).
      //
      // Every other component here is a property of the EDGE, so the basename was the only
      // thing identifying the file, and it does not: two sibling folders each with an
      // `index.ts` importing the same target produced ONE identity for TWO violations, and
      // one baseline entry accepted both. Measured `findings=2 distinctHashes=1`, on the
      // commonest layout there is. `ArchViolation.identity` requires uniqueness per finding
      // within a rule, in those words.
      //
      // An absolute path is not a new bet: `edgeCandidates(...)[0]` below is already the
      // resolved absolute path of the TARGET, and `hashViolation` normalises the repository
      // root out of identity text (`src/core/identity-root.ts`) with a root that defaults to
      // `discoverIdentityRoot`.
      sourceFile.getFilePath(),
      edge.kind,
      // No root here: `[0]` is the primary candidate either way, and this string
      // is a baseline identity — feeding it anything new would rewrite every
      // existing dependency entry for no gain.
      edgeCandidates(edge, sourceFile)[0],
      // See `edgeDiscriminator`. This family HAS reported `dynamic` and
      // `type-expression` all along, so the collision was live here — and it was live in
      // the slice family too, for the `import`/`reexport` spellings that carry no names.
      //
      // **Nothing moves.** The first edge of each `kind::specifier` group emits `''`,
      // which is byte-for-byte what the pre-ordinal formula produced; only the second and
      // later siblings gain `#n`, and those groups had one hash for two findings before.
      // Measured against `main` across all seven `import`/`reexport` spellings plus
      // `dynamic` and `type-expression`: zero diff.
      edgeDiscriminator(edge),
    ].join('::'),
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
  /**
   * What distinguishes this finding from a sibling, WITHOUT the file — the caller knows,
   * this function adds the path.
   *
   * [Bug 0063](../../bugs/fixed/0063-a-dependency-identity-collides-across-files-sharing-a-basename.md)'s
   * third mechanism, and the one my own corrected scope got wrong twice. This constructor
   * set no identity, so findings fell back to `element::message` — and for
   * `notHaveAliasedImports` the message is `"<basename> aliases \"x\" as \"y\""`, identical
   * for two sibling files aliasing the same import. I had asserted it was unaffected on the
   * ground that the message "names the specifier"; it names the *alias*, which is equally
   * shared. The control row written to pin the scope disproved it instead.
   */
  subject: string,
): ArchViolation {
  return {
    rule: context.rule,
    element: sourceFile.getBaseName(),
    file: sourceFile.getFilePath(),
    line: importDecl.getStartLineNumber(),
    // The path, then what the caller says distinguishes it. Not the message: a message is
    // prose and may be reworded, which is the whole reason `identity` exists.
    identity: `${sourceFile.getFilePath()}::${subject}`,
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
  const { globs, options } = splitGlobArgs(args)
  const ignoreType = options?.ignoreTypeImports === true
  const matchers = globs.map((g) => picomatch(g))
  const quotedGlobs = globs.map((g) => `"${g}"`).join(', ')
  return {
    // Declared so the glob is visible to `explain`, `doctor` and 0069's glob model
    // (plan 0073). `globAnyOf` because the variadic family is `matchers.some`, so the
    // set is dead only when every glob in it is — `all` here would read a set with one
    // live glob as dead, which is the 0.18.1 withdrawal in the other direction
    // (`glob-site.ts:185`).
    //
    // `import-target` has no path-universe views by design (`path-universe.ts:72`), so
    // declaring changes no verdict — a bare specifier legitimately matches no project
    // path, which is what bug 0014 was fixed to support.
    globs: globAnyOf(globs, 'import-target'),
    description: `only import from ${quotedGlobs}`,
    evaluate(sourceFiles: SourceFile[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      // Bug 0015: an allowlist constrains EDGES, so a subject with none passes
      // however broken the allowlist. Counted after the same filters the check
      // applies — including `ignoreType`, since an edge this rule skips is an
      // edge it did not test.
      let tested = 0
      // Counted separately so the disclosure can name the right cause: a subject
      // whose imports were all filtered by `ignoreTypeImports` is NOT a
      // dependency-free module, and saying so sends the reader to a folder full
      // of imports to look for the ones the tool says are missing.
      let seen = 0
      for (const sf of sourceFiles) {
        for (const edge of edgesOf(sf)) {
          if (!DEPENDENCY_KINDS[edge.kind]) continue
          seen++
          if (ignoreType && edge.typeOnly) continue
          tested++
          const candidates = edgeCandidates(edge, sf)
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
      recordEdgeCoverage(
        context.rule,
        sourceFiles.length,
        tested,
        seen > 0 ? 'all-filtered' : 'no-edges',
      )
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
  const { globs, options } = splitGlobArgs(args)
  const ignoreType = options?.ignoreTypeImports === true
  const matchers = globs.map((g) => picomatch(g))
  const quotedGlobs = globs.map((g) => `"${g}"`).join(', ')
  return {
    // Declared so the glob is visible to `explain`, `doctor` and 0069's glob model
    // (plan 0073). `globAnyOf` because the variadic family is `matchers.some`, so the
    // set is dead only when every glob in it is — `all` here would read a set with one
    // live glob as dead, which is the 0.18.1 withdrawal in the other direction
    // (`glob-site.ts:185`).
    //
    // `import-target` has no path-universe views by design (`path-universe.ts:72`), so
    // declaring changes no verdict — a bare specifier legitimately matches no project
    // path, which is what bug 0014 was fixed to support.
    globs: globAnyOf(globs, 'import-target'),
    description: `not import from ${quotedGlobs}`,
    evaluate(sourceFiles: SourceFile[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const sf of sourceFiles) {
        for (const edge of edgesOf(sf)) {
          if (!DEPENDENCY_KINDS[edge.kind]) continue
          if (ignoreType && edge.typeOnly) continue
          const importPath = matchedCandidate(edgeCandidates(edge, sf), matchers)
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
 * **Sees every kind of module edge**, not just static imports: `import`,
 * `export … from`, `import()` and `type X = import('…').Y`. (CJS `require` is
 * classified and deliberately not enforced — see `DEPENDENCY_KINDS`.)
 *
 * **What counts as a dependency differs per kind, and the asymmetry is
 * deliberate.** This is the only condition in the library where it does:
 *
 * | edge                              | satisfies `dependOn`?              |
 * | --------------------------------- | ---------------------------------- |
 * | `import { x } from '…'`           | yes                                |
 * | `import type { X } from '…'`      | **yes** — unchanged; opt out with `{ ignoreTypeImports: true }` |
 * | `export { x } from '…'`           | yes                                |
 * | `export type { X } from '…'`      | **no** — erased, so nothing loads  |
 * | `await import('…')`               | yes                                |
 * | `type X = import('…').Y`          | **no** — erased                    |
 *
 * For `kind === 'import'` the behaviour is exactly what it was before v0.28.0:
 * an `import type` of the target satisfies the rule, and `{ ignoreTypeImports:
 * true }` is the shipped opt-in that makes it fail. Requiring runtime there
 * would be a green→red change to a contract that already has an opt-out.
 *
 * For the other kinds it requires **runtime**, because the alternative creates a
 * new false green: `export type { SecurityConfig } from './security.js'` would
 * satisfy `dependOn('**\/security/**')` while the server installs nothing — and
 * on the baseline side that reads as "the violation was fixed".
 *
 * **This is a red→green reversal from v0.27.0.** Before v0.28.0 a runtime
 * re-export or dynamic import left this condition *unsatisfied*, so rules that
 * failed may now pass. That is the fix, not a regression: the dependency was
 * always there and the condition could not see it.
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
  const { globs, options } = splitGlobArgs(args)
  const ignoreType = options?.ignoreTypeImports === true
  const matchers = globs.map((g) => picomatch(g))
  const quotedGlobs = globs.map((g) => `"${g}"`).join(', ')
  return {
    // Declared so the glob is visible to `explain`, `doctor` and 0069's glob model
    // (plan 0073). `globAnyOf` because the variadic family is `matchers.some`, so the
    // set is dead only when every glob in it is — `all` here would read a set with one
    // live glob as dead, which is the 0.18.1 withdrawal in the other direction
    // (`glob-site.ts:185`).
    //
    // `import-target` has no path-universe views by design (`path-universe.ts:72`), so
    // declaring changes no verdict — a bare specifier legitimately matches no project
    // path, which is what bug 0014 was fixed to support.
    globs: globAnyOf(globs, 'import-target'),
    description:
      globs.length === 1 ? `depend on ${quotedGlobs}` : `depend on at least one of ${quotedGlobs}`,
    evaluate(sourceFiles: SourceFile[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const sf of sourceFiles) {
        // A `for … of` over `edgeStream`, not `edgesOf(sf).some(...)`.
        //
        // `edgesOf` builds and RESOLVES every edge in the file before returning, so
        // `.some()` on its result pays a `getSymbol()` per literal even when the
        // first one answers the question — 100 checker calls on a 100-import file
        // where the pre-0.28.0 code made 1. Spreading the generator
        // (`[...edgeStream(sf)].some(...)`) has the same defect and looks lazy, so
        // the loop is written out.
        let hasMatch = false
        for (const edge of edgeStream(sf)) {
          if (!DEPENDENCY_KINDS[edge.kind]) continue
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
          if (edge.kind === 'import' ? ignoreType && edge.typeOnly : edge.typeOnly) continue
          if (matchedCandidate(edgeCandidates(edge, sf), matchers) !== undefined) {
            hasMatch = true
            break
          }
        }
        if (!hasMatch) {
          violations.push({
            rule: context.rule,
            element: sf.getBaseName(),
            file: sf.getFilePath(),
            line: 1,
            // An identity, ADDED rather than corrected — bug 0063's worse half. This finding
            // had none, so it fell back to `element::message`; the element is a basename and
            // the message never names the file, so two sibling folders each with an
            // `index.ts` were one finding to the baseline. Measured
            // `findings=2 distinct=1`, with nothing in the identity to blame because there
            // was no identity.
            //
            // The globs are part of it because this finding is about a REQUIREMENT not met,
            // not about an edge: the same file failing two different `dependOn` rules is two
            // findings, and `rule` alone would not separate them if one rule carried both.
            identity: `${sf.getFilePath()}::depends-on::${[...globs].sort(byCodepoint).join(',')}`,
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
                  // The aliased name and the alias — the two things that make one aliased
                  // specifier different from another in the same file.
                  `aliased::${specifier.getName()}::${alias.getText()}`,
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
    // Declared so the glob is visible to `explain`, `doctor` and 0069's glob model
    // (plan 0073). `globAnyOf` because the variadic family is `matchers.some`, so the
    // set is dead only when every glob in it is — `all` here would read a set with one
    // live glob as dead, which is the 0.18.1 withdrawal in the other direction
    // (`glob-site.ts:185`).
    //
    // `import-target` has no path-universe views by design (`path-universe.ts:72`), so
    // declaring changes no verdict — a bare specifier legitimately matches no project
    // path, which is what bug 0014 was fixed to support.
    globs: globAnyOf(globs, 'import-target'),
    description: `only have type imports from ${quotedGlobs}`,
    evaluate(sourceFiles: SourceFile[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      // Bug 0015: same shape — the allowlist scopes which imports must be
      // type-only, so a subject with no matching import tests nothing.
      let tested = 0
      // Same distinction as `onlyImportFrom`, for the other reason: here an edge
      // is out of scope because the GLOB did not name it, and that is the case
      // worth surfacing — the glob may be a typo.
      let seen = 0
      for (const sf of sourceFiles) {
        for (const edge of edgesOf(sf)) {
          if (!TYPE_IMPORT_KINDS[edge.kind]) continue
          seen++
          const importPath = matchedCandidate(edgeCandidates(edge, sf), matchers)
          // In scope only when the allowlist matched it: an edge the glob does
          // not name is one this rule never had an opinion about.
          if (importPath !== undefined) tested++
          if (importPath !== undefined && !edge.typeOnly) {
            const violation = edgeViolation(
              sf,
              edge,
              `${sf.getBaseName()} has ${edgeValuePhrase(edge.kind)} "${importPath}" which should be a type-only ${edgeTypeOnlyNoun(edge.kind)}`,
              context,
            )
            // A producer-set `suggestion` WINS over the rule author's, because
            // `execute-rule.ts` resolves `v.suggestion ?? meta?.suggestion`. So it
            // is set only for the kinds this release introduces, where no remedy
            // existed before and a per-kind one is strictly better.
            //
            // NOT for `kind === 'import'`. Doing so replaced the shipped
            // `layered/type-imports-only` remedy — which offers "or move the value
            // you need into a layer this one is allowed to depend on", the only
            // followable action when the value is needed at runtime — with a
            // one-option remedy, and silently discarded any consumer's own
            // `.rule({ suggestion })`. Invisible to the message-identity guards
            // because `suggestion` is not hashed.
            violations.push(
              edge.kind === 'import'
                ? violation
                : { ...violation, suggestion: edgeTypeOnlyRemedy(edge) },
            )
          }
        }
      }
      recordEdgeCoverage(
        context.rule,
        sourceFiles.length,
        tested,
        seen > 0 ? 'none-matched' : 'no-edges',
      )
      return violations
    },
  }
}
