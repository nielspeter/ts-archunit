/**
 * The derivation in `scan-enforceable-primitives.ts`, guarded.
 *
 * A committed script is only better than a remembered number if the script is *checked*. Plan 0083
 * Phase 0's complaint is that four readers got four numbers, so the rows below are about the
 * classifier's behaviour — what it lets in, what it keeps out, and whether it read anything at all —
 * not about today's total.
 *
 * ADR-008's question, asked of this file: *what would it do if the derivation were completely broken?*
 * A broken walk returns an empty population, and an empty population satisfies every "no unexpected
 * member" assertion perfectly. So the vacuity row comes first, and the discrimination rows name real
 * members in both directions.
 *
 * ## What the first version of this file missed, and why the rows look the way they do
 *
 * It shipped with six rows and a sabotage matrix of eight, all caught, and two reviewers then measured
 * five more holes in an hour. Every one is now a row here, because they are all the same shape — a
 * guard one tier coarser than the thing it guards:
 *
 *  - The population was pinned by a **count plus a four-element folder set**, so deleting one
 *    `export … from './rules/hygiene.js'` line — four public primitives, `noStubComments` among them —
 *    left all six rows green. The precedent (`scan-cardinality-assertions.test.ts`) pins a 46-element
 *    **file** set for exactly this reason. Fixed by `CONTRIBUTING_FILES` below.
 *
 *    One correction to that finding, measured while proving the fix: under the manifest rule the same
 *    deletion is **not** a loss at all, because `./rules/hygiene` is its own declared subpath, so those
 *    four stay published and every row here stays green — correctly. The file set earns its place
 *    against a different revert: dropping a whole entry point takes three files with it, and it fires.
 *  - Admitting a whole extra return kind (`'boolean'`, `'GlobTree'`) was invisible for the same reason.
 *  - Each `MUST_EXCLUDE` entry went vacuous the moment its name left the API, and the row written to
 *    prevent that checked the *kind*, never the name. Fixed by asserting the names are present.
 *  - Corroboration was **per file**, so it certified "something in here returns this kind".
 *  - Membership followed **overload order** for `not`/`and`/`or`. Now enumerated.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { isRecord } from '../../src/core/type-guards.js'
import { scanEnforceablePrimitives } from './scan-enforceable-primitives.js'

const REPO = path.resolve(import.meta.dirname, '../..')

/**
 * A floor beneath the real population (181 on 2026-08-04), not a pin, and **not to be lowered**.
 *
 * Growth is a feature landing, so there is no ceiling. Collapse is the failure worth catching, and the
 * scale is measured rather than guessed: renaming the `Condition` interface leaves **63**,
 * `src/conditions/` dropping out leaves **115**, `src/predicates/` or `src/rules/` leaves **130**.
 *
 * The last of those is why the floor moved from 120 to 150: at 120, losing every rule in `src/rules/`
 * passed silently. And even at 150 a floor catches only wholesale collapse — losing
 * `src/rules/hygiene.ts` leaves 177 — which is what the file set below is for.
 *
 * (Three of these four numbers were written from inference first. Measuring them corrected one, in the
 * file whose entire subject is numbers nobody measured.)
 */
const POPULATION_FLOOR = 150

/** Likewise for the public surface the population is carved from (274 on 2026-08-04). */
const PUBLIC_FUNCTIONS_FLOOR = 250

const FLOOR_REMEDY =
  'This is a FLOOR, not a pin, and the cheapest green — lowering it — is the wrong move.\n' +
  'Two causes worth checking first: a primitive return type was renamed, or an entry point stopped\n' +
  're-exporting a folder. Both look like a smaller number and neither is a smaller API.'

/**
 * Members by name: one per kind, one per contributing folder, and one reachable ONLY through a
 * non-root subpath.
 *
 * That last group is why the population is 181 rather than 150. `maxCyclomaticComplexity` and
 * `haveFields` are not in `src/index.ts` at all; an adopter imports them from
 * `@nielspeter/ts-archunit/rules/metrics` and `/graphql`. The first version of this derivation read
 * only the root barrel and excluded 31 published primitives while claiming "a user cannot apply what
 * they cannot import".
 */
const MUST_INCLUDE: readonly string[] = [
  'noEval', // src/rules/security.ts, Condition
  'beExported', // src/conditions/exports.ts, Condition
  'haveNameMatching', // src/predicates/identity.ts, Predicate
  'haveMatchingCounterpart', // src/conditions/cross-layer.ts, PairCondition
  'defineCondition', // src/core/define.ts — the only folder no other name here covers
  'conditionResideInFolder', // src/conditions/structural.ts, and the no-ratio row's subject
  'maxCyclomaticComplexity', // ./rules/metrics ONLY — invisible to a barrel-only walk
  'haveFields', // ./graphql ONLY — likewise
]

/**
 * Non-members by name, each standing for one reason the rule excludes things.
 *
 * `buildFingerprint` and `computeSimilarity` are the two that made the plan's first count wrong:
 * public, in `src/smells/`, and internal helpers. If the rule readmits them it has gone back to
 * counting folders.
 *
 * The builder-shaped entries are a **recorded decision, not an oversight**. `smells.duplicateBodies(p)`
 * is something you point at code, and it is outside the population because it is a builder on a
 * different execution path — admitting it means abandoning a type-based rule for a judgment. Naming
 * them here is what keeps that a decision: plan 0083's own finding is that features built to fix our
 * own bugs were never aimed at us, and the smells feature is one of those.
 */
const MUST_EXCLUDE: readonly string[] = [
  'buildFingerprint', // returns Fingerprint — an internal helper
  'computeSimilarity', // returns number — likewise
  'modules', // returns a builder — an entry point, not a primitive
  'crossLayer', // builder-shaped check, deliberately outside (see above)
  'tsconfig', // builder-shaped check, deliberately outside
  'jsxElements', // builder-shaped check, deliberately outside
  'call', // returns ExpressionMatcher — an argument to a condition, not a condition
  'formatViolations', // returns string — output, not enforcement
]

/**
 * Every file that declares at least one member of the population.
 *
 * **This is the guard.** The count and the folder set are vacuity instruments; a *file* leaving this
 * set is the event worth catching, because that is what an accidentally-deleted re-export looks like.
 * Straight from `scan-cardinality-assertions.test.ts:47`, whose comment says why — and whose shape the
 * first version of this file did not copy.
 *
 * Not `file:line`: line numbers shift on every edit above them, which reds the row on unrelated
 * changes and teaches the next author to update the list without reading it.
 */
const CONTRIBUTING_FILES: readonly string[] = [
  'src/conditions/body-analysis-function.ts',
  'src/conditions/body-analysis-module.ts',
  'src/conditions/body-analysis.ts',
  'src/conditions/call.ts',
  'src/conditions/class.ts',
  'src/conditions/cross-layer.ts',
  'src/conditions/dependency.ts',
  'src/conditions/exports.ts',
  'src/conditions/function.ts',
  'src/conditions/jsx.ts',
  'src/conditions/members.ts',
  'src/conditions/pattern.ts',
  'src/conditions/reverse-dependency.ts',
  'src/conditions/slice.ts',
  'src/conditions/structural.ts',
  'src/conditions/type-level.ts',
  'src/core/combinators.ts',
  'src/core/define.ts',
  'src/graphql/resolver-rule-builder.ts',
  'src/graphql/schema-conditions.ts',
  'src/graphql/schema-predicates.ts',
  'src/predicates/call.ts',
  'src/predicates/class.ts',
  'src/predicates/function.ts',
  'src/predicates/identity.ts',
  'src/predicates/jsx.ts',
  'src/predicates/metrics.ts',
  'src/predicates/module.ts',
  'src/predicates/type.ts',
  'src/rules/architecture.ts',
  'src/rules/code-quality.ts',
  'src/rules/dependencies.ts',
  'src/rules/errors.ts',
  'src/rules/hygiene.ts',
  'src/rules/metrics-function.ts',
  'src/rules/metrics.ts',
  'src/rules/naming.ts',
  'src/rules/security.ts',
  'src/rules/typescript.ts',
]

/**
 * The five members that satisfy the rule's letter and not its gloss.
 *
 * The rule says "the type the rule engine consumes"; the gloss says "precisely the set of things you
 * can point at code". You cannot point `and` at code — it composes two primitives — and dogfooding
 * `defineCondition` is trivially satisfiable while saying nothing about coverage.
 *
 * They stay in, because carving them out by hand is how a mechanical rule becomes a judgment: the one
 * structural signal that isolates the combinators (a `Predicate`-typed parameter) does not separate the
 * two factories from real primitives like `haveConsistentExports`, which also takes callbacks. So the
 * decision is recorded instead, and asserted exactly — a sixth arrival reds rather than being absorbed
 * — and any future ratio must subtract this list rather than rediscover it.
 */
const META_PRIMITIVES: readonly string[] = [
  'and',
  'defineCondition',
  'definePredicate',
  'not',
  'or',
]

/**
 * Names whose overload signatures disagree about what they return.
 *
 * `not`, `and` and `or` overload as `[Predicate, TypeMatcher, Predicate|TypeMatcher]`. The first
 * version of the scan read the first declaration only, so their membership depended on the ORDER of
 * two interchangeable signatures — swapping those lines in `src/core/combinators.ts` moved three
 * members with every row still green. The scan now unions the signatures; this row makes the set of
 * names it has to reason about an enumerated decision.
 */
const HETEROGENEOUS_OVERLOADS: readonly string[] = ['and', 'not', 'or']

describe('the enforceable-primitive population is derived, not remembered (plan 0083 Phase 0)', () => {
  const { primitives, publicFunctions, entryPoints, returnKinds, heterogeneous } =
    scanEnforceablePrimitives(REPO)
  const names = primitives.map((p) => p.name)

  if (process.env.TSA_PRINT_PRIMITIVES === '1') {
    // Written to stderr, NOT through `console`: vitest's reporter intercepts console output and
    // replays it only for FAILING tests, so the documented way to read this list printed nothing at
    // all. Measured — and it is bug 0024's channel, whose fix is recorded in `src/core/stderr.ts`.
    process.stderr.write(
      `\n${String(primitives.length)} enforceable primitives of ${String(publicFunctions.length)} public functions ` +
        `across ${String(entryPoints.length)} entry points:\n` +
        primitives
          .map(
            (p) =>
              `  ${p.kind.padEnd(14)} ${p.name.padEnd(34)} ${p.file}:${String(p.line)}  [${p.subpaths.join(' ')}]`,
          )
          .join('\n') +
        '\n',
    )
  }

  it('VACUITY: the walk read the API, and the rule carved something out of it', () => {
    expect(publicFunctions.length, FLOOR_REMEDY).toBeGreaterThan(PUBLIC_FUNCTIONS_FLOOR)
    expect(primitives.length, FLOOR_REMEDY).toBeGreaterThan(POPULATION_FLOOR)
    // And the rule EXCLUDES something. A classifier that admits everything reproduces the original
    // mistake — 231 was exactly that number — while looking like a healthy population.
    expect(primitives.length).toBeLessThan(publicFunctions.length)
    // The histogram must account for the population exactly. It double-counted names reachable from
    // two subpaths until this row was written, summing to 209 against a population of 181.
    const fromKinds = ['Condition', 'PairCondition', 'Predicate'].reduce(
      (sum, k) => sum + (returnKinds.get(k) ?? 0),
      0,
    )
    expect(
      fromKinds,
      'the audit trail disagrees with the population it is supposed to explain',
    ).toBe(primitives.length)
  })

  it('every declared exports subpath resolved to a source file', () => {
    // The manifest walk's own vacuity. A subpath whose target does not map back to `src/` is dropped
    // silently, and dropping `./graphql` alone would take 8 primitives with it — the exact failure
    // this whole change was made to fix, one level up.
    const manifest: unknown = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf-8'))
    const exportsMap: unknown = isRecord(manifest) ? manifest.exports : undefined
    const declared = isRecord(exportsMap) ? Object.keys(exportsMap) : []
    const resolved = entryPoints.map((e) => e.subpath)
    expect(declared.length).toBeGreaterThan(10)
    expect(
      declared.filter((s) => !resolved.includes(s)),
      'these declared subpaths did not resolve to a source file, so their primitives are invisible',
    ).toEqual([])
  })

  it('includes a primitive from each kind, each folder, and each entry-point shape', () => {
    expect(
      MUST_INCLUDE.filter((n) => !names.includes(n)),
      'the derivation stopped seeing these published primitives',
    ).toEqual([])

    const folders = [...new Set(primitives.map((p) => p.file.split('/').slice(0, 2).join('/')))]
    expect(
      folders.sort(),
      'A folder ARRIVING here is fine — add it. A folder LEAVING is a re-export that vanished, and\n' +
        'editing this array to match is how that gets accepted silently. The two read identically in\n' +
        'the diff, so check which direction it moved before touching the expectation.',
    ).toEqual(['src/conditions', 'src/core', 'src/graphql', 'src/predicates', 'src/rules'])
  })

  it('excludes the helpers, entry points and matchers — each name still present to be excluded', () => {
    expect(
      MUST_EXCLUDE.filter((n) => names.includes(n)),
      'these are published but are not things you point at code; readmitting them is how the ' +
        'population went to 185, 187 and 231',
    ).toEqual([])
    // The half that was missing: each row above is ∀-over-∅ the moment its name leaves the API, and
    // `Fingerprint` and `ModuleRuleBuilder` have exactly one member each, so two of them were one
    // deletion from vacuous in both directions at once.
    expect(
      MUST_EXCLUDE.filter((n) => !publicFunctions.includes(n)),
      'these names are no longer public, so the exclusion row above no longer excludes anything —\n' +
        'replace each with a live example of the same exclusion reason rather than deleting the row',
    ).toEqual([])
  })

  it('the excluded kinds are really present — the exclusion is doing work', () => {
    for (const kind of ['Fingerprint', 'number', 'string', 'ModuleRuleBuilder']) {
      expect(
        returnKinds.get(kind) ?? 0,
        `no public function returns ${kind} any more`,
      ).toBeGreaterThan(0)
    }
  })

  it('no FILE has left the population', () => {
    // The guard. A count cannot see four primitives leave when the total is 181, and the folder set
    // cannot see `src/rules/hygiene.ts` leave while `security.ts` remains.
    const contributing = [...new Set(primitives.map((p) => p.file))].sort()
    expect(
      contributing.filter((f) => !CONTRIBUTING_FILES.includes(f)),
      'these files newly declare a published primitive — add them, this is growth',
    ).toEqual([])
    expect(
      CONTRIBUTING_FILES.filter((f) => !contributing.includes(f)),
      'these files no longer contribute a published primitive. If they were deleted or the rules moved,\n' +
        'trim the list. If a re-export was dropped by accident, restore it — an adopter loses those\n' +
        'primitives entirely and no other row here can see it.',
    ).toEqual([])
  })

  it('the overload sets that disagree with themselves are enumerated', () => {
    expect(
      [...heterogeneous],
      'a name whose overloads return different kinds decides its own membership by declaration ORDER\n' +
        'unless the scan unions them. If this list grew, check that the new name is classified the way\n' +
        'you intend rather than the way its signatures happen to be written.',
    ).toEqual([...HETEROGENEOUS_OVERLOADS])
    // And they really are in the population, which is the decision the union makes.
    for (const name of HETEROGENEOUS_OVERLOADS) expect(names).toContain(name)
  })

  it('the meta-primitives are exactly the recorded five', () => {
    // Rule 3: the escape hatch is stated and cannot widen silently. Any future ratio subtracts this
    // list; a sixth arrival must red rather than be absorbed into it.
    const core = primitives.filter((p) => p.file.startsWith('src/core/')).map((p) => p.name)
    expect(
      core.sort(),
      'the population gained or lost a member that composes primitives rather than applying to code',
    ).toEqual([...META_PRIMITIVES])
  })

  it('the checker’s verdict is corroborated by each declaration’s own text', () => {
    // A second, differently-derived opinion (ADR-008 rule 5): the population comes from the type
    // checker, this reads the source. Per DECLARATION — the first version matched the whole containing
    // file, and 28 of 39 files hold more than one primitive, so it certified "something in here
    // returns this kind" and a mislabelled member sailed through.
    //
    // `\b` rather than `<` because `PairCondition`'s type parameters are defaulted, so its
    // declarations read `): PairCondition {`.
    const uncorroborated = primitives.filter(
      (p) => !new RegExp(`\\):\\s*${p.kind}\\b`).test(p.signature),
    )
    expect(
      uncorroborated.map((p) => `${p.name} (${p.kind}) at ${p.file}:${String(p.line)}`),
      'the checker resolved a return kind the declaration does not spell',
    ).toEqual([])
  })

  it('every primitive is really callable at runtime, through the entry point that publishes it', async () => {
    // The third derivation, and the one that owes nothing to ts-morph: the MODULE SYSTEM. If the
    // checker and the source text agreed on a name that no longer loads — a botched re-export, a
    // renamed file — both would still pass. `tests/docs/deprecated-symbols.test.ts` uses the same
    // channel for the same reason.
    const callable = new Set<string>()
    for (const entry of entryPoints) {
      const loaded: unknown = await import(path.join(REPO, entry.file))
      if (!isRecord(loaded)) continue
      for (const key of Object.keys(loaded)) {
        if (typeof loaded[key] === 'function') callable.add(key)
      }
    }
    expect(callable.size, 'nothing loaded — every row below would be vacuous').toBeGreaterThan(200)
    expect(
      names.filter((n) => !callable.has(n)),
      'the checker sees these but the module system does not export them as functions',
    ).toEqual([])
  })

  it('NO coverage ratio is derivable from name matching — the counter-example, documented', () => {
    // The 13.0% divided "primitives whose name appears in tests/archunit/" by this population, and the
    // numerator is wrong in BOTH directions:
    //
    //   undercounts — a primitive is applied without its name appearing. `.resideInFolder(...)` in the
    //     should-phase calls `conditionResideInFolder` (src/builders/class-rule-builder.ts:131).
    //   overcounts  — a name appears without being applied: an import list, a comment, a string.
    //
    // What this row does is DOCUMENT that, executably. It cannot stop anyone quoting a ratio in a
    // markdown file, and the first version of this file claimed it could.
    const archRules = fs.readFileSync(
      path.join(REPO, 'tests', 'archunit', 'arch-rules.test.ts'),
      'utf-8',
    )
    expect(names).toContain('conditionResideInFolder')
    // Applied through the builder method — 18 times as measured on 2026-08-04. The claim was "twenty"
    // in three files, hand-typed, inside the change whose whole subject is hand-typed counts.
    expect(archRules.split('.resideInFolder(').length - 1).toBeGreaterThan(5)
    expect(
      archRules,
      'If arch-rules.test.ts now imports `conditionResideInFolder` by name, that is a legitimate\n' +
        'refactor and NOT a defect — the mechanism assertions below are the load-bearing part.',
    ).not.toContain('conditionResideInFolder')

    // The mechanism itself, so the reasoning cannot rot into a stale comment. The load-bearing line is
    // the PUBLIC alias in the barrel; the builder's local alias merely happens to spell it the same,
    // and asserting that instead reds on a rename that changes nothing.
    expect(fs.readFileSync(path.join(REPO, 'src', 'index.ts'), 'utf-8')).toContain(
      'resideInFolder as conditionResideInFolder',
    )
    expect(
      fs.readFileSync(path.join(REPO, 'src', 'builders', 'class-rule-builder.ts'), 'utf-8'),
    ).toContain('this.addCondition(conditionResideInFolder(glob))')
  })
})
