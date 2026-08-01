/**
 * An exclusion comment works for every condition, not only the ones that stamp
 * `ruleId` — [bug 0041](../../bugs/0041-an-exclusion-comment-is-a-no-op-for-most-conditions.md).
 *
 * `isExcludedByComment` opens with `if (!violation.ruleId) return false`
 * (`exclusion-comments.ts:262`). `applyFilters` used to stamp `ruleId` from the
 * rule's metadata *after* running that filter, so a comment matched only
 * violations whose producing condition set the field itself. For the dependency,
 * exports, slice, reverse-dependency and module-body families it did not, and the
 * documented exemption was inert — silently, with no error and no warning.
 *
 * ## Why this test is shaped as an asymmetry
 *
 * The independent derivation (ADR-008 rule 5) is **the same source under two
 * builders**. `classes()` routes through `createViolation`, which stamps;
 * `modules().notImportFrom()` does not. Before the fix those two disagreed about
 * identical comment text; after it they agree. A test written against `classes()`
 * alone passes in both worlds, and a test written against `modules()` alone would
 * have been read as "exclusion comments are broken" rather than as an ordering
 * defect — it is the *disagreement* that names the bug.
 *
 * The suite's only end-to-end test of the feature
 * (`tests/helpers/exclusion-comments.test.ts:181`) uses `alwaysFail` from
 * `tests/support/test-rule-builder.ts`, which stamps `ruleId: context.ruleId`.
 * Test and code were written from the same understanding of where the id comes
 * from, so they agreed while the feature did not work — rule 5, on our own suite.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Project } from 'ts-morph'
import { modules } from '../../src/builders/module-rule-builder.js'
import { classes } from '../../src/builders/class-rule-builder.js'
import { call } from '../../src/helpers/matchers.js'
import { isExcludedByComment } from '../../src/core/exclusion-comments.js'
import type { ArchProject } from '../../src/core/project.js'

const RULE_ID = 'probe/no-forbidden'
const CLASS_RULE_ID = 'probe/no-console'

let tmpDir: string
let project: ArchProject

/**
 * Real files on disk, because the comment scanner reads source text with
 * `fs.readFileSync` (`execute-rule.ts`) rather than going through ts-morph. An
 * in-memory project silently produces zero comments.
 */
function write(relative: string, lines: string[]): void {
  const full = path.join(tmpDir, relative)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, lines.join('\n') + '\n')
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-archunit-0041-'))
  fs.writeFileSync(
    path.join(tmpDir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true }, include: ['src'] }),
  )

  write('src/forbidden.ts', ['export const secret = 1'])

  // The comment sits directly above the import: a single-line directive covers
  // `comment.line + 1` only (`commentCoversViolation`).
  write('src/consumer-excluded.ts', [
    '// ts-archunit-exclude probe/no-forbidden: deliberate, guarded by 0041',
    "import { secret } from './forbidden.js'",
    'export const used = secret',
  ])

  write('src/consumer-plain.ts', [
    "import { secret } from './forbidden.js'",
    'export const used = secret',
  ])

  // Above the CLASS, not above the call. A class-level condition reports the
  // violation at the class declaration's line — measured, `notContain(call(...))`
  // returns `line: 1` for a `console.log` on line 4 — and a single-line directive
  // covers `comment.line + 1`. Placing it above the offending expression, which is
  // the intuitive spot, does nothing. Existing behaviour, orthogonal to 0041, but
  // it cost a debugging round here and is worth stating.
  write('src/logger-excluded.ts', [
    '// ts-archunit-exclude probe/no-console: deliberate, guarded by 0041',
    'export class LoggerExcluded {',
    '  run(): void {',
    "    console.log('x')",
    '  }',
    '}',
  ])

  write('src/logger-plain.ts', [
    'export class LoggerPlain {',
    '  run(): void {',
    "    console.log('x')",
    '  }',
    '}',
  ])

  const tsConfigPath = path.join(tmpDir, 'tsconfig.json')
  const p = new Project({ tsConfigFilePath: tsConfigPath })
  project = { tsConfigPath, _project: p, getSourceFiles: () => p.getSourceFiles() }
})

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

/** Files named by the surviving violations, basename only. */
function offendingFiles(violations: readonly { file: string }[]): string[] {
  return violations.map((v) => path.basename(v.file)).sort()
}

describe('an exclusion comment reaches every condition family (bug 0041)', () => {
  it('VACUITY: both rules fire on the un-excluded file, or every row below is meaningless', () => {
    const moduleHits = modules(project)
      .that()
      .resideInFile('**/consumer-plain.ts')
      .should()
      .notImportFrom('**/forbidden*')
      .rule({ id: RULE_ID })
      .violations()

    const classHits = classes(project)
      .that()
      .haveNameMatching(/^LoggerPlain$/)
      .should()
      .notContain(call(/^console\.log$/))
      .rule({ id: CLASS_RULE_ID })
      .violations()

    expect(moduleHits.length).toBeGreaterThan(0)
    expect(classHits.length).toBeGreaterThan(0)
  })

  it('a non-stamping condition honours the comment — this is the bug', () => {
    // `notImportFrom` builds its violations in `conditions/dependency.ts`, which
    // leaves `ruleId` to the enrichment step. Before the fix this returned the
    // violation unsuppressed, and it CARRIED `ruleId: 'probe/no-forbidden'` —
    // stamped a few lines too late to be seen by the filter.
    const violations = modules(project)
      .that()
      .resideInFile('**/consumer-excluded.ts')
      .should()
      .notImportFrom('**/forbidden*')
      .rule({ id: RULE_ID })
      .violations()

    expect(offendingFiles(violations)).toEqual([])
  })

  it('a stamping condition still honours it — the control that must not regress', () => {
    const violations = classes(project)
      .that()
      .haveNameMatching(/^LoggerExcluded$/)
      .should()
      .notContain(call(/^console\.log$/))
      .rule({ id: CLASS_RULE_ID })
      .violations()

    expect(offendingFiles(violations)).toEqual([])
  })

  it('THE ASYMMETRY: both families agree, by identity', () => {
    // The whole bug, as one assertion. Each family is run over both files; the
    // excluded one must drop out of both and the plain one must survive in both.
    // A fix that made `isExcludedByComment` always return true fails this, because
    // the plain files would vanish too.
    const moduleFiles = offendingFiles(
      modules(project)
        .that()
        .resideInFile('**/consumer-*.ts')
        .should()
        .notImportFrom('**/forbidden*')
        .rule({ id: RULE_ID })
        .violations(),
    )
    const classFiles = offendingFiles(
      classes(project)
        .that()
        .haveNameMatching(/^Logger/)
        .should()
        .notContain(call(/^console\.log$/))
        .rule({ id: CLASS_RULE_ID })
        .violations(),
    )

    expect(moduleFiles).toEqual(['consumer-plain.ts'])
    expect(classFiles).toEqual(['logger-plain.ts'])
  })

  it('a comment naming a DIFFERENT rule id does not suppress', () => {
    // Without this, "suppress everything" passes every row above.
    const violations = modules(project)
      .that()
      .resideInFile('**/consumer-excluded.ts')
      .should()
      .notImportFrom('**/forbidden*')
      .rule({ id: 'probe/some-other-rule' })
      .violations()

    expect(offendingFiles(violations)).toEqual(['consumer-excluded.ts'])
  })

  it('the public isExcludedByComment still refuses an unstamped violation', () => {
    // Residue of this fix, found by sabotage. `if (!ruleId) return false`
    // (`exclusion-comments.ts:262`) is now unreachable **from any producer in
    // `src/`**: every `ruleId:` assignment derives from `metadata.id` or
    // `context.ruleId`, and an empty `metadata.id` disables the comment scan
    // outright (`execute-rule.ts:156`).
    //
    // Not "unreachable through `applyFilters`", which is what this said first and
    // is false: `??` does not replace an empty string, so a violation carrying
    // `ruleId: ''` reaches the line and survives. Measured. No shipped producer
    // can emit that — a user-authored condition can.
    //
    // It is not dead code, though: `isExcludedByComment` is a public export
    // (`src/index.ts`), so a direct caller can still pass an unstamped violation,
    // and no test covered that. Asserted here rather than left as a green
    // sabotage row nobody can account for.
    const comment = {
      ruleId: RULE_ID,
      reason: 'r',
      file: 'src/x.ts',
      line: 1,
      isBlock: false,
    }
    expect(
      isExcludedByComment({ rule: 'r', element: 'e', file: 'src/x.ts', line: 2, message: 'm' }, [
        comment,
      ]),
    ).toBe(false)
  })

  it('a rule with no id ignores the comment, as before', () => {
    // `applyFilters` gates the whole comment scan on `ctx.metadata?.id`. Pinned
    // so the reorder is not read as having widened the feature.
    const violations = modules(project)
      .that()
      .resideInFile('**/consumer-excluded.ts')
      .should()
      .notImportFrom('**/forbidden*')
      .violations()

    expect(offendingFiles(violations)).toEqual(['consumer-excluded.ts'])
  })
})
