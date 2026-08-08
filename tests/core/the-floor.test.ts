/**
 * The floor no family can be born below — plan 0099.
 *
 * After 0098 every family reports what it examined and `diagnose()` previews the
 * ones that examined nothing. Neither failed. A rule whose glob matched nothing,
 * whose filters excluded everything, or whose corpus never loaded still returned
 * green from `check()`, and the suite counted it as coverage — the statement
 * ADR-008 opens with, and the reason
 * [bug 0066](../../bugs/0066-a-smell-detector-over-zero-files-passes.md) reported
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
import { schemaFromSDL } from '../../src/graphql/index.js'
import { ArchRuleError } from '../../src/core/errors.js'
import { diagnose } from '../../src/core/diagnose.js'

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
