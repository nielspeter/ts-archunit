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

  it('when NO rule declares an id, reports ONE aggregate finding — not silence', () => {
    // This test asserted silence, and review was right that silence is the
    // ADR-008 rule 1 failure: without any declared id, **every** inline exclusion
    // in the project genuinely is inert (`isExcludedByComment` bails without a
    // `ruleId`, and the scan is gated on `ctx.metadata?.id`). So those are all
    // real orphans and the diagnostic said nothing about any of them.
    //
    // Reporting each is the other failure — a wall of findings for one authored
    // cause, which rule 4 calls a total standing in for an identity. One
    // aggregate finding is neither.
    const idless = modules(project).that().resideInFile('**/*.ts').should().notImportFrom('**/x/**')
    const found = orphanExclusions([idless])

    expect(found).toHaveLength(1)
    expect(found[0]?.advice).toContain('No rule declares an id')
    expect(found[0]?.advice).toContain('Reported once rather than per comment')
    // It still carries a location, so the reader has somewhere to start.
    expect(found[0]?.file).toBeTruthy()
  })

  it('…and nothing at all when there are no directives either', () => {
    // The vacuity control for the row above: the aggregate finding must be about
    // real comments, not fire on any project whose rules lack ids.
    const clean = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-archunit-orphan-clean-'))
    try {
      fs.mkdirSync(path.join(clean, 'src'))
      fs.writeFileSync(path.join(clean, 'tsconfig.json'), JSON.stringify({ include: ['src'] }))
      fs.writeFileSync(path.join(clean, 'src/a.ts'), 'export const a = 1\n')
      const tsConfigPath = path.join(clean, 'tsconfig.json')
      const cp = new Project({ tsConfigFilePath: tsConfigPath })
      const cproj: ArchProject = {
        tsConfigPath,
        _project: cp,
        getSourceFiles: () => cp.getSourceFiles(),
      }
      const idless = modules(cproj).that().resideInFile('**/*.ts').should().notImportFrom('**/x/**')
      expect(orphanExclusions([idless])).toEqual([])
    } finally {
      fs.rmSync(clean, { recursive: true, force: true })
    }
  })

  it('the scope caveat appears only when the caller admits a partial view', () => {
    // The rule-2 fix. `doctor a.rules.ts` sees a subset of a multi-file project,
    // so a directive naming a rule from another file looks orphaned — and the
    // advice used to say "delete the comment", which un-waives a real violation.
    const withScope = orphanExclusions([rule('arch/live')], { ruleFilesChecked: 1 })
    expect(withScope[0]?.advice).toContain('Checked against 1 rule file only')
    expect(withScope[0]?.advice).toContain('false positive')

    // Vouched-for full coverage: no caveat, or it would be noise on every run.
    const full = orphanExclusions([rule('arch/live')], {
      ruleFilesChecked: 2,
      ruleFilesTotal: 2,
    })
    expect(full[0]?.advice).not.toContain('Checked against')

    // Unknown scope: silent, because the caller did not claim anything.
    expect(orphanExclusions([rule('arch/live')])[0]?.advice).not.toContain('Checked against')
  })

  it('reports each distinct orphan, and does not collapse them', () => {
    // Sabotage found the dedupe key untested: reducing it to the rule id alone
    // collapsed the same stale id across every file to ONE report — under-
    // reporting, the direction that hides work.
    const many = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-archunit-orphan-many-'))
    try {
      fs.mkdirSync(path.join(many, 'src'))
      fs.writeFileSync(path.join(many, 'tsconfig.json'), JSON.stringify({ include: ['src'] }))
      // Same stale id in two files, and twice in one of them.
      fs.writeFileSync(
        path.join(many, 'src/one.ts'),
        '// ts-archunit-exclude arch/gone: a\nexport const a = 1\n' +
          '// ts-archunit-exclude arch/gone: b\nexport const b = 2\n',
      )
      fs.writeFileSync(
        path.join(many, 'src/two.ts'),
        '// ts-archunit-exclude arch/gone: c\nexport const c = 3\n',
      )
      const tsConfigPath = path.join(many, 'tsconfig.json')
      const mp = new Project({ tsConfigFilePath: tsConfigPath })
      const mproj: ArchProject = {
        tsConfigPath,
        _project: mp,
        getSourceFiles: () => mp.getSourceFiles(),
      }
      const r = modules(mproj)
        .that()
        .resideInFile('**/*.ts')
        .should()
        .notImportFrom('**/x/**')
        .rule({ id: 'arch/live' })
      const found = orphanExclusions([r])

      // Three distinct (id, file, line) identities, not one.
      expect(found).toHaveLength(3)
      expect(new Set(found.map((o) => `${o.file}:${String(o.line)}`)).size).toBe(3)
      // …and the line is the comment's own, not a constant.
      expect(found.map((o) => o.line).sort((a, b) => a - b)).toEqual([1, 1, 3])
    } finally {
      fs.rmSync(many, { recursive: true, force: true })
    }
  })

  it('works on an in-memory project — the read used to lose these silently', () => {
    // `fs.readFileSync` threw ENOENT for a virtual file and the catch ate it, so
    // an in-memory project reported nothing. `getFullText()` has no such failure
    // mode, and `orphanExclusions` is a published export.
    const mem = new Project({ useInMemoryFileSystem: true })
    mem.createSourceFile(
      '/src/a.ts',
      '// ts-archunit-exclude arch/gone: stale\nexport const a = 1\n',
    )
    const memProj: ArchProject = {
      tsConfigPath: 'in-memory',
      _project: mem,
      getSourceFiles: () => mem.getSourceFiles(),
    }
    const r = modules(memProj)
      .that()
      .resideInFile('**/*.ts')
      .should()
      .notImportFrom('**/x/**')
      .rule({ id: 'arch/live' })
    expect(orphanExclusions([r]).map((o) => o.ruleId)).toEqual(['arch/gone'])
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
