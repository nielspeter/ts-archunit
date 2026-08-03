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
 * The remainder are classes **A** and **B**: the count is either the value under
 * test (a 16-char hash, "warns only once", a cache tally) or there is one subject
 * and no second element to confuse it with.
 *
 * **The arithmetic, since three numbers are in play.** Plan 0079 read 143 and
 * converted 47 blocks, leaving 96. Correcting the scan's over-broad
 * element-boolean signal returned 6 blocks it had been wrongly excluding, one of
 * which was a genuine case and was converted: 96 + 6 − 1 = **101**. Review then
 * found five more — two in `widened-module-edges.test.ts` (a **dead selector also
 * yields exactly one violation**, so the count accepted the configuration finding
 * when the fixture went missing), two in `matchers.test.ts`, one in
 * `graphql/schema-rules.test.ts` — plus two neighbours converted for consistency:
 * **98**.
 */
const CEILING = 98

/**
 * A floor beneath the real number, so a broken walk cannot pass.
 *
 * Without it every assertion here is over an empty set: a scan that reads nothing
 * reports an empty population, which reads as a clean repository. ADR-008's own
 * question — what would this test do if the thing it guards were completely
 * broken? — answers "pass" without this line.
 */
/**
 * Every test file that currently holds at least one count-only block.
 *
 * The guard is over this SET, not over the total — see the test below. A file
 * appearing here for the first time is the event worth catching.
 */
const CONTRIBUTING_FILES: readonly string[] = [
  'tests/builders/function-rule-builder.test.ts',
  'tests/builders/slice-rule-builder.test.ts',
  'tests/cli/baseline-cmd.test.ts',
  'tests/cli/load-rules.test.ts',
  'tests/cli/rule-file-truncation.test.ts',
  'tests/cli/watch.test.ts',
  'tests/conditions/bare-package-imports.test.ts',
  'tests/conditions/call-args.test.ts',
  'tests/conditions/call.test.ts',
  'tests/conditions/dependency.test.ts',
  'tests/conditions/dynamic-imports.test.ts',
  'tests/conditions/jsx.test.ts',
  'tests/conditions/members.test.ts',
  'tests/conditions/reverse-graph-widened.test.ts',
  'tests/conditions/structural.test.ts',
  'tests/conditions/type-level.test.ts',
  'tests/config/tsconfig.test.ts',
  'tests/core/assertion-gate.test.ts',
  'tests/core/code-frame.test.ts',
  'tests/core/comment-suppression-is-disclosed.test.ts',
  'tests/core/descendant-cache.test.ts',
  'tests/core/element-cache.test.ts',
  'tests/core/excluding-matching.test.ts',
  'tests/core/format-json.test.ts',
  'tests/core/glob-declaration.test.ts',
  'tests/core/held-builder-is-immutable.test.ts',
  'tests/core/preset-fanout-is-one-finding.test.ts',
  'tests/core/rule-builder.test.ts',
  'tests/core/workspace-has-no-single-root.test.ts',
  'tests/docs/doc-globs-are-anchored.test.ts',
  'tests/graphql/schema-loader.test.ts',
  'tests/helpers/baseline.test.ts',
  'tests/helpers/callback-extractor.test.ts',
  'tests/helpers/diff-aware-extended.test.ts',
  'tests/helpers/diff-aware-function.test.ts',
  'tests/helpers/diff-aware.test.ts',
  'tests/helpers/matchers-extended.test.ts',
  'tests/helpers/matchers-typescript.test.ts',
  'tests/helpers/matchers.test.ts',
  'tests/helpers/metric-ratchet.test.ts',
  'tests/models/arch-call.test.ts',
  'tests/predicates/jsx.test.ts',
  'tests/presets/override-keys-are-typed.test.ts',
  'tests/rules/errors-silent-catch.test.ts',
  'tests/rules/typescript-function-module.test.ts',
  'tests/rules/typescript.test.ts',
]

const BLOCKS_FLOOR = 2500

describe('the cardinality-only population does not grow (plan 0079)', () => {
  const { population, blocksScanned } = scanCardinalityAssertions(REPO)

  it('VACUITY: the scan actually read the suite', () => {
    expect(blocksScanned).toBeGreaterThan(BLOCKS_FLOOR)
    // And it really does find members — a population of zero here would mean the
    // identity signals had grown to swallow everything, not that the suite is
    // perfect. Classes A and B are legitimate and permanent.
    //
    // The total is a BAND, not the guard: the guard is the file set below. A band
    // catches a signal collapsing in either direction (swallowing everything, or
    // matching everything) without pretending a count can tell you which blocks
    // changed — which is the mistake this whole file is about.
    expect(population.length).toBeGreaterThan(20)
    expect(population.length).toBeLessThanOrEqual(CEILING)
  })

  it('no new FILE contributes a count-only block', () => {
    // **The guard against cardinality-only assertions was itself a
    // cardinality-only assertion**, which review pointed out and which is funny
    // exactly once. A bare `population.length <= CEILING` passes when a new class
    // C block is added and an unrelated one is deleted in the same change — the
    // net is zero and nobody is told.
    //
    // So the assertion is now over IDENTITIES (ADR-008 rule 4), at file
    // granularity. Not `file:line`: line numbers shift on every edit above them,
    // which would red this on unrelated changes and teach the next author to
    // update the list without reading it. Paths move far less often, and a *new
    // file* appearing in the population is the event worth catching — it means a
    // test file that had no count-only blocks just grew one.
    //
    // The total is kept below as a vacuity floor, not as the guard.
    const contributing = [...new Set(population.map((b) => b.file))].sort()
    const added = contributing.filter((f) => !CONTRIBUTING_FILES.includes(f))
    const gone = contributing.length < CONTRIBUTING_FILES.length

    expect(
      added,
      `these files newly contain an \`it()\` block that asserts a count and nothing else:\n  ${added.join('\n  ')}\n\n` +
        `Classify it: is the count the VALUE under test (fine), is there one subject and no second\n` +
        `element to confuse it with (fine), or does the count stand in for identity?\n` +
        `Beware the third case's trap — a dead selector also yields exactly ONE violation, so\n` +
        `\`toHaveLength(1)\` accepts the configuration finding when the condition never ran.`,
    ).toEqual([])

    // Shrinking is always allowed and needs no permission — but say so, because a
    // silently shorter list is how the ratchet would rot in the safe direction.
    if (gone) {
      // eslint-disable-next-line no-console -- a passing test with news for the author
      console.info(
        `plan 0079: the count-only population now spans ${String(contributing.length)} files, down from ${String(CONTRIBUTING_FILES.length)}. Trim CONTRIBUTING_FILES.`,
      )
    }
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
    // Remove first, not only in `finally`: a hard kill between the writes and the
    // cleanup leaves a probe file on disk, and the next run counts it — a red
    // ratchet with a work list naming a file that is not part of the suite.
    fs.rmSync(dir, { recursive: true, force: true })
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
