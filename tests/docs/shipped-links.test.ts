/**
 * The links in the files we PUBLISH have to work from where they are published.
 *
 * `CHANGELOG.md` ships inside the npm package (v0.25.0) because several releases
 * require an action rather than merely describing one, and `node_modules` is
 * where an agent inspecting the installed package looks. But `bugs/`, `plans/`
 * and `src/` are not in `files`, so every relative link in it — all 17 —
 * resolved to nothing from the tarball. Measured on the published 0.25.0
 * artifact, not inferred.
 *
 * Absolute GitHub links fix that and introduce the opposite hazard, which is why
 * this test exists rather than just the rewrite: the repo's link checker only
 * ever validated RELATIVE links, so a `blob/main/...` URL was checked by nothing
 * and rotted in silence. It already had — `plans/0070-a-rule-must-assert-something.md`
 * had moved to `plans/completed/` and the changelog still linked the old path, in
 * two places, shipped.
 *
 * So the property is checked from both directions: no relative link may remain
 * in a shipped file, and every absolute link into this repository must name a
 * path that exists in it.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const BLOB = 'https://github.com/nielspeter/ts-archunit/blob/main/'

/** Files listed in package.json `files` that can contain links. */
const SHIPPED = ['CHANGELOG.md', 'README.md']

const read = (name: string): string => fs.readFileSync(path.join(repoRoot, name), 'utf-8')

describe('files that ship inside the package', () => {
  it('are the ones this test knows about', () => {
    // Derived from package.json rather than hard-coded, so adding a shipped
    // markdown file fails here instead of silently escaping the checks below.
    const pkg: unknown = JSON.parse(read('package.json'))
    const files =
      pkg !== null && typeof pkg === 'object' && 'files' in pkg && Array.isArray(pkg.files)
        ? pkg.files
        : []
    const shippedMarkdown = files.filter(
      (f: unknown): f is string => typeof f === 'string' && f.endsWith('.md'),
    )
    expect([...shippedMarkdown].sort()).toEqual([...SHIPPED].sort())
  })

  for (const name of SHIPPED) {
    it(`${name} has no relative links, because the directories they point at are not published`, () => {
      const relative = [...read(name).matchAll(/\]\((\.{1,2}\/[^)#\s]*)/g)].map((m) => m[1])
      // README's links into `docs/` are the exception this asserts against:
      // `docs/` is not shipped either, so a relative link there is broken in the
      // tarball exactly as the changelog's were.
      expect(relative).toEqual([])
    })
  }
})

describe('absolute links into this repository', () => {
  // The half nothing checked. A `blob/main/...` URL is invisible to a
  // relative-link checker, so it rots the moment a file moves — and files in
  // this repo move on purpose (`bugs/X` → `bugs/fixed/X`, `plans/X` →
  // `plans/completed/X`). Validated against the working tree, which is a
  // different derivation from the URL itself.
  const sources = [...SHIPPED, 'plans/ROADMAP.md']

  it('name paths that exist', () => {
    const broken: string[] = []
    let total = 0
    for (const name of sources) {
      for (const match of read(name).matchAll(
        new RegExp(BLOB.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^)\\s#]+)', 'g'),
      )) {
        total += 1
        const target = match[1]
        if (target !== undefined && !fs.existsSync(path.join(repoRoot, target))) {
          broken.push(`${name} -> ${target}`)
        }
      }
    }
    // Non-vacuity: if the regex stops matching, this test silently certifies
    // nothing. The changelog alone carries about twenty.
    expect(total).toBeGreaterThan(15)
    expect(broken).toEqual([])
  })
})
