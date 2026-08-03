/**
 * Every relative link between our Markdown documents points at something that
 * exists — [bug 0046](../../bugs/fixed/0046-cross-document-links-rot-silently.md).
 *
 * The `adr/`, `bugs/` and `plans/` corpus is how this project carries decisions
 * forward: almost every code comment of consequence cites one, and the bug
 * documents cross-reference each other heavily. A dead link is a decision nobody
 * can reach, and the rot is **structural** rather than careless — a bug is filed
 * at `bugs/NNNN-name.md`, other documents link to it there, and the day it is
 * fixed it moves to `bugs/fixed/`. Every inbound link dies, silently.
 *
 * Measured when this was written: **82 broken links**, and two of them were rows
 * of `plans/ROADMAP.md` pointing at bugs that had moved.
 *
 * ## Two dialects, deliberately
 *
 * | corpus                                | link style                              |
 * | ------------------------------------- | --------------------------------------- |
 * | `adr/` `bugs/` `plans/` `proposals/`  | relative filesystem paths               |
 * | `docs/`                               | VitePress root-absolute, extensionless  |
 *
 * `docs/` links like `/presets#agentguardrails` are **routes**, not paths, so a
 * filesystem check reports all 159 of them broken. Under the right rule they are
 * all fine — measured, zero broken — and they are the user-facing surface, so
 * they are checked rather than skipped. Getting this wrong in either direction
 * produces a test that is either useless or permanently red.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO = path.resolve(import.meta.dirname, '../..')
/** Filesystem-path corpora. */
const DOC_DIRS = ['adr', 'bugs', 'plans', 'proposals']

/**
 * Root-level prose, which this check did not cover for four releases.
 *
 * Found the way bug 0046 was: by writing a link that did not resolve.
 * `CHANGELOG.md` cited `bugs/fixed/0042-a-configuration-finding-prints-the-rule-authors-remedy.md`,
 * a file that has never existed, and the suite stayed green — the walk started at
 * `adr/`, `bugs/`, `plans/` and `proposals/`, so the four documents at the
 * repository root were the one place a dead link could not be seen.
 *
 * That is backwards from the risk. `CHANGELOG.md` is the most-read document here
 * and the heaviest linker into `bugs/` and `plans/`, and every one of its links
 * points at a file that gets **renamed when the bug is fixed** — which is bug
 * 0046's exact mechanism, aimed at the file with the widest audience.
 *
 * Named explicitly rather than globbed at the root: a glob would walk `dist/`,
 * `node_modules/` and every fixture, and the list of root documents changes about
 * once a year.
 */
const ROOT_DOCS = ['CHANGELOG.md', 'README.md', 'CLAUDE.md', 'ts-archunit-spec.md']
/** VitePress-routed corpus. */
const SITE_DIR = 'docs'

const LINK = /\]\(([^)]+)\)/g
/** Fenced blocks, then inline spans. Order matters — a fence contains backticks. */
const FENCE = /^```[\s\S]*?^```/gm
const INLINE_CODE = /`[^`\n]*`/g

function markdownFiles(dir: string): string[] {
  const root = path.join(REPO, dir)
  if (!fs.existsSync(root)) return []
  const out: string[] = []
  const walk = (d: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name)
      // `dist/` is generated output and `.vitepress/` is config, not prose.
      if (entry.isDirectory()) {
        if (entry.name !== 'dist' && entry.name !== '.vitepress' && entry.name !== 'node_modules') {
          walk(full)
        }
      } else if (entry.name.endsWith('.md')) {
        out.push(full)
      }
    }
  }
  walk(root)
  return out
}

interface Link {
  readonly from: string
  readonly target: string
}

/**
 * Prose only. A link inside a code fence or a backtick span is an **example**,
 * not a reference — the first version of this check reported four such, three of
 * them in documents explaining link syntax, which is the shape that trains a
 * reader to ignore the test. Measured: 82 findings, 78 real.
 */
function prose(text: string): string {
  // Replace with blanks rather than deleting, so nothing is spliced together
  // across a removed region and read as a link that was never written.
  return text
    .replace(FENCE, (m) => ' '.repeat(m.length))
    .replace(INLINE_CODE, (m) => ' '.repeat(m.length))
}

function linksIn(file: string): Link[] {
  const found: Link[] = []
  for (const match of prose(fs.readFileSync(file, 'utf-8')).matchAll(LINK)) {
    const raw = match[1]?.trim()
    if (raw === undefined || raw === '') continue
    // External, in-page anchors and mail links are not ours to resolve.
    if (/^(https?:|mailto:|#)/.test(raw)) continue
    found.push({ from: path.relative(REPO, file), target: raw })
  }
  return found
}

/**
 * A repo-relative link resolves as a filesystem path.
 *
 * A **root-absolute** target is not one: `/cli` in a plan is a link to the
 * published docs site, and plans do cite it. Those are routes wherever they
 * appear, so they route-resolve in both corpora rather than being exempted —
 * exempting them would leave a real class of link unchecked.
 */
function resolvesAsPath(file: string, target: string): boolean {
  if (target.startsWith('/')) return resolvesAsRoute(file, target)
  const withoutAnchor = target.split('#')[0] ?? ''
  if (withoutAnchor === '') return true
  return fs.existsSync(path.resolve(path.dirname(file), withoutAnchor))
}

/** A VitePress route resolves to `<docs>/<route>.md` or `<route>/index.md`. */
function resolvesAsRoute(file: string, target: string): boolean {
  const withoutAnchor = (target.split('#')[0] ?? '').replace(/\/$/, '')
  if (withoutAnchor === '') return true
  const base = withoutAnchor.startsWith('/')
    ? path.join(REPO, SITE_DIR, withoutAnchor.slice(1))
    : path.resolve(path.dirname(file), withoutAnchor)
  return (
    fs.existsSync(base) || fs.existsSync(`${base}.md`) || fs.existsSync(path.join(base, 'index.md'))
  )
}

/**
 * Source files cite these documents too, and heavily — a bug link in a JSDoc
 * block is how a reader of the code reaches the reasoning. The first version of
 * this check walked `.md` only and missed them, which review caught: the guard
 * for bug 0047 linked to `bugs/fixed/` while the bug was still in `bugs/`, and
 * nothing noticed.
 */
function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'dist') walk(full)
      } else if (entry.name.endsWith('.ts')) {
        out.push(full)
      }
    }
  }
  for (const dir of ['src', 'tests']) {
    const root = path.join(REPO, dir)
    if (fs.existsSync(root)) walk(root)
  }
  return out
}

/** Only links that name one of our documents — not every parenthesised URL. */
function documentLinksIn(file: string): Link[] {
  const found: Link[] = []
  for (const match of fs.readFileSync(file, 'utf-8').matchAll(LINK)) {
    const raw = match[1]?.trim()
    if (raw === undefined || !raw.endsWith('.md')) continue
    if (/^(https?:|mailto:)/.test(raw)) continue
    found.push({ from: path.relative(REPO, file), target: raw })
  }
  return found
}

describe('cross-document links resolve (bug 0046)', () => {
  const docFiles = [
    ...DOC_DIRS.flatMap(markdownFiles),
    ...ROOT_DOCS.map((f) => path.join(REPO, f)).filter((f) => fs.existsSync(f)),
  ]
  const siteFiles = markdownFiles(SITE_DIR)

  it('VACUITY: the scan actually found documents and links', () => {
    // A glob that matches nothing passes every assertion below for free — the
    // ∀-over-∅ failure this project is named around. These floors are set well
    // beneath the real numbers so ordinary growth does not trip them, and well
    // above zero so a broken walk cannot pass.
    expect(docFiles.length).toBeGreaterThan(50)
    // Every root document is present BY NAME. `filter(existsSync)` above means a
    // typo in `ROOT_DOCS` drops a file silently, and the count floor is far too
    // coarse to notice four documents going missing.
    for (const name of ROOT_DOCS) {
      expect(docFiles.map((f) => path.relative(REPO, f))).toContain(name)
    }
    expect(siteFiles.length).toBeGreaterThan(10)
    expect(docFiles.flatMap(linksIn).length).toBeGreaterThan(100)
    expect(siteFiles.flatMap(linksIn).length).toBeGreaterThan(50)
  })

  it('every link in adr/, bugs/, plans/, proposals/ and root prose points at a real file', () => {
    const broken = docFiles
      .flatMap((f) => linksIn(f).map((l) => ({ ...l, file: f })))
      .filter((l) => !resolvesAsPath(l.file, l.target))
      .map((l) => `${l.from} -> ${l.target}`)

    // Identities, not a count (ADR-008 rule 4): the message names every dead
    // link, so the failure is the work list.
    expect(broken, `broken links:\n  ${broken.join('\n  ')}`).toEqual([])
  })

  it('every .md link in a source comment points at a real document', () => {
    const files = sourceFiles()
    const links = files.flatMap((f) => documentLinksIn(f).map((l) => ({ ...l, file: f })))

    // Vacuity: source really does cite documents, so an empty result would mean
    // a broken walk rather than a clean repo.
    expect(links.length).toBeGreaterThan(15)

    const broken = links
      .filter((l) => !resolvesAsPath(l.file, l.target))
      .map((l) => `${l.from} -> ${l.target}`)
    expect(broken, `broken document links in source:\n  ${broken.join('\n  ')}`).toEqual([])
  })

  it('every route in docs/ points at a page that exists', () => {
    const broken = siteFiles
      .flatMap((f) => linksIn(f).map((l) => ({ ...l, file: f })))
      .filter((l) => !resolvesAsRoute(l.file, l.target))
      .map((l) => `${l.from} -> ${l.target}`)

    expect(broken, `broken routes:\n  ${broken.join('\n  ')}`).toEqual([])
  })
})
