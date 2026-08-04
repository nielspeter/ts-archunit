/**
 * A shipped claim about what the cycle check detects must match what it detects.
 *
 * v0.48.0 taught the slice graph to see re-export edges and left **three** shipped
 * assertions saying it could not — two of them `because` strings, which
 * `src/core/format.ts` prints as the `Why:` line **on every finding**. So a user whose
 * build reddened on a newly-detected barrel cycle read, attached to that finding, that
 * barrel cycles are not detected. The third was `beFreeOfCycles`' own docstring, which
 * argued for its own currency — *"Recorded here because this docstring is read when the
 * rule fails, and a changelog is read once"* — and was then not updated when the
 * changelog was.
 *
 * All three were found by review, not by the suite. Nothing pinned prose against
 * behaviour, which is why a release whose entire subject was this behaviour could ship
 * with three statements contradicting it.
 *
 * This file is that pin, from both directions:
 *
 *  1. **Behaviour** — the two presets that ship a cycle rule detect a barrel cycle.
 *     If the capability regresses, these rows red and the prose becomes true again by
 *     accident rather than silently wrong.
 *  2. **Prose** — no shipped string asserts non-detection of the forms now counted.
 *     A text scan is a blunt instrument, and it is the instrument that was missing: the
 *     defect was literally a sentence.
 */
import { describe, it, expect } from 'vitest'
import { Project, ts } from 'ts-morph'
import fs from 'node:fs'
import path from 'node:path'
import type { ArchProject } from '../../src/core/project.js'
import { layeredArchitecture } from '../../src/presets/layered.js'
import { strictBoundaries } from '../../src/presets/boundaries.js'
import type { ArchViolation } from '../../src/core/violation.js'
import type { RuleBuilderLike } from '../../src/core/rule-builder-like.js'

/**
 * Three features and a barrel that re-exports all three. The barrel is a hub, so every
 * consumer joins one component — which is why v0.48.0 made multi-member cycles the
 * normal case rather than the exception.
 */
function barrelProject(): ArchProject {
  const tsm = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
  })
  tsm.createSourceFile(
    '/src/features/barrel/index.ts',
    "export { billing } from '../billing/index.js'\nexport { users } from '../users/index.js'\n",
  )
  tsm.createSourceFile(
    '/src/features/billing/index.ts',
    "import { users } from '../barrel/index.js'\nexport const billing = users\n",
  )
  tsm.createSourceFile('/src/features/users/index.ts', 'export const users = 1\n')
  return {
    tsConfigPath: '/tsconfig.json',
    _project: tsm,
    getSourceFiles: () => tsm.getSourceFiles(),
  }
}

const cycleFindings = (rules: RuleBuilderLike[]): ArchViolation[] =>
  rules
    .flatMap((r) => ('violations' in r && typeof r.violations === 'function' ? r.violations() : []))
    .filter((v): v is ArchViolation => v !== undefined && v.bypassFilters !== true)
    .filter((v) => v.message.startsWith('Cycle detected'))

describe('the presets actually detect a barrel cycle (v0.48.0)', () => {
  it('strictBoundaries reports it', () => {
    // `billing` re-exports through the barrel and the barrel re-exports `billing`, so
    // the two are mutually entangled through `export … from` alone — the exact shape
    // three shipped strings said was undetectable.
    const found = cycleFindings(strictBoundaries(barrelProject(), { folders: '**/src/features/*' }))
    expect(found.length).toBeGreaterThan(0)
  })

  it('layeredArchitecture reports it', () => {
    const found = cycleFindings(
      layeredArchitecture(barrelProject(), {
        layers: {
          barrel: '**/src/features/barrel/**',
          billing: '**/src/features/billing/**',
          users: '**/src/features/users/**',
        },
      }),
    )
    expect(found.length).toBeGreaterThan(0)
  })
})

describe('no shipped string claims the cycle check cannot see a re-export', () => {
  /** Every `.ts` under `src/`, which is what actually ships. */
  function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name)
      return e.isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : []
    })
  }

  /**
   * A non-detection phrase within `WINDOW` characters of a re-export term.
   *
   * The window is the whole point. A bare scan for "cannot see" flagged four files —
   * `core/define.ts`, `core/glob-evaluator.ts`, `predicates/module.ts` and
   * `helpers/slice-graph.ts` — none of which says anything about re-exports. That is a
   * detector whose findings are unactionable, which is the failure mode plan 0086 exists
   * to avoid, so it is not shipped as one. The claim being guarded is specifically
   * "this cannot see a re-export", and it takes both halves to be that claim.
   */
  const WINDOW = 300
  const NON_DETECTION = ['is not detected', 'invisible here', 'cannot see', 'declarations only']
  const REEXPORT_TERM = ['barrel', 're-export', 'export …', 'export {', 'export *']

  function claimsNonDetection(text: string): string[] {
    const hits: string[] = []
    for (const phrase of NON_DETECTION) {
      let from = text.indexOf(phrase)
      while (from !== -1) {
        const near = text.slice(Math.max(0, from - WINDOW), from + phrase.length + WINDOW)
        const term = REEXPORT_TERM.find((t) => near.includes(t))
        if (term !== undefined) hits.push(`"${phrase}" near "${term}"`)
        from = text.indexOf(phrase, from + 1)
      }
    }
    return hits
  }

  it('the stale phrases appear nowhere in src/', () => {
    // Deliberately phrase-level rather than clever. The three defects were sentences,
    // and a scan for those sentences is what would have caught them. Each phrase is one
    // that appeared verbatim in shipped text and was false from v0.48.0.
    const root = path.resolve(import.meta.dirname, '../../src')
    const files = sourceFiles(root)

    // Non-vacuity first: if the walk finds nothing, every phrase is trivially absent.
    expect(files.length).toBeGreaterThan(100)

    const offenders = files.flatMap((file) =>
      claimsNonDetection(fs.readFileSync(file, 'utf-8')).map(
        (hit) => `${path.relative(root, file)}: ${hit}`,
      ),
    )
    expect(offenders).toEqual([])
  })

  it("VACUITY: the scan really would fire — it catches the phrase in this file's own fixture", () => {
    // The scan above asserts an empty list, so it passes if the phrase list is wrong,
    // the walk is broken, or `includes` is never reached. Prove the detector fires by
    // running the same predicate over text that does contain a forbidden phrase.
    //
    // ADR-008 rule 5: a guard whose only outcome is "nothing found" is not yet a guard.
    const stale =
      'Note the cycle check sees static `import` declarations only: a cycle formed by ' +
      '`export … from` (a barrel) is not detected.'
    expect(claimsNonDetection(stale)).toEqual([
      '"is not detected" near "barrel"',
      '"declarations only" near "barrel"',
    ])

    // And the other direction: a non-detection phrase with no re-export term nearby is
    // NOT a hit. This is the row that keeps the window from being decoration — without
    // it the predicate could ignore the window entirely and both rows would still pass.
    expect(claimsNonDetection('this function cannot see the leaves of the glob tree')).toEqual([])
  })
})
