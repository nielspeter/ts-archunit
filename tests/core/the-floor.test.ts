/**
 * The floor no family can be born below — plan 0099.
 *
 * After 0098 every family reports what it examined and `diagnose()` previews the
 * ones that examined nothing. Neither failed. A rule whose glob matched nothing,
 * whose filters excluded everything, or whose corpus never loaded still returned
 * green from `check()`, and the suite counted it as coverage — the statement
 * ADR-008 opens with, and the reason
 * [bug 0066](../../bugs/fixed/0066-a-smell-detector-over-zero-files-passes.md) reported
 * 401 findings as clean.
 *
 * The floor lives at the ROOT (`TerminalBuilder.collectWithAssertionGuard`), not
 * in each family, because a per-family guard is one you can forget to add — and
 * four waves of guards were each followed by a family outside their enumeration.
 */
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import type { ArchProject } from '../../src/core/project.js'
import type { ArchViolation } from '../../src/core/violation.js'
import { project } from '../../src/core/project.js'
import { functions } from '../../src/builders/function-rule-builder.js'
import { classes } from '../../src/builders/class-rule-builder.js'
import { functionNoEval } from '../../src/rules/security.js'
import { smells } from '../../src/smells/index.js'
import { call } from '../../src/helpers/matchers.js'
import { agentGuardrails } from '../../src/presets/agent-guardrails.js'
import { dataLayerIsolation } from '../../src/presets/data-layer.js'
import { schemaFromSDL } from '../../src/graphql/index.js'
import { ArchRuleError } from '../../src/core/errors.js'
import { diagnose } from '../../src/core/diagnose.js'
import { dedupeConfigFindings } from '../../src/core/dedupe-config-findings.js'

function inMemory(files: Record<string, string>): ArchProject {
  const tsm = new Project({ useInMemoryFileSystem: true })
  for (const [name, text] of Object.entries(files)) tsm.createSourceFile(name, text)
  return {
    tsConfigPath: '/tsconfig.json',
    _project: tsm,
    getSourceFiles: () => tsm.getSourceFiles(),
  }
}

/** A real file the glob MATCHES which declares no functions — live glob, zero subjects. */
const POPULATED = { '/src/types-only.ts': 'export type A = { n: number }\nexport const a = 1\n' }

const configFindings = (vs: readonly ArchViolation[]): ArchViolation[] =>
  vs.filter((v) => v.bypassFilters === true)

describe('a rule that examines zero units fails', () => {
  /**
   * WHICH FAMILY ACTUALLY REACHES THE FLOOR, and why most of these rows do not.
   *
   * Review measured that 11 of this file's first 13 rows passed against `main`,
   * and that removing the floor produced ONE novel failure across 3295 tests. The
   * cause is routing, and it is by design:
   *
   * - a rule-builder rule with a GLOB predicate is intercepted earlier by
   *   `deadSelectorFindings()`;
   * - a rule-builder rule WITHOUT a glob produces its own `emptySelectionViolation`
   *   inside `collectViolations()`, so `violations.length !== 0` and the floor's
   *   branch is skipped — "a family that produced any finding passes through
   *   untouched" is the plan's first ruling.
   *
   * So the floor's own subjects are the families with NO empty-selection block of
   * their own: smells and graphql. Rows that exercise the rule-builder family are
   * kept because they assert the SHARED TEXT reaches it, but they are labelled so
   * nobody reads them as floor coverage. `dead-selector-fails.test.ts` guards that
   * family's own block.
   */
  it('the smell family — bug 0066, and the row the floor lives or dies by', () => {
    // `duplicateBodies` over a corpus its own filters emptied. Measured on the
    // real corpus before the fix: 401 findings reported as clean. This family has
    // no empty-selection block, so this genuinely reaches the floor.
    //
    // IDENTITY, not a count: `toHaveLength(1)` accepts any single config finding,
    // and this repo's own `scan-cardinality-assertions` ratchet names that trap —
    // "a dead selector also yields exactly ONE violation".
    const p = inMemory({ '/src/a.ts': 'export const a = 1\n' })
    const vs = smells
      .duplicateBodies(p)
      .minLines(500)
      .rule({ id: 'x/no-dup', because: 'b', suggestion: 's' })
      .violations()
    const config = configFindings(vs)
    expect(config).toHaveLength(1)
    expect(config[0]?.message).toContain('examined 0 function bodies')
    // Not the dead-glob diagnosis, and not the empty-project one: this corpus
    // loaded a file and the glob is live. Without these the row passes on three
    // different faults.
    expect(config[0]?.message).not.toContain('can never match')
    expect(config[0]?.message).not.toContain('loaded 0 source files')
    // The cause is named, per ADR-009 part 4 — `minLines` is a default the author
    // never wrote, and neither preset exposes a knob for it.
    expect(config[0]?.message).toContain('minLines(500)')
  })

  it('the graphql family — the second family with no block of its own', () => {
    const vs = schemaFromSDL('type Query { a: String }')
      .that()
      .typesNamed(/^ZZZNoSuchType$/)
      .should()
      .haveFields()
      .rule({ id: 'x/gql', because: 'b', suggestion: 's' })
      .violations()
    const config = configFindings(vs)
    expect(config).toHaveLength(1)
    expect(config[0]?.message).toContain('examined 0')
  })

  it('through check() — the floor must not live in one terminal only', () => {
    // Routed through the SMELL family deliberately: through the rule-builder
    // family this row passes with the floor removed entirely.
    const p = inMemory({ '/src/a.ts': 'export const a = 1\n' })
    const rule = () =>
      smells
        .duplicateBodies(p)
        .minLines(500)
        .rule({ id: 'x/no-dup', because: 'b', suggestion: 's' })
        .check()
    expect(rule).toThrow(ArchRuleError)
  })

  it('through .warn() too — bypassFilters refuses the downgrade', () => {
    // `'warn'` stops meaning "never fails the build" for THIS input class, and
    // that break is deliberate: a rule that enforces nothing is not a violation
    // you triage, it is a rule that does not work.
    const p = inMemory({ '/src/a.ts': 'export const a = 1\n' })
    const rule = () =>
      smells
        .duplicateBodies(p)
        .minLines(500)
        .rule({ id: 'x/no-dup', because: 'b', suggestion: 's' })
        .warn()
    expect(rule).toThrow(ArchRuleError)
  })

  it('the rule-builder family gets the SHARED text (not floor coverage — see above)', () => {
    const p = inMemory(POPULATED)
    const vs = functions(p)
      .that()
      .resideInFile('**/types-only.ts')
      .should()
      .satisfy(functionNoEval())
      .rule({ id: 'x/no-eval', because: 'b', suggestion: 's' })
      .violations()
    const config = configFindings(vs)
    expect(config).toHaveLength(1)
    // One text for one state: the family's own block delegates here.
    expect(config[0]?.message).toContain('examined 0 subjects')
  })
})

describe('what the floor does NOT fire on', () => {
  it('a rule that produced a finding passes through untouched', () => {
    const p = inMemory({ '/src/a.ts': 'export function f() { eval("1") }\n' })
    const vs = functions(p)
      .that()
      .resideInFile('**/src/**')
      .should()
      .satisfy(functionNoEval())
      .rule({ id: 'x/no-eval', because: 'b', suggestion: 's' })
      .violations()
    expect(configFindings(vs)).toEqual([])
    // Identity: the surviving finding is the rule's OWN violation, not a config
    // finding that happened to count to one.
    expect(vs).toHaveLength(1)
    expect(vs[0]?.message).toContain('eval')
  })

  it('a cardinality assertion — .notExist() examines zero BECAUSE that is the assertion', () => {
    // The 0.34.0 carve-out, asserted across the flip. `diagnose()` exempts this
    // too; if the two disagree, `doctor` reports a working rule as broken.
    const p = inMemory(POPULATED)
    const vs = classes(p)
      .that()
      .haveNameMatching(/^Nope$/)
      .should()
      .notExist()
      .violations()
    expect(vs).toEqual([])
  })

  it('a declared-empty rule over a genuinely empty selection', () => {
    const p = inMemory(POPULATED)
    const vs = functions(p)
      .that()
      .resideInFile('**/types-only.ts')
      .should()
      .satisfy(functionNoEval())
      .rule({ id: 'x/no-eval', because: 'b', suggestion: 's' })
      .expectEmpty()
      .violations()
    expect(vs).toEqual([])
  })
})

describe('precedence: an empty project outranks every declaration', () => {
  const emptyProject = (): ArchProject =>
    project(
      path.resolve(import.meta.dirname, '../matrix/fixtures/empty/tsconfig.json'),
    ) as unknown as ArchProject

  const messageOf = (vs: readonly ArchViolation[]): string =>
    vs.map((v) => v.message ?? '').join('\n')

  it('empty project + .expectEmpty() still reports the PROJECT, never the declaration', () => {
    // A declaration asserts a fact about a loaded corpus; over zero loaded files
    // it asserts nothing, and the expiry that justifies it can never engage. So a
    // one-line `.expectEmpty()` on a solution-style tsconfig would otherwise
    // restore bug 0066's 401-findings-reported-clean permanently, through the
    // sanctioned door.
    const vs = functions(emptyProject())
      .that()
      .resideInFile('**/src/**')
      .should()
      .satisfy(functionNoEval())
      .rule({ id: 'x/no-eval', because: 'b', suggestion: 's' })
      .expectEmpty()
      .violations()
    expect(configFindings(vs)).toHaveLength(1)
    expect(messageOf(vs)).toContain('loaded 0 source files')
  })

  it('holds for a rule with NO glob — the path that bypassed the precedence', () => {
    // Review measured this: `deadSelectorFindings()` only catches a rule that
    // DECLARES a glob, and `rule-builder` called the shared producer directly, so
    // a glob-less rule over a zero-file project was told to "widen it, or declare
    // the empty state" — both impossible on that input.
    //
    // The row above passes through `resideInFile()`, so it never exercised this
    // path. Asked ADR-008 rule 5's question, it would pass with the instrument
    // precedence removed from the root entirely.
    const vs = functions(emptyProject())
      .that()
      .haveNameMatching(/^nothing$/)
      .should()
      .satisfy(functionNoEval())
      .rule({ id: 'x/no-eval', because: 'b', suggestion: 's' })
      .violations()
    expect(messageOf(vs)).toContain('loaded 0 source files')
    expect(messageOf(vs)).not.toContain('widen it')
  })

  it('through a family that REACHES the floor — the headline ruling, guarded', () => {
    // The two rows above use the rule-builder family, which never reaches the
    // floor's branch: it produces its own finding, or `deadSelectorFindings()`
    // intercepts. Measured — inverting the floor so a declaration outranks the
    // empty project was caught by NOTHING until this row existed.
    //
    // The smell family has no block of its own, so this is the path where the
    // ruling actually lives: over a corpus of zero loaded files a declaration
    // asserts nothing, the expiry that justifies it can never engage, and one
    // line of `.expectEmpty()` would otherwise restore bug 0066's
    // 401-findings-reported-clean permanently through the sanctioned door.
    const vs = smells
      .duplicateBodies(emptyProject())
      .rule({ id: 'x/no-dup', because: 'b', suggestion: 's' })
      .expectEmpty()
      .violations()
    const config = configFindings(vs)
    expect(config).toHaveLength(1)
    expect(config[0]?.message).toContain('loaded 0 source files')
    expect(messageOf(vs)).not.toContain('expectEmpty')
  })

  it('the empty-project remedy NEVER offers a declaration', () => {
    // ADR-008 rule 2 / ADR-009 part 4: three causes, three remedies, and naming
    // the declaration here would be a remedy that cannot remediate.
    const vs = functions(emptyProject())
      .that()
      .resideInFile('**/src/**')
      .should()
      .satisfy(functionNoEval())
      .rule({ id: 'x/no-eval', because: 'b', suggestion: 's' })
      .violations()
    expect(messageOf(vs)).not.toContain('expectEmpty')
  })
})

describe('the expiry half is the root’s alone', () => {
  const expired = () => {
    const p = inMemory({ '/src/a.ts': 'export function f() { eval("1") }\n' })
    return functions(p)
      .that()
      .resideInFile('**/src/**')
      .should()
      .satisfy(functionNoEval())
      .rule({ id: 'x/no-eval', because: 'b', suggestion: 's' })
      .expectEmpty()
      .violations()
  }

  it('exactly ONE expiry finding — not one per implementation', () => {
    // `rule-builder` carried its own copy; keeping both double-reported one fault.
    //
    // Identity as well as count: this repo's own cardinality ratchet flagged the
    // count-only form here, and it is right to — `toHaveLength(1)` accepts any
    // single configuration finding, including the zero-subjects one this rule
    // must NOT produce.
    const config = configFindings(expired())
    expect(config).toHaveLength(1)
    expect(config[0]?.message).toContain('asserted this rule examines nothing')
    expect(config[0]?.message).not.toContain('enforces nothing as written today')
  })

  it('and the rule’s own violations are still reported under it', () => {
    const vs = expired()
    expect(vs.filter((v) => v.bypassFilters !== true).length).toBeGreaterThan(0)
    expect(vs[0]?.bypassFilters).toBe(true)
  })

  it('the remedy REMEDIATES: removing the declaration clears the finding', () => {
    // ADR-008 rule 2's behavioural corollary — apply the stated fix, assert it works.
    const p = inMemory({ '/src/a.ts': 'export function f() { eval("1") }\n' })
    const without = functions(p)
      .that()
      .resideInFile('**/src/**')
      .should()
      .satisfy(functionNoEval())
      .rule({ id: 'x/no-eval', because: 'b', suggestion: 's' })
      .violations()
    expect(configFindings(without)).toEqual([])
  })

  it('the Fix line is distinct from the message, so format.ts does not drop it', () => {
    const v = configFindings(expired())[0]
    expect(v?.suggestion).not.toBe(v?.message)
  })
})

describe('diagnose() and check() agree — the row that keeps the preview honest', () => {
  // 0096 shipped the preview saying "a later release makes this state fail at
  // check time". This is that release, and `docs/upgrading.md` tells people to
  // run `doctor` first and fix what it reports. Measured before the seam: the
  // gate said "a declaration is an assertion, not a silencer" while the preview
  // still said "the declaration is not itself checked yet ... A later release
  // makes this state fail" — contradicting advice for one rule, on the surface
  // the upgrade path walks.
  const zeroSubjectRule = () =>
    smells
      .duplicateBodies(inMemory({ '/src/a.ts': 'export const a = 1\n' }))
      .minLines(500)
      .rule({ id: 'x/no-dup', because: 'b', suggestion: 's' })

  it('the preview reports the same input the gate fails on', () => {
    const findings = diagnose([zeroSubjectRule()])
    expect(findings.map((f) => f.kind)).toContain('zero-subjects')
    expect(configFindings(zeroSubjectRule().violations())).toHaveLength(1)
  })

  it('and it reports the SAME SENTENCE, by construction rather than by luck', () => {
    const preview = diagnose([zeroSubjectRule()]).find((f) => f.kind === 'zero-subjects')
    const gate = configFindings(zeroSubjectRule().violations())[0]
    expect(preview?.advice).toBeDefined()
    // The gate appends the unsuppressable notice; the advice itself must match.
    expect(gate?.message).toContain(preview?.advice ?? '__absent__')
  })

  it('the preview never promises a LATER release does this — this is that release', () => {
    const preview = diagnose([zeroSubjectRule()]).find((f) => f.kind === 'zero-subjects')
    expect(preview?.advice ?? '').not.toContain('later release')
    expect(preview?.advice ?? '').not.toContain('not itself checked yet')
    expect(preview?.advice ?? '').not.toContain('can never fail')
  })

  it('CONTROL: a rule that examines something is silent on BOTH surfaces', () => {
    const p = inMemory({ '/src/a.ts': 'export function f() { eval("1") }\n' })
    const rule = functions(p)
      .that()
      .resideInFile('**/src/**')
      .should()
      .satisfy(functionNoEval())
      .rule({ id: 'x/no-eval', because: 'b', suggestion: 's' })
    expect(diagnose([rule]).map((f) => f.kind)).not.toContain('zero-subjects')
    expect(configFindings(rule.violations())).toEqual([])
  })
})

describe('distinct rules stay distinct through dedupe', () => {
  // Plan 0099 made an over-filtered detector FAIL, and `dedupeConfigFindings`
  // keys on `(file, ruleId ?? rule, element)`. A family that never overrides
  // `describeRule()` returns the SENTINEL `'unnamed'`, so with `file: ''` three
  // genuinely different detectors produced one identical key.
  //
  // Measured before the fix: three `duplicateBodies` builders with different
  // similarity and filters collapsed to ONE finding reading `Rule: unnamed` and
  // claiming "this one option generated 3 rules ... they are one edit". Two were
  // silently discarded, and both clauses were false — the user wrote no option,
  // and three rules are three edits. `dedupe-config-findings.ts` says exactly
  // that: "two findings, because they are two edits".
  const dupFixture = path.resolve(import.meta.dirname, '../fixtures/smells/duplicate-bodies')

  it('three different smell detectors are three findings, not one', () => {
    const p = project(path.join(dupFixture, 'tsconfig.json'))
    const raw = [
      // Differ by the fields `describe()` did NOT render. The first version of
      // this row differed by `withMinSimilarity`, which was the one field it did
      // — so the guard fired against the sentinel and could not fire against the
      // class the sentinel was an instance of. Rule 5 answered from memory rather
      // than from the diff.
      ...smells.duplicateBodies(p).minLines(500).violations(),
      ...smells.duplicateBodies(p).minLines(400).violations(),
      ...smells.duplicateBodies(p).minLines(300).ignoreTests().violations(),
    ]
    expect(raw).toHaveLength(3)
    // Identity, not a count: three findings that all read the same thing would
    // satisfy a length of 3 while still telling the reader nothing.
    const names = dedupeConfigFindings(raw).map((v) => v.rule)
    expect(new Set(names).size).toBe(3)
    expect(names.join('\n')).toContain('minLines >= 500')
    expect(names.join('\n')).toContain('minLines >= 400')
    expect(names.join('\n')).toContain('ignoring tests')
  })

  it('and none of them is named by the sentinel', () => {
    // `Rule: unnamed` gives the reader nothing to open. The identity half of the
    // fix — the dedupe guard alone would keep three findings that all read
    // "unnamed".
    const p = project(path.join(dupFixture, 'tsconfig.json'))
    const vs = smells.duplicateBodies(p).minLines(500).withMinSimilarity(0.9).violations()
    expect(vs[0]?.rule).not.toBe('unnamed')
    expect(vs[0]?.rule ?? '').toContain('duplicate')
  })

  it('CONTROL: genuinely identical findings still collapse', () => {
    // Without this the fix could be "never dedupe anything", which would undo
    // what the dedupe exists for.
    const p = project(path.join(dupFixture, 'tsconfig.json'))
    const one = () => smells.duplicateBodies(p).minLines(500).violations()
    const collapsed = dedupeConfigFindings([...one(), ...one()])
    expect(collapsed).toHaveLength(1)
    expect(collapsed[0]?.rule).toContain('duplicate')
  })
})

describe('the message names the right unit, in the right number', () => {
  // `CollectResult.examined` is unit-typed per family (ADR-009 part 1). A message
  // that prints one family's noun for another is a category error in the sentence
  // whose whole job is naming what was and was not looked at — and the seam
  // existed with only ONE family implementing it, so graphql, cross-layer and
  // correspondence all printed "subjects".
  it('each family names its own unit', () => {
    const p = inMemory({ '/src/a.ts': 'export const a = 1\n' })
    const smell = smells.duplicateBodies(p).minLines(500).violations()[0]
    expect(smell?.message).toContain('0 function bodies')

    const gql = schemaFromSDL('type Query { a: String }')
      .that()
      .typesNamed(/^ZZZ$/)
      .should()
      .haveFields()
      .violations()[0]
    expect(gql?.message).toContain('0 schema types')
    // The bug this replaces: every family inherited the base noun.
    expect(gql?.message).not.toContain('0 subjects')

    // The three the first version of this row left unpinned — deleting any of
    // their overrides kept the whole suite green, measured. The plan's own
    // framing names exactly these as the families that printed "subjects".
    const sib = smells
      .inconsistentSiblings(p)
      .forPattern(call('this.nothing'))
      .minLines(999)
      .violations()[0]
    expect(sib?.message).toContain('0 sibling files')
    // It inherited "function bodies" while counting FILES — the category error
    // this seam exists to remove, in the family sitting under the override.
    expect(sib?.message).not.toContain('function bodies')
  })

  it('singular when there is one of it — the likeliest expiry case', () => {
    // A declaration expires the day the FIRST thing appears, so "examined 1
    // subjects" is the sentence a reader is likeliest to meet.
    const p = inMemory({ '/src/a.ts': 'export function f() { eval("1") }\n' })
    const v = functions(p)
      .that()
      .resideInFile('**/src/**')
      .should()
      .satisfy(functionNoEval())
      .rule({ id: 'x/no-eval', because: 'b', suggestion: 's' })
      .expectEmpty()
      .violations()
      .find((x) => x.bypassFilters === true)
    expect(v?.message).toContain('examined 1 subject.')
    expect(v?.message).not.toContain('1 subjects')
  })

  it('does not ASSERT that narrowing removed something it cannot verify', () => {
    // `narrowingHint()` promises the caller "names the possibility rather than
    // asserting a cause it cannot verify". On a corpus that never contained a
    // unit of this family's kind, nothing was removed.
    const p = inMemory({ '/src/types-only.ts': 'export type A = { n: number }\n' })
    const v = functions(p)
      .that()
      .resideInFile('**/types-only.ts')
      .should()
      .satisfy(functionNoEval())
      .rule({ id: 'x/no-eval', because: 'b', suggestion: 's' })
      .violations()[0]
    expect(v?.message).toContain('may have removed')
    expect(v?.message).not.toContain('narrowing removed them —')
  })

  it('diagnose() carries no second copy of the advice', () => {
    // The seam exists because two texts for one state is the plan-0070 drift
    // shape. A fallback literal is that second text, one level down — it was
    // already diverging (no unit noun, no file count, no narrowing hint).
    const p = inMemory({ '/src/a.ts': 'export const a = 1\n' })
    const rule = smells.duplicateBodies(p).minLines(500).rule({ id: 'x/d', because: 'b' })
    const preview = diagnose([rule]).find((f) => f.kind === 'zero-subjects')
    const gate = configFindings(rule.violations())[0]
    expect(preview?.advice).toBeDefined()
    expect(gate?.message).toContain(preview?.advice ?? '__absent__')
  })
})

describe('advice is attached only to the finding it can settle', () => {
  it('a dead glob is NOT told to declare — there, off is the working exit', () => {
    // Measured before the fix: `.expectEmpty()` on a dead-glob rule changed
    // nothing, and the message still said "declare that instead" — steering the
    // reader off the only door that opens.
    const p = inMemory({ '/src/a.ts': 'export const a = 1\n' })
    const v = classes(p)
      .that()
      .resideInFile('**/nowhere-at-all/**')
      .should()
      .beExported()
      .rule({ id: 'x/dead', because: 'b', suggestion: 's' })
      .violations()[0]
    expect(v?.message ?? '').toContain('can never match')
    expect(v?.message ?? '').not.toContain('declare that instead')
  })

  it('a zero-examined rule IS — it is the one kind a declaration settles', () => {
    const p = inMemory({ '/src/a.ts': 'export const a = 1\n' })
    const v = smells.duplicateBodies(p).minLines(500).violations()[0]
    expect(v?.message ?? '').toContain('declare that instead')
  })
})

describe('the guards that landed on one carrier', () => {
  // Both rows below exist because a fix landed everywhere and its guard landed on
  // one of the carriers — the second-order pattern the architect measured twice.

  it('EVERY preset carrier states the reachable spelling, not just recommended', () => {
    // Measured: reverting the stamp in `collectRule` — the carrier for
    // strictBoundaries, layeredArchitecture and dataLayerIsolation, the three
    // whose rules are folder-glob-scoped and so likeliest to examine zero — left
    // 3315 tests green. Same for agent-guardrails. Only `recommended` was
    // guarded, and it is the one preset that does NOT use the shared carrier.
    //
    // Reverting sends those users to `.expectEmpty()`, a call a preset user holds
    // no builder to make: bug 0089's exact shape, on an unsuppressable failure.
    const p = inMemory({ '/src/types-only.ts': 'export type A = { n: number }\n' })

    // collectRule carrier — a LIVE glob with zero subjects. A dead glob gets the
    // discovery diagnosis instead, which never reaches the floor.
    const data = dataLayerIsolation(p, {
      repositories: '**/types-only.ts',
      baseClass: 'BaseRepository',
    })
      .flatMap((r) => r.violations())
      .filter((v) => v.bypassFilters === true)
    expect(data.length).toBeGreaterThan(0)
    expect(data.map((v) => v.message ?? '').join('\n')).toContain("in this preset's options")

    // agent-guardrails' own push helper
    const agent = agentGuardrails(p, { src: '**/types-only.ts', noEmptyBodies: true })
      .flatMap((r) => r.violations())
      .filter((v) => v.bypassFilters === true)
    expect(agent.length).toBeGreaterThan(0)
    expect(agent.map((v) => v.message ?? '').join('\n')).toContain("in this preset's options")
  })

  it('the smell hint does not claim a cause on a corpus that never had bodies', () => {
    // The row above this one routes through `functions()`, where narrowingHint()
    // returns undefined — so it guarded the BASE fallback, not the family that
    // produces the hint. Break the smell hint completely and it still passed.
    //
    // Types-only corpus with the DEFAULT threshold: zero function bodies existed,
    // so minLines removed nothing.
    const p = inMemory({ '/src/types-only.ts': 'export type A = { n: number }\n' })
    const v = smells.duplicateBodies(p).violations()[0]
    expect(v?.message ?? '').toContain('examined 0 function bodies')
    expect(v?.message ?? '').toContain('minLines(5)')
    // Stated as fact, never as the cause.
    expect(v?.message ?? '').not.toContain('narrowing removed them')
    // ...and it still discloses that the threshold is not the author's.
    expect(v?.message ?? '').toContain('did not write')
  })
})
