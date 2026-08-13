/**
 * Families we ship but had never run on ourselves.
 *
 * `arch-rules.test.ts` applied four of the eighteen checkable surfaces the
 * vacuity matrix enumerates — `classes`, `functions`, `modules`, `slices`.
 * The other fourteen were shipped, documented, and never pointed at this repo,
 * including every family plan 0099's floor newly gated: a release whose subject
 * is "a check that examined nothing is a lie" went out with its own detectors
 * unexercised on its own corpus. With this file the count is **13 of 18** —
 * `smells.duplicateBodies` joined the covered side once plan 0103 fixed the
 * detector (bug 0076); it is no longer in the excluded list below.
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
 *  - `calls` — no invariant of this codebase is naturally expressed with it. A
 *    row existed and was deleted: `expect(calls(p).examinedUnits())
 *    .toBeGreaterThan(0)`, which asserts the corpus is non-empty and nothing
 *    about the code, so it passed for every reachable state of this repository.
 *    It raised the coverage number by one while enforcing nothing. The number
 *    has to follow from real invariants, not the other way round.
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
import { Project } from 'ts-morph'
import {
  project,
  types,
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
import type { ArchProject } from '../../src/core/project.js'
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

/**
 * This repository's own `src/`, absolute.
 *
 * NOT `'**\/src/**'`. Preset includes are matched against the ABSOLUTE path, so
 * that glob matches any path containing a `src` segment — and this project's
 * fixtures live at `tests/fixtures/*\/src/**`. Measured: the recommended preset
 * scoped that way reported `eval` and `new Function` in `src/dangerous.ts` and
 * `src/security-class.ts`, which are deliberately-bad FIXTURES, not our code.
 * Every preset row below was grading the wrong corpus. `RecommendedOptions.include`
 * documents this hazard; bug 0075 is the same shape.
 */
const OUR_SRC = root.replaceAll('\\', '/') + '/src/**'

const BUILT: DiagnosableRule[] = []

/**
 * Registers a rule with `BUILT` — plan 0090, Phase 3's scoped proof — instead
 * of the `gate()` this file used to wrap every rule in.
 *
 * `gate()` was a repo-local type trick: it handed back an object exposing only
 * `.check`, so a rule downgraded to `.warn()` failed both `npm run typecheck`
 * and, if that were bypassed, at runtime. That mattered: this file shipped
 * without it once, every rule below was reachable at `.warn()`, and `.warn()`
 * never fails on an ordinary violation — the exact regression plan 0084 exists
 * to prevent (`arch/no-cycles` sat at `.warn()` for months and let a cycle in
 * overnight). It does not generalise to a primitive adopters can use.
 *
 * Plan 0090 ships one that does: `.asSeverity('warn', { accepted })` makes a
 * DEFERRED warning fail on anything not explicitly accepted, and pairing
 * `accepted` with `'error'` is a compile error. None of the five rules below
 * is legitimately warn-severity debt, so none of them calls `.asSeverity()` at
 * all — they stay at the default, which is `'error'`.
 *
 * `gate()`'s actual guarantee was narrower than "severity cannot be
 * downgraded" — `.check()` always hardcoded `'error'` and ignored
 * `.asSeverity()` entirely, gated or not, so a rule quietly gaining
 * `.asSeverity('warn')` was never something `gate()` caught either. What it
 * closed was a CALL-SITE mistake: writing `.warn()` where `.check()` was
 * meant. This file closes the same call-site mistake more simply — there is
 * now only ONE terminal call in the whole file (`checkAll(BUILT)`, at the
 * bottom), so there is only one place left to get it wrong, instead of five.
 * Each rule's own `it()` block keeps a REAL, independent assertion on
 * `.violations()` directly (a plain data list, unaffected by severity either
 * way) so a regression still has a specifically-named failing test, not only
 * the aggregate's.
 *
 * Registering into `BUILT` also puts these rules under the `diagnose()`
 * pre-flight at the bottom of this file, so a dead glob here is caught before
 * `checkAll()` rather than by whichever assertion happens to notice.
 */
function built<T extends DiagnosableRule>(rule: T): T {
  BUILT.push(rule)
  return rule
}

describe('tsconfig: the toolchain ADR-001 pins', () => {
  it('the compiler options ADR-001 requires are actually set', () => {
    // ADR-001 and the CLAUDE.md "Key Implementation Rules" both state these.
    // Stated in prose in two places and enforced in none, until here.
    //
    // Asserted on `.violations()`, not `.check()` — this is a REAL assertion
    // ADR-008 rule 5 demands (sabotage the tsconfig and this must red), not a
    // vacuous `built()`-only call. `.violations()` never depended on severity
    // to begin with, so it is unaffected by whether `checkAll(BUILT)` at the
    // bottom of this file (`built()`'s own doc comment explains it) also
    // catches the same regression — this and that are two independent reasons
    // the same fault fails, which is stronger than `gate()`'s single terminal
    // ever was.
    const rule = tsconfig(p)
      .requires({ strict: true, noUncheckedIndexedAccess: true })
      .because('ADR-001: strict mode with noUncheckedIndexedAccess')
    expect(built(rule).violations()).toEqual([])
  })
})

describe('smells: the detectors the floor lives by', () => {
  /**
   * RE-ENABLED — plan 0103 fixed the detector.
   *
   * See [bug 0076](../../bugs/fixed/0076-duplicate-body-similarity-erases-identifiers-so-every-wither-pairs.md).
   * `Fingerprint.kinds` was a sequence of `SyntaxKind` numbers and
   * `computeSimilarity` LCS over it, so identifiers never reached the
   * comparison — three bodies differing only in one assigned field's name
   * were reported as **100% similar**, and every ADR-003 wither in this
   * codebase paired with every other: 484 findings on `src/`, almost all
   * false. Plan 0103 adds `minDistinctVocabulary()`, a pairwise floor on
   * distinct identifier/literal text, gating the comparison before
   * `computeSimilarity()` is even called.
   *
   * This does NOT assert `.toEqual([])` — Phase 0's own triage measured that
   * a well-chosen floor does not drive false positives to zero (a second,
   * narrower false-positive class survives, filed separately once this
   * shipped), and pinning a count ceiling is exactly ADR-008 rule 5's
   * anti-pattern: a ceiling reads as coverage while a real regression can
   * still hide under it. Named, specific pairs instead — the motivating
   * false positive must be gone, the motivating genuine duplicate must
   * remain — matched on `identity`, which is deterministic and qualified by
   * path (`buildViolations()`'s own doc comment warns against matching the
   * message: the similarity percentage in it drifts as either body edits).
   */
  it('duplicate bodies: the wither triple no longer pairs, and the real duplicate still does', () => {
    const rule = smells.duplicateBodies(p).inFolder('**/src/**').ignoreTests()
    expect(rule.examinedUnits()).toBeGreaterThan(0)

    const identities = rule.violations().map((v) => v.identity ?? '')

    // Positive control, checked FIRST: the three wither methods must still be
    // in the examined corpus at all (via a zero-floor pass), or a rename of any
    // of them would make every negative assertion below vacuously true — found
    // by review: the qualified identity is `#ClassName.methodName`, not
    // `#methodName`, so `#ignoreTests` (bare) never matches anything and the
    // negatives passed for the wrong reason until this was corrected.
    const allIdentities = rule
      .minDistinctVocabulary(0)
      .violations()
      .map((v) => v.identity ?? '')
    const witherNames = [
      '#SmellBuilder.ignoreTests',
      '#SmellBuilder.groupByFolder',
      '#CorrespondenceBuilder.beComplete',
    ]
    for (const name of witherNames) {
      expect(
        allIdentities.some((id) => id.includes(name)),
        `${name} must still exist in the examined corpus (control for the negatives below)`,
      ).toBe(true)
    }

    // The motivating false positive — bug 0076's full three-way tie, not just
    // one edge of it. If the mechanism works it kills all three simultaneously
    // (a per-function property, applied symmetrically), so asserting only one
    // pair would pass even if a second edge of the same triangle regressed.
    const pairs: [string, string][] = [
      ['#SmellBuilder.ignoreTests', '#SmellBuilder.groupByFolder'],
      ['#SmellBuilder.ignoreTests', '#CorrespondenceBuilder.beComplete'],
      ['#SmellBuilder.groupByFolder', '#CorrespondenceBuilder.beComplete'],
    ]
    for (const [a, b] of pairs) {
      const stillPairs = identities.some((id) => id.includes(a) && id.includes(b))
      expect(stillPairs, `${a} / ${b} must no longer pair`).toBe(false)
    }

    // The motivating genuine duplicate — must survive. Both are top-level
    // functions (no owning class), so the qualified identity is the bare name.
    const realDuplicate = identities.some(
      (id) => id.includes('#classContain') && id.includes('#functionContain'),
    )
    expect(realDuplicate).toBe(true)
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
    // NOT an independent derivation, and it was labelled as one. It consumes
    // the same two arrays and the same `base()` keying as the sides below, so a
    // keying bug fails both together — which is exactly what happened twice
    // while writing this. Kept because it fails with a readable diff naming the
    // builder, where `beComplete()` reports ten findings; but it is a second
    // assertion, not a second opinion, and calling it independent was the kind
    // of comment that makes an unguarded thing look guarded.
    expect(builders.filter((b) => !tests.includes(b))).toEqual([])
    // `beComplete()`, not `haveNoOrphans()`: the invariant is one-directional.
    // Every builder needs a test; extra test files (`within`, the object-literal
    // and identified-by-arg cases) are additional coverage, not orphans.
    const rule = correspondence(p)
      .side('builder', builders)
      .side('test', tests)
      .should()
      .beComplete()
      .because('a builder with no test file is a surface nothing exercises')
    expect(built(rule).violations()).toEqual([])
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
    expect(built(rule).violations()).toEqual([])
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
            // RESOLVED module files, not module-specifier basenames. The first
            // version compared `stem(specifier)` to `stem(builderPath)`, which
            // let `../../src/predicates/type.js` satisfy "imports
            // type-rule-builder" — a basename collision. Sabotage proved it:
            // repointing `type-rule-builder.test.ts` at the barrel left the
            // rule green. Every builder with a same-named file elsewhere
            // (`type`, `call`, `class`, `module`, `function`) was unguarded.
            const target = pair.left.getFilePath()
            const resolved = pair.right
              .getImportDeclarations()
              .map((d) => d.getModuleSpecifierSourceFile()?.getFilePath())
            return resolved.includes(target)
              ? null
              : {
                  rule: 'builder test imports its builder',
                  element: path.basename(pair.right.getFilePath()),
                  file: pair.right.getFilePath(),
                  line: 1,
                  message: `${path.basename(pair.right.getFilePath())} is paired with ${path.basename(target)} but does not import it`,
                }
          },
        ),
      )
      .because('a test file that does not import its builder is covering something else')

    expect(rule.examinedUnits()).toBeGreaterThan(0)
    expect(built(rule).violations()).toEqual([])
  })
})

describe('inconsistentSiblings: the second detector the floor gates', () => {
  it('every preset validates its overrides', () => {
    // The detector reports a MINORITY that diverges from its siblings ("5 of 7
    // files … use call to X"), so the pattern has to be one the majority
    // already follows or the rule can examine a full folder and still be
    // incapable of failing. The first draft used `call('copy')` over
    // `src/builders`: 11 files examined, 0 with the pattern (the call sites are
    // `this.copy()` and `call()` matches callee text exactly — see the
    // `forPattern(call('this.copy'))` row below, plan 0102's re-measurement of
    // this exact case), therefore no possible finding — green, and worth
    // nothing.
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
    // Plan 0102's C1 regression + latch-placement test: this rule is
    // ALL-CONFORMING (5 of 5 call validateOverrides, nonMatching === 0) — the
    // shape that must NOT be reported inert regardless, since the latch is
    // computed from editsToMajority alone, before nonMatching === 0 enters.
    expect(rule.inertAdvice()).toBe('')
  })

  it('plan 0102: the poisoned row, re-measured — bug 0077(A) liquidated', () => {
    // Bug 0077(A) and this plan's Problem section both measured this exact
    // rule with a bare `call('copy')`, which never matches `this.copy()` — see
    // the corrected numbers in both documents. `call('this.copy')` is what
    // actually reaches the AST match: 11 files examined, 4 hold the pattern,
    // no folder within one edit of a 60% majority (3 > 1) — genuinely inert,
    // not a dead-pattern false negative.
    const rule = smells
      .inconsistentSiblings(p)
      .inFolder('**/src/builders/**')
      .forPattern(call('this.copy'))
    expect(rule.examinedUnits()).toBe(11)
    expect(rule.violations()).toEqual([])
    built(rule)
    // N-phase: INERT_FINDING_EMIT is false, so check() still passes today —
    // this is what lets N ship without breaking an adopter's green build.
    // `.check()` directly: it was never gate()'s job to guard THIS call
    // (gate()'s risk was `.warn()` at a call site, and `.check()` always
    // hardcoded 'error' regardless of gate() either way).
    expect(() => rule.check()).not.toThrow()
    // The diagnose-first preview carries the real numbers regardless of the
    // gate — this is the liquidation: a showcase rule this repo ships, pinned
    // as inert rather than reported as coverage.
    expect(rule.inertAdvice()).toContain('examined 11 sibling files')
    expect(rule.inertAdvice()).toContain('only 4 of them')
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
    const rules = recommended(p, { include: OUR_SRC })
    expect(rules.length).toBeGreaterThan(0)
    expect(configFindings(rules.flatMap((r) => r.violations()))).toEqual([])
  })

  it('agentGuardrails constructs rules that all enforce something', () => {
    const rules = agentGuardrails(p, {
      src: OUR_SRC,
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
    const rules = strictBoundaries(p, { folders: `${root}/src/*`, shared: [`${root}/src/core/**`] })
    expect(rules.length).toBeGreaterThan(0)
    expect(configFindings(rules.flatMap((r) => r.violations()))).toEqual([])
  })

  it('layeredArchitecture constructs rules that all enforce something', () => {
    const rules = layeredArchitecture(p, {
      layers: { builders: `${root}/src/builders/**`, core: `${root}/src/core/**` },
    })
    expect(rules.length).toBeGreaterThan(0)
    expect(configFindings(rules.flatMap((r) => r.violations()))).toEqual([])
  })

  it('checkAll reports no configuration finding across the whole preset', () => {
    // This row used to assert `expect(() => checkAll(rules)).toThrow(...)` —
    // pinning the fact that our source FAILS the recommended preset. Two things
    // were wrong with that. It was scoped to `'**/src/**'`, so what it actually
    // pinned were `eval` and `new Function` in deliberately-bad test FIXTURES.
    // And it punished improvement: cleaning the findings up would have turned
    // the row red, so the test's incentive pointed away from fixing the code.
    //
    // Correctly scoped, the remaining findings are all `no-silent-catch`, which
    // defaults to `warn` BECAUSE it is a finding a reader must judge (ADR-008
    // rule 1) — most of ours are deliberate probes whose failure is the answer.
    // So the thing worth asserting here is the one class that is never a
    // judgement call: `checkAll` aggregates and dedupes CONFIGURATION findings
    // across the array, a seam no per-rule terminal reaches.
    // Measured: with the corpus corrected this does NOT throw. Our source
    // satisfies `recommended` at error severity, and the 12 findings that
    // remain are all `no-silent-catch` at `warn`. So the row asserts the true
    // thing and stays useful in the improving direction — an `eval` or a `new
    // Function` reaching `src/` turns it red, and cleaning up a warning never
    // does.
    const rules = recommended(p, { include: OUR_SRC })
    expect(rules.length).toBeGreaterThan(0)
    expect(() => {
      checkAll(rules)
    }).not.toThrow()
  })
})

// ─── The pre-flight and the aggregate over this file's own rules ────
//
// Declared LAST on purpose: `BUILT` fills as the `it()` callbacks above run, so
// this must see all of them.
//
// There is deliberately NO cross-check of the `BUILT` population here.
// `arch-rules.test.ts` has one — it scans its own source for `.check()`/
// `.warn()` terminals — and it earns it: 39 rules, one uniform call shape, and
// a real chance of one silently dropping out. Copying it here was a mistake,
// measured before this file had only five rules to gate, let alone the plan
// 0090 migration that removed the one uniform call shape entirely — each rule
// below asserts on `.violations()` in its own way, so a source-text scan
// counting terminals would have nothing uniform left to count. Five rules on
// one screen do not need it.

describe('the rules in this file can all enforce something', () => {
  it('diagnoses every rule, and finds exactly the one poisoned row — plan 0102', () => {
    // Identities, never a count — ADR-008 rule 4. Not `toEqual([])`: this file
    // deliberately gates one rule known to be inert (the `call('this.copy')`
    // row above, bug 0077(A)'s exact case) — a green `diagnose(BUILT)` here
    // would be the vacuous pass this plan exists to remove. `'inert'`, not
    // `'zero-subjects'`: examinedUnits() is 11, not 0.
    const findings = diagnose(BUILT).map(
      (f) =>
        `${f.kind}: ${f.rule}${f.glob === undefined ? '' : ` [${f.position ?? '?'} ${f.glob}]`}`,
    )
    expect(findings).toEqual(["inert: Sibling files should consistently use call to 'this.copy'"])
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

describe('checkAll(BUILT) — the aggregate that replaces gate() (plan 0090, Phase 3)', () => {
  it('enforces every rule above in one call, and does not throw today', () => {
    // Nothing above calls `.check()`/`.warn()` per rule any more — `built()`'s
    // own doc comment explains why. This ONE aggregated call is where severity
    // is read and any violation on any of the five rules above would fail the
    // run. All five are currently clean (including the deliberately-inert
    // sixth-that-isn't — `INERT_FINDING_EMIT` is false, so it reports no
    // violation either), so this does not throw.
    expect(() => checkAll(BUILT)).not.toThrow()
  })

  it('would fail if one of them had a real violation — not vacuously green', () => {
    // ADR-008 rule 5, asked of the aggregate itself: `checkAll(BUILT)` passing
    // above is meaningful only if a genuine violation on one of these rules
    // would make it fail. A fresh in-memory project with one deliberately
    // lowercase-named exported type reproduces the exact shape the
    // PascalCase rule (`built()`ed above) guards — this is that same rule,
    // pointed at a corpus that violates it, not a synthetic finding invented
    // for this test.
    const badProject = new Project({ useInMemoryFileSystem: true })
    badProject.createSourceFile('/src/bad.ts', 'export type lowercaseType = string')
    const bad: ArchProject = {
      tsConfigPath: '/tsconfig.json',
      _project: badProject,
      getSourceFiles: () => badProject.getSourceFiles(),
    }
    const brokenRule = types(bad)
      .that()
      .areExported()
      .should()
      .haveNameMatching(/^[A-Z]/)
      .because('exported type names are public API')
    expect(brokenRule.violations().length).toBeGreaterThan(0)
    expect(() => checkAll([...BUILT, brokenRule])).toThrow(ArchRuleError)
  })
})
