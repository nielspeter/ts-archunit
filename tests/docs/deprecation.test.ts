import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { globSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readDeprecatedSymbols } from './deprecated-symbols.js'
import { scanMarkdown, format } from './scan-markdown.js'
import type { DocFile } from './scan-markdown.js'

const repoRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))

/**
 * Living docs = what a reader is taught from. Scope is `docs/**` + `README.md`.
 *
 * Everything else is out **by construction**, not by an exclusion list that could
 * rot (ADR-008 rule 3): `CHANGELOG.md` names deprecated symbols legitimately and
 * forever, and `plans/`, `proposals/`, `adr/` and the spec are historical records,
 * not instruction.
 */
function readLivingDocs(): DocFile[] {
  return globSync(['docs/**/*.md', 'README.md'], { cwd: repoRoot })
    .map((relativePath) => relativePath.split(path.sep).join('/'))
    .sort()
    .map((relativePath) => ({
      path: relativePath,
      text: readFileSync(path.join(repoRoot, relativePath), 'utf-8'),
    }))
}

const IMPERATIVE =
  'A doc teaches deprecated API. FIX: use the replacement named in each hit below. ' +
  'Do NOT suppress this check, add an exception, delete this test, reword the doc to ' +
  'evade the match, or remove the @deprecated tag from src/. If a page must name ' +
  'deprecated API on purpose (e.g. a migration guide), that is a design decision — ' +
  'stop and ask a human. The migration narrative belongs in CHANGELOG.md.'

describe('docs do not teach deprecated API (plan 0063)', () => {
  const project = new Project({ tsConfigFilePath: path.join(repoRoot, 'tsconfig.json') })

  it('no living doc teaches deprecated API', () => {
    const files = readLivingDocs()
    const symbols = readDeprecatedSymbols(project)

    // Two vacuity guards. `toEqual([])` passes just as happily on an empty corpus
    // or an empty vocabulary, so both inputs are asserted non-empty first — this is
    // the check that the check is still a check (ADR-008 rule 5).
    expect(
      files.length,
      'living-docs glob matched nothing — this guard is vacuous. Fix the glob.',
    ).toBeGreaterThan(0)
    expect(
      symbols.length,
      'no @deprecated symbols in src/ — this guard is vacuous. If the tags are ' +
        'genuinely gone (1.0 removal), retire this scan; see plan 0063.',
    ).toBeGreaterThan(0)

    // The false-positive canary. api-reference.md legitimately documents the four
    // colliding names in its Export/Signature tables; if it ever drops out of scope
    // the scan would look clean for the wrong reason.
    expect(
      files.map((file) => file.path),
      'docs/api-reference.md is not in scope — it is the false-positive canary for ' +
        'the collision rule, so the corpus is no longer meaningful.',
    ).toContain('docs/api-reference.md')

    expect(scanMarkdown(files, symbols).map(format), IMPERATIVE).toEqual([])
  })

  it('the guard can fail: seeded rot produces a hit', () => {
    // Derived FROM the live symbol set, so it cannot go stale as names change —
    // and at 1.0, when the tags vanish, this fails loudly rather than passing
    // silently on an empty vocabulary.
    const symbols = readDeprecatedSymbols(project)
    const solo = symbols.find((symbol) => !symbol.collides)
    expect(
      solo,
      'no non-colliding deprecated symbol to seed with — the can-fail proof is ' +
        'vacuous, so this guard is no longer known to be able to fail.',
    ).toBeDefined()

    const seeded: DocFile[] = [
      { path: 'docs/__seeded__.md', text: `Use \`${solo?.name ?? ''}(glob)\` to do it.` },
    ]
    expect(scanMarkdown(seeded, symbols).map((hit) => hit.name)).toEqual([solo?.name])
  })

  it('a colliding name is not flagged where docs legitimately name it', () => {
    // The other half of the can-fail proof: the guard must also be able to NOT
    // fire. A bare colliding name (an api-reference.md Export row) stays clean.
    const symbols = readDeprecatedSymbols(project)
    const colliding = symbols.find((symbol) => symbol.collides)
    expect(colliding, 'no colliding symbol — the false-positive rule is untested').toBeDefined()

    const legitimate: DocFile[] = [
      { path: 'docs/__seeded__.md', text: `| \`${colliding?.name ?? ''}\` | current export |` },
    ]
    expect(scanMarkdown(legitimate, symbols)).toEqual([])
  })
})
