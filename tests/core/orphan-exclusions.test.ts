/**
 * An exclusion comment naming a rule nobody declares is reported —
 * [bug 0044](../../bugs/fixed/0044-an-inline-exclusion-comment-has-no-feedback-channel.md).
 *
 * `.excluding()` warns when a pattern matches nothing. An inline comment cannot
 * get that on the enforcement path: comments are read only in files that already
 * produced a violation for that rule, so a directive naming a renamed rule is
 * never even parsed. Rename a rule and every comment naming the old id goes
 * inert — silently, permanently.
 *
 * v0.37.0 disclosed what a comment *did* suppress. This is the other direction:
 * a comment that suppresses nothing.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Project } from 'ts-morph'
import { modules } from '../../src/builders/module-rule-builder.js'
import { orphanExclusions } from '../../src/core/orphan-exclusions.js'
import type { ArchProject } from '../../src/core/project.js'

let dir: string
let project: ArchProject

/** A rule declaring `id`, over every `.ts` file. */
function rule(id: string) {
  return modules(project)
    .that()
    .resideInFile('**/*.ts')
    .should()
    .notImportFrom('**/x/**')
    .rule({ id })
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-archunit-orphan-'))
  fs.mkdirSync(path.join(dir, 'src'))
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ include: ['src'] }))
  fs.writeFileSync(
    path.join(dir, 'src/stale.ts'),
    '// ts-archunit-exclude arch/renamed-away: was valid before the rename\nexport const a = 1\n',
  )
  fs.writeFileSync(
    path.join(dir, 'src/live.ts'),
    '// ts-archunit-exclude arch/live: deliberate\nexport const b = 1\n',
  )
  fs.writeFileSync(path.join(dir, 'src/plain.ts'), 'export const c = 1\n')
  const tsConfigPath = path.join(dir, 'tsconfig.json')
  const p = new Project({ tsConfigFilePath: tsConfigPath })
  project = { tsConfigPath, _project: p, getSourceFiles: () => p.getSourceFiles() }
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('orphan exclusion comments are reported (bug 0044)', () => {
  it('VACUITY: the fixture really has both a stale and a live directive', () => {
    // Both rows below pass trivially if the fixture has only one kind of
    // comment, or none.
    const files = project.getSourceFiles().map((f) => path.basename(f.getFilePath()))
    expect(files).toContain('stale.ts')
    expect(files).toContain('live.ts')
  })

  it('names the stale one, by identity', () => {
    const found = orphanExclusions([rule('arch/live')])
    expect(found).toHaveLength(1)
    expect(found[0]?.ruleId).toBe('arch/renamed-away')
    expect(found[0]?.file.endsWith('stale.ts')).toBe(true)
    expect(found[0]?.line).toBe(1)
    // The remedy says both options and why nothing reported it before.
    expect(found[0]?.advice).toContain('no rule declares')
    expect(found[0]?.advice).toContain('delete the comment')
  })

  it('CONTROL: a declared id is not reported', () => {
    // Without this, "report every directive" passes the row above.
    const found = orphanExclusions([rule('arch/live'), rule('arch/renamed-away')])
    expect(found).toEqual([])
  })

  it('reports nothing when NO rule declares an id, rather than everything', () => {
    // A caller passing rules with no `.rule({ id })` has misconfigured this, not
    // discovered 100 orphans. Inline comments need an id to work at all, so a
    // wall of false orphans would be the fastest way to make this ignored.
    const idless = modules(project).that().resideInFile('**/*.ts').should().notImportFrom('**/x/**')
    expect(orphanExclusions([idless])).toEqual([])
  })

  it('a subset of rules produces FALSE orphans — the documented footgun', () => {
    // Pinned deliberately, because it is why this is not part of `diagnose()`:
    // `doctor` diagnoses one rule file at a time, and the declared-id set is the
    // union across all of them. Called with a subset, a directive naming a rule
    // from a sibling file looks orphaned. `doctor` calls this once, after the
    // load loop, with everything.
    const subsetOnly = orphanExclusions([rule('arch/renamed-away')])
    expect(subsetOnly.map((o) => o.ruleId)).toEqual(['arch/live'])
  })
})
