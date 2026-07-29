/**
 * An unmatched baseline entry, diagnosed (bug 0027).
 *
 * A violation's identity includes the rule description, so editing a rule — or
 * accumulating its conditions, which v0.23.0 made happen for a rule derived off a
 * held rule — changes the identity of violations that did not change at all.
 * Those entries stop matching and their accepted violations report as **new**,
 * reading like fresh rot in application code.
 *
 * The hard part is that an entry which stops matching is *normally success*:
 * that is what a ratchet is for. So the first test below is the one that
 * matters — the false red this feature could easily have become — and every
 * other assertion is only worth having because that one holds.
 *
 * Bug 0027's own suggested signal was "an entry whose `rule` string appears
 * under a different hash". It cannot work: the rule string is precisely what
 * changed. Measured before this was built, which is why the mechanism here is a
 * separate `hashSubject` over `element::message` instead.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { generateBaseline, withBaseline } from '../../src/helpers/baseline.js'
import type { ArchViolation } from '../../src/core/violation.js'

const created: string[] = []
afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
  }
})

function scratch(): { root: string; file: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archunit-descchange-'))
  created.push(root)
  fs.writeFileSync(path.join(root, '.git'), 'gitdir: /elsewhere\n')
  return { root, file: path.join(root, 'baseline.json') }
}

/** Two violations of one rule, and one of another, so partial cases are real. */
const v = (rule: string, element: string): ArchViolation => ({
  rule,
  element,
  file: '/anywhere/src/order.ts',
  line: 12,
  message: `${element} contains call to parseInt`,
})

const RULE_BEFORE = 'that extend BaseService should not contain call to parseInt'
const RULE_AFTER = 'that extend BaseService should not contain call to parseInt and be exported'
const OTHER_RULE = 'that reside in src/http should not import from src/domain'

const configFindings = (violations: ArchViolation[]): ArchViolation[] =>
  violations.filter((x) => x.bypassFilters === true)

/**
 * The description-change finding specifically, never "the first configuration
 * finding" — with a single-entry baseline `matched === 0`, so the generic
 * unmatched-baseline finding is also a candidate, and selecting by index picked
 * that one up instead. Three of these tests failed that way first, which is what
 * revealed that the generic finding was blaming a repository-root mismatch that
 * a detected description change disproves.
 */
const descriptionChange = (violations: ArchViolation[]): ArchViolation | undefined =>
  configFindings(violations).find((x) => x.message.includes('description changed'))

describe('a baseline entry that stops matching because the violation was FIXED', () => {
  it('is silent — this is what success looks like', () => {
    // THE false-red case. A ratchet exists so that accepted violations get
    // fixed; an entry with no counterpart in the run is the good outcome, and a
    // finding here would red the most common healthy workflow. Everything else
    // in this file is only safe because this holds.
    const { root, file } = scratch()
    generateBaseline([v(RULE_BEFORE, 'A.total'), v(RULE_BEFORE, 'B.total')], file, { root })

    // Second violation fixed; first still present and unchanged.
    const kept = withBaseline(file, { root }).filterNew([v(RULE_BEFORE, 'A.total')])

    expect(kept).toEqual([])
    expect(configFindings(kept)).toHaveLength(0)
  })

  it('is silent when EVERY violation was fixed', () => {
    const { root, file } = scratch()
    generateBaseline([v(RULE_BEFORE, 'A.total')], file, { root })
    // An empty run is not evidence about the baseline either.
    expect(withBaseline(file, { root }).filterNew([])).toEqual([])
  })
})

describe('a baseline entry that stops matching because the RULE was edited', () => {
  it('says so, names both spellings, and tells the reader to regenerate', () => {
    const { root, file } = scratch()
    generateBaseline([v(RULE_BEFORE, 'A.total')], file, { root })

    // Same code, same finding, new rule description — the accumulate case.
    const kept = withBaseline(file, { root }).filterNew([v(RULE_AFTER, 'A.total')])
    const finding = descriptionChange(kept)

    expect(finding).toBeDefined()
    // It must deny the reading a bare re-report invites.
    expect(finding?.message).toContain('not new rot in your code')
    // Identities, never a total (ADR-008 rule 4): both spellings, so the reader
    // can see WHAT changed rather than being told how many did.
    expect(finding?.message).toContain(RULE_BEFORE)
    expect(finding?.message).toContain(RULE_AFTER)
    expect(finding?.suggestion).toContain('ts-archunit baseline')
    expect(finding?.suggestion).toContain('<your-rule-files>')
    // Unsuppressable, like every configuration finding.
    expect(finding?.bypassFilters).toBe(true)
    // And the violation itself is still reported — the finding explains it, it
    // does not replace it.
    expect(kept.filter((x) => x.bypassFilters !== true)).toHaveLength(1)
  })

  it('names an edited rule once, however many violations it has', () => {
    const { root, file } = scratch()
    generateBaseline([v(RULE_BEFORE, 'A.total'), v(RULE_BEFORE, 'B.total')], file, { root })

    const kept = withBaseline(file, { root }).filterNew([
      v(RULE_AFTER, 'A.total'),
      v(RULE_AFTER, 'B.total'),
    ])
    const finding = descriptionChange(kept)
    expect(finding).toBeDefined()
    expect(finding?.message).toContain('1 rule')
    // Counted on the `was:` marker, not on the description text: RULE_AFTER
    // CONTAINS RULE_BEFORE as a prefix, so the description legitimately appears
    // twice in one was/now pair and counting it measures the overlap rather than
    // the grouping. Two violations of one edited rule must produce one pair.
    expect(finding?.message?.split('was:').length ?? 0).toBe(2)
  })

  it('distinguishes an edited rule from a fixed violation in the same run', () => {
    // The mixed case, which is what a real upgrade looks like: one rule edited,
    // one violation fixed. Only the edit is reported.
    const { root, file } = scratch()
    generateBaseline([v(RULE_BEFORE, 'A.total'), v(OTHER_RULE, 'C.total')], file, { root })

    const kept = withBaseline(file, { root }).filterNew([v(RULE_AFTER, 'A.total')])
    const finding = descriptionChange(kept)
    expect(finding).toBeDefined()
    expect(finding?.message).toContain(RULE_BEFORE)
    // The fixed rule's violation is NOT named as a description change.
    expect(finding?.message).not.toContain(OTHER_RULE)
  })
})

describe('the diagnosis degrades honestly rather than guessing', () => {
  it('is silent for a baseline written before subjects were recorded', () => {
    // A pre-0.24.0 file has no `subject` on its entries, so the question cannot
    // be asked. Saying nothing is right; naming a cause we cannot verify is the
    // ADR-008 rule 2 defect, and it is exactly what the withdrawn HASH_VERSION
    // bump did.
    const { root, file } = scratch()
    fs.writeFileSync(
      file,
      JSON.stringify({
        generatedAt: '2026-07-28T00:00:00.000Z',
        hashVersion: 2,
        count: 1,
        violations: [
          { rule: RULE_BEFORE, file: 'src/order.ts', line: 12, hash: 'deadbeefdeadbeef' },
        ],
      }),
    )
    const kept = withBaseline(file, { root }).filterNew([v(RULE_AFTER, 'A.total')])
    const descriptionFindings = configFindings(kept).filter((x) =>
      x.message.includes('description changed'),
    )
    expect(descriptionFindings).toHaveLength(0)
  })

  it('writes a subject for every entry it records', () => {
    // The producer half. Without this the diagnosis above can never fire, and
    // nothing else in the suite would notice — the tests would all still pass
    // on the "silent" branch.
    const { root, file } = scratch()
    generateBaseline([v(RULE_BEFORE, 'A.total')], file, { root })
    const written: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'))
    const text = JSON.stringify(written)
    expect(text).toContain('"subject"')
    // Distinct from the full hash — otherwise it carries no new information.
    const parsed: unknown = JSON.parse(text)
    const entry =
      parsed !== null && typeof parsed === 'object' && 'violations' in parsed
        ? parsed.violations
        : undefined
    expect(JSON.stringify(entry)).toMatch(/"hash":"[0-9a-f]{16}"/)
    expect(JSON.stringify(entry)).toMatch(/"subject":"[0-9a-f]{16}"/)
    const hashMatch = /"hash":"([0-9a-f]{16})"/.exec(JSON.stringify(entry))
    const subjMatch = /"subject":"([0-9a-f]{16})"/.exec(JSON.stringify(entry))
    expect(hashMatch?.[1]).not.toBe(subjMatch?.[1])
  })

  it('does not fire for a genuinely new violation of an unchanged rule', () => {
    // A new violation has a subject the baseline never recorded, so there is
    // nothing to say about the rule. This is the ordinary red path and it must
    // stay ordinary.
    const { root, file } = scratch()
    generateBaseline([v(RULE_BEFORE, 'A.total')], file, { root })
    const kept = withBaseline(file, { root }).filterNew([
      v(RULE_BEFORE, 'A.total'),
      v(RULE_BEFORE, 'BRAND_NEW.total'),
    ])
    expect(configFindings(kept)).toHaveLength(0)
    expect(kept).toHaveLength(1)
    expect(kept[0]?.element).toBe('BRAND_NEW.total')
  })
})
