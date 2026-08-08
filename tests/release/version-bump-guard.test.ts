/**
 * The gate that refuses a patch release carrying feature-level change.
 *
 * Found in review of plan 0089. The constraint "the next release is 0.59.0, not a
 * patch" lived only as a prose blockquote in `CHANGELOG.md` — no test, no script,
 * no workflow step read it. `publish.yml` verified the tag matched `package.json`
 * and that a changelog section existed; **both pass for `v0.58.1`**. And the
 * release-notes extractor would then have lifted that very blockquote into the
 * GitHub release body, printed after `npm publish`, which is immutable.
 *
 * ADR-008 rule 6 puts a gate on an irreversible effect in the "guard the guard"
 * row, so the gate is a script rather than an inline `run:` block, and these rows
 * exercise it directly. Asked rule 5's question — what would this do if the guard
 * were completely broken? — a `run:` block could only have been read, not run.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const SCRIPT = path.resolve(
  import.meta.dirname,
  '../../.github/scripts/assert-version-bump-is-safe.sh',
)
const dir = mkdtempSync(path.join(tmpdir(), 'bump-guard-'))

const notes = (body: string, name: string): string => {
  const file = path.join(dir, name)
  writeFileSync(file, body)
  return file
}

/** Returns the exit code, never throwing, so a row can assert a refusal. */
function run(version: string, latest: string, notesFile: string): { code: number; err: string } {
  try {
    execFileSync(SCRIPT, [version, latest, notesFile], { encoding: 'utf8', stdio: 'pipe' })
    return { code: 0, err: '' }
  } catch (e: unknown) {
    const status = typeof e === 'object' && e !== null && 'status' in e ? e.status : 1
    const stderr = typeof e === 'object' && e !== null && 'stderr' in e ? String(e.stderr) : ''
    return { code: typeof status === 'number' ? status : 1, err: stderr }
  }
}

const ADDED = notes('### Added\n- a new preset option\n', 'added.md')
const FIXED = notes('### Fixed\n- a bug\n', 'fixed.md')
const CHANGED = notes('### Changed\n- a default\n', 'changed.md')

describe('the version-bump guard', () => {
  it('REFUSES the exact release this branch must not ship: 0.58.1 carrying Added', () => {
    const { code, err } = run('0.58.1', '0.58.0', ADDED)
    expect(code).toBe(1)
    expect(err).toContain('resolves inside 0.58.x')
    // The remedy names the version to use, because the reader is often an agent.
    // Computed from LATEST, never hardcoded.
    expect(err).toContain('0.59.0')
  })

  it('refuses a patch carrying Changed', () => {
    expect(run('0.58.1', '0.58.0', CHANGED).code).toBe(1)
  })

  it('ALLOWS the minor — this is what 0.59.0 must do', () => {
    expect(run('0.59.0', '0.58.0', ADDED).code).toBe(0)
  })

  it('allows a genuine patch: Fixed only', () => {
    // Without this row the guard could be `exit 1` and every other row would pass.
    expect(run('0.58.1', '0.58.0', FIXED).code).toBe(0)
  })

  it('allows a major', () => {
    expect(run('1.0.0', '0.58.0', ADDED).code).toBe(0)
  })

  it('FAILS CLOSED when the published baseline is unknown', () => {
    // `npm view` returning empty (network, auth, unpublished) must not read as
    // "probably fine" — npm publish is immutable.
    const { code, err } = run('0.58.1', '', ADDED)
    expect(code).toBe(1)
    expect(err).toContain('fails closed')
  })

  it('FAILS CLOSED when the release-notes file is missing', () => {
    const { code } = run('0.58.1', '0.58.0', path.join(dir, 'absent.md'))
    expect(code).toBe(1)
  })

  it('REFUSES a downgrade — it moves the latest dist-tag backwards', () => {
    // The first cut tested `${VERSION%.*} != ${LATEST%.*}`, which is inequality
    // and not order: measured, 0.57.0 over a published 0.58.0 printed "is a minor
    // or major bump" and exited 0.
    for (const older of ['0.57.0', '0.57.5', '0.58.0']) {
      const { code, err } = run(older, '0.58.0', ADDED)
      expect({ older, code }).toEqual({ older, code: 1 })
      expect(err).toContain('not greater than the published')
    }
  })

  it("refuses this repo's ACTUAL breaking-change heading style", () => {
    // Not a synthetic `### Changed`. The unanchored pattern matched this today,
    // but nothing pinned it: tightening it to `^### (Added|Changed|Removed)$` —
    // the obvious "clean this up" edit — left all seven original rows green while
    // publishing a breaking change as a patch. CHANGELOG.md:190 is this heading.
    const real = notes(
      '### Changed (⚠️ BREAKING — `correspondence().allowEmpty()` is now `.expectEmpty()`)\n- x\n',
      'real-breaking.md',
    )
    expect(run('0.58.1', '0.58.0', real).code).toBe(1)
  })

  it('refuses headings the gate does not recognise, not just the three it named', () => {
    // The first cut listed FORBIDDEN headings, so it failed open on anything
    // unanticipated. `### Deprecated` is Keep a Changelog and feature-level;
    // `### Breaking` is a heading this repo actually shipped in 0.10.0.
    for (const heading of ['### Deprecated', '### Breaking', '### Performance']) {
      const f = notes(`${heading}\n- x\n`, `h-${heading.slice(4)}.md`)
      expect({ heading, code: run('0.58.1', '0.58.0', f).code }).toEqual({ heading, code: 1 })
    }
  })

  it('refuses a section with no ### heading at all', () => {
    // Bare bullets classified as nothing, and "nothing" read as safe.
    const bare = notes('- just a bullet, no heading\n', 'bare.md')
    expect(run('0.58.1', '0.58.0', bare).code).toBe(1)
  })

  it('refuses a prerelease on either side — the gate does not model them', () => {
    // `${VERSION%.*}` strips at the LAST dot, so `0.58.1-rc.1` became
    // `0.58.1-rc` and never equalled `0.58`. And publish.yml passes no --tag, so
    // a prerelease publishes to `latest` and becomes the next run's baseline:
    // `0.58.2` over `0.58.1-rc.1` was waved through too. One prerelease disabled
    // the gate for the release after it.
    expect(run('0.58.1-rc.1', '0.58.0', ADDED).code).toBe(1)
    expect(run('0.58.2', '0.58.1-rc.1', ADDED).code).toBe(1)
  })

  it('names the tag deletion in its remedy — re-tagging silently does nothing', () => {
    // The gate fires from a tag push, so the tag already exists. 8 of this repo's
    // 26 patch releases would have landed here; the recovery path is the common
    // path, and an agent that is not told to delete the tag retries into the
    // identical failure.
    const { err } = run('0.58.1', '0.58.0', ADDED)
    expect(err).toContain('git push --delete origin v0.58.1')
  })

  it('CONTROL: 0.58.1 is still recognised as greater, so the patch rule can be reached', () => {
    // Without this the ordering check could reject everything and the Fixed-only
    // row above would be the only thing keeping it honest.
    expect(run('0.58.1', '0.58.0', FIXED).code).toBe(0)
  })
})
