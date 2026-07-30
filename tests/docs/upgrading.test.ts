/**
 * The upgrade page has to cover every version that exists.
 *
 * Plan 0071's third instrument, and the one most likely to rot: a release adds a
 * `CHANGELOG.md` heading, nobody adds the row, and the page silently claims
 * complete coverage of a range that no longer ends where it says. An adopter
 * jumping across the gap reads "no action required" by omission.
 *
 * So the version list is **derived from `CHANGELOG.md`**, never restated here.
 * A hard-coded list would pass forever after the next release, which is the
 * failure mode rather than a risk of it.
 *
 * The row-not-blank assertion is what stops the cheapest fix. Given a failure
 * saying "0.27.0 has no row", the minimum edit that goes green is
 * `| **0.27.0** | | |` — a row that satisfies coverage and tells the reader
 * nothing. Both cells must say something.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const read = (name: string): string => fs.readFileSync(path.join(repoRoot, name), 'utf-8')

/** Released versions, in the order `CHANGELOG.md` lists them. */
function releasedVersions(): string[] {
  return [...read('CHANGELOG.md').matchAll(/^## \[([\d.]+)\]/gm)].flatMap((m) =>
    m[1] === undefined ? [] : [m[1]],
  )
}

/**
 * Rows of the per-release table, as `[version, changesEnforcement, action]`.
 *
 * The whitespace in the pattern is `\s*`, not a literal space: prettier pads
 * every cell to align the column, so `| **0.9.0**  |` carries two spaces where
 * `| **0.26.0** |` carries one. A single-space pattern matched 18 of 29 rows and
 * the coverage assertion still passed on the 18 — the `> 25` anchor is what
 * caught it.
 */
function tableRows(): { version: string; enforcement: string; action: string }[] {
  return [
    ...read('docs/upgrading.md').matchAll(/^\|\s*\*\*([\d.]+)\*\*\s*\|([^|]*)\|(.*)\|$/gm),
  ].flatMap((m) => {
    const [, version, enforcement, action] = m
    if (version === undefined || enforcement === undefined || action === undefined) return []
    return [{ version, enforcement: enforcement.trim(), action: action.trim() }]
  })
}

describe('docs/upgrading.md', () => {
  it('exists, because the 0.28.0 recipe points at it', () => {
    expect(fs.existsSync(path.join(repoRoot, 'docs/upgrading.md'))).toBe(true)
  })

  it('is reachable from the sidebar', () => {
    // A page nobody can navigate to is not documentation. VitePress will render
    // it at /upgrading either way, so nothing else notices.
    expect(read('docs/.vitepress/config.ts')).toContain("link: '/upgrading'")
  })

  it('has a row for every released version', () => {
    const versions = releasedVersions()
    const covered = new Set(tableRows().map((r) => r.version))

    // Non-vacuity: if either regex stops matching, both sides go empty and the
    // difference is trivially none. There are 29 releases as of 0.26.0.
    expect(versions.length).toBeGreaterThan(25)
    expect(covered.size).toBeGreaterThan(25)

    expect(versions.filter((v) => !covered.has(v))).toEqual([])
  })

  it('has no row for a version that was never released', () => {
    // The other direction. A row for an unreleased version reads as a promise,
    // and 0.28.0 is referenced in the prose on purpose — but not in the table,
    // because it has not shipped.
    const released = new Set(releasedVersions())
    expect(
      tableRows()
        .filter((r) => !released.has(r.version))
        .map((r) => r.version),
    ).toEqual([])
  })

  it('says something in both cells of every row', () => {
    // Otherwise the cheapest way to satisfy the coverage assertion above is an
    // empty row, and an empty "action required" cell reads as "none".
    const thin = tableRows().filter((r) => r.enforcement.length < 2 || r.action.length < 4)
    expect(thin).toEqual([])
  })

  it('states the ordering rule the per-release notes cannot', () => {
    // The page's reason for existing: the changelog's own notes, followed in
    // order, tell an adopter to regenerate the baseline last. If this sentence
    // goes, the table is just a restatement of the changelog.
    const page = read('docs/upgrading.md')
    expect(page).toContain('Refresh the baseline on the version you are leaving')
  })
})
