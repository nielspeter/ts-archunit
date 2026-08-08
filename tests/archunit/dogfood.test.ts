/**
 * Families we ship but had never run on ourselves.
 *
 * `arch-rules.test.ts` applied four of the eighteen checkable surfaces the
 * vacuity matrix enumerates — `classes`, `functions`, `modules`, `slices`.
 * The other fourteen were shipped, documented, and never pointed at this repo,
 * including every family plan 0099's floor newly gated: a release whose subject
 * is "a check that examined nothing is a lie" went out with its own detectors
 * unexercised on its own corpus. With this file the count is **14 of 18**.
 *
 * The four still uncovered are excluded for a reason, so that "we thought about
 * this" and "we forgot this" do not look the same — and because a rule pointed
 * at a corpus this repo does not have is precisely the vacuous pass 0099 now
 * fails:
 *
 *  - `jsxElements` — no JSX in `src/`; the only .tsx is a fixture with its own
 *    tsconfig (see the root tsconfig's `exclude`).
 *  - `graphql:schema` / `graphql:resolvers` — no schema and no resolvers here.
 *  - `presets:dataLayerIsolation` — no data layer.
 *
 * ## What each rule asserts, and why it is not one thing
 *
 * The rule families assert `examinedUnits() > 0` before their condition:
 * without it, a selector that silently stopped matching still counts as
 * coverage, which is ADR-009's whole subject.
 *
 * The preset rows do NOT, and cannot — a preset returns an array of rules, so
 * there is no single examined count to assert. They assert instead that the
 * array is non-empty and carries no CONFIGURATION finding (the `bypassFilters`
 * class: a rule that enforces nothing). That is the preset-level spelling of
 * the same question.
 *
 * And `examinedUnits() > 0` is necessary but **not sufficient**, which this
 * file learned the hard way — see the `inconsistentSiblings` row, where a rule
 * examined all 11 files in a folder and was still structurally incapable of
 * producing a finding. The question ADR-008 rule 5 actually asks is what the
 * rule would do if the thing it guards were broken, and the only answer that
 * counts is a measured one. Each rule here has been sabotaged and observed to
 * fail; three of them first fired on real defects in their own construction.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  project,
  types,
  calls,
  call,
  smells,
  tsconfig,
  correspondence,
  crossLayer,
  satisfyPairCondition,
  checkAll,
  ArchRuleError,
} from '../../src/index.js'
import type { ArchViolation } from '../../src/index.js'
// Through the `./presets` barrel, not the individual modules: that subpath is
// what the exports map publishes and what an adopter imports, so a preset
// dropped from the barrel breaks this file rather than passing unnoticed.
import {
  recommended,
  agentGuardrails,
  strictBoundaries,
  layeredArchitecture,
} from '../../src/presets/index.js'

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

describe('crossLayer: the family most likely to look healthy while empty', () => {
  it('every builder is paired with the test file that imports it', () => {
    // The failure mode 0099's notes single out: both layers resolve files, zero
    // pairs form, and the rule reads as green. So the pair count is asserted
    // before the condition — a mapping that stopped matching would otherwise
    // leave a rule that examines nothing.
    // `.js` as well as `.ts`: import specifiers are ESM-resolved
    // (`../../src/builders/slice-rule-builder.js`, ADR-004), so a stem that
    // only strips `.ts` leaves `-builder.js` and matches no builder — all 11
    // pairs then read as "does not import its builder". Measured, not assumed.
    const stem = (f: string): string =>
      path
        .basename(f)
        .replace(/\.test\.(ts|js)$/, '')
        .replace(/\.(ts|js)$/, '')
        .replace(/-(rule-)?builder$/, '')

    const rule = crossLayer(p)
      .layer('builder', '**/src/builders/**')
      .layer('test', '**/tests/builders/**')
      .mapping((a, b) => stem(a.getFilePath()) === stem(b.getFilePath()))
      .forEachPair()
      .should(
        satisfyPairCondition(
          'the test file imports the builder it covers',
          (pair): ArchViolation | null => {
            const imports = pair.right
              .getImportDeclarations()
              .map((d) => d.getModuleSpecifierValue())
            const target = stem(pair.left.getFilePath())
            return imports.some((s) => stem(s) === target)
              ? null
              : {
                  rule: 'builder test imports its builder',
                  element: path.basename(pair.right.getFilePath()),
                  file: pair.right.getFilePath(),
                  line: 1,
                  message: `${path.basename(pair.right.getFilePath())} is paired with ${path.basename(pair.left.getFilePath())} but does not import it`,
                }
          },
        ),
      )
      .because('a test file that does not import its builder is covering something else')

    expect(rule.examinedUnits()).toBeGreaterThan(0)
    rule.check()
  })
})

describe('inconsistentSiblings: the second detector the floor gates', () => {
  it('every preset validates its overrides', () => {
    // The detector reports a MINORITY that diverges from its siblings ("5 of 7
    // files … use call to X"), so the pattern has to be one the majority
    // already follows or the rule can examine a full folder and still be
    // incapable of failing. The first draft used `call('copy')` over
    // `src/builders`: 11 files examined, 4 with the pattern, therefore no
    // majority and no possible finding — green, and worth nothing.
    //
    // `validateOverrides` over `src/presets` is the real invariant: every
    // preset must reject an override naming a rule it does not construct, or
    // a typo'd rule id silently does nothing.
    const rule = smells
      .inconsistentSiblings(p)
      .inFolder('**/src/presets/**')
      // `index.ts` is a barrel and `shared.ts` DEFINES the helper; neither is a
      // preset, so neither should call it.
      .ignorePaths('**/src/presets/index.ts', '**/src/presets/shared.ts')
      .forPattern(call('validateOverrides'))
    expect(rule.examinedUnits()).toBeGreaterThan(0)
    expect(rule.violations()).toEqual([])
  })
})

/**
 * The presets, run on ourselves.
 *
 * We ship five and ran none of them here. What is asserted is **no
 * configuration finding** — the `bypassFilters` class, which means a rule
 * enforces nothing: a dead glob, an assertion-free rule, or (since 0.59.0) one
 * that examined zero units. Those are not opinions about our code, they are the
 * preset failing to be a check at all, and they are exactly what `collectRule`'s
 * declared-empty carrier exists to describe.
 *
 * Style violations are deliberately NOT asserted to be zero. These presets are
 * opinionated and this repo did not adopt them; pretending otherwise would mean
 * tuning options until the code agreed, which is the move this file already
 * refused once.
 */
const configFindings = (vs: readonly ArchViolation[]): readonly ArchViolation[] =>
  vs.filter((v) => v.bypassFilters === true)

describe('presets: the surface an adopter actually installs', () => {
  it('recommended constructs rules that all enforce something', () => {
    const rules = recommended(p, { include: '**/src/**' })
    expect(rules.length).toBeGreaterThan(0)
    expect(configFindings(rules.flatMap((r) => r.violations()))).toEqual([])
  })

  it('agentGuardrails constructs rules that all enforce something', () => {
    const rules = agentGuardrails(p, {
      src: '**/src/**',
      noGenericErrors: true,
      noStubs: true,
      noEmptyBodies: true,
      noCopyPaste: true,
    })
    expect(rules.length).toBeGreaterThan(0)
    expect(configFindings(rules.flatMap((r) => r.violations()))).toEqual([])
  })

  it('strictBoundaries constructs rules that all enforce something', () => {
    // `'**/src/*'`, not `'src/*'`: boundary discovery matches ABSOLUTE paths, so
    // the unprefixed form discovers nothing. The preset said so itself, in the
    // finding this assertion now guards against.
    const rules = strictBoundaries(p, { folders: '**/src/*', shared: ['**/src/core/**'] })
    expect(rules.length).toBeGreaterThan(0)
    expect(configFindings(rules.flatMap((r) => r.violations()))).toEqual([])
  })

  it('layeredArchitecture constructs rules that all enforce something', () => {
    const rules = layeredArchitecture(p, {
      layers: { builders: '**/src/builders/**', core: '**/src/core/**' },
    })
    expect(rules.length).toBeGreaterThan(0)
    expect(configFindings(rules.flatMap((r) => r.violations()))).toEqual([])
  })

  it('checkAll is the aggregation path a preset user runs', () => {
    // `checkAll` dedupes config findings across the whole array — a seam the
    // per-rule terminals cannot reach, and the one a preset user actually runs.
    //
    // This asserts that it DOES throw, because today our source does not
    // satisfy `recommended` (7 style findings, none of them configuration —
    // the rule above proves that half). Pinning today's truth in the direction
    // it actually points follows `tests/matrix/`: a silent regression and a
    // silent fix must be equally loud. Clean those 7 up and this row goes red,
    // which is the notification, not a nuisance — flip it to `.not.toThrow()`.
    const rules = recommended(p, { include: '**/src/**' })
    expect(() => checkAll(rules)).toThrow(ArchRuleError)
  })
})
