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
import { ArchRuleError } from '../../src/core/errors.js'

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
  it('the rule-builder family', () => {
    const p = inMemory(POPULATED)
    const vs = functions(p)
      .that()
      .resideInFile('**/types-only.ts')
      .should()
      .satisfy(functionNoEval())
      .rule({ id: 'x/no-eval', because: 'b', suggestion: 's' })
      .violations()
    expect(configFindings(vs)).toHaveLength(1)
    expect(vs[0]?.message).toContain('examined 0')
  })

  it('the smell family — bug 0066, the reason this plan exists', () => {
    // `duplicateBodies` over a corpus its own filters emptied. Measured on the
    // real corpus before the fix: 401 findings reported as clean.
    const p = inMemory({ '/src/a.ts': 'export const a = 1\n' })
    const vs = smells
      .duplicateBodies(p)
      .minLines(500)
      .rule({ id: 'x/no-dup', because: 'b', suggestion: 's' })
      .violations()
    expect(configFindings(vs)).toHaveLength(1)
  })

  it('through check() — not only through violations()', () => {
    // The mis-wiring this catches: the floor inside one terminal only.
    const p = inMemory(POPULATED)
    const rule = () =>
      functions(p)
        .that()
        .resideInFile('**/types-only.ts')
        .should()
        .satisfy(functionNoEval())
        .rule({ id: 'x/no-eval', because: 'b', suggestion: 's' })
        .check()
    expect(rule).toThrow(ArchRuleError)
  })

  it('through .warn() too — bypassFilters refuses the downgrade', () => {
    // `'warn'` stops meaning "never fails the build" for THIS input class, and
    // that break is deliberate: a rule that enforces nothing is not a violation
    // you triage, it is a rule that does not work.
    const p = inMemory(POPULATED)
    const rule = () =>
      functions(p)
        .that()
        .resideInFile('**/types-only.ts')
        .should()
        .satisfy(functionNoEval())
        .rule({ id: 'x/no-eval', because: 'b', suggestion: 's' })
        .warn()
    expect(rule).toThrow(ArchRuleError)
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
    expect(vs).toHaveLength(1)
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
    expect(configFindings(expired())).toHaveLength(1)
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
