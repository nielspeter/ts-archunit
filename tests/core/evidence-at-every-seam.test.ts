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
 * feature. Every family below is reached the second way.
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
import { project } from '../../src/core/project.js'
import { diagnose } from '../../src/core/diagnose.js'
import { smells } from '../../src/smells/index.js'
import { correspondence } from '../../src/builders/correspondence-builder.js'
import { resolvers, schemaFromSDL } from '../../src/graphql/index.js'

const fixture = (name: string): string =>
  path.resolve(import.meta.dirname, `../fixtures/${name}/tsconfig.json`)

/** A project that loaded files — every row needs upstream healthy. */
const loaded = project(fixture('smells/duplicate-bodies'))
const emptyProject = project(fixture('does-not-load'))

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
    expect(kindsOf(smells.duplicateBodies(loaded).minLines(9999), loaded)).toContain(
      'zero-subjects',
    )
  })

  it('reaches a family with NO project — the case that was inert', () => {
    // `correspondence` discards its project by documented design and `schemaFromSDL`
    // never had one, so both answer `undefined` from `getProject()`. The first
    // attempt gated the evidence check on that and gave these families no preview
    // at all — while its tests passed, because they called the accessor instead.
    expect(kindsOf(correspondence(loaded).side('a', []).side('b', []))).toContain('zero-subjects')
    expect(kindsOf(schemaFromSDL('type Query { a: String }').that().mutations())).toContain(
      'zero-subjects',
    )
  })

  it('does NOT fire beside project-empty — one fault, one finding', () => {
    const kinds = kindsOf(smells.duplicateBodies(emptyProject), emptyProject)
    expect(kinds).toContain('project-empty')
    expect(kinds).not.toContain('zero-subjects')
  })

  it('does NOT fire beside a dead glob — the derived symptom yields to the cause', () => {
    // Emitting this first produced ['zero-subjects','dead-glob'] for one typo, with
    // advice that is false on that path, and broke the invariant bug 0040 is filed
    // for: that `diagnose()` and the gate agree about a dead discovery glob.
    const kinds = kindsOf(smells.duplicateBodies(loaded).inFolder('**/nowhere-at-all/**'), loaded)
    expect(kinds).toContain('dead-glob')
    expect(kinds).not.toContain('zero-subjects')
  })

  it('stays silent when the family examined something', () => {
    // Non-vacuity: every row above holds if the finding fired always, or never.
    expect(kindsOf(smells.duplicateBodies(loaded).minLines(1), loaded)).not.toContain(
      'zero-subjects',
    )
  })

  it('the remedy names the narrowing, and never claims the author wrote it', () => {
    // ADR-008 rule 2. The commonest trigger is a DEFAULT — `minLines` is 5 — so
    // "fix your filters" sends a reader who wrote none looking for filters that do
    // not exist in their code. Precedence means only this one cause survives to be
    // reported, so the advice can name it without hedging.
    const [finding] = diagnose([smells.duplicateBodies(loaded).minLines(9999)], loaded).filter(
      (f) => f.kind === 'zero-subjects',
    )
    expect(finding?.advice).toContain('0 subjects')
    expect(finding?.advice).toContain('did not write')
    expect(finding?.advice).not.toContain('glob')
  })
})
