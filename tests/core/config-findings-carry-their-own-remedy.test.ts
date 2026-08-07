/**
 * A configuration finding carries its own remedy, never the rule author's (bug 0021).
 *
 * A `bypassFilters` finding reports that the rule enforces **nothing**. The author's
 * `suggestion` describes how to fix a real violation of that rule, and the formatter
 * renders `suggestion` under `Fix:` — the field an agent obeys. So inheriting it
 * pairs a configuration message with a remedy that cannot apply: measured before this
 * fix, a finding reading *"resolved no slices"* printed *"Split the cycle by
 * extracting a shared module."* as its `Fix:`.
 *
 * `SliceRuleBuilder.metaViolation` had argued exactly this in a comment and omitted
 * both fields. It was overridden one layer up by `execute-rule.ts`, so the omission
 * had no effect in any shipped version — which is why this test asserts on **three**
 * producers rather than one. A single-producer test would have passed on the builder
 * that already tried, while the layer that defeated it went unguarded.
 *
 * Two directions, because dropping metadata everywhere would satisfy the first
 * alone:
 *   - a config finding carries none of the author's remedy text, and still carries
 *     `ruleId` (which says WHICH rule enforces nothing — needed, and not a claim
 *     about a cause) and `because` (why the rule exists — context, not a remedy);
 *   - a real violation of the same rule carries all four.
 */
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { functions } from '../../src/builders/function-rule-builder.js'
import { slices } from '../../src/builders/slice-rule-builder.js'
import { byName, correspondence } from '../../src/builders/correspondence-builder.js'
import type { ArchProject } from '../../src/core/project.js'
import type { RuleMetadata } from '../../src/core/rule-metadata.js'

const fixtures = (name: string): string =>
  path.resolve(import.meta.dirname, `../fixtures/${name}/tsconfig.json`)

function load(name: string): ArchProject {
  const p = new Project({ tsConfigFilePath: fixtures(name) })
  return {
    tsConfigPath: fixtures(name),
    _project: p,
    getSourceFiles: () => p.getSourceFiles(),
  }
}

/** Deliberately about the rule's subject matter, so it is wrong for a config finding. */
const AUTHOR: RuleMetadata = {
  id: 'arch/example',
  because: 'layering keeps the domain testable',
  suggestion: 'Split the cycle by extracting a shared module.',
  docs: 'https://example.test/authors-page',
}

describe('a config finding carries its own remedy, not the author’s (bug 0021)', () => {
  it('empty selector: own suggestion, no author suggestion or docs', () => {
    const p = load('poc')
    const findings = functions(p)
      .that()
      .haveNameMatching(/^definitelyNotAFunction$/)
      // `.expectNonEmpty()` is redundant since R3b — the empty selection is a
      // finding either way — but kept here so the test still describes the
      // shape a reader will meet in existing rule files.
      .expectNonEmpty()
      .should()
      .beExported()
      .rule(AUTHOR)
      .violations()

    expect(findings).toHaveLength(1)
    const [f] = findings
    expect(f?.bypassFilters).toBe(true)
    expect(f?.suggestion).not.toBe(AUTHOR.suggestion)
    // R3b changed this remedy, and had to: it used to say "drop
    // .expectNonEmpty() if matching nothing is valid here", which stopped being
    // true the moment empty became the default fault. Dropping the opt-in now
    // changes nothing, so an agent following that advice fails and then
    // improvises — ADR-008 rule 2, a remedy impossible on the path that
    // produced it.
    expect(f?.suggestion).toContain('.expectEmpty()')
    expect(f?.suggestion).not.toContain('drop .expectNonEmpty()')
    // Bug 0069: R3b fixed the field above and left the identical defect in the
    // one the reader meets first — the message named `.expectNonEmpty()` twice,
    // on rules that never called it, and told them to remove it. The guard was
    // written for the field being fixed, so it could not see that. Both fields
    // are now one assertion-pair, not two.
    expect(f?.message).not.toContain('.expectNonEmpty()')
    expect(f?.docs).not.toBe(AUTHOR.docs)
    // Kept: neither asserts a remedy for this finding.
    expect(f?.ruleId).toBe('arch/example')
    expect(f?.because).toBe(AUTHOR.because)
  })

  it('empty selector: the message names no API the rule never called (bug 0069)', () => {
    // The sharp case. The test above calls `.expectNonEmpty()`, so a message
    // naming it there is merely useless; here the chain never calls it, and the
    // shipped text said "`.expectNonEmpty()` requires at least one … remove
    // `.expectNonEmpty()`" — a remedy with nothing to remove. ADR-008 rule 2:
    // an impossible fix is worse than none, because the agent tries it, fails,
    // and then improvises.
    const p = load('poc')
    const findings = functions(p)
      .that()
      .haveNameMatching(/^definitelyNotAFunction$/)
      .should()
      .beExported()
      .violations()

    expect(findings).toHaveLength(1)
    const [f] = findings
    expect(f?.bypassFilters).toBe(true)
    expect(f?.message).not.toContain('.expectNonEmpty()')
    // Not vacuous by silence: the finding still states the fault and still
    // carries a remedy that IS reachable from this chain.
    expect(f?.message).toContain('0 subjects')
    expect(f?.suggestion).toContain('.expectEmpty()')
  })

  it('empty slice discovery: own suggestion, own docs, never the author’s', () => {
    const p = load('slices')
    const findings = slices(p)
      .matching('src/nowhere/')
      .should()
      .beFreeOfCycles()
      .rule(AUTHOR)
      .violations()

    expect(findings).toHaveLength(1)
    const [f] = findings
    expect(f?.bypassFilters).toBe(true)
    // This is the producer whose comment asked for the omission and was overridden.
    expect(f?.suggestion).not.toBe(AUTHOR.suggestion)
    expect(f?.suggestion).toContain('discovers nothing')
    expect(f?.docs).not.toBe(AUTHOR.docs)
    expect(f?.ruleId).toBe('arch/example')
  })

  it('empty correspondence side: own suggestion, no author docs', () => {
    const p = load('poc')
    const empty = functions(p)
      .that()
      .haveNameMatching(/^definitelyNotAFunction$/)
    const findings = correspondence(p)
      .side('a', empty, byName())
      .side('b', ['k'])
      .beComplete()
      .rule(AUTHOR)
      .violations()

    const config = findings.filter((v) => v.bypassFilters)
    expect(config.length).toBeGreaterThan(0)
    for (const f of config) {
      // `baseViolation` is shared with real violations, so this one is fixed by an
      // override at the producer — the execute-rule guard cannot reach it.
      expect(f.suggestion).not.toBe(AUTHOR.suggestion)
      expect(f.suggestion).toContain('.expectEmpty(')
      // The MESSAGE carries its own remedy sentence too, and nothing pinned it:
      // reverting it to `.allowEmpty(` left the whole suite green while the text
      // told an agent to call a method this release deletes. The RuleBuilder half
      // of this file already guards its message this way (`:110`); the
      // correspondence half never got the mirror.
      expect(f.message).not.toContain('.allowEmpty(')
      expect(f.docs).not.toBe(AUTHOR.docs)
      expect(f.ruleId).toBe('arch/example')
    }
  })

  it('a REAL violation of the same rule still inherits all four', () => {
    // The other direction. Without this, "drop the author's metadata everywhere"
    // satisfies every assertion above, and that is a different, worse bug.
    const p = load('poc')
    const findings = functions(p)
      .that()
      .haveNameMatching(/^parse/)
      .should()
      .notExist()
      .rule(AUTHOR)
      .violations()

    expect(findings.length).toBeGreaterThan(0)
    for (const f of findings) {
      expect(f.bypassFilters).toBeFalsy()
      expect(f.suggestion).toBe(AUTHOR.suggestion)
      expect(f.docs).toBe(AUTHOR.docs)
      expect(f.because).toBe(AUTHOR.because)
      expect(f.ruleId).toBe('arch/example')
    }
  })

  it('every config finding carries SOME remedy — no bare Fix: line', () => {
    // ADR-008 rule 2 in the other direction: a finding with no remedy at all is
    // what the fix for this bug would produce if it only removed. This is the
    // invariant `tests/presets/shared.test.ts` asserts for presets, asserted here
    // for the producers a preset never reaches.
    const poc = load('poc')
    const sl = load('slices')
    const all = [
      ...functions(poc)
        .that()
        .haveNameMatching(/^definitelyNotAFunction$/)
        .expectNonEmpty()
        .should()
        .beExported()
        .violations(),
      ...slices(sl).matching('src/nowhere/').should().beFreeOfCycles().violations(),
      ...correspondence(poc)
        .side(
          'a',
          functions(poc)
            .that()
            .haveNameMatching(/^definitelyNotAFunction$/),
          byName(),
        )
        .side('b', ['k'])
        .beComplete()
        .violations(),
    ].filter((v) => v.bypassFilters)

    expect(all.length).toBeGreaterThanOrEqual(3)
    for (const f of all) {
      expect(f.suggestion, `${f.rule} has no remedy`).toBeTruthy()
    }
  })
})
