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
import { correspondence } from '../../src/builders/correspondence-builder.js'
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

  it('the OTHER family too: correspondence, whose sides declare independently', () => {
    // `RuleBuilder` and `CorrespondenceBuilder` had the same early return, and
    // fixing one would have been the "covers the families someone remembered"
    // shape ADR-009 names. Measured before the fix: 2 real
    // `has no matching` findings became 0 the moment a side was falsely declared.
    //
    // The asymmetry that stays: a side that is GENUINELY empty still
    // short-circuits, because an empty side makes the comparison vacuous. Only a
    // declared-empty side that FILLED keeps going — there, both sides have
    // content and the correspondence is perfectly computable.
    const p = inMemory({ '/src/one.ts': 'export const one = 1\n' })
    const messages = correspondence(p)
      // `files` has a key `registry` lacks, so `beComplete()` has a real finding
      // to make — and `files` is plainly not empty, so declaring it is FALSE.
      .side('files', ['one', 'two'])
      .side('registry', ['one'])
      .expectEmpty('files')
      .beComplete()
      .violations()
      .map((v) => v.message)
    expect(messages[0]).toContain('was declared empty')
    expect(messages.join('\n')).toContain('has no matching registry')
  })

  it('survives dedupeConfigFindings — the pipeline a user actually runs', () => {
    // Every other row here asserts at `.violations()`, which is the one path that
    // SKIPS dedupe. Both real consumers dedupe (`check-all.ts`, `cli/check.ts`),
    // and a one-word change to `element` routed this finding into the collapse:
    // with `file: ''` and the rule id in both remaining key slots, N fanned-out
    // instances became one — and the survivor picked up `affectedNote`'s "this one
    // option generated N rules that cannot enforce anything", which is FALSE here
    // and false precisely because of the no-swallow fix: those rules enforce, and
    // their violations print underneath. Measured 4 → 3 before the fix.
    const p = inMemory({
      '/src/routes/d.ts': "import { x } from 'lodash'\nvoid x\n",
      '/src/routes/e.ts': "import { y } from 'knex'\nvoid y\n",
      '/src/domain/f.ts': 'export const f = 1\n',
    })
    const raw = layeredArchitecture(p, {
      layers: { routes: '**/routes/**', domain: '**/domain/**' },
      // Two packages → two rules under one id, BOTH genuinely violated.
      restrictedPackages: { '**/domain/**': ['lodash'], '**/nowhere/**': ['knex'] },
      expectEmpty: ['preset/layered/restricted-packages'],
    }).flatMap((r) => r.violations())
    const deduped = dedupeConfigFindings(raw)

    expect(deduped).toHaveLength(raw.length)
    // And the false note never appears on a declaration finding.
    expect(deduped.map((v) => v.message ?? '').join('\n')).not.toContain('cannot enforce anything')
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
    expect(v?.suggestion ?? '').toContain('separate findings under the same rule id')
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
    expect(v?.message ?? '').toContain('examined 0 subjects')
    expect(v?.suggestion ?? '').toContain("expectEmpty: ['preset/recommended/no-eval']")
  })
})
