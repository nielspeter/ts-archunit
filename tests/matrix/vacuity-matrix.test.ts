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
import { loadPublishedExports, SUBPATHS } from './enumerate.js'
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
  // A preset that constructs NOTHING is its own verdict, not a harness error. Measured:
  // `dataLayerIsolation({ repositories })` returns an empty array, so a user who configured it
  // gets zero rules and a green build — vacuity one level up from the one this matrix probes.
  if (built.length === 0) return 'no-checks'
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
const KNOWN_FAIL_OPEN: Readonly<Record<string, Verdict>> = AUDIT_2026_08

/** The release that must have emptied the list; past it, a stalled programme reds the audit. */
const EXPIRES_AT_VERSION = '0.62.0'

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
    const current: string = process.env.npm_package_version ?? '0.0.0'
    const past = (a: string, b: string): boolean =>
      a.split('.').map(Number).join('.') >= b.split('.').map(Number).join('.')
    const open = Object.values(KNOWN_FAIL_OPEN).filter((v) => v === 'fail-open').length
    if (open > 0 && past(current, EXPIRES_AT_VERSION)) {
      throw new Error(
        `${String(open)} cells still fail open at ${current}. Plan 0098 was ` +
          `due by ${EXPIRES_AT_VERSION}; a stalled programme must red the audit rather than live behind it.`,
      )
    }
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
})
