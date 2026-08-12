/**
 * A held builder is immutable (bug 0016).
 *
 * Every chain method returns a copy. Holding a builder in a variable and
 * deriving two rules from it must give two independent rules — the shape
 * `docs/core-concepts.md`, `docs/classes.md` and `docs/graphql.md` all teach.
 *
 * The bug was filed against `RuleBuilder.that()` alone. Measured by the
 * structural guard below, it was **40 methods across 12 classes**, and **9 of
 * those classes are outside `RuleBuilder`'s hierarchy**, so a fix there could
 * not have reached them. The
 * leaks that matter most are the ones that turn a later rule GREEN —
 * `SmellBuilder.ignorePaths` (inherit an ignore, skip the files),
 * `CorrespondenceBuilder.allowEmpty` (inherit an opt-out from the empty-side
 * guard), and any narrowing predicate (inherit it, select nothing, pass).
 *
 * Two derivations, per ADR-008:
 *
 *   1. Behavioural — hold a builder, derive twice, assert both rules are
 *      right. Every assertion below is on a rule that MUST fail or MUST report
 *      an exact non-zero count; a guard whose rules pass is satisfied by the
 *      bug it guards.
 *   2. Structural — read `src/` and fail on any `return this` that follows a
 *      mutation of the builder's own state. This is what catches builder #14,
 *      which no behavioural test can know about. It disagrees with derivation
 *      1 by construction: it never runs a rule.
 */
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import {
  copiesContainer,
  mutatedInPlace,
  mutatesThenReturnsThis,
} from '../helpers/builder-mutation-scan.js'
import { project } from '../../src/core/project.js'
import { slices } from '../../src/builders/slice-rule-builder.js'
import { byName, correspondence } from '../../src/builders/correspondence-builder.js'
import { modules } from '../../src/builders/module-rule-builder.js'
import { functions } from '../../src/builders/function-rule-builder.js'
import { calls } from '../../src/builders/call-rule-builder.js'
import { call } from '../../src/helpers/matchers.js'
import { tsconfig } from '../../src/tsconfig/index.js'
import { crossLayer } from '../../src/builders/cross-layer-builder.js'
import { smells } from '../../src/smells/index.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'

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

describe('a held builder is immutable — behavioural', () => {
  it('RuleBuilder: narrowing twice gives two correct subject sets', () => {
    const p = load('poc')
    const parsers = functions(p)
      .that()
      .haveNameMatching(/^parse/)

    // Four parsers; three end in Order. Narrow to each disjoint half in turn.
    expect(
      parsers
        .that()
        .haveNameMatching(/Order$/)
        .should()
        .notExist()
        .violations(),
    ).toHaveLength(3)
    expect(
      parsers
        .that()
        .haveNameMatching(/^parseConfig$/)
        .should()
        .notExist()
        .violations(),
    ).toHaveLength(1)
    // The held selection is still all four. Under the bug it was the empty
    // intersection of the two narrowings, and reported none.
    expect(
      parsers
        .should()
        .notExist()
        .violations()
        .map((x) => x.element)
        .sort(),
    ).toEqual(['parseBarOrder', 'parseBazOrder', 'parseConfig', 'parseFooOrder'])
  })

  it('RuleBuilder: expectNonEmpty() does not leak onto the held selection', () => {
    const p = load('poc')
    const nothing = functions(p)
      .that()
      .haveNameMatching(/^definitelyNotAFunction$/)

    // Plan 0074 (R3b) inverted this: an empty selection is a configuration finding by default now. Both spellings now fail, so this can no longer prove non-leakage by
    // contrasting them. The property under test is immutability of the HELD
    // selection, so assert that directly: the flag must not survive onto the
    // held builder, whatever the default does with it.
    expect(() => nothing.expectNonEmpty().should().beExported().check()).toThrow(ArchRuleError)
    expect(() => nothing.should().beExported().check()).toThrow(ArchRuleError)

    // The discriminator, now that both throw: `.expectEmpty()` is refused on a
    // builder that leaked `.expectNonEmpty()`, and accepted on a clean one.
    // A leak makes the second line throw a TypeError instead of passing.
    expect(() => nothing.expectNonEmpty().expectEmpty()).toThrow(TypeError)
    expect(() => nothing.expectEmpty()).not.toThrow()
  })

  it('SliceRuleBuilder: a second rule off a held selection has only its own condition', () => {
    const p = load('slices')
    const held = slices(p).matching('src/')

    // Both conditions fire on this fixture, and each reports exactly ONE
    // violation — feature-a <-> feature-b is a cycle, and `bad` depends upward.
    // So the elements are the only thing that distinguishes them; a count
    // assertion is 1 === 1 either way. The earlier version of this test
    // compared `held.should().beFreeOfCycles()` to its own previous count,
    // which is ADR-008 rule 5's anti-pattern: a derivation agreeing with
    // itself. It also claimed the fixture was acyclic, which it is not.
    const cycles = ['feature-a -> feature-b', 'feature-b -> feature-a']
    const order = ['leaky-controller.ts']

    expect(
      held
        .should()
        .beFreeOfCycles()
        .violations()
        .map((v) => v.element),
    ).toEqual(cycles)
    expect(
      held
        .should()
        .respectLayerOrder('controllers', 'services', 'domain', 'bad')
        .violations()
        .map((v) => v.element),
    ).toEqual(order)
    // Re-deriving each reports only its own finding, not the union.
    expect(
      held
        .should()
        .beFreeOfCycles()
        .violations()
        .map((v) => v.element),
    ).toEqual(cycles)
  })

  it('SliceRuleBuilder: re-discovery does not edit the held selection', () => {
    const p = load('slices')
    const held = slices(p).matching('src/')
    const order = (): readonly string[] =>
      held
        .should()
        .respectLayerOrder('controllers', 'services', 'domain', 'bad')
        .violations()
        .map((v) => v.element)

    // Assert the elements, not the count. This fixture reports exactly one
    // layer-order violation, and an empty slice set reports exactly one
    // config finding — so a count-only assertion is 1 === 1 and passes under
    // the bug. Measured: it did.
    expect(order()).toEqual(['leaky-controller.ts'])

    // Discover a different, empty slice set off the same held builder.
    expect(() => held.matching('src/nowhere/*').should().beFreeOfCycles().check()).toThrow(
      ArchRuleError,
    )
    expect(order()).toEqual(['leaky-controller.ts'])
  })

  it('SmellBuilder: a leaked ignorePaths would silently skip files (false green)', () => {
    const p = project(fixtures('smells/duplicate-bodies'))
    const held = smells.duplicateBodies(p).minLines(3).withMinSimilarity(0.8)

    const all = held.violations()
    expect(all.length).toBeGreaterThan(0)

    // Ignoring everything now yields a CONFIGURATION finding rather than an empty
    // result (plan 0099's floor — an emptied corpus is bug 0066, not a pass), so
    // this asserts the finding's kind exactly as the `inFolder` leak test below
    // already does for plan 0080. The property under test is unchanged: the leak
    // would land on `held` and be visible on the line after.
    const ignoredAll = held.ignorePaths('**/*').violations()
    expect(ignoredAll.length).toBeGreaterThan(0)
    expect(ignoredAll.every((v) => v.bypassFilters === true)).toBe(true)
    // `held` is untouched: still the ordinary duplicate findings, none of them
    // configuration findings.
    const after = held.violations()
    expect(after).toHaveLength(all.length)
    expect(after.every((v) => v.bypassFilters !== true)).toBe(true)
  })

  it('SmellBuilder: inFolder() and minLines() do not accumulate on the held builder', () => {
    const p = project(fixtures('smells/duplicate-bodies'))
    // The threshold is set ONCE, on the held builder. The earlier version of
    // this test re-specified `minLines(3)` on every read, which overwrote a
    // leaked `_minLines` before it could be observed — the same defect already
    // documented for `requires()` below, surviving one test over. And it
    // called `inFolder` on `held.minLines(3)` rather than on `held`, so a
    // leaked folder scope landed on the intermediate copy and was invisible.
    // Measured: reverting either method failed no behavioural test.
    const held = smells.duplicateBodies(p).withMinSimilarity(0.8).minLines(3)
    const baseline = held.violations().length
    expect(baseline).toBeGreaterThan(0)

    // A folder glob matching nothing now yields a **configuration finding**
    // rather than an empty result (plan 0080), so the leak test asserts on the
    // finding's presence rather than on a length of zero. The property under
    // test is unchanged: called directly on `held`, so a leak would land on
    // `held` itself and be visible in the line after.
    const scopedToNothing = held.inFolder('**/no-such-dir/**').violations()
    expect(scopedToNothing.every((v) => v.bypassFilters === true)).toBe(true)
    expect(scopedToNothing.length).toBeGreaterThan(0)
    // The held builder is untouched: still the ordinary duplicate findings, none
    // of them configuration findings.
    const after = held.violations()
    expect(after).toHaveLength(baseline)
    expect(after.every((v) => v.bypassFilters !== true)).toBe(true)

    // A threshold nothing can meet, likewise on `held`, with no re-set after.
    // Same plan-0099 treatment as the `inFolder` case directly above.
    const tooHigh = held.minLines(1000).violations()
    expect(tooHigh.length).toBeGreaterThan(0)
    expect(tooHigh.every((v) => v.bypassFilters === true)).toBe(true)
    const stillBaseline = held.violations()
    expect(stillBaseline).toHaveLength(baseline)
    expect(stillBaseline.every((v) => v.bypassFilters !== true)).toBe(true)

    // And the flag setters, whose leaks change what a LATER detector sees.
    // `ignoreTests` and `groupByFolder` are the false-green direction: an
    // inherited ignore narrows the population silently.
    expect(held.ignoreTests().violations().length).toBeLessThanOrEqual(baseline)
    expect(held.violations()).toHaveLength(baseline)
    expect(held.groupByFolder().violations().length).toBeGreaterThan(0)
    expect(held.violations()).toHaveLength(baseline)
  })

  it('DuplicateBodiesBuilder: withMinSimilarity() does not stick to the held detector', () => {
    const p = project(fixtures('smells/duplicate-bodies'))
    const held = smells.duplicateBodies(p).minLines(3).withMinSimilarity(0.8)
    const baseline = held.violations().length
    expect(baseline).toBeGreaterThan(0)

    // A threshold no pair can meet. Set on a derived detector only — and never
    // re-set afterwards, or a leak is overwritten before it can be seen.
    expect(held.withMinSimilarity(1.01).violations()).toHaveLength(0)
    expect(held.violations()).toHaveLength(baseline)
  })

  it('InconsistentSiblingsBuilder: forPattern() does not stick to the held detector', () => {
    const p = project(fixtures('smells/inconsistent-siblings'))
    // The detector reports nothing at all without a pattern, so the held one
    // must carry a working pattern for this to be falsifiable.
    const held = smells.inconsistentSiblings(p).minLines(2).forPattern(call('this.extractCount'))
    const baseline = held.violations().length
    expect(baseline).toBeGreaterThan(0)

    // An impossible pattern silences the detector — the false-green direction.
    // Inherited, it would silence every later detector off the same builder.
    expect(held.forPattern(call('definitelyNotCalledAnywhere')).violations()).toHaveLength(0)
    expect(held.violations()).toHaveLength(baseline)
  })

  it('CallRuleBuilder: identifiedByArg() does not stick to the held selection', () => {
    const tsMorphProject = new Project({ useInMemoryFileSystem: true })
    tsMorphProject.createSourceFile(
      'routes.ts',
      `declare const app: { post(p: string, h: unknown): void }
       declare const handler: unknown
       app.post("/auth/token", handler)
       app.post("/users", handler)`,
    )
    const p: ArchProject = {
      tsConfigPath: '/virtual/tsconfig.json',
      _project: tsMorphProject,
      getSourceFiles: () => tsMorphProject.getSourceFiles(),
    }
    const held = calls(p).that().onObject('app').and().withMethod('post')

    // `identifiedByArg` folds an argument into the violation element, so a leak
    // shows in the element text rather than in the count.
    const elements = (b: typeof held): string[] =>
      b
        .should()
        .notExist()
        .violations()
        .map((v) => v.element)

    expect(elements(held)).toEqual(['app.post', 'app.post'])
    expect(elements(held.identifiedByArg(0))).toEqual([
      'app.post("/auth/token")',
      'app.post("/users")',
    ])
    // The held selection still reports the unfolded elements.
    expect(elements(held)).toEqual(['app.post', 'app.post'])
  })

  it('RuleBuilder: deriving a rule off a held RULE leaves the held rule asserting (fork)', () => {
    // `should()` forks, and `fork()` clears the condition list. If that fork
    // shared state with its parent, deriving a second rule would clear the
    // HELD rule's conditions in place — turning a rule that asserted something
    // into one that asserts nothing, silently. Measured: sabotaging
    // `fork()`'s copy fails 0 of 2340 tests without this probe.
    const p = load('poc')
    const rule = functions(p)
      .that()
      .haveNameMatching(/^parse/)
      .should()
      .notExist()
    expect(rule.violations()).toHaveLength(4)

    rule.should().beExported()
    expect(rule.violations()).toHaveLength(4)
  })

  it('RuleBuilder: a second .should() ACCUMULATES, and the held rule is untouched (bug 0020)', () => {
    // REPLACED at 0.23.0. Through 0.22.0 this asserted `toHaveLength(0)` for
    // the derived rule, pinning `fork()`'s condition-clearing — which silently
    // discarded an assertion the author wrote (bug 0020). Two things are being
    // pinned now, and the discriminator is the MESSAGE, not the count: two
    // conditions over one selection iterate the same filtered set, so their
    // elements are identical by construction, and a count of 8 is produced by
    // both a correct `copy()` and one sharing the array.
    const p = load('poc')
    const sel = functions(p)
      .that()
      .haveNameMatching(/^parse/)
    const held = sel.should().notExist()
    const kinds = (b: typeof held): string[] =>
      [
        ...new Set(b.violations().map((v) => (/not exist/.test(v.message) ? 'notExist' : 'other'))),
      ].sort()

    // `notExist` and `beAsync` both fire on all four parsers with
    // distinguishable messages — `beExported` yields 0 here, which is why the
    // earlier version's count assertion could not discriminate.
    const derived = held.should().beAsync()
    expect(derived.violations()).toHaveLength(8)
    expect(kinds(derived)).toEqual(['notExist', 'other'])

    // The held rule still asserts exactly its own condition.
    expect(held.violations()).toHaveLength(4)
    expect(kinds(held)).toEqual(['notExist'])
  })

  it('RuleBuilder: a second .should() matches .andShould() exactly (bug 0020)', () => {
    // The equivalence the CHANGELOG claims. `.andShould()` is the canonical
    // spelling and stays so; a second `.should()` is now the same thing.
    const p = load('poc')
    const sel = (): ReturnType<typeof functions> =>
      functions(p)
        .that()
        .haveNameMatching(/^parse/)
    const viaShould = sel().should().notExist().should().beAsync().violations()
    const viaAndShould = sel().should().notExist().andShould().beAsync().violations()
    expect(viaShould.map((v) => v.message).sort()).toEqual(
      viaAndShould.map((v) => v.message).sort(),
    )
  })

  it('CorrespondenceBuilder: a leaked allowEmpty would hide an empty side', () => {
    const p = load('poc')
    const empty = functions(p)
      .that()
      .haveNameMatching(/^nothingMatchesThis$/)
    const held = correspondence(p).side('a', empty, byName()).side('b', ['x'])

    // Not declared: the empty side is the reported root cause.
    expect(() => held.beComplete().check()).toThrow(ArchRuleError)
    // Declared on a derived rule only (plan 0097 renamed this from allowEmpty).
    expect(() => held.expectEmpty('a').beComplete().check()).not.toThrow()
    // The held builder must still fail. Under the bug the declaration leaked and
    // every later rule off this selection accepted an empty side.
    expect(() => held.beComplete().check()).toThrow(ArchRuleError)
  })

  it('TsconfigBuilder: requires() does not accumulate on the held builder', () => {
    const p = project(path.resolve(import.meta.dirname, '../../tsconfig.json'))
    const held = tsconfig(p)

    // This repo is strict, so a `strict: false` requirement fails.
    expect(() => held.requires({ strict: false }).check()).toThrow(ArchRuleError)
    // A separate rule off the same held builder must not inherit it. The two
    // requirements must use DIFFERENT keys: `requires()` merges with later keys
    // winning, so `{strict: false}` then `{strict: true}` overwrites the leak
    // and passes either way. Measured: the same-key version passed under the
    // bug. `noUncheckedIndexedAccess` is on in this repo, so this one holds.
    expect(() => held.requires({ noUncheckedIndexedAccess: true }).check()).not.toThrow()
    expect(() => held.requires({ strict: false }).check()).toThrow(ArchRuleError)
  })

  it('CrossLayerBuilder: layer() does not accumulate on the held builder', () => {
    const p = load('cross-layer')
    const held = crossLayer(p)

    // Fewer than two layers is a RangeError, which is exactly what proves the
    // held builder kept none: if `.layer()` had mutated it, the second call
    // below would find the first call's layer still there and not throw.
    expect(() => held.layer('routes', 'src/routes/**').mapping(() => true)).toThrow(RangeError)
    expect(() => held.layer('schemas', 'src/schemas/**').mapping(() => true)).toThrow(RangeError)
  })

  it('CallRuleBuilder-family: excluding() does not leak onto the held selection', () => {
    const p = load('poc')
    const held = modules(p).that().resideInFolder('**/src/**')
    const all = held.should().notExist().violations()
    expect(all.length).toBeGreaterThan(1)

    // Suppress everything on a derived rule.
    expect(held.excluding(/.*/).should().notExist().violations()).toHaveLength(0)
    // A leaked exclusion is the worst kind of leak: it silences a later rule
    // with no output at all.
    expect(held.should().notExist().violations()).toHaveLength(all.length)
  })
})

describe('a held builder is immutable — structural', () => {
  // One repo load, shared. Two `new Project` calls over this repo's 454 files
  // cost ~330ms each in isolation and 10-12s under full parallelism, which is
  // how both of these tests came to fail on timeout in a run where nothing was
  // wrong. See the note in vitest.config.ts on why a flaky guard is worse than
  // a slow one here.
  let repoProject: Project | undefined
  const repo = (): Project => {
    repoProject ??= new Project({
      tsConfigFilePath: path.resolve(import.meta.dirname, '../../tsconfig.json'),
    })
    return repoProject
  }

  /**
   * `src/` must contain no method that mutates its own state and then returns
   * `this`. Derived from the source text, so it holds for builders this file
   * has never heard of — and pointed at the pre-fix source it names all 40
   * offending methods, which is how the 9 classes beyond the bug report were
   * found.
   *
   * The detector itself lives in `tests/helpers/builder-mutation-scan.ts` and
   * is driven from fixtures by `builder-mutation-scan.test.ts`. It has to be:
   * an assertion that this returns `[]` holds both when `src/` is clean and
   * when the detector is broken, and the first version of this guard WAS
   * broken — it required the pre-fix spelling `this._x.push(...)` and matched
   * 0 of 32 candidate fields once every call site said `next._x.push(...)`.
   */
  it('no chain method mutates its own state and returns this', () => {
    const offenders: string[] = []

    for (const sf of repo().getSourceFiles('src/**/*.ts')) {
      for (const cls of sf.getClasses()) {
        for (const method of cls.getMethods()) {
          const site = mutatesThenReturnsThis(method)
          if (site) {
            offenders.push(
              `${sf.getBaseName()}:${String(method.getStartLineNumber())} ` +
                `${cls.getName() ?? '(anonymous)'}.${method.getName()}() — ${site}`,
            )
          }
        }
      }
    }

    expect(
      offenders,
      'These methods mutate the builder and hand it back, so a held builder is ' +
        'edited in place (bug 0016). Use copy-on-write:\n' +
        '  const next = this.copy()\n  next._field = ...\n  return next\n' +
        'If the field holds a mutable container, also copy it in a `copy()` override.\n\n' +
        offenders.join('\n'),
    ).toEqual([])
  })

  /**
   * Every field that is mutated in place must be given a fresh container
   * somewhere in its own class.
   *
   * The first structural test catches a method that hands `this` back. This
   * one catches the subtler half: a method that correctly returns a copy, but
   * whose copy shares the array it pushes into. `Object.assign` copies the
   * *reference*, so `next._items.push(x)` on such a clone edits the original's
   * array and the leak survives the copy-on-write rewrite entirely.
   *
   * "Somewhere in its own class" rather than "inside `copy()`", because
   * `TerminalBuilder` factors its two containers out into `adoptFilterState`,
   * and a guard that insisted on the literal `copy()` body would have to
   * hard-code that exception. Both spellings — `clone._x = [...this._x]` and
   * `this._x = [...source._x]` — copy one instance's container into another's,
   * and that is what is actually being required.
   *
   * The earlier version of this test asserted that no `copy()` override
   * returns `this`. It passed with every fix reverted, because with the fix
   * gone there are no overrides to be wrong — a guard that is satisfied by the
   * absence of the thing it guards. This version fails there: pointed at the
   * pre-fix source it names 12 fields that are mutated in place with nothing
   * copying them.
   */
  it('every in-place-mutated container field is copied for the clone', () => {
    const unguarded: string[] = []

    for (const sf of repo().getSourceFiles('src/**/*.ts')) {
      for (const cls of sf.getClasses()) {
        const body = cls.getText()
        for (const field of cls.getProperties()) {
          const name = field.getName()
          if (!name.startsWith('_')) continue
          if (!mutatedInPlace(cls, name)) continue
          if (copiesContainer(body, name)) continue
          unguarded.push(
            `${sf.getBaseName()} ${cls.getName() ?? '(anonymous)'}.${name} ` +
              `is mutated in place but never re-created for a clone`,
          )
        }
      }
    }

    expect(
      unguarded,
      'A clone shares these fields with the builder it was copied from, so ' +
        'mutating the clone mutates the original (bug 0016). Add a `copy()` ' +
        'override that replaces them:\n' +
        '  protected override copy(): this {\n' +
        '    const clone = super.copy()\n' +
        '    clone._field = [...this._field]\n' +
        '    return clone\n' +
        '  }\n\n' +
        unguarded.join('\n'),
    ).toEqual([])
  })
})
