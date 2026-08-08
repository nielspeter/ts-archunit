/**
 * Families we ship but had never run on ourselves.
 *
 * `arch-rules.test.ts` applied four of the eighteen checkable surfaces the
 * vacuity matrix enumerates — `classes`, `functions`, `modules`, `slices`.
 * The other fourteen were shipped, documented, and never pointed at this repo,
 * including every family plan 0099's floor newly gated: a release whose subject
 * is "a check that examined nothing is a lie" went out with its own detectors
 * unexercised on its own corpus. With this file the count is **13 of 18**.
 *
 * The five still uncovered are excluded for a reason, so that "we thought about
 * this" and "we forgot this" do not look the same — and because a rule pointed
 * at a corpus this repo does not have is precisely the vacuous pass 0099 now
 * fails:
 *
 *  - `jsxElements` — no JSX in `src/`; the only .tsx is a fixture with its own
 *    tsconfig (see the root tsconfig's `exclude`).
 *  - `graphql:schema` / `graphql:resolvers` — no schema and no resolvers here.
 *  - `presets:dataLayerIsolation` — no data layer.
 *  - `smells.duplicateBodies` — the detector itself is broken (bug 0076); the
 *    row is present and skipped rather than absent, so the gap is visible in
 *    the run. This is the one exclusion that is about our code, not our corpus.
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
import type { DiagnosableRule } from '../../src/core/diagnose.js'
import { diagnose } from '../../src/core/diagnose.js'
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

/** A rule that can be run at error severity. `warn` is deliberately absent. */
interface Checkable {
  check: () => void
}

const BUILT: DiagnosableRule[] = []

/**
 * The same gate `arch-rules.test.ts` uses, and for the same reason.
 *
 * This file shipped without it and was wrong to: every rule below was reachable
 * at `.warn()`, which is the regression plan 0084 exists to prevent —
 * `arch/no-cycles` sat at `.warn()` for months, could not fail, and let a cycle
 * in overnight. Handing back only `.check()` makes the downgrade fail twice, at
 * `npm run typecheck` and at runtime.
 *
 * Registering into `BUILT` also puts these rules under the `diagnose()`
 * pre-flight at the bottom of this file, so a dead glob here is caught before
 * `check()` rather than by whichever assertion happens to notice.
 */
function gate<T extends DiagnosableRule & Checkable>(rule: T): Checkable {
  BUILT.push(rule)
  return {
    check: () => {
      rule.check()
    },
  }
}

describe('tsconfig: the toolchain ADR-001 pins', () => {
  it('the compiler options ADR-001 requires are actually set', () => {
    // ADR-001 and the CLAUDE.md "Key Implementation Rules" both state these.
    // Stated in prose in two places and enforced in none, until here.
    gate(
      tsconfig(p)
        .requires({ strict: true, noUncheckedIndexedAccess: true })
        .because('ADR-001: strict mode with noUncheckedIndexedAccess'),
    ).check()
  })
})

describe('smells: the detectors the floor lives by', () => {
  /**
   * DISABLED — the detector is broken, not this repository.
   *
   * See [bug 0076](../../bugs/0076-duplicate-body-similarity-erases-identifiers-so-every-wither-pairs.md).
   * `Fingerprint.kinds` is a sequence of `SyntaxKind` numbers and
   * `computeSimilarity` is LCS over it, so identifiers never reach the
   * comparison. These three bodies are reported as **100% similar**:
   *
   *     const next = this.copy()      const next = this.copy()      const next = this.copy()
   *     next._ignoreTests = true      next._checkComplete = true    next._groupByFolder = true
   *     return next                   return next                   return next
   *
   * They differ only in the assigned field, which is the whole of what they do.
   * ADR-003 mandates that shape for every wither, so on this codebase the
   * detector pairs each one with every other: 484 findings on `src/`, almost
   * all false.
   *
   * Left as `skip` rather than deleted, and rather than pinned at a ceiling of
   * 484. A ceiling would have read as coverage while reporting green over both
   * the false positives and any real duplication beneath them, and tuning
   * `minLines` to 12 — which was tried, and cuts 484 to 95 — buys the drop by
   * refusing to look at short functions, where copy-paste actually collects.
   * A skip shows up as not-covered in the run, which is the truth.
   *
   * Re-enable with bug 0076. There is genuine duplication here for the fixed
   * detector to find: `src/conditions/body-analysis.ts`, `-function.ts` and
   * `-module.ts` are three copies of one condition family.
   */
  it.skip('duplicate bodies in src do not increase', () => {
    const rule = smells.duplicateBodies(p).inFolder('**/src/**').ignoreTests()
    expect(rule.examinedUnits()).toBeGreaterThan(0)
    expect(rule.violations()).toEqual([])
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
    gate(
      correspondence(p)
        .side('builder', builders)
        .side('test', tests)
        .should()
        .beComplete()
        .because('a builder with no test file is a surface nothing exercises'),
    ).check()
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
    gate(rule).check()
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
    gate(rule).check()
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

// ─── The pre-flight over this file's own gated rules ────────────────
//
// Declared LAST on purpose: `BUILT` fills as the `it()` callbacks above run, so
// this must see all of them.
//
// There is deliberately NO cross-check of the `BUILT` population here.
// `arch-rules.test.ts` has one — it scans its own source for `.check()`
// terminals — and it earns it: 39 rules, one uniform call shape, and a real
// chance of one silently dropping out. Copying it here was a mistake. This file
// mixes `).check()` with single-line `gate(rule).check()`, so the regex had to
// be widened, which pulled in `gate()`'s own forwarding call, which then needed
// a string-equality exclusion; the replacement — a hand-written list of the
// four rule names — would have been transcribed from the failure output. A
// derivation adjusted until it agrees with the thing it checks is the first
// derivation retyped, and labelling it "ADR-008 rule 5" makes it worse, because
// then it looks guarded. Four rules on one screen do not need it.

describe('the gated rules in this file can all enforce something', () => {
  it('diagnoses every gated rule, and finds nothing wrong', () => {
    // Identities, never a count — ADR-008 rule 4.
    const findings = diagnose(BUILT).map(
      (f) =>
        `${f.kind}: ${f.rule}${f.glob === undefined ? '' : ` [${f.position ?? '?'} ${f.glob}]`}`,
    )
    expect(findings).toEqual([])
  })

  it('would report a fault if one were introduced', () => {
    // `toEqual([])` above is exactly what a `diagnose()` that had stopped
    // working would also produce, so without this control that zero is evidence
    // of nothing.
    const deadSelector = types(p)
      .that()
      .resideInFolder('**/no-such-folder-anywhere/**')
      .should()
      .beExported()
    expect(diagnose([deadSelector]).map((f) => f.kind)).toEqual(['dead-glob'])
    // And a healthy rule stays silent, or the control would pass for a
    // `diagnose()` that simply reported everything.
    expect(diagnose([BUILT[0] as DiagnosableRule])).toEqual([])
  })
})
