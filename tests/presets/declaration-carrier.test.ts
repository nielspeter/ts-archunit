/**
 * The declared-empty carrier reaches every construction path — plan 0089.
 *
 * ## Why this file exists separately from the per-preset tests
 *
 * The presets build rules **three different ways**: through the shared
 * `collectRule` (layered, boundaries, data-layer), through a local `push` helper
 * (agent-guardrails), and through an inline loop (recommended). A carrier wired
 * into one of them and asserted through one preset would look complete and cover
 * a third of the surface — which is
 * [ADR-009](../../adr/009-a-pass-is-constructed-from-evidence.md)'s Context
 * table exactly: a mechanism that covers the families someone remembered.
 *
 * So the rows below are organised by **construction path**, not by preset, and
 * each names which path it proves.
 *
 * ## Why the carrier has to exist at all
 *
 * A preset user holds no builder, so `.expectEmpty()` is unreachable to them.
 * Once plan 0099's floor fails a check that examined nothing, their only other
 * remedy is `overrides: { id: 'off' }` — permanent, non-expiring, and it deletes
 * the rule rather than declaring a fact about it. Shipping the floor without a
 * carrier trains every preset user to write the permanent silencer, which is
 * worse than the vacuous pass it replaces because it looks deliberate.
 */
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import type { ArchProject } from '../../src/core/project.js'
import type { ArchViolation } from '../../src/core/violation.js'
import type { RuleBuilderLike } from '../../src/core/rule-builder-like.js'
import { recommended } from '../../src/presets/recommended.js'
import { agentGuardrails } from '../../src/presets/agent-guardrails.js'
import { dataLayerIsolation } from '../../src/presets/data-layer.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/presets/recommended')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

/**
 * A real file the globs MATCH which declares no functions — a live glob with a
 * zero selection. That is the declarable state, and it is deliberately not a
 * dead glob: plan 0074 makes a selector that can never match a config error, and
 * no declaration may hide one. The distinction is asserted below.
 */
const EMPTY = '**/types-only.ts'

const p = loadTestProject()

const configFindings = (rules: RuleBuilderLike[]): ArchViolation[] =>
  rules.flatMap((r) => r.violations()).filter((v) => v.bypassFilters === true)

/**
 * The surviving rule ids, sorted — an identity assertion rather than a count.
 *
 * Counts cannot tell "the carrier reached the RIGHT rule" from "it reached *a*
 * rule". Measured: rotating the carrier's key by one, so declaring `no-eval`
 * declares the next rule instead, preserves every count in this file and passed
 * 871/871. ADR-008 rule 5 — compare identities, not integers.
 */
const ids = (rules: RuleBuilderLike[]): string[] =>
  configFindings(rules)
    .map((v) => v.ruleId ?? '')
    .sort()

describe('the carrier reaches every construction path (plan 0089)', () => {
  it('PATH 1 — the inline loop: recommended', () => {
    const ALL = [
      'preset/recommended/no-eval',
      'preset/recommended/no-function-constructor',
      'preset/recommended/no-silent-catch',
      'preset/recommended/no-empty-bodies',
    ] as const
    expect(ids(recommended(p, { include: EMPTY }))).toEqual([...ALL].sort())
    // One at a time, so "reached every rule" cannot pass as "silenced everything"
    // — and by NAME, so "reached the right rule" cannot pass as "reached a rule".
    expect(ids(recommended(p, { include: EMPTY, expectEmpty: [ALL[0]] }))).toEqual(
      ALL.filter((id) => id !== ALL[0]).sort(),
    )
    expect(ids(recommended(p, { include: EMPTY, expectEmpty: [...ALL] }))).toEqual([])
  })

  it('PATH 2 — the local push helper: agentGuardrails', () => {
    // The path a carrier wired only into `collectRule` would have missed
    // entirely, with every other preset still passing.
    const opts = { src: EMPTY, noEmptyBodies: true, noStubs: true }
    expect(ids(agentGuardrails(p, opts))).toEqual([
      'preset/agent/no-empty-bodies',
      'preset/agent/no-stubs',
    ])
    // By name: the survivor must be the rule NOT declared.
    expect(
      ids(agentGuardrails(p, { ...opts, expectEmpty: ['preset/agent/no-empty-bodies'] })),
    ).toEqual(['preset/agent/no-stubs'])
    expect(
      ids(
        agentGuardrails(p, {
          ...opts,
          expectEmpty: ['preset/agent/no-empty-bodies', 'preset/agent/no-stubs'],
        }),
      ),
    ).toEqual([])
  })

  it('PATH 3 — the shared collectRule: dataLayerIsolation', () => {
    // `requireTypedErrors` is on so this path constructs TWO rules. With one, the
    // one-at-a-time row below collapses into the all-declared row, and a
    // `collectRule` that ignored the id list and declared everything it built
    // passed the whole suite — measured, 3254/3254 green.
    const opts = { repositories: EMPTY, baseClass: 'BaseRepository', requireTypedErrors: true }
    expect(configFindings(dataLayerIsolation(p, opts))).toHaveLength(2)
    // One at a time, so "reached every rule" cannot pass as "silenced everything".
    const one = configFindings(
      dataLayerIsolation(p, { ...opts, expectEmpty: ['preset/data/extend-base'] }),
    )
    expect(one).toHaveLength(1)
    // Named, not just counted: the survivor must be the rule NOT declared.
    expect(one[0]?.ruleId).toContain('preset/data/typed-errors')
    expect(
      configFindings(
        dataLayerIsolation(p, {
          ...opts,
          expectEmpty: ['preset/data/extend-base', 'preset/data/typed-errors'],
        }),
      ),
    ).toEqual([])
  })

  it('a DEAD glob is not declarable, on any path', () => {
    // The distinction that keeps the carrier from being a mute button. An empty
    // selection is a state you may declare; a selector that can never match is a
    // mistake, and plan 0074 says no declaration hides one.
    const dead = recommended(p, {
      include: '**/nowhere-at-all/**',
      expectEmpty: [
        'preset/recommended/no-eval',
        'preset/recommended/no-function-constructor',
        'preset/recommended/no-silent-catch',
        'preset/recommended/no-empty-bodies',
      ],
    })
    expect(configFindings(dead)).toHaveLength(4)
    expect(configFindings(dead)[0]?.message).toContain('can never match')
  })

  it('CONTROL: the fixture really does contain a function-free file', () => {
    // Every row above is meaningless if `types-only.ts` stopped matching or
    // gained a function: the findings would vanish for the wrong reason and the
    // "declared" assertions would pass over an empty set.
    expect(configFindings(recommended(p, { include: EMPTY })).length).toBeGreaterThan(0)
    expect(configFindings(recommended(p))).toEqual([])
  })
})
