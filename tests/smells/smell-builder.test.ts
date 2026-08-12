import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'
import { project } from '../../src/core/project.js'
import { smells } from '../../src/smells/index.js'
import { call } from '../../src/helpers/matchers.js'
import { ArchRuleError } from '../../src/core/errors.js'

const dupFixturesDir = path.resolve(import.meta.dirname, '../fixtures/smells/duplicate-bodies')
const sibFixturesDir = path.resolve(import.meta.dirname, '../fixtures/smells/inconsistent-siblings')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SmellBuilder.ignoreTests()', () => {
  it('ignoreTests on duplicateBodies does not crash', () => {
    const p = project(path.join(dupFixturesDir, 'tsconfig.json'))
    const builder = smells.duplicateBodies(p).minLines(3).withMinSimilarity(0.8).ignoreTests()
    // The fixture dir has no test files so ignoreTests is a no-op but should not error
    expect(() => builder.check()).toThrow(ArchRuleError)
  })

  it('ignoreTests on inconsistentSiblings does not crash', () => {
    const p = project(path.join(sibFixturesDir, 'tsconfig.json'))
    const builder = smells
      .inconsistentSiblings(p)
      .forPattern(call('this.extractCount'))
      .minLines(2)
      .ignoreTests()
    expect(() => builder.check()).toThrow(ArchRuleError)
  })
})

describe('SmellBuilder.ignorePaths()', () => {
  it('ignorePaths excludes matching files from duplicateBodies', () => {
    const p = project(path.join(dupFixturesDir, 'tsconfig.json'))
    // Ignore a SUBSET, not `**/*.ts`. Plan 0099 makes an emptied corpus fail, so
    // the old shape (`ignorePaths('**/*.ts')` then `.not.toThrow()`) would now
    // pass whether `ignorePaths` works or is a no-op — the floor fires either
    // way. Ignoring one file of the duplicate pair is what still proves the
    // filter does something: the duplicate disappears while subjects remain.
    const withoutFilter = smells.duplicateBodies(p).minLines(3).withMinSimilarity(0.8)
    expect(withoutFilter.violations().length).toBeGreaterThan(0)

    const builder = smells
      .duplicateBodies(p)
      .minLines(3)
      .withMinSimilarity(0.8)
      .ignorePaths('**/file-b.ts')
    // The duplicate is gone...
    expect(builder.violations().filter((v) => v.bypassFilters !== true)).toEqual([])
    // ...and the rule still examined something, so this is the filter working
    // rather than the corpus being emptied.
    expect(builder.examinedUnits()).toBeGreaterThan(0)
    expect(builder.violations().filter((v) => v.bypassFilters === true)).toEqual([])
  })

  it('ignorePaths that empties the corpus FAILS — plan 0099', () => {
    // The old shape, kept as its own row so the behaviour is stated rather than
    // lost. This is bug 0066: a filter that removes everything used to pass.
    const p = project(path.join(dupFixturesDir, 'tsconfig.json'))
    const builder = smells
      .duplicateBodies(p)
      .minLines(3)
      .withMinSimilarity(0.8)
      .ignorePaths('**/*.ts')
    expect(() => builder.check()).toThrow(ArchRuleError)
    expect(builder.violations()[0]?.message).toContain('examined 0 function bodies')
  })

  it('ignorePaths excludes matching files from inconsistentSiblings', () => {
    const p = project(path.join(sibFixturesDir, 'tsconfig.json'))
    const builder = smells
      .inconsistentSiblings(p)
      .forPattern(call('this.extractCount'))
      .minLines(2)
      // Both files that don't call extractCount — plan 0102 added
      // archive-repo.ts alongside legacy-repo.ts (a second parseInt caller, so
      // that pattern is 2-of-5 rather than 1-of-4). Ignoring only legacy-repo.ts
      // would leave archive-repo.ts as a new odd-one-out.
      .ignorePaths('**/legacy-repo.ts', '**/archive-repo.ts')
    // A SUBSET again: the inconsistent siblings are the ignored files, so the
    // finding disappears while the other repositories are still examined.
    expect(builder.violations().filter((v) => v.bypassFilters !== true)).toEqual([])
    expect(builder.examinedUnits()).toBeGreaterThan(0)
    expect(builder.violations().filter((v) => v.bypassFilters === true)).toEqual([])
  })

  it('ignorePaths can be called multiple times', () => {
    const p = project(path.join(dupFixturesDir, 'tsconfig.json'))
    const builder = smells
      .duplicateBodies(p)
      .minLines(3)
      .withMinSimilarity(0.8)
      .ignorePaths('**/nonexistent/**')
      .ignorePaths('**/also-nonexistent/**')
    // No paths match so original violations still apply
    expect(() => builder.check()).toThrow(ArchRuleError)
  })
})

describe('SmellBuilder.inFolder()', () => {
  it('a LIVE inFolder glob scopes without complaint', () => {
    // Rewritten against a REAL but narrower folder. This asserted
    // `inFolder('**/nonexistent/**')` did `not.toThrow()`, with the comment "No
    // files in nonexistent folder, so no violations" — which is the ∀-over-∅
    // pass stated as the expectation. A detector scoped to nothing detects
    // nothing, and the test called that success.
    //
    // A dead folder glob is now a configuration finding (plan 0080), so the
    // scoping property needs a live folder to be about anything.
    const p = project(path.join(dupFixturesDir, 'tsconfig.json'))
    const all = smells.duplicateBodies(p).minLines(3).withMinSimilarity(0.8).violations()
    expect(all.length).toBeGreaterThan(0)

    // A LIVE folder glob: no configuration finding, and the duplicates still
    // found. `**/duplicate-bodies/**` is the fixture's own directory — it has no
    // subfolders, so a genuinely *narrower* live glob is not available here, and
    // the scoping-to-a-subset property is asserted in `inconsistent-siblings`
    // where the fixture has one. Said rather than faked with a dead glob, which
    // is what this test used to do.
    const scoped = smells
      .duplicateBodies(p)
      .minLines(3)
      .withMinSimilarity(0.8)
      .inFolder('**/duplicate-bodies/**')
      .violations()
    expect(scoped.every((v) => v.bypassFilters !== true)).toBe(true)
    expect(scoped.length).toBe(all.length)
  })

  it('a folder glob matching NOTHING is a finding, not a quiet pass', () => {
    // The other half of the rewrite above, and the actual fix.
    const p = project(path.join(dupFixturesDir, 'tsconfig.json'))
    const violations = smells
      .duplicateBodies(p)
      .minLines(3)
      .withMinSimilarity(0.8)
      .inFolder('**/nonexistent/**')
      .violations()
    expect(violations.filter((v) => v.bypassFilters === true).length).toBeGreaterThan(0)
  })
})

describe('SmellBuilder.warn() output formats', () => {
  it('warn with json format outputs JSON', () => {
    const p = project(path.join(dupFixturesDir, 'tsconfig.json'))
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    smells.duplicateBodies(p).minLines(3).withMinSimilarity(0.8).warn({ format: 'json' })
    expect(warnSpy).toHaveBeenCalled()
    // JSON output should start with [ or { or be valid JSON
    const output = String(warnSpy.mock.calls[0]?.[0] ?? '')
    expect(output.startsWith('[') || output.startsWith('{')).toBe(true)
  })

  it('warn with github format writes to stdout', () => {
    const p = project(path.join(dupFixturesDir, 'tsconfig.json'))
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    smells.duplicateBodies(p).minLines(3).withMinSimilarity(0.8).warn({ format: 'github' })
    expect(writeSpy).toHaveBeenCalled()
    const output = String(writeSpy.mock.calls[0]?.[0] ?? '')
    expect(output).toContain('::warning')
  })

  it('warn with terminal format outputs to console.warn', () => {
    const p = project(path.join(dupFixturesDir, 'tsconfig.json'))
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    smells.duplicateBodies(p).minLines(3).withMinSimilarity(0.8).warn({ format: 'terminal' })
    expect(warnSpy).toHaveBeenCalled()
  })

  it('warn does nothing when there is genuinely nothing to report', () => {
    // The corpus here used to be `minLines(1000)` — which is not CLEAN, it is
    // VACUOUS, and plan 0099 makes that fail. Flipping this row to expect a throw
    // would have deleted the only assertion that `.warn()` is ever silent, so the
    // silence property keeps its row and gets a genuinely clean corpus:
    // similarity 1.0 finds no exact duplicates while still examining bodies.
    const p = project(path.join(dupFixturesDir, 'tsconfig.json'))
    const builder = smells.duplicateBodies(p).minLines(3).withMinSimilarity(1.0)
    expect(builder.examinedUnits()).toBeGreaterThan(0)
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    builder.warn()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('warn on a VACUOUS corpus is loud — it is not a clean run', () => {
    const p = project(path.join(dupFixturesDir, 'tsconfig.json'))
    expect(() => smells.duplicateBodies(p).minLines(1000).withMinSimilarity(0.5).warn()).toThrow(
      ArchRuleError,
    )
  })
})

describe('SmellBuilder.check() output formats', () => {
  it('check with github format writes annotations before throwing', () => {
    const p = project(path.join(dupFixturesDir, 'tsconfig.json'))
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    expect(() => {
      smells.duplicateBodies(p).minLines(3).withMinSimilarity(0.8).check({ format: 'github' })
    }).toThrow(ArchRuleError)
    expect(writeSpy).toHaveBeenCalled()
    const output = String(writeSpy.mock.calls[0]?.[0] ?? '')
    expect(output).toContain('::error')
  })
})
