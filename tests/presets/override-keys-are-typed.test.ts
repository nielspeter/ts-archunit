/**
 * A misspelled override key does not compile —
 * [bug 0038](../../bugs/fixed/0038-a-typo-in-a-preset-override-key-is-a-silent-false-green.md).
 *
 * The runtime finding is guarded in `recommended.test.ts`. This guards the other
 * half, and it needs a different instrument: a type cannot be asserted at run
 * time, so the **compiler** is the oracle.
 *
 * `@ts-expect-error` is exactly right for it, because it fails in the direction
 * that matters. If the union stops rejecting a bad key — someone widens
 * `PresetBaseOptions` back to `Record<string, …>`, or a preset drops its type
 * argument — the directive becomes unused and `tsc` errors on *that*. The guard
 * cannot silently stop guarding.
 *
 * This is genuine independence in ADR-008 rule 5's sense: the runtime test and
 * this one cannot fail the same way, because one is a value comparison and the
 * other is the type checker.
 */
import { describe, expect, it } from 'vitest'
import { Project } from 'ts-morph'
import type { ArchProject } from '../../src/core/project.js'
import { recommended } from '../../src/presets/recommended.js'
import { strictBoundaries } from '../../src/presets/boundaries.js'
import { layeredArchitecture } from '../../src/presets/layered.js'
import { dataLayerIsolation } from '../../src/presets/data-layer.js'
import type { RecommendedOptions } from '../../src/presets/recommended.js'
import type { StrictBoundariesOptions } from '../../src/presets/boundaries.js'
import type { LayeredArchitectureOptions } from '../../src/presets/layered.js'
import type { DataLayerIsolationOptions } from '../../src/presets/data-layer.js'
import type { AgentGuardrailsOptions } from '../../src/presets/agent-guardrails.js'

describe('preset override keys are typed (bug 0038)', () => {
  it('a correct key compiles — the control', () => {
    // If this stopped compiling the rows below would pass for the wrong reason:
    // a union that rejects EVERYTHING also rejects every typo.
    const ok: RecommendedOptions = {
      overrides: { 'preset/recommended/no-silent-catch': 'off' },
    }
    const boundaries: StrictBoundariesOptions = {
      folders: '**/src/*',
      overrides: { 'preset/boundaries/no-cross-boundary': 'warn' },
    }
    const layered: LayeredArchitectureOptions = {
      layers: { domain: '**/src/domain/**', app: '**/src/app/**' },
      overrides: { 'preset/layered/layer-order': 'off' },
    }
    const data: DataLayerIsolationOptions = {
      repositories: '**/src/repositories/**',
      overrides: { 'preset/data/extend-base': 'off' },
    }
    expect([ok, boundaries, layered, data].every((o) => o.overrides !== undefined)).toBe(true)
  })

  it('a misspelled key does not compile, on every preset with a closed id set', () => {
    const recommendedTypo: RecommendedOptions = {
      // @ts-expect-error — 'no-silent-cach' is the measured typo from bug 0038
      overrides: { 'preset/recommended/no-silent-cach': 'error' },
    }
    const boundariesTypo: StrictBoundariesOptions = {
      folders: '**/src/*',
      // @ts-expect-error — no such rule in this preset
      overrides: { 'preset/boundaries/no-cross-boundry': 'off' },
    }
    const layeredTypo: LayeredArchitectureOptions = {
      layers: { domain: '**/src/domain/**', app: '**/src/app/**' },
      // @ts-expect-error — no such rule in this preset
      overrides: { 'preset/layered/layer-orders': 'off' },
    }
    const dataTypo: DataLayerIsolationOptions = {
      repositories: '**/src/repositories/**',
      // @ts-expect-error — no such rule in this preset
      overrides: { 'preset/data/extends-base': 'off' },
    }
    // A key from ANOTHER preset is the likelier mistake, and also rejected.
    const crossPreset: RecommendedOptions = {
      // @ts-expect-error — that rule belongs to strictBoundaries
      overrides: { 'preset/boundaries/no-cross-boundary': 'off' },
    }
    expect([recommendedTypo, boundariesTypo, layeredTypo, dataTypo, crossPreset].length).toBe(5)
  })

  it('agentGuardrails accepts its open ids, and that limit is deliberate', () => {
    // `no-inline-logic/${api}` is built from the caller's own options, so the set
    // is not closed and a typo in the API segment compiles. Stated here rather
    // than left to be discovered — the runtime finding covers this arm.
    const open: AgentGuardrailsOptions = {
      src: '**/src/**',
      overrides: {
        'preset/agent/no-inline-logic/anything.at.all': 'off',
        'preset/agent/no-stubs': 'warn',
      },
    }
    expect(open.overrides).toBeDefined()

    const closedArmTypo: AgentGuardrailsOptions = {
      src: '**/src/**',
      // @ts-expect-error — the fixed ids are still closed
      overrides: { 'preset/agent/no-stub': 'warn' },
    }
    expect(closedArmTypo.overrides).toBeDefined()
  })

  it('the typed key and the runtime finding agree about what is valid', () => {
    // Both derive from the same `RULE_IDS`, so this is a consistency check rather
    // than an independent one — asserted because they are two exports a future
    // change could move apart.
    const project = new Project({ useInMemoryFileSystem: true })
    project.createSourceFile('src/a.ts', 'export const a = 1\n')
    const p: ArchProject = {
      tsConfigPath: 'in-memory',
      _project: project,
      getSourceFiles: () => project.getSourceFiles(),
    }
    const findings = recommended(p, {
      overrides: { 'preset/recommended/no-silent-catch': 'off' },
    }).flatMap((r) => r.violations())

    // Filtered to OVERRIDE findings specifically. The bare in-memory fixture
    // matches no files, so the preset legitimately reports empty selectors —
    // asserting "no configuration findings at all" would be asserting something
    // this test is not about, and it failed for exactly that reason first.
    expect(findings.filter((v) => v.ruleId?.startsWith('preset/override/'))).toEqual([])
    expect([strictBoundaries, layeredArchitecture, dataLayerIsolation].length).toBe(3)
  })
})
