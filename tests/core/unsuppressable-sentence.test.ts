/**
 * The unsuppressability sentence names every mechanism that refuses the flag,
 * and no mechanism that does not — [ADR-008](../../adr/008-agent-first-failure-surfaces.md)
 * rule 3, guarded by rule 5.
 *
 * The sentence is a **list**, and a list is the shape that goes stale. It was
 * written inline twice and both copies named five suppression surfaces while the
 * code refused six; the omitted one was the inline `// ts-archunit-exclude`
 * comment, which [bug 0041](../../bugs/fixed/0041-an-exclusion-comment-is-a-no-op-for-most-conditions.md)
 * made reachable from every condition family. An agent reading "not by A, B, C,
 * D, or E" infers exhaustiveness and reaches for the sixth.
 *
 * ## The independent derivation
 *
 * A contains-check would be same-derivation: the test and the sentence get
 * written from one understanding and agree even when it is wrong. So each
 * mechanism is probed **behaviourally** — actually try to suppress a
 * `bypassFilters` finding with it — and the resulting set is compared against
 * the names parsed out of the string. Runtime behaviour versus prose.
 *
 * It fails in both directions, which is the point: naming something that does
 * not refuse is bug 0017's shape, and refusing by something unnamed is what
 * actually happened.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyFilters } from '../../src/core/execute-rule.js'
import { severityFor } from '../../src/core/violation.js'
import { DiffFilter } from '../../src/helpers/diff-aware.js'
import { UNSUPPRESSABLE, UNSUPPRESSABLE_MECHANISMS } from '../../src/core/unsuppressable.js'
import { Baseline } from '../../src/helpers/baseline.js'
import type { ArchViolation } from '../../src/core/violation.js'

const CONFIG: ArchViolation = {
  rule: 'r',
  ruleId: 'probe/config',
  element: 'probe/config',
  file: '',
  line: 0,
  message: 'this rule enforces nothing',
  suggestion: 'fix the glob',
  bypassFilters: true,
}

/** Did this mechanism fail to remove the finding? */
const refuses: Record<string, () => boolean> = {
  '.excluding()': () =>
    applyFilters([CONFIG], { metadata: { id: 'probe/config' }, exclusions: ['probe/config'] })
      .length === 1,

  // `.warn()` and `.asSeverity('warn')` both act by grading severity down, and
  // `severityFor` is where that is refused — NOT `applyFilters`, which was this
  // probe's first target. It returned 'error' either way there, so the probe
  // passed while exercising a neighbour of the mechanism. Pointing a behavioural
  // probe at the wrong function is the defect class this whole file guards.
  '.warn()': () => severityFor(CONFIG, 'warn') === 'error',
  ".asSeverity('warn')": () => severityFor({ ...CONFIG, severity: 'warn' }, 'warn') === 'error',

  '// ts-archunit-exclude': () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-archunit-unsupp-'))
    const file = path.join(dir, 'r.ts')
    fs.writeFileSync(file, '// ts-archunit-exclude probe/config: try me\nconst x = 1\n')
    try {
      return (
        applyFilters([{ ...CONFIG, file, line: 2 }], { metadata: { id: 'probe/config' } })
          .length === 1
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  },

  baseline: () => new Baseline(new Set(), process.cwd()).filterNew([CONFIG]).length === 1,

  // A diff filter restricted to a file set that excludes this finding entirely.
  // `filterToChanged` must still let it through, or a `--changed` run on an
  // unrelated file reports a clean build for a rule that enforces nothing.
  'diff-aware': () =>
    new DiffFilter(new Set(['src/somewhere-else.ts']), 'main').filterToChanged([CONFIG]).length ===
    1,
}

describe('the unsuppressability sentence is true and complete', () => {
  it('every mechanism it names really does refuse the finding', () => {
    // Over-claim direction — bug 0017's shape.
    for (const name of UNSUPPRESSABLE_MECHANISMS) {
      const probe = refuses[name]
      expect(probe, `${name} is named but has no behavioural probe`).toBeDefined()
      expect(probe?.(), `the sentence names ${name}, but it did not refuse`).toBe(true)
    }
  })

  it('every mechanism that refuses is named — this is the direction that failed', () => {
    // Under-claim. The inline comment refused and went unnamed for two releases.
    for (const name of Object.keys(refuses)) {
      expect(
        UNSUPPRESSABLE.includes(name),
        `${name} refuses the finding but the sentence does not name it`,
      ).toBe(true)
    }
  })

  it('VACUITY: the probe set is non-empty and the sentence is not', () => {
    expect(Object.keys(refuses).length).toBeGreaterThanOrEqual(6)
    expect(UNSUPPRESSABLE_MECHANISMS.length).toBe(Object.keys(refuses).length)
    expect(UNSUPPRESSABLE.length).toBeGreaterThan(50)
  })
})
