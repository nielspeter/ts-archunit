import { describe, it, expect } from 'vitest'
import { isDescribable } from '../../src/core/rule-description.js'
import { Project } from 'ts-morph'
import path from 'node:path'
import type { ArchProject } from '../../src/core/project.js'
import { agentGuardrails } from '../../src/presets/agent-guardrails.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/presets/agent-guardrails')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

const SRC = '**/mistakes.ts'

/**
 * `RuleBuilderLike` declares only `violations()`, so a preset builder's rule id
 * needs narrowing to read. Same guard as `boundaries-folder-level.test.ts`, and
 * for the same reason: the assertions below are about WHICH rules a preset
 * produced, which is unavailable through the declared interface.
 */

/** The rule ids a preset produced, in order. */
function idsOf(builders: readonly object[]): (string | undefined)[] {
  return builders.map((b) => (isDescribable(b) ? b.describeRule().id : undefined))
}

describe('agentGuardrails preset', () => {
  const p = loadTestProject()

  it('returns one severity-carrying builder per enabled rule', () => {
    const builders = agentGuardrails(p, {
      src: SRC,
      noInlineLogic: ['parseInt'],
      noGenericErrors: true,
      noStubs: true,
      noEmptyBodies: true,
      noCopyPaste: true,
    })
    // One per enabled rule, BY ID — five builders with the same id also had
    // length 5, and "per enabled rule" is a statement about which.
    expect(idsOf(builders)).toEqual([
      'preset/agent/no-inline-logic/parseInt',
      'preset/agent/no-generic-errors',
      'preset/agent/no-stubs',
      'preset/agent/no-empty-bodies',
      'preset/agent/no-copy-paste',
    ])
  })

  it('catches inline parseInt (error severity)', () => {
    const [builder] = agentGuardrails(p, { src: SRC, noInlineLogic: ['parseInt'] })
    const violations = builder!.violations()
    expect(violations.some((v) => v.element.includes('parseCount'))).toBe(true)
    expect(violations.every((v) => v.severity === 'error')).toBe(true)
  })

  it('catches generic Error, stubs, and empty bodies', () => {
    const g = agentGuardrails(p, { src: SRC, noGenericErrors: true })
    expect(g[0]!.violations().some((v) => v.element.includes('boom'))).toBe(true)
    const s = agentGuardrails(p, { src: SRC, noStubs: true })
    expect(s[0]!.violations().some((v) => v.element.includes('todo'))).toBe(true)
    const e = agentGuardrails(p, { src: SRC, noEmptyBodies: true })
    expect(e[0]!.violations().some((v) => v.element.includes('emptyBody'))).toBe(true)
  })

  it('no-copy-paste is a warn-severity builder', () => {
    const builders = agentGuardrails(p, { src: SRC, noCopyPaste: true })
    const violations = builders[0]!.violations()
    expect(violations.length).toBeGreaterThan(0)
    expect(violations.every((v) => v.severity === 'warn')).toBe(true)
  })

  it('override to "off" omits the builder', () => {
    const builders = agentGuardrails(p, {
      src: SRC,
      noGenericErrors: true,
      overrides: { 'preset/agent/no-generic-errors': 'off' },
    })
    expect(builders).toHaveLength(0)
  })

  it('plan 0100: enabling a rule then overriding it off is a declaration, not silence', () => {
    // Distinct from the truly-minimal call below: `noGenericErrors: true` means
    // something WAS attempted, so `overrides: { …: 'off' }` is the reader
    // explicitly declining it — UNSUPPRESSABLE's own text calls this "a
    // permanent decision that never expires", not a suppression. No new
    // finding should appear alongside the omitted builder.
    const builders = agentGuardrails(p, {
      src: SRC,
      noGenericErrors: true,
      overrides: { 'preset/agent/no-generic-errors': 'off' },
    })
    expect(builders).toEqual([])
  })

  it('plan 0100 review: overriding a real-but-not-yet-enabled id off reports constructs-nothing, not "unknown key"', () => {
    // The flag is UNSET this time — the id is real (a compile-time member of
    // AgentGuardrailsRuleId) but nothing attempted it, which is the truly-minimal
    // call's own shape. Reviewer-found bug: `overrideFindings`/`validateOverrides`
    // used to be handed the flag-gated `attempted` list as "known ids", so this
    // correctly-spelled key was misdiagnosed "matches no rule in this preset"
    // with an EMPTY enumeration — and that wrong finding then silently
    // suppressed the correct one via `assertEnabled`'s `otherFindings` guard.
    const builders = agentGuardrails(p, {
      src: SRC,
      overrides: { 'preset/agent/no-generic-errors': 'off' },
    })
    const violations = builders.flatMap((b) => b.violations())
    expect(violations).toHaveLength(1)
    expect(violations[0]?.ruleId).toBe('preset/agent/constructs-nothing')
  })

  it('plan 0100 review: a genuine override typo is still caught, with a non-empty enumeration', () => {
    // The companion case to the one above — proves the fix narrowed the KNOWN
    // set correctly rather than widening it to accept anything. Widened to
    // `Record<string, …>` deliberately (same pattern as recommended.test.ts's
    // 'no-evalz' case) — the typed key union already rejects this at compile
    // time, which is bug 0038's OTHER guarantee; this test is about the
    // runtime path a JS consumer (or a dynamically-built overrides object)
    // still reaches.
    const overrides: Partial<Record<string, 'error' | 'warn' | 'off'>> = {
      'preset/agent/no-generic-errrors': 'off', // typo: errrors
    }
    const builders = agentGuardrails(p, { src: SRC, overrides })
    const violations = builders.flatMap((b) => b.violations())
    expect(violations[0]?.ruleId).toBe('preset/override/preset/agent/no-generic-errrors')
    expect(violations[0]?.suggestion).toContain(
      'preset/agent/no-generic-errors, preset/agent/no-stubs, preset/agent/no-empty-bodies, preset/agent/no-copy-paste',
    )
  })

  it('override to "warn" downgrades the severity', () => {
    const [builder] = agentGuardrails(p, {
      src: SRC,
      noGenericErrors: true,
      overrides: { 'preset/agent/no-generic-errors': 'warn' },
    })
    const violations = builder!.violations()
    expect(violations.length).toBeGreaterThan(0)
    expect(violations.every((v) => v.severity === 'warn')).toBe(true)
  })

  it('rules carry agent-facing metadata (id/suggestion/because) on violations', () => {
    const [builder] = agentGuardrails(p, { src: SRC, noGenericErrors: true })
    const violations = builder!.violations()
    expect(violations[0]?.ruleId).toBe('preset/agent/no-generic-errors')
    expect(violations[0]?.suggestion).toContain('domain-specific')
    expect(violations[0]?.because).toBeTruthy()
  })

  it('produces zero violations on clean code (no false positives)', () => {
    const builders = agentGuardrails(p, {
      src: '**/clean.ts',
      noInlineLogic: ['parseInt', 'eval', 'JSON.parse'],
      noGenericErrors: true,
      noStubs: true,
      noEmptyBodies: true,
    })
    const violations = builders.flatMap((b) => b.violations())
    expect(violations).toHaveLength(0)
  })

  it('empty / omitted noInlineLogic generates no inline-logic rules specifically', () => {
    // A DIFFERENT flag stays on, so this is not the truly-minimal call below —
    // it isolates the claim to `noInlineLogic` alone.
    const builders = agentGuardrails(p, { src: SRC, noInlineLogic: [], noGenericErrors: true })
    expect(idsOf(builders)).toEqual(['preset/agent/no-generic-errors'])
  })

  it('plan 0100: the truly minimal call constructs nothing, and says so', () => {
    // Every rule sits behind an optional flag and none was set here — the
    // exact silence bug 0100 measured: `agentGuardrails({ src })` used to
    // return `[]`, a green build that enforced nothing.
    const builders = agentGuardrails(p, { src: SRC })
    expect(builders).toHaveLength(1)
    const violations = builders[0]!.violations()
    // Identity, not count: the ONE violation must be THIS finding, not some
    // other config-finding that happens to also number one.
    expect(violations).toHaveLength(1)
    expect(violations[0]?.ruleId).toBe('preset/agent/constructs-nothing')
    expect(violations[0]?.message).toContain('constructed 0 rules')
    expect(violations[0]?.bypassFilters).toBe(true)
  })

  it('plan 0100: the remedy is proven — enabling one flag clears the finding', () => {
    const idsOfViolations = (
      builders: readonly { violations: () => { ruleId?: string }[] }[],
    ): string[] => builders.flatMap((b) => b.violations()).map((v) => v.ruleId ?? '')

    expect(idsOfViolations(agentGuardrails(p, { src: SRC }))).toContain(
      'preset/agent/constructs-nothing',
    )
    // Applying exactly the stated remedy — "Set at least one of: noInlineLogic,
    // noGenericErrors, …" — and nothing else about the call changes.
    expect(idsOfViolations(agentGuardrails(p, { src: SRC, noGenericErrors: true }))).not.toContain(
      'preset/agent/constructs-nothing',
    )
  })

  it('plan 0100: a more specific finding on the same unattempted call reports ONCE, not stacked', () => {
    // `expectEmpty` names a rule this call never attempts either — so
    // `declaredEmptyFindings` fires its own "binds to nothing" finding, and
    // `assertEnabled` (attempted.length === 0, same as the test above) must
    // defer to it rather than pile a second, less specific finding on top.
    // Reviewer-found gap: the ONLY existing test of the "otherFindings"
    // guard used an override-key finding, whose knownIds bug this same
    // review also fixed — this one is independent of that fix.
    const builders = agentGuardrails(p, {
      src: SRC,
      expectEmpty: ['preset/agent/no-generic-errors'],
    })
    const ids = builders.flatMap((b) => b.violations()).map((v) => v.ruleId)
    expect(ids).toEqual(['preset/expect-empty/preset/agent/no-generic-errors'])
  })

  it('generates a distinct rule id per noInlineLogic entry', () => {
    const builders = agentGuardrails(p, { src: SRC, noInlineLogic: ['parseInt', 'eval'] })
    // DISTINCT is the claim, and a count of 2 cannot see it: two builders
    // sharing one id — the bug this guards — also had length 2.
    expect(idsOf(builders)).toEqual([
      'preset/agent/no-inline-logic/parseInt',
      'preset/agent/no-inline-logic/eval',
    ])
  })
})

/**
 * Presets must see handler maps (bug 0013).
 *
 * `functions()` keeps object-literal collection opt-in so that widening a
 * selector the USER wrote does not silently change their rule. A preset's
 * subject set is the preset's own, and this one's docstring already promises
 * that "standalone functions, arrow functions, and class methods are all
 * covered" — a handler map is none of the three, so `{ POST: () => {} }`
 * slipped every guardrail in the preset named for the mistakes agents make.
 *
 * Ask ADR-008's question of the tests above: what would they do if no preset
 * rule could see a handler map? They would all pass — every other fixture here
 * declares its functions. That is why this block has its own fixture.
 */
describe('agentGuardrails sees handler maps', () => {
  const handlerMapDir = path.resolve(import.meta.dirname, '../fixtures/presets/handler-map')
  const handlerMapTsconfig = path.join(handlerMapDir, 'tsconfig.json')
  const project = new Project({ tsConfigFilePath: handlerMapTsconfig })
  const hp: ArchProject = {
    tsConfigPath: handlerMapTsconfig,
    _project: project,
    getSourceFiles: () => project.getSourceFiles(),
  }

  const elementsFor = (id: string): string[] =>
    agentGuardrails(hp, {
      src: '**/src/**',
      noGenericErrors: true,
      noStubs: true,
      noEmptyBodies: true,
    })
      .flatMap((r) => r.violations())
      .filter((v) => v.ruleId === id)
      .map((v) => v.element)
      .sort()

  it('flags the same defect in a named function and an object-literal handler', () => {
    // Identical bodies, so anything reported for one must be reported for the
    // other. Asserting the exact pair rather than a count keeps this from
    // passing if the object-literal one were reported twice.
    expect(elementsFor('preset/agent/no-stubs')).toEqual(['namedHandler', 'routes.objectHandler'])
    expect(elementsFor('preset/agent/no-generic-errors')).toEqual([
      'namedHandler',
      'routes.objectHandler',
    ])
  })

  it('flags an empty arrow used as a handler-map value', () => {
    // The canonical agent stub: `{ POST: () => {} }`.
    expect(elementsFor('preset/agent/no-empty-bodies')).toEqual(['routes.emptyHandler'])
  })
})
