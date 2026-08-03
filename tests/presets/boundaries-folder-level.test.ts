/**
 * `strictBoundaries()`'s `no-cross-boundary` rule is FOLDER-level (bug 0017).
 *
 * Its metadata used to describe entry-point-mediated access — a looser policy
 * than the rule implements — and its `Fix:` line said "import from the other
 * boundary's entry point instead". Applied exactly, that reproduces the
 * identical violation, so an agent obeying it loops and its only exits are
 * unsanctioned (baseline, exclude, disable).
 *
 * The draft guard for this bug was "assert the rule behaves identically for both
 * imports", and it is vacuously satisfiable: two of four sabotages (a dead glob,
 * a narrowed selector) pass it as `0 === 0`. So every assertion here is by
 * IDENTITY — which importer, which imported file — with an explicit non-vacuity
 * anchor, and the load-bearing one is the last: apply the stated remedy and
 * assert the finding clears. The old text fails that test, which is this bug
 * stated as a test rather than as prose.
 *
 * Its own fixture root, because the existing boundaries fixtures are
 * materialized by every test in `boundaries.test.ts` and `duplicateBodies` runs
 * pairwise over them.
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { project } from '../../src/core/project.js'
import { strictBoundaries } from '../../src/presets/boundaries.js'
import type { ArchViolation } from '../../src/core/violation.js'
import { isDescribable } from '../../src/core/rule-description.js'

const p = project(
  path.resolve(import.meta.dirname, '../fixtures/presets/boundaries-folder-level/tsconfig.json'),
)
const FOLDERS = '**/src/features/*'
const SHARED = ['**/src/shared/**']

const run = (options: Parameters<typeof strictBoundaries>[1]): ArchViolation[] =>
  strictBoundaries(p, options).flatMap((rule) => rule.violations())

const crossBoundary = (violations: ArchViolation[]): ArchViolation[] =>
  violations.filter((v) => v.ruleId === 'preset/boundaries/no-cross-boundary')

/** Which importer produced it, and which file it reached for. */
const edges = (violations: ArchViolation[]): string[] =>
  crossBoundary(violations)
    .map((v) => {
      const importer = path.basename(v.file)
      const imported = /"([^"]+)"/.exec(v.message)?.[1]
      return `${importer} -> ${imported === undefined ? '?' : path.basename(imported)}`
    })
    .sort()

/**
 * `strictBoundaries()` returns `RuleBuilderLike`, which declares only
 * `violations()`. Narrowed with a real guard rather than a cast: ADR-005 bars
 * `as`, and the `imperative` this reads is the string `init` tells users to
 * commit into their agent's system prompt — the surface bug 0017 called its
 * worst.
 */

describe('the rule is folder-level, and treats an entry point exactly like an internal', () => {
  it('flags BOTH cross-boundary imports, named by identity', () => {
    // The pin the draft guard could not make: not "the same count either way"
    // but "these two specific edges are reported". `via-index.ts` reaches the
    // other boundary's `index.ts` — its public surface — and is flagged exactly
    // as `via-internal.ts` is.
    expect(edges(run({ folders: FOLDERS, shared: SHARED }))).toEqual([
      'via-index.ts -> index.ts',
      'via-internal.ts -> internal.ts',
    ])
  })

  it('NON-VACUITY: the rule really ran — no discovery finding, and legal imports pass', () => {
    // Without this, every assertion above is satisfiable by a rule that selects
    // nothing. Two independent anchors: no configuration finding (the glob
    // matched folders), and the within-boundary and shared imports — which the
    // rule must NOT flag — are genuinely present in the fixture.
    const all = run({ folders: FOLDERS, shared: SHARED })
    expect(all.filter((v) => v.bypassFilters === true)).toEqual([])
    // `billing/index.ts` imports `billing/internal.ts`: inside one boundary.
    expect(edges(all)).not.toContain('index.ts -> internal.ts')
    // `reporting/uses-shared.ts` imports `shared/util.ts`: allowed.
    expect(edges(all)).not.toContain('uses-shared.ts -> util.ts')
  })
})

describe('the remedy remediates (ADR-008 rule 2)', () => {
  it('the stated fix, applied, clears the finding', () => {
    // The generalizable guard for this defect class. The remedy says: move the
    // code both boundaries need into a shared folder, or remove the dependency.
    // `uses-shared.ts` is that remedy already applied — it depends on
    // `src/shared/**` rather than on the other boundary — and it must produce
    // nothing while its unfixed siblings still do.
    const remaining = edges(run({ folders: FOLDERS, shared: SHARED }))
    expect(remaining).not.toContain('uses-shared.ts -> util.ts')
    expect(remaining).toHaveLength(2)
  })

  it('the OLD remedy would not have cleared it — the loop, as a test', () => {
    // "Import from the other boundary's entry point instead of reaching into its
    // internals." `via-index.ts` has already done exactly that, and is still
    // reported. This is the bug: the sanctioned fix reproduces the violation.
    expect(edges(run({ folders: FOLDERS, shared: SHARED }))).toContain('via-index.ts -> index.ts')
  })
})

describe('the message is honest in both configurations', () => {
  const suggestionOf = (options: Parameters<typeof strictBoundaries>[1]): string =>
    crossBoundary(run(options))[0]?.suggestion ?? ''

  it('with shared configured, it names the folders that actually exist', () => {
    const fix = suggestionOf({ folders: FOLDERS, shared: SHARED })
    expect(fix).toContain('**/src/shared/**')
    expect(fix).toContain('remove the dependency on the other boundary')
  })

  it('with shared EMPTY, it does not send the reader to a folder that is not allowed', () => {
    // `shared` defaults to `[]`, which is legal — and there the old text's "move
    // the shared piece into the shared module" named somewhere unreachable.
    // Measured: with shared unconfigured, importing `src/shared/**` is ITSELF a
    // violation of this rule, so the fix produced a third finding.
    const withoutShared = run({ folders: FOLDERS })
    expect(edges(withoutShared)).toContain('uses-shared.ts -> util.ts')
    const fix = suggestionOf({ folders: FOLDERS })
    expect(fix).toContain('No shared folders are configured')
    expect(fix).toContain('strictBoundaries({ shared })')
  })

  it('TRIPWIRE: no string claims entry-point enforcement the rule does not do', () => {
    // Labelled a tripwire on purpose: a synonym passes it, so it is not the
    // guard — the identity assertions above are. It is here because the defect
    // was authorial, and this is the phrase that was wrong.
    const rules = strictBoundaries(p, { folders: FOLDERS, shared: SHARED })
    const texts = rules.flatMap((rule) => {
      // Fail rather than skip: `return []` degraded a non-describable rule to
      // an empty contribution, so the assertion below could pass over nothing.
      if (!isDescribable(rule)) throw new Error('a preset rule cannot describe itself')
      const d = rule.describeRule()
      return [d.because ?? '', d.suggestion ?? '', d.imperative ?? '']
    })
    const crossTexts = texts.filter((t) => t.includes('boundar'))
    expect(crossTexts.length).toBeGreaterThan(0)
    for (const text of crossTexts) {
      expect(text).not.toMatch(/entry point|public surface|internals/i)
    }
  })
})

describe('a `shared` glob that matches nothing says so (bug 0023)', () => {
  // `shared` globs go raw into `no-cross-boundary`'s allow list and are matched
  // against absolute file paths, so a spelling that matches nothing creates no
  // allowance — and said nothing about it. `folders` has had a loud guard since
  // plan 0067; the two options sat on one preset holding the caller to two
  // different contracts.
  //
  // Reusing this fixture rather than growing a second one, as bug 0023 asks: the
  // cross-boundary violations above are the non-vacuity anchor, so "the shared
  // import passes" is never satisfied by a rule that selected nothing.
  const sharedFindings = (violations: ArchViolation[]): ArchViolation[] =>
    violations.filter((v) => v.ruleId === 'preset/boundaries/shared-discovery')

  it('the working spelling: shared import passes, no finding', () => {
    const all = run({ folders: FOLDERS, shared: SHARED })
    expect(sharedFindings(all)).toEqual([])
    expect(edges(all)).not.toContain('uses-shared.ts -> util.ts')
    // Non-vacuity: the rule ran and found the real cross-boundary edges.
    expect(edges(all)).toHaveLength(2)
  })

  it('a relative spelling is reported, instead of silently flagging legal code', () => {
    // Measured before the guard: this produced 3 cross-boundary violations — the
    // two real ones plus a FALSE RED on `uses-shared.ts` — and zero explanation.
    const all = run({ folders: FOLDERS, shared: ['src/shared/**'] })
    const finding = sharedFindings(all)[0]
    expect(finding).toBeDefined()
    // Pinned on the DISCOVERY clause, not just "the glob appears somewhere":
    // the remedy embeds the glob too, so replacing the finding's `glob` field
    // with a placeholder left the message still mentioning it and was caught by
    // nothing. A finding that names a different glob than the one at fault is
    // self-contradictory, and this is the only assertion that would see it.
    expect(finding?.message).toContain("for glob 'src/shared/**'")
    expect(finding?.message).toContain('matched no file')
    // The remedy names the spelling that works, and it is the one this fixture
    // proves works in the test above.
    expect(finding?.suggestion).toContain('**/src/shared/**')
    expect(finding?.bypassFilters).toBe(true)
    expect(finding?.severity).toBe('error')
  })

  it('a dead glob is reported too, and names itself', () => {
    // Indistinguishable from the relative case before the guard: same violation
    // count, same silence. The finding has to name the glob to tell them apart.
    const finding = sharedFindings(run({ folders: FOLDERS, shared: ['**/no-such-dir/**'] }))[0]
    expect(finding).toBeDefined()
    expect(finding?.message).toContain('**/no-such-dir/**')
  })

  it('a folder glob with no trailing /** is a fault here, though shared-isolation accepts it', () => {
    // The subtlety the guard is deliberately strict about: `atPath` selects files
    // for `shared-isolation` by matching the folder, but the ALLOW LIST matches
    // resolved file paths, so this spelling creates no allowance. Guarding on
    // file matches — not on `atPath` — is what makes this case visible.
    const all = run({ folders: FOLDERS, shared: ['**/src/shared'] })
    expect(sharedFindings(all)[0]).toBeDefined()
    // And it really would have been a false red: the shared import is flagged.
    expect(edges(all)).toContain('uses-shared.ts -> util.ts')
  })

  it('reports each bad glob separately, so a mixed list is not hidden by a good one', () => {
    // One working glob plus one dead: the working one must not mask the other,
    // and the good one must not be reported.
    const findings = sharedFindings(
      run({ folders: FOLDERS, shared: ['**/src/shared/**', '**/no-such-dir/**'] }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.message).toContain('**/no-such-dir/**')
    expect(findings[0]?.message).not.toContain('**/src/shared/**')
  })
})
