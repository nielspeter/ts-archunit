/**
 * A user-defined predicate or condition can declare its globs — bug 0030.
 *
 * `definePredicate` and `defineCondition` returned exactly the fields they were
 * handed and had no parameter for globs, so a custom path-matching predicate's
 * glob never reached `globs()`, `doctor` or `diagnose()`. `Predicate.globs` and
 * `Condition.globs` were both optional, so it compiled and always had.
 *
 * ## The two halves have different severity, and the tests say which is which
 *
 * | position    | acted on?                             | so a declared glob…       |
 * | ----------- | ------------------------------------- | ------------------------- |
 * | `selector`  | **yes** — `doctor` reports a dead one | **is reported dead**      |
 * | `condition` | no — skipped by decision              | is visible, never a fault |
 *
 * So the predicate half was a **present-tense** detection gap: a typo'd glob in a
 * custom predicate narrowed the selection to nothing and `doctor` exited 0. The
 * condition half is latent until [plan 0074](../../plans/completed/0074-r3b-the-selector-glob-flip.md).
 *
 * ## Why this asserts `diagnose()` and calls it the `doctor` surface
 *
 * `src/cli/commands/doctor.ts:48` is `findings.push(...diagnose(loaded)…)` — a thin
 * wrapper that adds the rule file's name. Asserting `diagnose` is asserting what
 * `doctor` prints, without needing a loadable `arch.rules.ts` on disk.
 *
 * ## Why this is a separate file from `condition-glob-declaration.test.ts`
 *
 * That file's population is the twelve **built-in** conditions, derived by parsing
 * `src/`. This one is about the two public factories and covers a predicate, a
 * different position, and the `doctor` surface. Bug 0030 nominated that file; the
 * subject overlaps but the population does not.
 *
 * ## The measurement that made this fixable in one parameter
 *
 * Before the fix, a hand-built `Predicate` object literal carrying `globs` and
 * passed to `.satisfy()` already reached `globs()` stamped `position: 'selector'`
 * **and was reported as a dead glob by `diagnose()`, identically to a built-in
 * `resideInFolder` control.** `satisfy()` stores the object as-is
 * (`rule-builder.ts:104-109`), so the plumbing was never the problem — only the
 * factory's signature was. That is why the fix is two optional parameters and not
 * a change to the gathering.
 */
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import type { SourceFile } from 'ts-morph'
import { modules } from '../../src/index.js'
import { definePredicate, defineCondition } from '../../src/core/define.js'
import { diagnose } from '../../src/core/diagnose.js'
import { globNode } from '../../src/core/glob-site.js'
import { globSitesOf } from '../../src/core/glob-evaluator.js'
import type { ArchProject } from '../../src/core/project.js'

const tsconfigPath = path.resolve(import.meta.dirname, '../fixtures/modules/tsconfig.json')

function loadProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

/** Matches nothing in the fixture project. */
const DEAD = '**/nonexistent-folder/**'
/** Matches the fixture project — `tests/fixtures/modules` has files under it. */
const LIVE = '**/fixtures/modules/**'

const alwaysMatches = (): boolean => true

describe('a user-defined predicate declares a selector glob', () => {
  it('reaches globs() stamped position: selector', () => {
    const custom = definePredicate<SourceFile>(
      `reside in '${DEAD}'`,
      alwaysMatches,
      globNode({ glob: DEAD, kind: 'file-path' }),
    )
    const rule = modules(loadProject())
      .that()
      .satisfy(custom)
      .should()
      .notImportFrom('**/banned/**')

    const sites = rule.globs().flatMap((tree) => globSitesOf(tree))
    const selector = sites.filter((s) => s.position === 'selector')
    expect(selector.map((s) => s.glob)).toEqual([DEAD])
    expect(selector.map((s) => s.kind)).toEqual(['file-path'])
    // The origin comes from the description the caller wrote, so `doctor` names
    // the site rather than printing a bare glob.
    expect(selector.at(0)?.origin).toContain('reside in')
  })

  it('is REPORTED as a dead glob, which is the half that matters', () => {
    // Reaching `globs()` is necessary and not sufficient: bug 0030's whole cost
    // was that `doctor` exited 0 on a custom predicate whose glob matched
    // nothing. This is the assertion that would have failed before the fix.
    const custom = definePredicate<SourceFile>(
      `reside in '${DEAD}'`,
      alwaysMatches,
      globNode({ glob: DEAD, kind: 'file-path' }),
    )
    const rule = modules(loadProject())
      .that()
      .satisfy(custom)
      .should()
      .notImportFrom('**/banned/**')

    const findings = diagnose([rule])
    expect(findings.map((f) => `${f.kind}:${String(f.position)}:${String(f.glob)}`)).toEqual([
      `dead-glob:selector:${DEAD}`,
    ])
  })

  it('is not reported when the glob is alive', () => {
    // The discriminator. Without it, machinery that reported EVERY declared
    // selector glob as dead would satisfy the assertion above.
    const custom = definePredicate<SourceFile>(
      `reside in '${LIVE}'`,
      alwaysMatches,
      globNode({ glob: LIVE, kind: 'file-path' }),
    )
    const rule = modules(loadProject())
      .that()
      .satisfy(custom)
      .should()
      .notImportFrom('**/banned/**')

    expect(diagnose([rule])).toEqual([])
  })

  it('declares nothing when no globs are passed, and does not become a finding', () => {
    // Backward compatibility, and the reason the parameter is optional: every
    // `definePredicate` written before this release passes two arguments, and
    // "declared no globs" must stay distinct from "declared a dead glob".
    const custom = definePredicate<SourceFile>('is a source file', alwaysMatches)
    expect(custom.globs).toBeUndefined()

    const rule = modules(loadProject())
      .that()
      .satisfy(custom)
      .should()
      .notImportFrom('**/banned/**')
    expect(
      rule
        .globs()
        .flatMap((tree) => globSitesOf(tree))
        .filter((s) => s.position === 'selector'),
    ).toEqual([])
    expect(diagnose([rule])).toEqual([])
  })

  it('honours the declared kind, so import-target stays exempt', () => {
    // The documented contract, asserted rather than described. A bare specifier
    // legitimately matches no project path — bug 0014 — so `import-target` has no
    // path universe and must never be reported dead. The same string declared as
    // `file-path` IS reported, which is what makes this a real discriminator and
    // not a restatement of the test above.
    const asSpecifier = definePredicate<SourceFile>(
      'imports fastify',
      alwaysMatches,
      globNode({ glob: 'fastify', kind: 'import-target' }),
    )
    const asPath = definePredicate<SourceFile>(
      'resides in fastify',
      alwaysMatches,
      globNode({ glob: 'fastify', kind: 'file-path' }),
    )
    const build = (predicate: typeof asSpecifier): ReturnType<typeof diagnose> =>
      diagnose([
        modules(loadProject()).that().satisfy(predicate).should().notImportFrom('**/banned/**'),
      ])

    expect(build(asSpecifier)).toEqual([])
    expect(build(asPath).map((f) => f.kind)).toEqual(['dead-glob'])
  })
})

describe('a user-defined condition declares a condition glob', () => {
  it('reaches globs() stamped position: condition', () => {
    const custom = defineCondition<SourceFile>(
      `not import from '${DEAD}'`,
      () => [],
      globNode({ glob: DEAD, kind: 'import-target' }),
    )
    const rule = modules(loadProject()).that().resideInFolder(LIVE).should().satisfy(custom)

    const sites = rule.globs().flatMap((tree) => globSitesOf(tree))
    const condition = sites.filter((s) => s.position === 'condition')
    expect(condition.map((s) => s.glob)).toEqual([DEAD])
    expect(condition.at(0)?.origin).toContain('not import from')
  })

  it('is visible but never a fault, even when it matches nothing', () => {
    // NOT a bug, and the assertion exists so nobody "fixes" it into one. A
    // denylist glob matching nothing is indistinguishable from a ban being
    // respected — 0069's decision table, `diagnose.ts`'s condition skip, and the
    // reason plan 0072 was refuted twice. A `file-path` kind is used here
    // deliberately: it HAS a path universe, so the glob is genuinely checkable
    // and is still not reported. The exemption is the position, not the kind.
    const custom = defineCondition<SourceFile>(
      `reside in '${DEAD}'`,
      () => [],
      globNode({ glob: DEAD, kind: 'file-path' }),
    )
    const rule = modules(loadProject()).that().resideInFolder(LIVE).should().satisfy(custom)

    const sites = rule.globs().flatMap((tree) => globSitesOf(tree))
    expect(sites.filter((s) => s.position === 'condition')).toHaveLength(1)
    expect(diagnose([rule])).toEqual([])
  })

  it('declares nothing when no globs are passed', () => {
    const custom = defineCondition<SourceFile>('asserts nothing about paths', () => [])
    expect(custom.globs).toBeUndefined()
  })
})
