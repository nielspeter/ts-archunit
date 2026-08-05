/**
 * Plan 0083 Phase 0's derivation: the **population of enforceable primitives**, from source.
 *
 * ## Why this file exists at all
 *
 * [Plan 0083](../../plans/0083-eat-our-own-dogfood.md) was filed claiming **166** enforceable
 * primitives, "derived from source". A product review re-ran the stated method and got **185**.
 * A third run got **187**. A fourth reader — me, on 2026-08-04 — got **231** and quoted a coverage
 * figure of 13.0% from it. Four numbers, one sentence of method, **no committed script**. So it was
 * never a derivation; it was a recollection with a method attached.
 *
 * The first committed version of this file then produced a fifth number, **150**, and was wrong for a
 * fifth reason: it read only `src/index.ts`. `package.json` declares **twelve** `exports` subpaths, and
 * 31 primitives are reachable only through the other eleven — every metric rule, every `typescript`
 * rule, the `naming`, `dependencies` and `code-quality` families, and all of GraphQL. The docstring
 * justified the barrel restriction with "a user cannot apply what they cannot import", which was false
 * for all 31 of them. A review measured it within the hour.
 *
 * **The deliverable is therefore not a number. It is this rule, written down and executed:**
 *
 * > An *enforceable primitive* is a function reachable from one of `package.json`'s declared `exports`
 * > subpaths, whose declared return type is `Condition`, `PairCondition` or `Predicate`.
 *
 * ## Why the manifest and not the barrel
 *
 * The published `exports` map is what decides whether an adopter can import a thing at all, so it is
 * the honest boundary — and reading it makes this derivation independent of the barrel in ADR-008
 * rule 5's sense: the manifest and `src/index.ts` are maintained by different edits, and when they
 * disagree the disagreement is the finding. The barrel alone cannot see a subpath, which is exactly
 * how 150 happened.
 *
 * ## What the rule includes and excludes, and why each side is deliberate
 *
 * The **return type** is the definition rather than the folder, because the folder was what made every
 * earlier count wrong. The first draft counted `src/smells/`'s `buildFingerprint` and
 * `computeSimilarity`; they return `Fingerprint` and `number`. They are internal helpers that happen
 * to be exported — the same category error the plan rejects for `TerminalBuilder`. A return type of
 * `Condition` or `Predicate` is not a naming convention: it is the type the rule engine consumes, so
 * it is precisely the set of things you can point at code.
 *
 * Both halves of the rule exclude a real member:
 *
 * - **Reachable from a declared subpath** excludes conditions that exist only for internal
 *   composition. A user cannot apply what they cannot import — now true as stated, because the
 *   manifest is what "import" means.
 * - **Returns `Condition` / `PairCondition` / `Predicate`** excludes the other public functions: entry
 *   points (`modules`, `classes`, returning builders), argument matchers (`call`, `access`, returning
 *   `ExpressionMatcher`), formatters (returning `string`), and the two smell helpers above. The full
 *   histogram is returned so this exclusion is auditable rather than asserted.
 *
 * `PairCondition` is in because a condition over two element sets is still a condition you point at
 * code — `haveMatchingCounterpart` is the correspondence family's whole point. Its declarations read
 * `): PairCondition {` with no type arguments, because its parameters are defaulted
 * (`PairCondition<A = SourceFile, B = SourceFile>`); that is why corroboration below matches on a word
 * boundary rather than on `<`. The first version of this comment said "non-generic", which is wrong
 * about the type and right about the text.
 *
 * ## A function, including one written as a `const`
 *
 * "A function" means anything callable, so an exported `const f = (): Condition<X> => …` counts. The
 * first version narrowed to `FunctionDeclaration` and would have missed it silently — a review
 * measured that too, by adding one. Today the repository has none, which is why the assumption was
 * never tested; the derivation now takes call signatures, so the code matches the sentence.
 *
 * ## Why this file reports NO coverage ratio
 *
 * The 13.0% came from matching primitive names against call sites in `tests/archunit/`. That numerator
 * is wrong, and not marginally: **a primitive can be applied without its name ever appearing.**
 * `.resideInFolder(...)` in the should-phase calls `conditionResideInFolder`
 * (`src/builders/class-rule-builder.ts:131`), and `arch-rules.test.ts` writes `.resideInFolder(`
 * **eighteen** times and `conditionResideInFolder` zero times. Most predicates are reached the same
 * way, through a builder method of the same name.
 *
 * An honest numerator needs call-graph reachability, not name matching. That is Phase 2's problem and
 * it is parked. So this file ships the **denominator only**, and the test documents the
 * counter-example — note *documents*: the test cannot stop someone quoting a ratio in a markdown file,
 * and the first version of this docstring claimed it could.
 *
 * ## Reading the population
 *
 * `TSA_PRINT_PRIMITIVES=1 npx vitest run tests/tools/scan-enforceable-primitives.test.ts` prints the
 * list. A stated escape hatch (ADR-008 rule 3), not a silent one: it exists because Phase 2's input is
 * the list, and a list nobody can print is the same failure as a number nobody can reproduce.
 */
import { Node, Project } from 'ts-morph'
import type { ExportedDeclarations, SourceFile } from 'ts-morph'
import fs from 'node:fs'
import path from 'node:path'
import { isRecord } from '../../src/core/type-guards.js'

/** The three return types that make a function something you can point at code. */
export const PRIMITIVE_KINDS: readonly string[] = ['Condition', 'PairCondition', 'Predicate']

/** One member of the population. */
export interface Primitive {
  readonly name: string
  readonly kind: string
  /** Repo-relative path of the DECLARATION, so the output is stable across checkouts. */
  readonly file: string
  /** 1-based line of the declaration, so a failure names a place to look. */
  readonly line: number
  /**
   * The declaration's own signature text — the source a reader sees.
   *
   * Carried per declaration so the checker's verdict can be corroborated against the text of *that
   * declaration*. The first version matched against the whole containing file, which certifies only
   * that something in the file returns that kind.
   */
  readonly signature: string
  /** Every declared `exports` subpath that reaches it, sorted. */
  readonly subpaths: readonly string[]
}

/** A declared entry point: the subpath an adopter writes, and the source file it resolves to. */
export interface EntryPoint {
  readonly subpath: string
  readonly file: string
}

export interface PrimitivePopulation {
  /** The population, sorted by name. */
  readonly primitives: readonly Primitive[]
  /**
   * Every exported function name across all entry points — the surface the population is carved from.
   *
   * Names rather than a count, because a count cannot support the assertion that matters: that each
   * name this repository claims is *excluded* is actually present to be excluded. A count leaves every
   * such row one deletion away from being vacuously true.
   */
  readonly publicFunctions: readonly string[]
  /** The entry points read, so a manifest walk that finds nothing is visible rather than silent. */
  readonly entryPoints: readonly EntryPoint[]
  /**
   * Return-type symbol → how many public functions return it.
   *
   * The audit trail for the exclusion: a reader can see that `Fingerprint`, `string` and
   * `ModuleRuleBuilder` were left out, rather than taking this file's word for it.
   */
  readonly returnKinds: ReadonlyMap<string, number>
  /**
   * Names whose overload signatures do not all return the same kind.
   *
   * Exposed so those can be an enumerated decision rather than an accident of declaration order —
   * the defect that put `not`/`and`/`or` in the population without anyone choosing it.
   */
  readonly heterogeneous: readonly string[]
}

/**
 * The entry points an adopter can import, derived from `package.json`'s `exports` map.
 *
 * Maps the published `./dist/x.js` back to `src/x.ts`, which is the one assumption here: it holds
 * because `tsconfig.json` emits `src/` to `dist/` flat, and `scripts/verify-package.mjs` already
 * fails the build if a declared subpath does not resolve after packing.
 */
function entryPointsOf(repo: string): EntryPoint[] {
  const manifest: unknown = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf-8'))
  if (!isRecord(manifest)) return []
  const map: unknown = manifest.exports
  if (!isRecord(map)) return []

  const out: EntryPoint[] = []
  for (const subpath of Object.keys(map)) {
    // A target is either a string or a conditions object; take whichever field names the JS.
    // `isRecord` (src/core/type-guards.ts) rather than a cast — ADR-005, and the same guard the
    // library uses to read untyped JSON.
    const target: unknown = map[subpath]
    const candidates: unknown[] = isRecord(target) ? [target.import, target.default] : [target]
    const js = candidates.find((c): c is string => typeof c === 'string')
    if (js === undefined) continue
    const source = js.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts')
    if (fs.existsSync(path.join(repo, source))) out.push({ subpath, file: source })
  }
  return out
}

/**
 * The return type as the checker resolves it, reduced to a symbol name.
 *
 * An alias first, because `PairCondition` and friends are what the source writes; then the symbol;
 * then the printed text for primitives like `string` and `number`, which have no symbol. Comparing
 * `getText()` alone would split `Condition<SourceFile>` from `Condition<ClassDeclaration>` into two
 * kinds and hide the population inside the noise.
 */
function returnKindOf(declaration: ExportedDeclarations): string | undefined {
  if (Node.isFunctionDeclaration(declaration)) {
    const type = declaration.getReturnType()
    return type.getAliasSymbol()?.getName() ?? type.getSymbol()?.getName() ?? type.getText()
  }
  // A `const f = (): Condition<X> => …` is a function too. Its own type carries the call signature,
  // so the return type comes from there rather than from the declaration.
  if (Node.isVariableDeclaration(declaration)) {
    const signature = declaration.getType().getCallSignatures()[0]
    if (signature === undefined) return undefined
    const type = signature.getReturnType()
    return type.getAliasSymbol()?.getName() ?? type.getSymbol()?.getName() ?? type.getText()
  }
  return undefined
}

/**
 * The declaration's signature text — what a reader sees, independent of what the checker resolved.
 *
 * Per declaration rather than per file. The first version corroborated the checker's verdict against
 * the whole containing file, which certifies "something in here returns this kind" — **36 of the 39**
 * declaring files hold more than one primitive, so a mislabelled member sailed through unless it
 * happened to be one of a handful of named names. (That 36 is measured; the first version of this
 * sentence carried a reviewer's figure for the smaller population without re-deriving it.)
 */
function signatureTextOf(declaration: ExportedDeclarations): string {
  const full = declaration.getSourceFile().getFullText()
  if (Node.isFunctionDeclaration(declaration)) {
    const body = declaration.getBody()
    return full.slice(
      declaration.getStart(),
      body === undefined ? declaration.getEnd() : body.getStart(),
    )
  }
  // For a `const`, the head up to the arrow's body is the annotated part; the whole declaration is a
  // safe upper bound and short in practice.
  return declaration.getText()
}

/** Derive the population from `repo`'s own source and its published manifest. */
export function scanEnforceablePrimitives(repo: string): PrimitivePopulation {
  const project = new Project({ tsConfigFilePath: path.join(repo, 'tsconfig.json') })
  const entryPoints = entryPointsOf(repo)

  const found = new Map<string, { primitive: Primitive; subpaths: Set<string> }>()
  const publicFunctions = new Set<string>()
  const returnKinds = new Map<string, number>()
  const heterogeneous = new Set<string>()
  /** Declaration keys already counted in the histogram — see the comment at its increment. */
  const counted = new Set<string>()

  for (const entry of entryPoints) {
    const file: SourceFile | undefined = project.getSourceFile(path.join(repo, entry.file))
    if (file === undefined) continue

    for (const [name, declarations] of file.getExportedDeclarations()) {
      // Overloads declare one name several times — `notImportFrom` has three signatures, all
      // returning `Condition<SourceFile>`. Take one declaration per name, but read EVERY signature
      // before deciding what the name returns.
      //
      // Reading only the first was a real defect, found by review rather than by the sabotage matrix:
      // `not`, `and` and `or` overload as `[Predicate, TypeMatcher, Predicate|TypeMatcher]`, so their
      // membership followed the ORDER of two interchangeable signatures. Swapping those two lines in
      // `src/core/combinators.ts` — semantically neutral, disjoint parameter types — moved three
      // members and every row still passed. `tests/core/condition-glob-declaration.test.ts:317` had
      // already met this and unions the overloads, noting that reading implementation signatures alone
      // "missed three of the four dependency conditions".
      const declaration = declarations.find(
        (d) => Node.isFunctionDeclaration(d) || Node.isVariableDeclaration(d),
      )
      if (declaration === undefined) continue

      // Kind → the signature that returns it. Keeping the NODE, not just the kind, is what makes the
      // recorded `signature` and `line` describe the signature that justified the classification.
      //
      // The first version stored the kind from the union and the text from `declarations.find(...)`,
      // and those are two different declarations for an overload set. Swapping `not`'s two
      // interchangeable overloads then produced a red on the corroboration row — a false alarm on a
      // semantically neutral edit, which is how a guard gets deleted. Found by a sabotage row written
      // to stay GREEN; without that row the coupling would have shipped.
      const byKind = new Map<string, ExportedDeclarations>()
      for (const d of declarations) {
        const overloads = Node.isFunctionDeclaration(d) ? [d, ...d.getOverloads()] : [d]
        for (const signature of overloads) {
          const k = returnKindOf(signature)
          if (k !== undefined && !byKind.has(k)) byKind.set(k, signature)
        }
      }
      if (byKind.size === 0) continue
      if (byKind.size > 1) heterogeneous.add(name)

      // A name counts as a primitive if ANY of its signatures returns a primitive kind, and the kind
      // recorded is that one — a decision, rather than whichever declaration came first.
      const kind = PRIMITIVE_KINDS.find((k) => byKind.has(k)) ?? [...byKind.keys()].sort()[0]
      if (kind === undefined) continue
      const declaringSignature = byKind.get(kind) ?? declaration

      // Keyed on the DECLARATION, not the name: one primitive exported from two subpaths is one
      // primitive, and two different primitives could in principle share a name across entry points.
      const declFile = path.relative(repo, declaration.getSourceFile().getFilePath())
      const key = `${declFile}::${name}`

      // The histogram counts DECLARATIONS, on the same key as the population, so that
      // "primitive kinds sum to the population" holds by construction rather than by luck.
      //
      // Counting sightings made it sum to 209 against a population of 181, because 28 names are
      // reachable from more than one entry point. Counting names instead fixed that and left a subtler
      // version: two different declarations sharing a name would be one histogram entry and two
      // population members, and the test asserting the two agree would red with a message about the
      // audit trail rather than about the collision. There are no such collisions today — which is
      // exactly why the invariant should not rest on there being none.
      if (!counted.has(key)) {
        counted.add(key)
        returnKinds.set(kind, (returnKinds.get(kind) ?? 0) + 1)
      }
      publicFunctions.add(name)
      if (!PRIMITIVE_KINDS.includes(kind)) continue
      const existing = found.get(key)
      if (existing === undefined) {
        found.set(key, {
          primitive: {
            name,
            kind,
            file: declFile,
            line: declaringSignature.getStartLineNumber(),
            signature: signatureTextOf(declaringSignature),
            subpaths: [],
          },
          subpaths: new Set([entry.subpath]),
        })
      } else {
        existing.subpaths.add(entry.subpath)
      }
    }
  }

  const primitives: Primitive[] = [...found.values()]
    .map(({ primitive, subpaths }) => ({ ...primitive, subpaths: [...subpaths].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file))

  return {
    primitives,
    publicFunctions: [...publicFunctions].sort(),
    entryPoints,
    returnKinds,
    heterogeneous: [...heterogeneous].sort(),
  }
}
