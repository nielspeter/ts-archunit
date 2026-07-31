import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const DOCS_DIR = path.resolve(import.meta.dirname, '../../docs')
const REPO_ROOT = path.resolve(import.meta.dirname, '../..')

/**
 * `upgrading.md` is a historical record, not a teaching page: its per-release
 * table describes what each version *changed*, so the 0.32.0 row correctly says
 * the command is "documented as supported rather than experimental". Scanning it
 * reddens a correct page, and a scan that reddens correct pages gets suppressed
 * — the outcome ADR-008 rule 3 warns about, and the reason `scan-markdown.ts`
 * distinguishes colliding from solo names. Its anchor check still applies: a
 * dead link is wrong in a historical page too.
 */
const NARRATES_ITS_OWN_HISTORY = 'upgrading.md'

/** Every living doc page, plus the README. `.vitepress/` is build output. */
function livingDocs(): { path: string; text: string }[] {
  const pages = fs
    .readdirSync(DOCS_DIR)
    .filter((name) => name.endsWith('.md'))
    .map((name) => path.join(DOCS_DIR, name))
  return [...pages, path.join(REPO_ROOT, 'README.md')].map((file) => ({
    path: path.relative(REPO_ROOT, file),
    text: fs.readFileSync(file, 'utf8'),
  }))
}

/**
 * Plan 0077 promoted `doctor` from hidden experiment to supported command.
 *
 * The promotion is spread over prose in two pages, a help string and a dispatch
 * comment, and the word it removes appears in ordinary sentences — so a reader
 * re-adding "experimental" next to `doctor`, or a page that was simply missed,
 * leaves the docs contradicting `--help` with nothing to catch it. The plan's
 * test inventory claimed this guard existed before it did; review found the row
 * describing a test nobody had written.
 */
describe('docs do not call doctor experimental (plan 0077)', () => {
  it('has no page pairing the command with the word', () => {
    const offenders: string[] = []
    const pages = livingDocs().filter((f) => !f.path.endsWith(NARRATES_ITS_OWN_HISTORY))
    // The exemption is one named file, so a page that quietly stops being scanned
    // cannot happen by a glob drifting.
    expect(livingDocs().length - pages.length).toBe(1)
    for (const file of pages) {
      file.text.split('\n').forEach((line, index) => {
        if (!/\bdoctor\b/.test(line)) return
        if (!/experimental/i.test(line)) return
        offenders.push(`${file.path}:${index + 1}: ${line.trim()}`)
      })
    }
    // The list, not the count — ADR-008 rule 4. A count tells the next reader to
    // go hunting; the line tells them what to edit.
    expect(offenders).toEqual([])
  })

  it('has no link left pointing at the retired #diagnostics-experimental anchor', () => {
    const offenders: string[] = []
    for (const file of livingDocs()) {
      file.text.split('\n').forEach((line, index) => {
        if (!line.includes('diagnostics-experimental')) return
        offenders.push(`${file.path}:${index + 1}: ${line.trim()}`)
      })
    }
    // A dead in-page anchor renders as a link that silently lands at the top of
    // the page — the reader never learns they missed the section.
    expect(offenders).toEqual([])
  })
})
