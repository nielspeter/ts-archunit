/**
 * Families we ship but never ran on ourselves.
 *
 * `arch-rules.test.ts` applies four of the eighteen checkable surfaces the
 * vacuity matrix enumerates — `classes`, `functions`, `modules`, `slices`.
 * The other fourteen are shipped, documented, and never pointed at this repo.
 * That includes every family plan 0099's floor newly gated: a release whose
 * subject is "a check that examined nothing is a lie" went out with its own
 * detectors unexercised on its own corpus.
 *
 * This file closes the gap for the families that have a real corpus here.
 * Deliberately excluded, with reasons, so "we thought about this" and "we
 * forgot this" do not look the same:
 *
 *  - `jsxElements` — no JSX in `src/`; the only .tsx is a fixture with its own
 *    tsconfig (see the root tsconfig's `exclude`).
 *  - `graphql:schema` / `graphql:resolvers` — no schema and no resolvers here.
 *  - `presets:dataLayerIsolation` — no data layer.
 *
 * Every rule below is asserted to examine a non-zero number of units. Without
 * that, a rule that silently stopped matching would still be counted as
 * coverage — ADR-009's whole subject, and the reason this file exists.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { project, types, calls, smells, tsconfig, correspondence } from '../../src/index.js'

const p = project('tsconfig.json')
const root = path.resolve(import.meta.dirname, '../..')

describe('tsconfig: the toolchain ADR-001 pins', () => {
  it('the compiler options ADR-001 requires are actually set', () => {
    // ADR-001 and the CLAUDE.md "Key Implementation Rules" both state these.
    // Stated in prose in two places and enforced in none, until here.
    tsconfig(p)
      .requires({ strict: true, noUncheckedIndexedAccess: true })
      .because('ADR-001: strict mode with noUncheckedIndexedAccess')
      .check()
  })
})

/**
 * Today's duplicate-body count on `src/`, at the DEFAULT `minLines`.
 *
 * A ceiling that may only go down — not a threshold tuned until the code
 * agrees with it. The first draft of this file moved `minLines` 5 → 12 to get
 * from 484 pairs to 95, which is detector-tuning: the number falls, the
 * duplication does not, and the suite reports green over real rot. That is the
 * exact move ADR-008 exists to forbid, so the knob stays at its default and the
 * debt is stated as a number instead.
 *
 * The bulk is genuine and known:
 *
 *  - `src/conditions/body-analysis.ts`, `body-analysis-function.ts` and
 *    `body-analysis-module.ts` are three near-identical copies of the same
 *    condition logic, one per entry point — `functionNotContain` is **98%**
 *    similar to `classNotContain`, `classContain` **98%** to
 *    `haveCallbackContaining`. This is the copy-pasted-parser rot from the
 *    project's own origin story, in its own source.
 *  - The immutable fluent-builder withers (`const next = this.copy()` …) that
 *    ADR-003 mandates, which are idiom rather than rot.
 *
 * Separating those two and paying down the first is its own piece of work.
 * Until then this number may fall and must never rise.
 */
const DUPLICATE_BODIES_CEILING = 484

describe('smells: the detectors the floor lives by', () => {
  it('duplicate bodies in src do not increase', () => {
    const rule = smells.duplicateBodies(p).inFolder('**/src/**').ignoreTests()
    // `inFolder` matches the WHOLE file path, so `inFolder('src')` matches
    // nothing and this would report a dead glob instead of a smell. Measured,
    // not assumed — that is exactly the mistake this file exists to catch.
    expect(rule.examinedUnits()).toBeGreaterThan(0)
    expect(rule.violations().length).toBeLessThanOrEqual(DUPLICATE_BODIES_CEILING)
  })
})

describe('correspondence: the surfaces that must stay in step', () => {
  it('every builder in src/builders has a test file naming it', () => {
    // Keyed on the base name, NOT on a `-rule-builder` suffix: `correspondence`
    // and `cross-layer` are `*-builder.ts`, so a suffix-keyed side silently
    // dropped them — my first attempt did exactly that and reported five
    // phantom orphans.
    // Strips `.test.ts` BEFORE `.ts`: keying `call-rule-builder.test.ts` with a
    // `/\.test$/` strip leaves `call-rule-builder.test`, which matches no
    // builder, so every builder reads as missing. That was this rule's second
    // false report of its own making — hence the independent check below.
    const base = (f: string): string =>
      f
        .replace(/\.test\.ts$/, '')
        .replace(/\.ts$/, '')
        .replace(/-(rule-)?builder$/, '')
    const builders = fs
      .readdirSync(path.join(root, 'src/builders'))
      .filter((f) => f.endsWith('-builder.ts'))
      .map(base)
    const tests = fs
      .readdirSync(path.join(root, 'tests/builders'))
      .filter((f) => f.endsWith('.test.ts'))
      .map(base)

    expect(builders.length).toBeGreaterThan(0)
    // Independently derived, so a keying bug in the sides above cannot pass as
    // a clean result: set difference computed here, in plain JS, agreeing with
    // `comm -23` over the two directory listings.
    expect(builders.filter((b) => !tests.includes(b))).toEqual([])
    // `beComplete()`, not `haveNoOrphans()`: the invariant is one-directional.
    // Every builder needs a test; extra test files (`within`, the object-literal
    // and identified-by-arg cases) are additional coverage, not orphans.
    correspondence(p)
      .side('builder', builders)
      .side('test', tests)
      .should()
      .beComplete()
      .because('a builder with no test file is a surface nothing exercises')
      .check()
  })
})

describe('the rule-builder grammar we never turned on ourselves', () => {
  it('exported types are named in PascalCase', () => {
    const rule = types(p)
      .that()
      .areExported()
      .should()
      .haveNameMatching(/^[A-Z]/)
      .because('exported type names are public API')
    expect(rule.examinedUnits()).toBeGreaterThan(0)
    rule.check()
  })

  it('calls resolve against a non-empty corpus', () => {
    // `calls()` is exported and has never been pointed at this repo. The
    // assertion is deliberately weak; the point is that the family runs here
    // at all, with a corpus, so a regression in call collection is visible.
    const rule = calls(p)
    expect(rule.examinedUnits()).toBeGreaterThan(0)
  })
})
