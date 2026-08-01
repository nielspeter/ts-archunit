import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { workspace, modules } from '../../src/index.js'
import { resolveByDefinition } from '../../src/models/slice.js'

const fixture = path.resolve(import.meta.dirname, '../fixtures/workspace-roots')
const alpha = path.join(fixture, 'packages/alpha/tsconfig.json')
const beta = path.join(fixture, 'packages/beta/tsconfig.json')

/**
 * A workspace has no single root — bug 0035.
 *
 * `workspace([a, b])` sets `ArchProject.tsConfigPath` to the **alphabetically
 * first** config, so resolving "the project root" from it meant *that one
 * package*: measured, `'src/api/**'` matched `packages/alpha` and not
 * `packages/beta`, and renaming a package — or adding one called `aaa` —
 * silently changed which one it meant.
 *
 * That is the machine-dependent shape [bug 0011](../../bugs/fixed/0011-dogfood-rules-select-nothing.md)
 * already cost this project once: a rule scoped by a name nobody chose
 * deliberately. Each file now resolves against **the root that contains it**.
 */
describe('a relative glob resolves per package in a workspace (bug 0035)', () => {
  const p = workspace([alpha, beta])

  it('the fixture really is a workspace, and tsConfigPath really is just one of them', () => {
    // Both halves matter: without two packages the test proves nothing, and if
    // `tsConfigPath` ever became something else the bug would be gone for a
    // different reason than the fix.
    expect(p.getSourceFiles()).toHaveLength(2)
    expect(p.tsConfigPath).toBe(alpha)
  })

  it('assignedFrom matches the folder in EVERY package, not just the primary', () => {
    const files = resolveByDefinition(p, { api: 'src/api/**' })[0]?.files ?? []
    expect(files.map((f) => f.getFilePath()).sort()).toEqual(
      [
        path.join(fixture, 'packages/alpha/src/api/handler.ts'),
        path.join(fixture, 'packages/beta/src/api/handler.ts'),
      ].sort(),
    )
  })

  it('the path predicates do the same', () => {
    // v0.35.0 shipped this behaviour for the predicates first, via ts-morph's
    // `configFilePath` — which is also the primary. Same bug, same fix.
    expect(modules(p).that().resideInFolder('src/api/**').subjects()).toHaveLength(2)
  })

  it('agrees with the anchored spelling here, because every package matches', () => {
    // In a workspace the two spellings coincide for a folder every package has.
    // They diverge only when one package lacks it — which is the next test.
    expect(modules(p).that().resideInFolder('**/src/api/**').subjects()).toHaveLength(2)
  })

  it('CONTROL: still selects nothing for a folder no package has', () => {
    expect(resolveByDefinition(p, { api: 'src/no-such/**' })[0]?.files ?? []).toEqual([])
    expect(modules(p).that().resideInFolder('src/no-such/**').subjects()).toEqual([])
  })

  it('CONTROL: a single-tsconfig project is unchanged', () => {
    // The fix must not alter the case that already worked: one root, and a
    // relative glob means that root's folder.
    const single = workspace([alpha])
    expect(resolveByDefinition(single, { api: 'src/api/**' })[0]?.files).toHaveLength(1)
  })
})
