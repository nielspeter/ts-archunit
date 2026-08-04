/**
 * The derivation in `scan-enforceable-primitives.ts`, guarded.
 *
 * A committed script is only better than a remembered number if the script is *checked*.
 * Plan 0083 Phase 0's whole complaint is that four readers got four numbers, so the rows below
 * are about the classifier's behaviour — what it lets in, what it keeps out, and whether it read
 * anything at all — not about today's total.
 *
 * ADR-008's question, asked of this file: *what would it do if the derivation were completely
 * broken?* A broken walk returns an empty population, and an empty population satisfies every
 * "no unexpected member" assertion perfectly. So the vacuity row comes first and the
 * discrimination rows name real members in both directions.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { scanEnforceablePrimitives } from './scan-enforceable-primitives.js'

const REPO = path.resolve(import.meta.dirname, '../..')

/**
 * A floor beneath the real population (150 on 2026-08-04), not a pin.
 *
 * Growth is a feature landing, so there is no ceiling. A collapse is the failure worth catching:
 * renaming the `Condition` interface, or `src/index.ts` stopping re-exporting a folder, would
 * take the population to single digits while every other row here still passed.
 */
const POPULATION_FLOOR = 120

/** Likewise for the public surface the population is carved out of (231 on 2026-08-04). */
const PUBLIC_FUNCTIONS_FLOOR = 200

/**
 * Members, by name — a primitive from each of the three kinds and each of the four folders.
 *
 * Named rather than counted, because a count cannot tell you that `src/rules/` fell out.
 */
const MUST_INCLUDE: readonly string[] = [
  'noEval', // src/rules, Condition
  'beExported', // src/conditions, Condition
  'haveNameMatching', // src/predicates, Predicate
  'haveMatchingCounterpart', // src/conditions/cross-layer, PairCondition — the non-generic one
  'conditionResideInFolder', // src/core, and the subject of the no-ratio row below
]

/**
 * Non-members, by name, each standing for one reason the rule excludes things.
 *
 * `buildFingerprint` and `computeSimilarity` are the two that made the plan's first count wrong:
 * public, in `src/smells/`, and internal helpers. If the rule ever readmits them it has gone back
 * to counting folders.
 */
const MUST_EXCLUDE: readonly string[] = [
  'buildFingerprint', // returns Fingerprint — an internal helper
  'computeSimilarity', // returns number — likewise
  'modules', // returns a builder — an entry point, not a primitive
  'call', // returns ExpressionMatcher — an argument to a condition, not a condition
  'formatViolations', // returns string — output, not enforcement
]

describe('the enforceable-primitive population is derived, not remembered (plan 0083 Phase 0)', () => {
  const { primitives, publicFunctions, returnKinds } = scanEnforceablePrimitives(REPO)
  const names = primitives.map((p) => p.name)

  if (process.env.TSA_PRINT_PRIMITIVES === '1') {
    // The stated escape hatch: Phase 2's input is this list, and a list nobody can print is the
    // same failure as a number nobody can reproduce.
    // eslint-disable-next-line no-console -- an explicitly requested report, off by default
    console.info(
      `${String(primitives.length)} enforceable primitives of ${String(publicFunctions)} public functions:\n` +
        primitives.map((p) => `  ${p.kind.padEnd(14)} ${p.name.padEnd(34)} ${p.file}`).join('\n'),
    )
  }

  it('VACUITY: the walk read the public API, and the rule carved something out of it', () => {
    expect(publicFunctions).toBeGreaterThan(PUBLIC_FUNCTIONS_FLOOR)
    expect(primitives.length).toBeGreaterThan(POPULATION_FLOOR)
    // And the rule EXCLUDES something. A classifier that admits everything reproduces the
    // original mistake — 231 was exactly that number — while looking like a healthy population.
    expect(primitives.length).toBeLessThan(publicFunctions)
  })

  it('includes a primitive from each kind and each folder, by name', () => {
    const missing = MUST_INCLUDE.filter((n) => !names.includes(n))
    expect(missing, 'the derivation stopped seeing these public primitives').toEqual([])
    // All four source folders still contribute. A folder dropping out is the collapse the floor
    // above only catches when it is large.
    const folders = [...new Set(primitives.map((p) => p.file.split('/').slice(0, 2).join('/')))]
    expect(folders.sort()).toEqual(['src/conditions', 'src/core', 'src/predicates', 'src/rules'])
  })

  it('excludes the helpers, entry points and matchers — each for a stated reason', () => {
    const admitted = MUST_EXCLUDE.filter((n) => names.includes(n))
    expect(
      admitted,
      'these are public but are not things you point at code; readmitting them is how the ' +
        'population went to 185, 187 and 231',
    ).toEqual([])
  })

  it('the excluded kinds are really present — the exclusion is doing work', () => {
    // Without this, the row above passes because the names vanished from the API entirely rather
    // than because the rule rejected them.
    for (const kind of ['Fingerprint', 'number', 'string', 'ModuleRuleBuilder']) {
      expect(
        returnKinds.get(kind) ?? 0,
        `no public function returns ${kind} any more`,
      ).toBeGreaterThan(0)
    }
  })

  it('the checker’s verdict is corroborated by the declaration text', () => {
    // A second, differently-derived opinion (ADR-008 rule 5). The population comes from the type
    // checker; this reads the source. If a ts-morph upgrade started resolving return types
    // through an alias, or `returnKindOf` fell back to printed text, the two would disagree here
    // rather than silently agreeing on a wrong population.
    //
    // `\b` rather than `<`: `PairCondition` is non-generic, so its declarations read
    // `): PairCondition {`. Requiring the angle bracket dropped all three of them.
    const uncorroborated = primitives.filter((p) => {
      const text = fs.readFileSync(path.join(REPO, p.file), 'utf-8')
      return !new RegExp(`\\):\\s*${p.kind}\\b`).test(text)
    })
    expect(uncorroborated.map((p) => `${p.name} (${p.kind}) in ${p.file}`)).toEqual([])
  })

  it('NO coverage ratio is derivable from name matching — the counter-example, in code', () => {
    // The 13.0% figure divided "primitives whose name appears in tests/archunit/" by this
    // population. The numerator is wrong because a primitive can be applied without its name
    // ever appearing: `.resideInFolder(...)` in the should-phase calls `conditionResideInFolder`
    // (src/builders/class-rule-builder.ts:131).
    //
    // This row exists so that the next attempt to quote a percentage has to argue with a failing
    // assertion. An honest numerator needs call-graph reachability, which is Phase 2's problem.
    const archRules = fs.readFileSync(
      path.join(REPO, 'tests', 'archunit', 'arch-rules.test.ts'),
      'utf-8',
    )
    expect(names).toContain('conditionResideInFolder')
    // Applied through the builder method, twenty times as measured on 2026-08-04...
    expect(archRules.split('.resideInFolder(').length - 1).toBeGreaterThan(5)
    // ...and never once by the name a name-matching scan would look for.
    expect(archRules).not.toContain('conditionResideInFolder')

    // And the mechanism, not just the two counts: the builder really does route the public
    // primitive, so the reasoning above cannot rot into a stale comment.
    const builder = fs.readFileSync(
      path.join(REPO, 'src', 'builders', 'class-rule-builder.ts'),
      'utf-8',
    )
    expect(builder).toContain('resideInFolder as conditionResideInFolder')
    expect(builder).toContain('this.addCondition(conditionResideInFolder(glob))')
  })
})
