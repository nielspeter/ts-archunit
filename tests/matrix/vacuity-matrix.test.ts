/**
 * The vacuity matrix — plan 0095, and the ADR-008 conformance audit.
 *
 * Runs every published check-constructor over a corpus of ZERO subjects and records what it
 * does. A cell that PASSES there is fail-open: the check reported clean about nothing, and the
 * suite counted it as coverage. That is the sentence ADR-008 opens with.
 *
 * This file **measures**; it does not fix. `KNOWN_FAIL_OPEN` is today's truth, asserted
 * exactly — so a silent regression and a silent fix are equally loud — and plan 0098 empties it.
 *
 * ## Why this exists rather than another per-family guard
 *
 * Four waves of vacuity guards each closed their enumeration and each was followed by a family
 * outside it (ADR-009's Context table). Every one of those enumerations came from the diff or
 * the bug report of the surface where the defect appeared, and the next family is by
 * construction in neither. This enumeration comes from `package.json`'s exports map: the one
 * list a published entry point cannot avoid joining, because joining it is what "published"
 * means.
 *
 * ## Requires a build
 *
 * It imports from `dist` on purpose — the shipped artifact is what adopters run, and the
 * exports map is part of what is under test. `tests/matrix/` is excluded from the default
 * vitest include for that reason; run it with `npm run test:matrix`.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import path from 'node:path'
import { project } from '../../src/core/project.js'
import { loadPublishedExports, readPackageVersion, SUBPATHS } from './enumerate.js'
import {
  CHECKS,
  NOT_CHECKS,
  NO_CORPUS,
  type Ctx,
  type Probeable,
} from './vacuity-classification.js'

const fixtures = path.resolve(import.meta.dirname, 'fixtures')

/** What a probe can conclude about one construction over zero subjects. */
type Verdict = 'fail-open' | 'config-finding' | 'other-throw' | 'no-checks'

function isProbeable(value: unknown): value is Probeable {
  if (typeof value !== 'object' || value === null) return false
  // `Reflect.get`, not a spread: the terminals live on the prototype, and `{ ...builder }`
  // copies own properties only — so the first version of this guard rejected every builder
  // in the matrix and reported "recipe produced nothing probeable" for all twenty cells.
  return (
    typeof Reflect.get(value, 'check') === 'function' &&
    typeof Reflect.get(value, 'warn') === 'function'
  )
}

/** Narrow a recipe's result to the things that can actually be probed. */
function probeables(result: unknown): Probeable[] {
  const list = Array.isArray(result) ? result : [result]
  return list.filter(isProbeable)
}

/**
 * The minimal shape a manufactured config-finding carries — `.violations()`
 * only, same interface `RuleBuilderLike` requires. Narrower than `Probeable`:
 * `assertDiscovered()` / `overrideFindings()` / plan 0100's `assertEnabled()`
 * all return exactly this, and none of the three implement `.check()`/`.warn()`
 * — both real consumers of a preset's array (`checkAll()`,
 * `src/cli/load-rules.ts`) call only `.violations()` on each element, so
 * neither method is needed for this shape to be a real, working finding.
 */
function isRuleBuilderLike(
  value: unknown,
): value is { violations: () => { bypassFilters?: boolean }[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'violations') === 'function'
  )
}

/**
 * True when a recipe's result already carries a manufactured finding that the
 * `.check()`/`.warn()` probe below cannot see — plan 0100. Checks
 * `bypassFilters === true`, the same structural marker `probe()` above reads
 * off a THROWN error's message (`'cannot be suppressed'`) — not merely
 * non-empty `.violations()`. Review found the looser form was safe only
 * inductively (every current bare-`{ violations }` producer in this codebase
 * happens to carry only manufactured, unsuppressable findings), not
 * structurally — a future bare-object producer returning real, non-manufactured
 * violations would have been silently misclassified as `'config-finding'`.
 */
function hasManufacturedFinding(result: unknown): boolean {
  const list = Array.isArray(result) ? result : [result]
  return list.some(
    (item) => isRuleBuilderLike(item) && item.violations().some((v) => v.bypassFilters === true),
  )
}

/**
 * Run one construction and classify what came back.
 *
 * Three verdicts, not two. A probe that lumped every throw together would report a
 * configuration finding and an unrelated crash as the same thing — and the end state plan 0098
 * asserts is "config-finding everywhere except the families whose instrument fails closed", so
 * the distinction is the measurement, not a nicety.
 */
function probe(run: () => void): Verdict {
  try {
    run()
    return 'fail-open'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // A configuration finding is unsuppressable by construction, and says so in its own text.
    return /cannot be suppressed|Architecture violation/i.test(message)
      ? 'config-finding'
      : 'other-throw'
  }
}

function verdictOf(entryKey: string, ctx: Ctx, terminal: 'check' | 'warn'): Verdict {
  const entry = CHECKS[entryKey]
  if (entry === undefined) throw new Error(`no recipe for ${entryKey}`)
  // Construction is part of the probe. A family whose INSTRUMENT fails closed refuses to build
  // at all — `schema()` throws "No .graphql files found" before any terminal runs — and that is
  // a real verdict about the zero-subject cell, not an error in the harness.
  let result: unknown
  try {
    result = entry.recipe(ctx)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return /cannot be suppressed|Architecture violation/i.test(message)
      ? 'config-finding'
      : 'other-throw'
  }
  const built = probeables(result)
  // A preset that constructs NOTHING is its own verdict, not a harness error. Measured, before
  // plan 0100: `dataLayerIsolation({ repositories })` returned an empty array, so a user who
  // configured it got zero rules and a green build — vacuity one level up from the one this
  // matrix probes via `.check()`/`.warn()`.
  //
  // Plan 0100 closed that for `dataLayerIsolation` (and `agentGuardrails`) by manufacturing a
  // finding when nothing else explains the emptiness — but that finding is `{ violations }`-only,
  // same shape `assertDiscovered()`/`overrideFindings()` already use, so `probeables()` above
  // still filters it out (it has no `.check()`/`.warn()`). `built.length === 0` alone can no
  // longer mean "nothing to report" — it can mean "something to report, just not Probeable".
  if (built.length === 0) return hasManufacturedFinding(result) ? 'config-finding' : 'no-checks'
  // A preset builds many checks; the family fails open only if EVERY one of them does.
  const verdicts = built.map((b) => probe(() => (terminal === 'check' ? b.check() : b.warn())))
  return verdicts.every((v) => v === 'fail-open')
    ? 'fail-open'
    : (verdicts.find((v) => v !== 'fail-open') ?? 'fail-open')
}

/**
 * Measured on the 0.58.0 surface. Every cell here is a check that reports clean over a project
 * which loaded nothing — the population plan 0098 exists to empty.
 *
 * The list may only SHRINK: `AUDIT_2026_08` is the dated measurement it is bounded by, so a new
 * fail-open cannot be admitted by editing one line. ADR-008 rule 3's corollary — a marker an
 * agent can stamp to go green is worse than no marker.
 */
const AUDIT_2026_08: Readonly<Record<string, Verdict>> = {
  '.:smells.duplicateBodies': 'fail-open', // bug 0066
  '.:smells.inconsistentSiblings': 'fail-open', // predicted in BUGS.md, measured here first
  './presets:agentGuardrails': 'fail-open', // with noCopyPaste as the only enabled rule
  './presets:strictBoundaries': 'fail-open', // same shape
  './presets:dataLayerIsolation': 'no-checks', // constructs zero rules from a valid option
  './graphql:schema': 'other-throw', // the loader refuses an empty corpus — fails CLOSED
}
/**
 * Today's truth, after plan 0099's floor and plan 0100's construction guard. It
 * may only SHRINK against `AUDIT_2026_08` above, which is the dated
 * measurement it is bounded by.
 *
 * The four `'fail-open'` cells are gone: every one of them now reports a
 * configuration finding at both `check()` and `.warn()`. That is bug 0066 closed,
 * measured by an instrument written before the fix and untouched by it.
 *
 * `dataLayerIsolation` is gone too — [plan 0100](../../plans/completed/0100-a-preset-that-constructs-nothing.md)
 * manufactures a finding at construction time when neither `baseClass` nor
 * `requireTypedErrors` was ever set, so `dataLayerIsolation({ repositories })`
 * now reports `'config-finding'` here instead of `'no-checks'`. The vacuity
 * list is EMPTY: what remains is `graphql:schema`, a different verdict that was
 * never vacuity debt — it fails CLOSED by refusing to build over an empty
 * corpus, which is the wanted behaviour.
 */
const KNOWN_FAIL_OPEN: Readonly<Record<string, Verdict>> = {
  './graphql:schema': 'other-throw', // fails CLOSED by refusing an empty corpus — not vacuity debt
}

/** The release that must have emptied the list; past it, a stalled programme reds the audit. */
const EXPIRES_AT_VERSION = '0.62.0'

/**
 * Numeric, component-wise version compare — module scope so the gate and its
 * CONTROL call the SAME function.
 *
 * They did not: each declared its own copy with the same body, so reverting the
 * gate to the lexicographic form left the control passing. ADR-008 rule 5's
 * question answered "pass", in the file whose purpose is finding checks that
 * cannot fail, in the commit repairing that file's expiry gate — the same shape
 * fixed one level up (counting only `'fail-open'`) and reintroduced one down.
 *
 * The bug it exists against: the original re-joined to a STRING after
 * `map(Number)`, so `past('0.100.0', '0.62.0')` was false.
 */
/**
 * The whole expiry verdict, as ONE function — returns the failure message or
 * `undefined`.
 *
 * The gate and its CONTROL must drive the SAME code. They did not: each held its
 * own copy of the comparison, so reverting the gate left the control passing.
 * Measured across all three repairs this file made — the numeric compare, the
 * vacuity predicate, and the version source — each reverted GREEN. ADR-008 rule
 * 5 answered "pass" three times, in the file whose subject is checks that cannot
 * fail.
 *
 * Taking `version` and `list` as arguments is what makes it drivable: the control
 * can ask for a verdict at 0.100.0, or over a synthetic list, without waiting for
 * a release.
 */
export function expiryFailure(
  list: Readonly<Record<string, Verdict>>,
  // DEFAULTED, so the gate has no version expression to revert. The control
  // asserted `readPackageVersion()` directly, which proved the function but never
  // the gate's choice to call it: reverting only the call site to
  // `process.env.npm_package_version ?? '0.0.0'` left the matrix 43/43 green.
  // A defaulted parameter removes the seam instead of adding a row to watch it.
  version: string = readPackageVersion(),
  // The deadline is injectable for one reason: without it the default `version`
  // is unfalsifiable. Both the real version (0.58.0) and the broken '0.0.0'
  // fallback sit BEFORE 0.62.0, so every assertion returns undefined either way —
  // measured, reverting the default to `process.env.npm_package_version ?? '0.0.0'`
  // left the matrix 43/43 green. Driving a deadline below the real version is what
  // separates them.
  deadline: string = EXPIRES_AT_VERSION,
): string | undefined {
  // Everything still VACUOUS, not only `'fail-open'`. Plan 0099 converts all four
  // `'fail-open'` cells, so a gate counting only those reaches zero and can never
  // fire again at any version. `'other-throw'` is excluded because it fails
  // CLOSED — `./graphql:schema` refuses an empty corpus, which is the wanted
  // behaviour, not a debt.
  const vacuous = Object.values(list).filter((v) => v === 'fail-open' || v === 'no-checks').length
  if (vacuous === 0 || !past(version, deadline)) return undefined
  return (
    `${String(vacuous)} cells are still vacuous at ${version}. Plan 0100 was ` +
    `due by ${deadline}; a stalled programme must red the audit rather than live behind it.`
  )
}

function past(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x > y
  }
  return true
}

describe('the vacuity matrix (plan 0095)', () => {
  let published: Awaited<ReturnType<typeof loadPublishedExports>>
  let ctx: Ctx

  beforeAll(async () => {
    published = await loadPublishedExports()
    ctx = {
      project: project(path.join(fixtures, 'empty/tsconfig.json')),
      emptyDir: path.join(fixtures, 'empty-schema'),
    }
  })

  it('CONTROL: the fixture project really did load zero source files', () => {
    // Every verdict below is meaningless if the corpus is not empty. `0 === 0` is green.
    expect(ctx.project.getSourceFiles()).toHaveLength(0)
  })

  it('every published export is classified, and every classified name is published', () => {
    const publishedKeys = new Set(published.map((e) => e.key))
    const classified = new Set([...Object.keys(CHECKS), ...NO_CORPUS, ...NOT_CHECKS])

    // Forward: a new family joins the audit by being written down, or it fails here.
    expect([...publishedKeys].filter((k) => !classified.has(k)).sort()).toEqual([])
    // Reverse: a removed export cannot linger as a stale row nobody re-reads.
    expect([...classified].filter((k) => !publishedKeys.has(k)).sort()).toEqual([])

    // The population, asserted before anything is concluded about it.
    expect(SUBPATHS.length).toBeGreaterThanOrEqual(12)
    expect(publishedKeys.size).toBeGreaterThanOrEqual(300)
  })

  it('the known-fail-open list may only shrink, and expires', () => {
    expect(Object.keys(KNOWN_FAIL_OPEN).filter((k) => !(k in AUDIT_2026_08))).toEqual([])
    const failure = expiryFailure(KNOWN_FAIL_OPEN)
    if (failure !== undefined) throw new Error(failure)
  })

  it('CONTROL: each of the three repairs is falsifiable through the gate itself', () => {
    // Drives `expiryFailure`, not a copy of it. Each row below kills exactly one
    // revert; measured before this, all three reverted GREEN.

    // 1. The numeric compare. Lexicographically '0.100.0' < '0.62.0', so the old
    //    form returned undefined here and the deadline quietly stopped existing.
    //    Driven by a synthetic vacuous list, not `KNOWN_FAIL_OPEN` — plan 0100
    //    emptied its vacuity debt (only `'other-throw'` remains, which is not
    //    debt), so `KNOWN_FAIL_OPEN` itself can no longer drive this repair.
    expect(expiryFailure({ x: 'fail-open' }, '0.100.0')).toBeDefined()
    expect(expiryFailure({ x: 'fail-open' }, '0.61.9')).toBeUndefined()

    // 2. The vacuity predicate. A list whose only debt is 'no-checks' must still
    //    expire — counting 'fail-open' alone made the gate unreachable the moment
    //    this plan converted those four cells.
    expect(expiryFailure({ x: 'no-checks' }, '0.100.0')).toBeDefined()
    // ...and 'other-throw' is not debt: it fails closed.
    expect(expiryFailure({ x: 'other-throw' }, '0.100.0')).toBeUndefined()

    // 3. The version source. `process.env.npm_package_version ?? '0.0.0'` failed
    //    open twice: the fallback is past no deadline, and the variable is unset
    //    whenever vitest is invoked directly — which is how CI runs this file.
    //    `toMatch(/^\d+\.\d+\.\d+/)` passed on '0.0.0', so it rejected nothing.
    //
    //    Asserted by REMOVING the variable rather than by observing it absent:
    //    `npm run test:matrix` sets it, `npx vitest` (which is how CI invokes
    //    this file) does not, so an assertion about the ambient environment would
    //    pass or fail depending on who ran it. With it unset, the old
    //    env-reading implementation returns the '0.0.0' fallback and this fails.
    const saved = process.env.npm_package_version
    delete process.env.npm_package_version
    try {
      expect(readPackageVersion()).not.toBe('0.0.0')
      expect(readPackageVersion()).toMatch(/^\d+\.\d+\.\d+/)
      // The DEFAULT is what the gate uses, so prove it directly: with the env
      // var gone, a '0.0.0' default would never be past any deadline and the
      // call below would return undefined.
      // The DEFAULT version, against a deadline below the real one. With the
      // env var gone, a '0.0.0' fallback is not past 0.1.0 and this returns
      // undefined; the real 0.58.0 is, and it returns a message. That is the
      // assertion that separates the two defaults.
      expect(expiryFailure({ x: 'no-checks' }, undefined, '0.1.0')).toBeDefined()
      expect(expiryFailure({ x: 'no-checks' })).toBeUndefined()
    } finally {
      if (saved !== undefined) process.env.npm_package_version = saved
    }

    // `KNOWN_FAIL_OPEN` itself is not accidentally empty — its one remaining
    // entry is `'other-throw'`, not vacuity debt (see repair 2, above), so
    // this is a sanity check on the constant, not a claim that a deadline
    // still applies to it.
    expect(Object.keys(KNOWN_FAIL_OPEN).length).toBeGreaterThan(0)
  })

  it.each(Object.keys(CHECKS))('%s behaves as recorded at .check()', (key) => {
    const verdict = verdictOf(key, ctx, 'check')
    const expected: Verdict = KNOWN_FAIL_OPEN[key] ?? 'config-finding'
    // Exact, in both directions: a silent fix is as loud as a silent regression.
    expect(`${key} → ${verdict}`).toBe(`${key} → ${expected}`)
  })

  it.each(Object.keys(CHECKS))('%s behaves as recorded at .warn()', (key) => {
    // `.warn()` is the path most likely to have been forgotten — a configuration finding is the
    // one thing warn cannot downgrade, and six producers once resolved to `warn` regardless.
    const verdict = verdictOf(key, ctx, 'warn')
    const expected: Verdict = KNOWN_FAIL_OPEN[key] ?? 'config-finding'
    expect(`${key} → ${verdict}`).toBe(`${key} → ${expected}`)
  })

  /**
   * The matrix's own vacuity guards. Ask ADR-008 rule 5's question of the probe itself: if it
   * classified everything as one verdict, what would fail? Without these, nothing — the cells
   * would agree with whatever the list said. Three, not two: two fakes covering `fail-open` and
   * `other-throw` are both satisfied by a probe that never returns `config-finding`, which is
   * the verdict the whole end state depends on.
   */
  describe('controls — the probe can tell the three verdicts apart', () => {
    it('sees a fail-open', () => {
      expect(probe(() => undefined)).toBe('fail-open')
    })

    it('sees a configuration finding', () => {
      expect(
        probe(() => {
          throw new Error('Architecture violation (1 found) — this finding cannot be suppressed: …')
        }),
      ).toBe('config-finding')
    })

    it('sees an unrelated throw, and does not call it a finding', () => {
      expect(
        probe(() => {
          throw new Error('ENOENT: no such file or directory')
        }),
      ).toBe('other-throw')
    })
  })

  /**
   * Plan 0100's addition: `built.length === 0` used to mean only "nothing to report" (`'no-checks'`).
   * `assertEnabled()` manufactures a `{ violations }`-only finding that `probeables()` still
   * cannot see (no `.check()`/`.warn()`), so the same empty-`built` state now has two real causes —
   * these prove `hasManufacturedFinding` tells them apart, independently of whether the preset fix
   * itself is also reverted at the same time.
   */
  describe('controls — a non-Probeable result is told apart from a truly empty one', () => {
    it('an empty array stays no-checks', () => {
      expect(hasManufacturedFinding([])).toBe(false)
    })

    it('a bare RuleBuilderLike with no violations is not a finding', () => {
      expect(hasManufacturedFinding([{ violations: () => [] }])).toBe(false)
    })

    it('a bare RuleBuilderLike carrying a manufactured (bypassFilters) violation IS a finding', () => {
      expect(
        hasManufacturedFinding([
          { violations: () => [{ message: 'constructed 0 rules', bypassFilters: true }] },
        ]),
      ).toBe(true)
    })

    it('a violation WITHOUT bypassFilters is not read as manufactured', () => {
      // Review found the looser `.length > 0` form was safe only inductively —
      // every current bare-object producer happens to carry only manufactured
      // findings. This proves the guard now reads the STRUCTURAL marker, not
      // merely non-emptiness, so a hypothetical future bare-object producer
      // returning real violations would not be misclassified.
      expect(
        hasManufacturedFinding([{ violations: () => [{ message: 'a real violation' }] }]),
      ).toBe(false)
    })

    it('does not mistake a Probeable, un-probed builder for a finding', () => {
      // A real terminal builder has `.violations()` too — this proves the guard
      // reads the VALUE, not merely the shape, so a real rule that simply
      // has no violations yet does not get misread as a manufactured finding.
      expect(hasManufacturedFinding([{ violations: () => [], check() {}, warn() {} }])).toBe(false)
    })
  })
})
