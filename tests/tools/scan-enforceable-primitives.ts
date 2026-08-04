/**
 * Plan 0083 Phase 0's derivation: the **population of enforceable primitives**, from source.
 *
 * ## Why this file exists at all
 *
 * [Plan 0083](../../plans/0083-eat-our-own-dogfood.md) was filed claiming **166** enforceable
 * primitives, "derived from source". A product review re-ran the stated method and got **185**.
 * A third run got **187**. A fourth reader — me, on 2026-08-04 — got **231** and quoted a
 * coverage figure of 13.0% from it.
 *
 * Four numbers, one sentence of method, **no committed script**. So it was never a derivation;
 * it was a recollection with a method attached. The precedent that fixed this one level down is
 * `scan-cardinality-assertions.ts`, committed for exactly the same reason and now the only
 * reason plan 0079's numbers can be audited at all.
 *
 * **The deliverable is therefore not a number. It is this rule, written down and executed:**
 *
 * > An *enforceable primitive* is a function exported from `src/index.ts` whose declared return
 * > type is `Condition`, `PairCondition` or `Predicate`.
 *
 * ## What that rule includes and excludes, and why each side is deliberate
 *
 * The return type is the definition rather than the folder, because the folder was what made
 * every earlier count wrong. The first draft counted `src/smells/`'s `buildFingerprint` and
 * `computeSimilarity` as primitives; they return `Fingerprint` and `number`. They are internal
 * helpers that happen to be exported — the same category error the plan rejects for
 * `TerminalBuilder`. A return type of `Condition` or `Predicate` is not a naming convention: it
 * is the type the rule engine consumes, so it is precisely the set of things you can point at
 * code.
 *
 * Both halves of the rule do work, and each excludes a real member:
 *
 * - **Exported from `src/index.ts`** excludes conditions that exist only for internal
 *   composition. A user cannot apply what they cannot import.
 * - **Returns `Condition` / `PairCondition` / `Predicate`** excludes the 81 other public
 *   functions — entry points (`modules`, `classes`, returning builders), argument matchers
 *   (`call`, `access`, returning `ExpressionMatcher`), formatters (returning `string`), and the
 *   two smell helpers above. The full histogram is returned so this exclusion is auditable
 *   rather than asserted.
 *
 * `PairCondition` is in because a condition over two element sets is still a condition you point
 * at code — `haveMatchingCounterpart` is the correspondence family's whole point. It is
 * non-generic, which is the one wrinkle in corroborating the checker's verdict against the
 * declaration text; see the test.
 *
 * ## Why this file reports NO coverage ratio, which is the finding
 *
 * The 13.0% came from matching primitive names against call sites in `tests/archunit/`. That
 * numerator is wrong, and not marginally: **a primitive can be applied without its name ever
 * appearing.** `.resideInFolder(...)` in the should-phase calls `conditionResideInFolder`
 * (`src/builders/class-rule-builder.ts:131`), and `arch-rules.test.ts` writes
 * `.resideInFolder(` twenty times and `conditionResideInFolder` zero times. Most of the 51
 * predicates are reached the same way, through a builder method of the same name.
 *
 * An honest numerator needs call-graph reachability, not name matching. That is Phase 2's
 * problem and it is parked. So this file ships the **denominator only**, and the test pins the
 * counter-example above so that the next person to divide two numbers here has to argue with a
 * failing assertion rather than with a comment.
 *
 * ## Reading the population
 *
 * `TSA_PRINT_PRIMITIVES=1 npx vitest run tests/tools/scan-enforceable-primitives.test.ts`
 * prints the list. A stated escape hatch (ADR-008 rule 3), not a silent one: it exists because
 * Phase 2's input is the list, and a list nobody can print is the same failure as a number
 * nobody can reproduce.
 */
import { Node, Project } from 'ts-morph'
import path from 'node:path'

/** The three return types that make a function something you can point at code. */
export const PRIMITIVE_KINDS: readonly string[] = ['Condition', 'PairCondition', 'Predicate']

/** One member of the population. */
export interface Primitive {
  readonly name: string
  readonly kind: string
  /** Repo-relative, so the output is stable across checkouts. */
  readonly file: string
}

export interface PrimitivePopulation {
  /** The population, sorted by name. */
  readonly primitives: readonly Primitive[]
  /** Every function `src/index.ts` exports — the denominator the population is carved from. */
  readonly publicFunctions: number
  /**
   * Return-type symbol → how many public functions return it.
   *
   * The audit trail for the exclusion: a reader can see that `Fingerprint`, `string` and
   * `ModuleRuleBuilder` were left out, rather than taking this file's word for it.
   */
  readonly returnKinds: ReadonlyMap<string, number>
}

/**
 * The return type as the checker resolves it, reduced to a symbol name.
 *
 * An alias first, because `PairCondition` and friends are what the source writes; then the
 * symbol; then the printed text for primitives like `string` and `number`, which have no
 * symbol. Comparing `getText()` alone would split `Condition<SourceFile>` from
 * `Condition<ClassDeclaration>` into two kinds and hide the population inside the noise.
 */
function returnKindOf(fn: Node): string {
  if (!Node.isFunctionDeclaration(fn)) return '(not a function)'
  const type = fn.getReturnType()
  return type.getAliasSymbol()?.getName() ?? type.getSymbol()?.getName() ?? type.getText()
}

/**
 * Derive the population from `repo`'s own source.
 *
 * Loads the repository's real tsconfig, so this is the same resolution the library performs on
 * an adopter's project — not a re-implementation of it.
 */
export function scanEnforceablePrimitives(repo: string): PrimitivePopulation {
  const project = new Project({ tsConfigFilePath: path.join(repo, 'tsconfig.json') })
  const index = project.getSourceFileOrThrow(path.join(repo, 'src', 'index.ts'))

  const primitives: Primitive[] = []
  const returnKinds = new Map<string, number>()
  let publicFunctions = 0

  for (const [name, declarations] of index.getExportedDeclarations()) {
    // Overloads declare one name several times — `notImportFrom` has three signatures, all
    // returning `Condition<SourceFile>`. Counting declarations instead of names would have
    // inflated the population by the size of the overload set, which is one of the ways a
    // hand-run count drifts between readers.
    const declaration = declarations.find((d) => Node.isFunctionDeclaration(d))
    if (declaration === undefined) continue
    publicFunctions += 1

    const kind = returnKindOf(declaration)
    returnKinds.set(kind, (returnKinds.get(kind) ?? 0) + 1)
    if (!PRIMITIVE_KINDS.includes(kind)) continue

    primitives.push({
      name,
      kind,
      file: path.relative(repo, declaration.getSourceFile().getFilePath()),
    })
  }

  primitives.sort((a, b) => a.name.localeCompare(b.name))
  return { primitives, publicFunctions, returnKinds }
}
