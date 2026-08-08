/**
 * A false `.expectEmpty()` reports the declaration AND the violations under it.
 *
 * Found in review of plan 0089. `RuleBuilder.evaluate` returned early on a
 * declared-empty selection that turned out non-empty, so the rule's conditions
 * were never evaluated and every real violation was discarded.
 *
 * Harmless-looking while a declaration names one rule. Plan 0089's preset carrier
 * made it not: `boundaries` and `layered` construct some ids many times —
 * `restricted-packages` once per package, `no-cross-boundary` once per boundary —
 * and `expectEmpty` applies to every instance. Measured on a two-package config
 * where one selection was empty and one was not, a genuine
 * `imports "lodash" which matches forbidden [lodash]` disappeared and was replaced
 * by a config error. The user had made the run STRICTER and lost a finding.
 *
 * The rule fails either way, so reporting both can only add information — and the
 * one the reader must act on is the violation.
 */
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import type { ArchProject } from '../../src/core/project.js'
import { layeredArchitecture } from '../../src/presets/layered.js'
import { functions } from '../../src/builders/function-rule-builder.js'
import { functionNoEval } from '../../src/rules/security.js'

function inMemory(files: Record<string, string>): ArchProject {
  const tsm = new Project({ useInMemoryFileSystem: true })
  for (const [name, text] of Object.entries(files)) tsm.createSourceFile(name, text)
  return {
    tsConfigPath: '/tsconfig.json',
    _project: tsm,
    getSourceFiles: () => tsm.getSourceFiles(),
  }
}

describe('a false declaration does not swallow the findings under it', () => {
  it('the fan-out case that found it: one id, two rules, one of them non-empty', () => {
    const p = inMemory({
      '/src/routes/d.ts': "import { x } from 'lodash'\nvoid x\n",
      '/src/domain/e.ts': 'export const e = 1\n',
    })
    const opts = {
      layers: { routes: '**/routes/**', domain: '**/domain/**' },
      // Two packages → two `restricted-packages` rules under ONE id. The first
      // selection is empty (nothing resides in `**/nowhere/**`), the second is not.
      restrictedPackages: { '**/nowhere/**': ['knex'], '**/domain/**': ['lodash'] },
    }
    const all = layeredArchitecture(p, {
      ...opts,
      expectEmpty: ['preset/layered/restricted-packages'],
    }).flatMap((r) => r.violations())

    // The false declaration is reported — that is the assertion working.
    expect(all.some((v) => v.bypassFilters === true)).toBe(true)
    // And the real architecture violation is STILL THERE. This is the row that
    // fails if `evaluate` goes back to returning early.
    const real = all.filter((v) => v.bypassFilters !== true)
    expect(real.map((v) => v.message ?? '')).toContainEqual(
      expect.stringContaining('matches forbidden'),
    )
  })

  it('the declaration is reported FIRST — configuration before findings produced under it', () => {
    const p = inMemory({ '/src/a.ts': 'export function f() { eval("1") }\n' })
    const out = functions(p)
      .that()
      .resideInFile('**/src/**')
      .should()
      .satisfy(functionNoEval())
      .rule({ id: 'x/no-eval', because: 'b', suggestion: 's' })
      .expectEmpty()
      .violations()
    expect(out.length).toBeGreaterThan(1)
    expect(out[0]?.bypassFilters).toBe(true)
    expect(out.some((v) => v.bypassFilters !== true)).toBe(true)
  })
})

describe('the remedy names a call the reader can actually make', () => {
  const declaredNonEmpty = (id: string): { message: string; suggestion: string } => {
    const p = inMemory({ '/src/a.ts': 'export function f() { eval("1") }\n' })
    const v = functions(p)
      .that()
      .resideInFile('**/src/**')
      .should()
      .satisfy(functionNoEval())
      .rule({ id, because: 'b', suggestion: 's' })
      .expectEmpty()
      .violations()
      .find((x) => x.bypassFilters === true)
    return { message: v?.message ?? '', suggestion: v?.suggestion ?? '' }
  }

  it('a PRESET rule id is told the config spelling, never `.expectEmpty()`', () => {
    // The whole point: a preset user holds no builder, so `.expectEmpty()` is
    // unreachable to them — and the default terminal formatter prints the chain
    // description, never the id, so the argument they need was nowhere on screen.
    const { message, suggestion } = declaredNonEmpty('preset/recommended/no-eval')
    expect(message).toContain("expectEmpty: ['preset/recommended/no-eval']")
    expect(suggestion).toContain("expectEmpty: ['preset/recommended/no-eval']")
    expect(message).not.toContain('.expectEmpty()')
    expect(suggestion).not.toContain('.expectEmpty()')
  })

  it('a non-preset rule still gets the builder spelling', () => {
    const { message } = declaredNonEmpty('my/own/rule')
    expect(message).toContain('.expectEmpty()')
  })

  it('carries the rule id, and a Fix distinct from the message', () => {
    const p = inMemory({ '/src/a.ts': 'export function f() { eval("1") }\n' })
    const v = functions(p)
      .that()
      .resideInFile('**/src/**')
      .should()
      .satisfy(functionNoEval())
      .rule({ id: 'preset/recommended/no-eval', because: 'b', suggestion: 's' })
      .expectEmpty()
      .violations()
      .find((x) => x.bypassFilters === true)
    expect(v?.ruleId).toBe('preset/recommended/no-eval')
    // `format.ts` drops the `Fix:` line when suggestion === message, so this
    // finding shipped with no remedy at all.
    expect(v?.suggestion).not.toBe(v?.message)
    expect(v?.suggestion ?? '').toContain('reported below this finding')
  })

  it('the EMPTY-selection finding points at the reachable spelling too', () => {
    // A LIVE glob with a zero selection — the file exists and matches, it just
    // declares no functions. A dead glob (`**/nowhere/**`) produces the
    // can-never-match finding instead, which is a different diagnosis with its
    // own remedy and no declaration to offer.
    const p = inMemory({ '/src/types-only.ts': 'export type A = { n: number }\n' })
    const v = functions(p)
      .that()
      .resideInFile('**/types-only.ts')
      .should()
      .satisfy(functionNoEval())
      .rule({ id: 'preset/recommended/no-eval', because: 'b', suggestion: 's' })
      .violations()
      .find((x) => x.bypassFilters === true)
    expect(v?.message ?? '').toContain('matched 0 subjects')
    expect(v?.suggestion ?? '').toContain("expectEmpty: ['preset/recommended/no-eval']")
  })
})
