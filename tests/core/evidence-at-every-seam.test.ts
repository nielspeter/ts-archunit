/**
 * Every family counts what it examined, and the preview reports it — plan 0096.
 *
 * ## Through `diagnose()`, not through the accessor
 *
 * A first attempt at this plan asserted `examinedUnits()` **directly** for correspondence and
 * graphql-schema and routed only `duplicateBodies` through `diagnose()`. All eight of its tests
 * passed while the preview was **inert for those two families** — they return `undefined` from
 * `getProject()`, so `diagnose()` hit its `if (!target) … continue` and never reached the check.
 * A row that calls the accessor proves the accessor; only a row that calls `diagnose()` proves the
 * feature. Both kinds appear below and they are labelled: the first `describe` is accessor-level and
 * proves the SEAM, the second is `diagnose()`-level and proves the FEATURE.
 *
 * All five families are reached the second way, and that sentence has been wrong twice — first at
 * three of five, then at four, each time asserted rather than counted, in the documentation of the
 * file written to prevent exactly that. It is now true, and the way to keep it true is to count the
 * `kindsOf(...)` call sites in the second `describe` rather than to trust this paragraph.
 *
 * ## What each fixture holds
 *
 * Every row keeps **every upstream count non-zero** — files loaded, globs matched, the pre-filter
 * set populated — while the family's own seam count is zero. That makes these rows a behavioural
 * provenance guard: evidence wired one layer too high (`sourceFiles.length`, a glob-match count)
 * reads healthy here and reds the assertion. Same-layer miswirings remain review-enforced, which
 * ADR-009's Notes states rather than implies.
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { Project } from 'ts-morph'
import { project, resetProjectCache } from '../../src/core/project.js'
import type { ArchProject } from '../../src/core/project.js'
import { diagnose } from '../../src/core/diagnose.js'
import { smells } from '../../src/smells/index.js'
import { call, globAnyOf, stampGlobs } from '../../src/index.js'
import { correspondence } from '../../src/builders/correspondence-builder.js'
import { modules, slices, crossLayer, haveMatchingCounterpart } from '../../src/index.js'
import { tsconfig } from '../../src/tsconfig/index.js'
import { resolvers, schemaFromSDL } from '../../src/graphql/index.js'
import * as rootExports from '../../src/index.js'
import * as graphqlExports from '../../src/graphql/index.js'

const fixture = (name: string): string =>
  path.resolve(import.meta.dirname, `../fixtures/${name}/tsconfig.json`)

/** A project that loaded files — every row needs upstream healthy. */
const loaded = project(fixture('smells/duplicate-bodies'))
const emptyProject = project(fixture('does-not-load'))
/** This repo itself — crossLayer needs two layers that really select files. */
const loadedSelf = project(path.resolve(import.meta.dirname, '../../tsconfig.json'))

const kindsOf = (rule: Parameters<typeof diagnose>[0][number], p?: typeof loaded): string[] =>
  diagnose([rule], p).map((f) => f.kind)

describe('a family counts what it examined (plan 0096)', () => {
  it('CONTROL: the fixture project really did load files', () => {
    // Without this every "upstream is healthy" claim below is unverified, and the
    // rows collapse into the empty-project case they exist to be distinct from.
    expect(loaded.getSourceFiles().length).toBeGreaterThan(0)
  })

  it('duplicateBodies: files loaded, every body under minLines, zero examined', () => {
    expect(smells.duplicateBodies(loaded).minLines(9999).examinedUnits()).toBe(0)
    // The seam is post-minLines. A count taken at the file layer would report the
    // CONTROL's number here, and this row would not hold.
    expect(smells.duplicateBodies(loaded).minLines(1).examinedUnits()).toBeGreaterThan(0)
  })

  it('correspondence: two empty sides is its zero-subject state', () => {
    expect(correspondence(loaded).side('a', []).side('b', []).examinedUnits()).toBe(0)
    expect(correspondence(loaded).side('a', ['k']).side('b', []).examinedUnits()).toBe(1)
  })

  it('graphql schema: fields loaded, predicates narrow to zero', () => {
    // Post-predicate, which is the seam `collectViolations` filters at. The loader
    // already refuses a corpus with no `.graphql` files; this is the case its own
    // instrument cannot catch.
    expect(schemaFromSDL('type Query { a: String }').that().mutations().examinedUnits()).toBe(0)
    expect(schemaFromSDL('type Query { a: String }').that().queries().examinedUnits()).toBe(1)
  })

  it('graphql resolvers: glob matched files, predicates narrow to zero', () => {
    // The family the first attempt got wrong — it counted PRE-predicate, so a
    // chain whose `.that()` selected nothing reported healthy evidence and passed
    // green. Sharing `selected()` with `collectViolations()` means the existing
    // graphql violation tests now guard this seam too: reverting it to
    // `getElements()` reds them, because both readers see the change. This row
    // pins the evidence half directly.
    const p = project(fixture('graphql'))
    const wide = resolvers(p, '**/*.ts')
    expect(wide.examinedUnits()).toBeGreaterThan(0)
    expect(
      wide
        .that()
        .resolveFieldReturning(/ZZZ_NOTHING_MATCHES/)
        .examinedUnits(),
    ).toBe(0)
  })

  it('the four families plan 0098 forced answer with a NUMBER, not a constant', () => {
    // The hole the type cannot close. `collectViolations()` returning
    // `{ violations, examined }` forces every family to produce the field; it
    // cannot force the field to mean anything, and all eight could satisfy the
    // compiler with `examined: 0`. So each family shows its count RESPONDING to
    // input — zero on a narrowed selection, non-zero on a wide one, over a
    // project that loaded files either way. A constant fails one half of every
    // pair below, whichever constant it is.
    const mods = project(fixture('modules'))

    // RuleBuilder<T> — post-predicate subjects.
    expect(modules(mods).that().resideInFolder('**/nowhere-at-all/**').examinedUnits()).toBe(0)
    expect(modules(mods).examinedUnits()).toBeGreaterThan(0)

    // SliceRuleBuilder — slices holding at least one FILE, not slices DECLARED.
    // `assignedFrom()` is the discriminating shape and `matching()` is not:
    // matching a dead glob yields no slices at all, so both definitions answer 0
    // and the row would pass either way. assignedFrom returns one slice per key
    // whether or not anything matched, so here `_slices.length` is 2 while the
    // honest count is 0 — measured, and the reason this row uses this API.
    const declaredButEmpty = slices(mods).assignedFrom({
      alpha: '**/nowhere-at-all/**',
      beta: '**/also-nowhere/**',
    })
    expect(declaredButEmpty.examinedUnits()).toBe(0)
    expect(slices(mods).matching('**/src/*').examinedUnits()).toBeGreaterThan(0)

    // TsconfigBuilder — declared requirements. Its unit is not a subject count
    // at all: this family examines a config, and `.requires({})` is its vacuity.
    expect(tsconfig(mods).requires({}).examinedUnits()).toBe(0)
    expect(tsconfig(mods).requires({ strict: true }).examinedUnits()).toBe(1)
  })

  it('crossLayer counts PAIRS — layers that select files can still examine nothing', () => {
    // The unit that is least obvious, and the one a reviewer flagged as possibly
    // ambiguous. Pairs, not layers and not the files behind them: a mapping that
    // never matches forms no pairs, so the condition receives an empty array and
    // the rule cannot fail — while both layer globs select real files. Counting
    // layers (2) or files (many) would report this rule healthy.
    const both = (map: () => boolean) =>
      crossLayer(loadedSelf)
        .layer('core', '**/src/core/*.ts')
        .layer('builders', '**/src/builders/*.ts')
        .mapping(map)
        .forEachPair()
        .should(haveMatchingCounterpart([]))
    expect(both(() => false).examinedUnits()).toBe(0)
    expect(both(() => true).examinedUnits()).toBeGreaterThan(0)
  })

  it('the memo does not survive a narrowing — a clone is a different key', () => {
    // The hazard an instance field would have had: `shallowClone` is Object.assign
    // over own properties, so a memo stored on the builder is copied onto one that
    // was just given a DIFFERENT filter, and the clone answers with its parent's
    // selection. Plausible number, stale evidence, invisible without this row.
    const wide = smells.duplicateBodies(loaded).minLines(1)
    const before = wide.examinedUnits()
    expect(before).toBeGreaterThan(0)
    // Materialize the parent FIRST, then narrow — the order that would poison a
    // copied memo.
    expect(wide.minLines(9999).examinedUnits()).toBe(0)
    // And the parent is unchanged, so the memo is not shared in the other direction.
    expect(wide.examinedUnits()).toBe(before)
  })
})

describe('the preview reports it, with the gate’s precedence (plan 0096)', () => {
  it('fires when the project loaded files and the family examined none', () => {
    // toEqual, not toContain. `diagnose.test.ts` bans the weaker form in writing —
    // "the cheap green the plan bans: it would stop pinning that no third finding
    // appears" — and on the first pass every positive row here used it, which is
    // exactly why a ['no-condition','zero-subjects'] double-report went unseen.
    expect(kindsOf(smells.duplicateBodies(loaded).minLines(9999), loaded)).toEqual([
      'zero-subjects',
    ])
  })

  it('reaches a family with NO project — the case that was inert', () => {
    // `correspondence` discards its project by documented design and `schemaFromSDL`
    // never had one, so both answer `undefined` from `getProject()`. The first
    // attempt gated the evidence check on that and gave these families no preview
    // at all — while its tests passed, because they called the accessor instead.
    // ASSERTION-COMPLETE rules. The first pass used bare selections, which are
    // also condition-less — so the rows passed under `toContain` while actually
    // reporting ['no-condition','zero-subjects'], conflating the fault they mean
    // to prove with a different one.
    expect(kindsOf(correspondence(loaded).side('a', []).side('b', []).beComplete())).toEqual([
      'zero-subjects',
    ])
    expect(
      kindsOf(
        schemaFromSDL('type Query { a: String }').that().mutations().should().haveFields('x'),
      ),
    ).toEqual(['zero-subjects'])
  })

  it('yields to a missing assertion — ["no-condition"] alone', () => {
    // The plan pre-registered this row and the first pass shipped without it,
    // because `const before` was captured AFTER the no-condition push so the tail
    // could never suppress on it.
    expect(kindsOf(correspondence(loaded).side('a', []).side('b', []))).toEqual(['no-condition'])
  })

  it('yields to a declaration — the advice must not tell you to do what you did', () => {
    // ADR-008 rule 2, behaviourally: apply the stated remedy and assert the
    // finding clears. The first pass asserted the advice's TEXT and never that
    // following it worked — and it did not, because nothing consulted
    // `declaresEmpty()`, the hook 0097 created for exactly this question.
    expect(kindsOf(smells.duplicateBodies(loaded).minLines(9999), loaded)).toEqual([
      'zero-subjects',
    ])
    expect(kindsOf(smells.duplicateBodies(loaded).minLines(9999).expectEmpty(), loaded)).toEqual([])
  })

  it('correspondence declares PER SIDE, and one side is not enough', () => {
    // The override that makes `declaresEmpty()` mean something different here:
    // `_expectEmpty` can never be true on this class, because the zero-arg form
    // throws. Its docstring recorded the override as unobservable-until-0098 —
    // an ADR-008 split-row equivalence — and that equivalence EXPIRED the moment
    // `diagnose()` became its first reader, one commit later. Reverting the
    // override to the base body left the whole suite green until this row.
    const base = correspondence(loaded).side('a', []).side('b', []).beComplete()
    expect(kindsOf(base)).toEqual(['zero-subjects'])
    // One of two sides is not a declaration about the rule.
    expect(kindsOf(base.expectEmpty('a'))).toEqual(['zero-subjects'])
    // Both is — and the base body would report here, telling an author who
    // declared both sides to go and declare them.
    expect(kindsOf(base.expectEmpty('a').expectEmpty('b'))).toEqual([])
    // And `[].every(...)` is TRUE, so a correspondence with no sides at all would
    // declare itself empty vacuously — the ∀-over-∅ shape this whole plan is
    // about, reappearing inside the check that suppresses the plan's own finding.
    expect(correspondence(loaded).beComplete().declaresEmpty()).toBe(false)
  })

  it('resolvers reports through diagnose(), not only through the accessor', () => {
    // The family the first attempt counted pre-predicate. Its accessor row lives
    // above; this proves the preview actually reaches it.
    const p = project(fixture('graphql'))
    const narrowed = resolvers(p, '**/*.ts')
      .that()
      .resolveFieldReturning(/ZZZ_NOTHING_MATCHES/)
      .should()
      .contain(call('nothing.atAll'))
    expect(kindsOf(narrowed, p)).toEqual(['zero-subjects'])
  })

  it('inconsistentSiblings reports through diagnose() too — the fifth family', () => {
    // Absent from the first pass, and it was the family whose `detect()` never
    // called `selected()` — so its evidence was a second derivation that a
    // reviewer rewrote to `sourceFiles.length` with the whole suite still green.
    const modules = project(fixture('modules'))
    // A folder holding exactly ONE file. That is where the `>= 2` threshold is
    // semantic rather than an optimisation: `detect()` would skip it anyway via
    // its downstream majority guards, so only the COUNT distinguishes. Without
    // this row, dropping the threshold is caught by nothing — measured.
    const single = smells
      .inconsistentSiblings(modules)
      .inFolder('**/vendor/nested/src/domain/**')
      .forPattern(call('x'))
    expect(single.examinedUnits()).toBe(0)
    // The row above is 0 for TWO different reasons, and only one of them is the
    // threshold: rename that folder and the glob goes dead, `examinedUnits()`
    // stays 0, and the row passes while guarding nothing. `diagnose()` tells the
    // two apart — a dead glob reports ['dead-glob'] and yields, so this reds.
    expect(kindsOf(single, modules)).toEqual(['zero-subjects'])

    // And the same detector over folders that ARE comparable counts them, so the
    // row above is not green merely because the glob matched nothing.
    const comparable = smells.inconsistentSiblings(modules).forPattern(call('x'))
    expect(comparable.examinedUnits()).toBeGreaterThan(1)
  })

  it('does NOT fire beside project-empty — one fault, one finding', () => {
    // toEqual, for the same reason as every other positive row here — leaving
    // two rows on the form this file's own header calls "the cheap green the
    // plan bans" is the inconsistency that lets a third finding appear unseen.
    expect(kindsOf(smells.duplicateBodies(emptyProject), emptyProject)).toEqual(['project-empty'])
  })

  it('does NOT fire beside project-unknown — the OTHER gate, on the other branch', () => {
    // The no-project branch has its own copy of the precedence gate, and the
    // shape it exists to prevent — ['project-unknown', ..., 'zero-subjects'] —
    // needs a rule that declares globs AND cannot name a project. No builder in
    // the library is that shape today, so it is hand-built here exactly as
    // `diagnose.test.ts` hand-builds the `project-unknown` case: the branch is
    // reachable through the structural interface, so it is guarded through it.
    // One row had been credited to two call sites, and this is the other half.
    const opaque = {
      violations: () => [],
      globs: () => [
        stampGlobs(globAnyOf(['**/anywhere/**'], 'file-path'), 'selector', () => 'hand-built'),
      ],
      examinedUnits: () => 0,
    }
    expect(diagnose([opaque]).map((f) => f.kind)).toEqual(['project-unknown'])

    // And with no globs the same rule DOES reach the evidence check, so the row
    // above is the gate working rather than the branch being unreachable.
    expect(diagnose([{ violations: () => [], examinedUnits: () => 0 }]).map((f) => f.kind)).toEqual(
      ['zero-subjects'],
    )
  })

  it('does NOT fire beside a dead glob — the derived symptom yields to the cause', () => {
    // Emitting this first produced ['zero-subjects','dead-glob'] for one typo, with
    // advice that is false on that path, and broke the invariant bug 0040 is filed
    // for: that `diagnose()` and the gate agree about a dead discovery glob.
    expect(
      kindsOf(smells.duplicateBodies(loaded).inFolder('**/nowhere-at-all/**'), loaded),
    ).toEqual(['dead-glob'])
  })

  it('stays silent when the family examined something', () => {
    // Non-vacuity: every row above holds if the finding fired always, or never.
    expect(kindsOf(smells.duplicateBodies(loaded).minLines(1), loaded)).toEqual([])
  })

  it('the remedy names a call the reader can actually make', () => {
    // ADR-008 rule 2, at its strictest: take the advice string, call what it
    // names, and assert the finding clears. The generic `.expectEmpty()` is a
    // TypeError on correspondence, so an advice string shared across families
    // would send this reader into an exception — verified, not assumed.
    const rule = correspondence(loaded).side('a', []).side('b', []).beComplete()
    const [finding] = diagnose([rule]).filter((f) => f.kind === 'zero-subjects')
    expect(finding?.advice).toContain('.expectEmpty(sideName)')
    expect(finding?.advice).not.toContain('with .expectEmpty() if')
    // And the zero-arg form the generic advice WOULD have named does throw here,
    // so the distinction is real rather than cosmetic.
    expect(() => rule.expectEmpty()).toThrow(TypeError)
    expect(kindsOf(rule.expectEmpty('a').expectEmpty('b'))).toEqual([])
  })

  it('the remedy names the narrowing, and never claims the author wrote it', () => {
    // ADR-008 rule 2. The commonest trigger is a DEFAULT — `minLines` is 5 — so
    // "fix your filters" sends a reader who wrote none looking for filters that do
    // not exist in their code. Precedence means only this one cause survives to be
    // reported, so the advice can name it without hedging.
    const [finding] = diagnose([smells.duplicateBodies(loaded).minLines(9999)], loaded).filter(
      (f) => f.kind === 'zero-subjects',
    )
    expect(finding?.advice).toContain('0 function bodies')
    // The narrowing is NAMED with its actual value...
    expect(finding?.advice).toContain('minLines(9999)')
    // ...and because the author wrote 9999 themselves, the advice must NOT claim
    // they did not. Plan 0099 first appended "minLines defaults to 5, a default
    // you did not write" unconditionally, which rendered as
    // "minLines(9999) — minLines defaults to 5, a default you did not write":
    // false on the path that produced it, on an unsuppressable hard failure, and
    // it sends an agent hunting for where 5 comes from instead of the 9999 that
    // is the fault.
    expect(finding?.advice).not.toContain('did not write')
    expect(finding?.advice).not.toContain('glob')
    // The ranking INVERTED in plan 0099, and this row now asserts the inverse
    // rather than being deleted.
    //
    // 0096 ranked declaring below widening because `.expectEmpty()` was "a marker
    // an agent can stamp to go green" — it made the finding vanish and proved
    // nothing. This comment named the condition for that changing: "until 0098's
    // effectiveness half". 0099 is that half — a false declaration now fails, so
    // the declaration is an assertion and the two are genuine peers.
    //
    // The old ranking is also unavailable to the reader it was aimed at: for a
    // greenfield adopter whose second layer does not exist yet, widening is
    // impossible, so "widening is the fix" was advice they could not take.
    expect(finding?.advice).not.toContain('not itself checked yet')
    expect(finding?.advice).not.toContain('proving anything')
    // ADR-008 rule 3's corollary still holds, and this is what now enforces it:
    // the declaration is described by what it DOES, so it cannot read as a mute
    // button. `the-floor.test.ts` proves the behaviour behind this sentence.
    expect(finding?.advice).toContain('not a silencer')
    // Both remedies offered as peers. "widening is the fix" was the 0096 ranking
    // and it is gone with the policy it expressed.
    expect(finding?.advice).not.toContain('widening is the fix')
    expect(finding?.advice).toContain('widen the selector')
    expect(finding?.advice).toContain('declare the empty state')
  })

  it('and it DOES name the default when the author left it alone', () => {
    // The other half of the branch. Without this row the fix above could be
    // "never mention the default at all", which loses the single most useful
    // fact for the commonest cause — a threshold the author never set.
    const [finding] = diagnose(
      [smells.duplicateBodies(loaded).ignorePaths('**/*.ts')],
      loaded,
    ).filter((f) => f.kind === 'zero-subjects')
    expect(finding?.advice).toContain('minLines(5)')
    expect(finding?.advice).toContain('did not write')
  })
})

/**
 * Nothing forces a family to implement either hook — plan 0096's review, item I5.
 *
 * `examinedUnits?` and `declaresEmpty?` are both OPTIONAL on `DiagnosableRule`,
 * and the two failure modes are asymmetric and both silent:
 *
 *   forget `examinedUnits`  -> no preview at all for that family (fails open)
 *   forget `declaresEmpty`  -> inherit `_expectEmpty`, which for a family whose
 *                              declaration is per-side is ALWAYS false, so the
 *                              preview tells an author to declare what they
 *                              declared (over-reports)
 *
 * The second one is the defect this plan's fix commit repaired for
 * `correspondence`, and it is reachable again for the next family. Modelled on
 * `assertion-gate.test.ts`'s prototype census, which exists for the same reason
 * about `assertsSomething()`.
 */
describe('classification of the evidence hooks (plan 0096)', () => {
  // A family that narrows on its OWN seam, past what the generic subject
  // machinery can see, must count there. This is the list ADR-010 rule 1's
  // table should name.
  const COUNTS_AT_ITS_OWN_SEAM: readonly string[] = [
    'DuplicateBodiesBuilder', // post-minLines, post-glob
    'InconsistentSiblingsBuilder', // folders of >= 2, not files
    'CorrespondenceBuilder', // materialized sides, and it has no project
    'SchemaRuleBuilder', // post-predicate fields; no project either
    'ResolverRuleBuilder', // post-predicate resolvers
    // Plan 0098 — the seam's return type forced these. `RuleBuilder` is the
    // abstract root, so its subclasses correctly INHERIT a real implementation
    // and the walk finds 'RuleBuilder' rather than a missing hook.
    'RuleBuilder', // post-predicate subjects
    'SliceRuleBuilder', // slices holding at least one file
    'TsconfigBuilder', // declared requirements — a config, not a corpus
    // NOT listed, and stated rather than left as a gap: `crossLayer`'s seam lives
    // on `PairFinalBuilder`, which no entry point exports, so a name census
    // cannot reach it (the same caveat `assertion-gate.test.ts` records). Its
    // unit is guarded behaviourally by the PAIRS row above instead.
  ]

  /**
   * The class in the chain that DEFINES `method`, by name — undefined if nobody
   * does. Prototype walk rather than a `.d.ts` read, matching the precedent in
   * `assertion-gate.test.ts`; bug 0071 records what that cannot see.
   */
  const ownerOf = (cls: unknown, method: string): string | undefined => {
    if (typeof cls !== 'function') return undefined
    const start: unknown = cls.prototype
    let proto: object | null = typeof start === 'object' && start !== null ? start : null
    while (proto) {
      if (Object.hasOwn(proto, method)) {
        const ctor: unknown = Object.getOwnPropertyDescriptor(proto, 'constructor')?.value
        return typeof ctor === 'function' ? ctor.name : undefined
      }
      const next: unknown = Object.getPrototypeOf(proto)
      proto = typeof next === 'object' && next !== null ? next : null
    }
    return undefined
  }

  const named = new Map<string, unknown>()
  for (const mod of [rootExports, graphqlExports]) {
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value === 'function') named.set(name, value)
    }
  }

  it('CONTROL: the census actually found these classes', () => {
    // Without this, every `continue` below turns the block into [].filter().
    const missing = COUNTS_AT_ITS_OWN_SEAM.filter((n) => !named.has(n))
    expect(missing, 'listed families that are no longer exported by name').toEqual([])
  })

  it('every listed family implements examinedUnits() on its own hierarchy', () => {
    // Deleting `DuplicateBodiesBuilder.examinedUnits` makes `diagnose()` return
    // [] for it — a family with no preview, silently. This reds instead.
    const inherited = COUNTS_AT_ITS_OWN_SEAM.filter(
      (n) => ownerOf(named.get(n), 'examinedUnits') !== n,
    )
    expect(inherited, 'must count at its own seam, not inherit or omit').toEqual([])
  })

  it('a family that redefines expectEmpty() must redefine BOTH readers of it', () => {
    // THE structural link, and the one that was missing. If you change what
    // declaring means — correspondence declares per SIDE, so the zero-arg form
    // throws and `_expectEmpty` can never be true — then the base answer to
    // "did they declare?" is wrong for you, and wrong in the over-reporting
    // direction. Reverting the override alone kept 3219 tests green.
    // Two readers, and forgetting EITHER is silent. `declaresEmpty()` is how the
    // gate reads the declaration; `emptyDeclarationAdvice()` is how the remedy
    // spells it, and a family that redefines the call but not the advice ships a
    // remedy that throws when followed.
    const offenders = [...named.keys()].filter(
      (n) =>
        ownerOf(named.get(n), 'expectEmpty') === n &&
        (ownerOf(named.get(n), 'declaresEmpty') !== n ||
          ownerOf(named.get(n), 'emptyDeclarationAdvice') !== n),
    )
    expect(offenders, 'redefines what declaring means but not how it is read').toEqual([])
  })

  it('CONTROL: that link is a real constraint, not a claim about an empty set', () => {
    // The row above is [] if no builder overrides `expectEmpty` at all. One does.
    const redefiners = [...named.keys()].filter((n) => ownerOf(named.get(n), 'expectEmpty') === n)
    expect(redefiners).toContain('CorrespondenceBuilder')
  })
})

/**
 * The memo's staleness escape hatch — plan 0096's review, item I4.
 *
 * `selection-memo.ts` reasons carefully about ONE staleness hazard (a clone
 * inheriting its parent's selection, solved by keying on object identity) and
 * used to stop one short of the other: a builder held across a mutation of the
 * underlying ts-morph project keeps answering with the pre-mutation selection,
 * because identity has not changed. `element-cache.ts` has exactly this profile
 * and solves it by registering with `cache-registry.ts`; a second memo with a
 * second, different answer would be two mechanisms for one state.
 *
 * It is worse here than in the element cache, which is why it is guarded rather
 * than disclaimed: both readers — the gate and the evidence count — go through
 * this memo, so a stale entry is a stale VERDICT and a stale count that agree
 * with each other. That is the failure mode plan 0096 exists to remove.
 */
describe('the sharing and the memo are observable, not just intended (plan 0096)', () => {
  /**
   * The structural requirement of this plan — ONE `selected()`, called by both
   * the gate and the evidence — is BEHAVIOURALLY INVISIBLE. Re-deriving the same
   * set inline inside `detect()` produces identical violations and an identical
   * count, which is exactly how the first attempt shipped `inconsistentSiblings`
   * with two derivations of one threshold, and how a reviewer then rewrote its
   * `selected()` to `sourceFiles.length` with the whole suite green.
   *
   * So the guard cannot be behavioural. It is a COUNT: a project that records
   * how often its file list is asked for. One shared, memoized selection asks
   * once; un-share `detect()` and it asks twice; delete the memo and it asks
   * twice. That also makes it the only guard on the plan's stated performance
   * requirement — `doctor` calls `diagnose()` once per rule file, and without
   * the memo a rule file with ten smell rules pays the walk twice over.
   */
  it('both readers ask the project for its files exactly ONCE', () => {
    const tsMorphProject = new Project({ useInMemoryFileSystem: true })
    for (const name of ['a', 'b']) {
      tsMorphProject.createSourceFile(
        `/src/${name}.ts`,
        `export function ${name}() {\n  log.info('x')\n  const q = 1\n  const w = 2\n  return q + w\n}\n`,
      )
    }
    let asked = 0
    const counting: ArchProject = {
      tsConfigPath: '/tsconfig.json',
      _project: tsMorphProject,
      getSourceFiles: () => {
        asked++
        return tsMorphProject.getSourceFiles()
      },
    }
    const rule = smells.inconsistentSiblings(counting).forPattern(call('log.info')).minLines(2)

    expect(rule.examinedUnits()).toBe(2)
    const afterEvidence = asked
    expect(afterEvidence).toBe(1)

    // The gate now reads the SAME materialized selection. A second ask here
    // means a second derivation — the defect, not a performance nit.
    // `violations()` is the public gate path — `collectViolations()` is protected,
    // and reaching past a visibility boundary to test would guard a seam no
    // consumer can reach.
    expect(rule.violations()).toEqual([])
    expect(asked, 'the gate re-derived what the evidence already computed').toBe(afterEvidence)
  })
})

describe('the selection memo yields to resetProjectCache() (plan 0096)', () => {
  const heldProject = (): ArchProject => {
    const tsMorphProject = new Project({ useInMemoryFileSystem: true })
    // Two identical bodies, comfortably over minLines — one duplicate pair.
    for (const name of ['a', 'b']) {
      tsMorphProject.createSourceFile(
        `/src/${name}.ts`,
        `export function ${name}() {\n  const x = 1\n  const y = 2\n  const z = 3\n  return x + y + z\n}\n`,
      )
    }
    return {
      tsConfigPath: '/tsconfig.json',
      _project: tsMorphProject,
      getSourceFiles: () => tsMorphProject.getSourceFiles(),
    }
  }

  it('is frozen for a builder held across a mutation — stated, not hidden', () => {
    const held = heldProject()
    const rule = smells.duplicateBodies(held).minLines(3)
    const before = rule.examinedUnits()
    expect(before).toBe(2)

    held._project.createSourceFile('/src/c.ts', 'export function c() {\n  return 1\n}\n')
    // Same builder object, so the same memo key. The new file is invisible.
    expect(rule.examinedUnits()).toBe(before)
  })

  it('sees the mutation after resetProjectCache()', () => {
    const held = heldProject()
    const rule = smells.duplicateBodies(held).minLines(3)
    expect(rule.examinedUnits()).toBe(2)

    held._project.createSourceFile(
      '/src/c.ts',
      'export function c() {\n  const x = 1\n  const y = 2\n  const z = 3\n  return x + y + z\n}\n',
    )
    resetProjectCache()

    // Removing `registerCacheReset` from `selection-memo.ts` reds this and
    // nothing else — measured. The element cache alone does not cover it,
    // because the memo caches POST-filter and holds its own copy.
    expect(rule.examinedUnits()).toBe(3)
  })
})
