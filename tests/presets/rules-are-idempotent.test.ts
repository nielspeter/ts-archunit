/**
 * The **same rule objects**, evaluated twice in one process, report identically.
 *
 * Plan 0083 Phase 3's second hard requirement, and the reason it is a requirement rather
 * than a nice-to-have: **bug 0034 was not "presets fan out".** It was a `Set` living in a
 * matcher closure that was never reset, so `evaluate()` returned 2 findings and then 0.
 * Three defects rode along with it while 2767 tests passed, because every test built a
 * fresh matcher and asserted *that* something was found rather than *which*.
 *
 * `tests/helpers/comment-matcher-reports-every-hit.test.ts` guards the re-evaluation half
 * for `comment()` specifically, at condition level. What nothing covered is the **general**
 * form: any shipped preset, any condition inside it, holding state across a second run.
 * That is the class, and this file is the guard for the class.
 *
 * ## Why this shape and not a reference consumer
 *
 * Plan 0083 proposed one project running every preset with a per-rule-id finding map. That
 * is a bigger, churn-prone artifact — the plan itself warns it is "a snapshot in all but
 * name" — and it is *not needed for this requirement*. Idempotence is a property of the
 * rule objects, so the cheapest honest test builds each preset's array **once**, runs it
 * twice, and compares. No snapshot, nothing to hand-edit when detection improves.
 *
 * The comparison is by **identity** — rule id, element, line, message — not by count. A
 * count comparison passes when the second run reports a *different* finding, which is the
 * failure mode a leaked `Set` actually produces.
 */
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import type { ArchProject } from '../../src/core/project.js'
import type { RuleBuilderLike } from '../../src/core/rule-builder-like.js'
import {
  recommended,
  layeredArchitecture,
  strictBoundaries,
  dataLayerIsolation,
  agentGuardrails,
} from '../../src/presets/index.js'

function projectFor(fixture: string): ArchProject {
  const tsconfig = path.resolve(import.meta.dirname, `../fixtures/presets/${fixture}/tsconfig.json`)
  const tsMorph = new Project({ tsConfigFilePath: tsconfig })
  return {
    tsConfigPath: tsconfig,
    _project: tsMorph,
    getSourceFiles: () => tsMorph.getSourceFiles(),
  }
}

/**
 * `ruleId | element | line | message` per finding, **in report order** — an identity, not
 * a total, and deliberately NOT sorted.
 *
 * Sorting was the first version and it is strictly weaker: the claim being tested is that
 * two runs are *identical*, and source order is a stated contract elsewhere in this
 * library, so a leak that reorders findings without changing the set is exactly the kind
 * of thing this file should catch. Sorting hides it and buys nothing — there is no
 * legitimate nondeterminism here to paper over.
 */
function fingerprint(rules: RuleBuilderLike[]): string[] {
  return rules
    .flatMap((r) => ('violations' in r && typeof r.violations === 'function' ? r.violations() : []))
    .filter((v) => v !== undefined)
    .map((v) => `${v.rule}|${v.element}|${v.line}|${v.message}`)
}

/** Every shipped preset, built against the fixture that trips it. */
const PRESETS: Array<[string, () => RuleBuilderLike[]]> = [
  ['recommended', () => recommended(projectFor('recommended'))],
  [
    'layeredArchitecture',
    () =>
      layeredArchitecture(projectFor('layered'), {
        layers: {
          repositories: '**/repositories/**',
          services: '**/services/**',
          routes: '**/routes/**',
        },
      }),
  ],
  [
    'strictBoundaries',
    () => strictBoundaries(projectFor('boundaries'), { folders: '**/src/feature-*' }),
  ],
  [
    'dataLayerIsolation',
    () =>
      dataLayerIsolation(projectFor('data-layer'), {
        repositories: '**/repositories/**',
        baseClass: 'BaseRepository',
      }),
  ],
  [
    'agentGuardrails',
    () =>
      agentGuardrails(projectFor('agent-guardrails'), {
        // EVERY option on, deliberately. With only `noInlineLogic` set, the preset never
        // constructs the stub rule — so `comment()` is never reached and reintroducing
        // bug 0034's exact mechanism (a `Set` in that matcher's closure, never reset) left
        // all six rows passing. A test that cites a bug it cannot see is worse than no
        // test, so the options here are chosen to reach the code the bug lived in.
        src: '**/src/**',
        noInlineLogic: ['parseInt'],
        noStubs: true,
        noEmptyBodies: true,
        noGenericErrors: true,
        noCopyPaste: true,
      }),
  ],
]

describe('a preset built once reports the same findings when run twice (bug 0034)', () => {
  it('a third run still agrees, and so does the union across all presets', () => {
    // Two runs cannot distinguish "stateless" from "state that flips on every other
    // call" — a `Set` that is cleared at the wrong moment alternates. A third run costs
    // nothing and rules that out.
    //
    // The union matters separately: presets share conditions, so state leaking between
    // TWO presets in one process is a shape no single-preset row can see.
    //
    // **Declared FIRST on purpose.** Leaked state is usually module-level, so it survives
    // between `it()` blocks too — with this row last, the rows above had already warmed
    // the leak and its own first run saw the degraded answer, making all three agree.
    // Measured, both orderings: with this row last it stayed green and `agentGuardrails`
    // red; with it first the reverse. **Only the row that runs first sees cold state, so
    // exactly one row can catch a module-level leak** — the suite reds either way, which
    // is what matters, but do not read a single red row as "only one thing is wrong".
    // Test order is part of the derivation when the thing under test is state.
    const all = PRESETS.flatMap(([, build]) => build())
    const runs = [fingerprint(all), fingerprint(all), fingerprint(all)]
    expect(runs[0]!.length).toBeGreaterThan(0)
    expect(runs[1]).toEqual(runs[0])
    expect(runs[2]).toEqual(runs[0])
  })

  it.each(PRESETS)('%s', (_name, build) => {
    // ONE array, evaluated twice. Building it twice is what every other test does, and
    // it is exactly what cannot see this bug.
    const rules = build()

    const first = fingerprint(rules)
    const second = fingerprint(rules)

    // Non-vacuity BEFORE the comparison: two empty lists are trivially equal, and a
    // preset whose globs discover nothing produces no ordinary findings at all. Without
    // this row the whole file passes over five presets that matched no files — which is
    // this library's own subject applied to its own test.
    expect(first.length).toBeGreaterThan(0)

    expect(second).toEqual(first)
  })
})
