import { describe, it, expect } from 'vitest'
import { scanMarkdown, format } from './scan-markdown.js'
import type { DeprecatedSymbol } from './deprecated-symbols.js'

/**
 * Synthetic names on purpose. The real vocabulary disappears at 1.0 when the
 * deprecated methods are deleted; the matching ALGEBRA (collision handling, word
 * boundaries, per-line de-duplication) is what these tests pin, and it outlives the
 * names.
 */
const SYNTHETIC: DeprecatedSymbol[] = [
  { name: 'oldSolo', replacement: 'Use `newSolo()`.', declaredAt: 'x.ts:1', collides: false },
  { name: 'oldShared', replacement: 'Use `newShared()`.', declaredAt: 'x.ts:2', collides: true },
  {
    name: 'oldSoloWithOptions',
    replacement: 'Use `newOpts()`.',
    declaredAt: 'x.ts:3',
    collides: false,
  },
]

function names(text: string): string[] {
  return scanMarkdown([{ path: 'f.md', text }], SYNTHETIC).map((hit) => hit.name)
}

describe('scanMarkdown', () => {
  it.each([
    ['dotted call, colliding name', '.oldShared(`X`)', ['oldShared']],
    // The api-reference.md guard: a colliding name documented bare is legitimate.
    ['bare mention, colliding name', '| `oldShared` | desc |', []],
    // The two-column-table case: a solo name has no legitimate bare use.
    ['bare mention, solo name', '| `oldSolo(glob)` | desc |', ['oldSolo']],
    // Right boundary: must not report the shorter name inside the longer one.
    ['longer name is not two hits', '.oldSoloWithOptions([], {})', ['oldSoloWithOptions']],
    ['same symbol twice on one line', '.oldShared(a) .oldShared(b)', ['oldShared']],
    // Known behaviour, pinned deliberately rather than left to chance.
    ['link target counts as a mention', '[oldSolo](/api#oldSolo)', ['oldSolo']],
    ['clean line', 'Use `newSolo()` instead.', []],
  ])('%s', (_label, text, expected) => {
    expect(names(text)).toEqual(expected)
  })

  it('reports each occurrence line separately', () => {
    const hits = scanMarkdown(
      [{ path: 'f.md', text: 'a\n.oldShared(x)\nb\n.oldShared(y)' }],
      SYNTHETIC,
    )
    expect(hits.map((hit) => hit.line)).toEqual([2, 4])
  })

  it('is order-independent (no shared regex lastIndex)', () => {
    // A /g regex reused across lines would make the second call miss.
    const once = names('.oldShared(a)')
    expect(names('.oldShared(a)')).toEqual(once)
    expect(names('.oldShared(a)')).toEqual(once)
  })
})

describe('format', () => {
  it('renders location, fix, and the disambiguation for a colliding name', () => {
    const [hit] = scanMarkdown([{ path: 'docs/x.md', text: '.oldShared(y)' }], SYNTHETIC)
    const text = format(hit!)
    expect(text).toContain('docs/x.md:1')
    expect(text).toContain('`.oldShared()` is deprecated')
    expect(text).toContain('FIX: Use `newShared()`.')
    expect(text).toContain('NOT the `oldShared` export')
  })

  it('omits the disambiguation — and the call form — for a bare solo match', () => {
    const [hit] = scanMarkdown([{ path: 'docs/x.md', text: '| `oldSolo` |' }], SYNTHETIC)
    const text = format(hit!)
    expect(text).toContain('`oldSolo` is deprecated')
    // The line has no call form, so the message must not invent one.
    expect(text).not.toContain('oldSolo()')
    expect(text).not.toContain('NOT the')
  })
})
