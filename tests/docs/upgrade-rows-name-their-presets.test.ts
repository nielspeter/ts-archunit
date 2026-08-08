/**
 * An upgrade row that names a condition must name the presets containing it —
 * plan 0089 Phase 2.
 *
 * ## The defect this closes
 *
 * `docs/upgrading.md` scopes its rows by API names: _"Only if you use `slices()`
 * rules"_, _"Only if you baseline `beFreeOfCycles()` findings"_. Someone who
 * calls `layeredArchitecture(p, …)` reads both as "not me" — **and is wrong**,
 * because the preset constructs both. The row is true and unreachable, which is
 * the same class of defect as stale prose: it costs nothing to read and it
 * misroutes exactly the population with the least control over the change.
 *
 * ## Why derived rather than listed
 *
 * The condition→preset map is read out of `src/presets/*.ts` at test time. A
 * hand-written list would be a second derivation of the same fact and would rot
 * the first time a preset gained a condition — and rot silently, because a stale
 * list still passes. This is the durable half of Phase 2: the prose is checked
 * against the code, not against a copy of the code.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../..')
const presetsDir = path.join(root, 'src/presets')

/** Conditions whose behaviour an upgrade row can plausibly change. */
const CONDITIONS = [
  'beFreeOfCycles',
  'respectLayerOrder',
  'notDependOn',
  'onlyDependOn',
  'notImportFrom',
  'onlyImportFrom',
  'dependOn',
] as const

/** Preset entry points, by the file that defines them. */
const PRESET_EXPORTS: Record<string, string[]> = {
  'layered.ts': ['layeredArchitecture'],
  'boundaries.ts': ['strictBoundaries'],
  'data-layer.ts': ['dataLayerIsolation'],
  'agent-guardrails.ts': ['agentGuardrails'],
  'recommended.ts': ['recommended'],
}

/** condition → presets that construct it, read from source. */
function conditionToPresets(): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const [file, exports] of Object.entries(PRESET_EXPORTS)) {
    const src = fs.readFileSync(path.join(presetsDir, file), 'utf8')
    for (const condition of CONDITIONS) {
      if (!new RegExp(`\\.${condition}\\(`).test(src)) continue
      map.set(condition, [...(map.get(condition) ?? []), ...exports])
    }
  }
  return map
}

/** Version rows of the upgrade table — each begins `| **<version>** |`. */
function upgradeRows(): { version: string; text: string }[] {
  const doc = fs.readFileSync(path.join(root, 'docs/upgrading.md'), 'utf8')
  return doc
    .split('\n')
    .filter((line) => /^\|\s*\*\*\d+\.\d+\.\d+\*\*\s*\|/.test(line))
    .map((line) => ({
      version: /\*\*(\d+\.\d+\.\d+)\*\*/.exec(line)?.[1] ?? '?',
      text: line,
    }))
}

describe('upgrade rows name the presets that contain the condition (plan 0089)', () => {
  const map = conditionToPresets()

  it('CONTROL: the map really was derived, and is not empty', () => {
    // Every assertion below is vacuously true over an empty map — which is what
    // a regex that stopped matching would produce.
    expect(map.get('beFreeOfCycles')).toEqual(
      expect.arrayContaining(['layeredArchitecture', 'strictBoundaries']),
    )
    expect(map.get('respectLayerOrder')).toEqual(['layeredArchitecture'])
  })

  it('CONTROL: the upgrade table really was parsed', () => {
    expect(upgradeRows().length).toBeGreaterThan(5)
  })

  it('every row naming a condition also names its presets', () => {
    const gaps: string[] = []
    for (const { version, text } of upgradeRows()) {
      for (const [condition, presets] of map) {
        if (!text.includes(`${condition}(`)) continue
        const missing = [...new Set(presets)].filter((preset) => !text.includes(preset))
        if (missing.length > 0) {
          gaps.push(`${version}: names ${condition}() but not ${missing.join(', ')}`)
        }
      }
    }
    expect(
      gaps,
      'an upgrade row scoped by a name a preset user never types misroutes exactly the ' +
        'population with the least control over the change',
    ).toEqual([])
  })
})
