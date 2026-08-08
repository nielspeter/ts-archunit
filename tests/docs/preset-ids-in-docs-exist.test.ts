/**
 * Every `preset/…` id printed in the docs is one a preset actually constructs.
 *
 * Plan 0089 turned preset rule ids into a **declaration interface**: they are what
 * a user types into `expectEmpty`, and an id that names no constructed rule is an
 * unsuppressable failure. So a wrong id in the docs is no longer a typo — it is a
 * documented value that hard-fails the build of whoever copies it.
 *
 * Found in review of this plan, in prose this plan added: the `importOptions`
 * exclusion note named `preset/boundaries/no-copy-paste`, which does not exist.
 * The real id is `preset/boundaries/no-duplicate-bodies`, spelled correctly in the
 * generated-rules table forty lines below it.
 *
 * The id set is derived from `src/presets/*.ts` rather than listed here, for the
 * reason the sibling upgrade-row guard states: a hand-written list rots the first
 * time a preset gains a rule, and rots silently, because a stale list still passes.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../..')
const presetsDir = path.join(root, 'src/presets')

/** Every `preset/…` id literal any preset source constructs. */
function constructedIds(): Set<string> {
  const ids = new Set<string>()
  for (const file of readdirSync(presetsDir).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(path.join(presetsDir, file), 'utf8')
    for (const m of src.matchAll(/['"`](preset\/[a-z0-9-]+\/[^'"`\s]*)['"`]/gi)) {
      const id = m[1]
      if (id !== undefined) ids.add(id)
    }
  }
  return ids
}

/**
 * Markdown with fenced code blocks removed is still in scope — a `expectEmpty:
 * ['preset/...']` example is exactly the text a reader copies, so examples must
 * name real ids too. Only inline-code spans and fences are unwrapped, not skipped.
 */
function idsMentionedIn(file: string, unreleasedOnly = false): Map<string, number> {
  const all = readFileSync(path.join(root, file), 'utf8').split('\n')
  // Released CHANGELOG sections are immutable history, and some deliberately
  // quote a MISSPELLED id: bug 0038's entry reads "'…/no-silent-cach': 'error'
  // left the rule at warn", which is the whole point of that entry. Correcting it
  // would falsify the record, so the ∀ runs over what is still being written.
  // Falls back to the NEWEST RELEASED section when `[Unreleased]` is absent.
  //
  // Without this the guard went vacuous the moment the release commit renamed the
  // heading: `start` was -1, `end` became 7, and the window was the CHANGELOG
  // PREAMBLE — seven lines of boilerplate with zero preset ids in it. Green, and
  // scanning nothing, for this release and every one after. That is the failure
  // mode this repo exists to catch, in a guard written to catch it.
  const start = unreleasedOnly ? all.findIndex((l) => /^## \[(Unreleased|\d)/.test(l)) : 0
  const endOffset = unreleasedOnly
    ? all.slice(start + 1).findIndex((l) => /^## \[/.test(l))
    : all.length
  const end = unreleasedOnly && endOffset >= 0 ? start + 1 + endOffset : all.length
  const lines = all.slice(start < 0 ? 0 : start, end)
  // The window must contain something. A slice that silently empties is the
  // ∀-over-∅ pass, and this file's whole subject is guards that cannot fail.
  if (lines.length === 0)
    throw new Error(`${file}: scan window is empty — the guard would be vacuous`)
  const found = new Map<string, number>()
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/(preset\/[a-z0-9-]+\/[a-z0-9-]+(?:\/[a-z0-9$<>{}-]+)?)/gi)) {
      const id = m[1]
      if (id !== undefined && !found.has(id)) found.set(id, (start < 0 ? 0 : start) + i + 1)
    }
  })
  return found
}

describe('preset ids printed in the docs exist', () => {
  const built = constructedIds()

  it('CONTROL: the derivation actually found the preset ids', () => {
    // Without this, a regex that matched nothing would make every row below
    // vacuous — the ∀-over-∅ pass this repo exists to prevent.
    expect(built.size).toBeGreaterThan(10)
    expect(built).toContain('preset/boundaries/no-duplicate-bodies')
    expect(built).toContain('preset/recommended/no-eval')
  })

  it('CONTROL: an id that does not exist is not in the derived set', () => {
    // The exact wrong id review found, so this guard is proven to be capable of
    // failing rather than merely of passing.
    expect(built.has('preset/boundaries/no-copy-paste')).toBe(false)
  })

  for (const [file, unreleasedOnly] of [
    ['docs/presets.md', false],
    ['CHANGELOG.md', true],
  ] as const) {
    it(`${file}${unreleasedOnly ? ' [Unreleased]' : ''} names only ids some preset constructs`, () => {
      const mentioned = idsMentionedIn(file, unreleasedOnly)
      const unknown = [...mentioned.entries()]
        // `preset/expect-empty/…` and `preset/override/…` are the CONFIG finding
        // namespaces, not rule ids — they are built by wrapping a rule id.
        .filter(([id]) => !id.startsWith('preset/expect-empty/'))
        .filter(([id]) => !id.startsWith('preset/override/'))
        // `no-inline-logic/${api}` is open by construction: the trailing segment
        // is the user's own API name, so only the prefix can be checked.
        .filter(([id]) => !id.startsWith('preset/agent/no-inline-logic/'))
        .filter(([id]) => !built.has(id))
        .map(([id, line]) => `${file}:${line} — ${id}`)
      expect(unknown).toEqual([])
    })
  }
})
