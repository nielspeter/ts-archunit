import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { scanCardinalityAssertions } from './scan-cardinality-assertions.js'

const REPO = path.resolve(import.meta.dirname, '../..')

/**
 * The population that survived [plan 0079](../../plans/completed/0079-triage-the-cardinality-only-assertions.md),
 * measured on the branch that closed it.
 *
 * **A ratchet, not a snapshot.** It fails when the number goes UP, which is the
 * direction that matters: a new `it()` block asserting only a count is the defect
 * this plan spent a release removing. Going down needs no permission — lower the
 * number and say why.
 *
 * The remainder are classes **A** and **B**: the count is either the value under test (a
 * 16-char hash, "warns only once", a cache tally) or there is one subject and no
 * second element to confuse it with. Plan 0079 read all 143 and converted the 47
 * blocks where a count stood in for identity.
 */
const CEILING = 101

/**
 * A floor beneath the real number, so a broken walk cannot pass.
 *
 * Without it every assertion here is over an empty set: a scan that reads nothing
 * reports an empty population, which reads as a clean repository. ADR-008's own
 * question — what would this test do if the thing it guards were completely
 * broken? — answers "pass" without this line.
 */
const BLOCKS_FLOOR = 2500

describe('the cardinality-only population does not grow (plan 0079)', () => {
  const { population, blocksScanned } = scanCardinalityAssertions(REPO)

  it('VACUITY: the scan actually read the suite', () => {
    expect(blocksScanned).toBeGreaterThan(BLOCKS_FLOOR)
    // And it really does find members — a population of zero here would mean the
    // identity signals had grown to swallow everything, not that the suite is
    // perfect. Classes A and B are legitimate and permanent.
    expect(population.length).toBeGreaterThan(20)
  })

  it('no new block asserts a count with nothing pinning which elements', () => {
    // Identities, not a total (ADR-008 rule 4): when this fails the message is the
    // work list, so the next author reads which blocks to look at rather than a
    // number to raise.
    const listed = population.map((b) => `${b.file}:${String(b.line)} — ${b.name}`)
    expect(
      population.length,
      `the cardinality-only population is ${String(population.length)}, above the ${String(CEILING)} recorded when plan 0079 closed.\n` +
        `Classify the new one: is the count the VALUE under test (fine), is there one subject and no\n` +
        `second element to confuse it with (fine), or does the count stand in for identity?\n` +
        `If the last, assert which elements — the population now is:\n  ${listed.join('\n  ')}`,
    ).toBeLessThanOrEqual(CEILING)
  })

  it('the two signals that were added after a hand-read sample still fire', () => {
    // Guarding the guard. The scan shipped with an identity list that counted
    // `toBeTruthy`/`toThrow` — neither survives a swap — and missed every
    // element-boolean idiom. Both corrections are load-bearing for the 96 above,
    // and neither is exercised by the count assertions in this file.
    const swapSurvivor = `
      it('a count plus a bare truthiness check is NOT an identity assertion', () => {
        expect(violations).toHaveLength(3)
        expect(violations[0]).toBeTruthy()
      })
    `
    const elementBoolean = `
      it('a boolean about a specific element IS one', () => {
        expect(violations).toHaveLength(2)
        expect(messages.some((m) => m.includes('"offset"'))).toBe(true)
      })
    `
    // Written to a scratch file the scan reads, because the scan's unit is a file
    // on disk. Asserting on the regexes directly would test the regexes rather
    // than the decision they feed.
    const dir = path.join(REPO, 'tests', 'tools', '.scan-probe')
    fs.mkdirSync(dir, { recursive: true })
    try {
      fs.writeFileSync(path.join(dir, 'a.test.ts'), swapSurvivor)
      fs.writeFileSync(path.join(dir, 'b.test.ts'), elementBoolean)
      const probed = scanCardinalityAssertions(REPO).population.map((b) => b.file)
      expect(probed).toContain(path.join('tests', 'tools', '.scan-probe', 'a.test.ts'))
      expect(probed).not.toContain(path.join('tests', 'tools', '.scan-probe', 'b.test.ts'))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
