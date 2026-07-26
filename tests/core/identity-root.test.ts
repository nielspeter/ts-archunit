/**
 * Identity-root discovery (bug 0010).
 *
 * The root chosen here decides whether a baseline is portable. Every case
 * below is one where picking the wrong ancestor silently reintroduces
 * machine-dependent identity — silently, because the baseline still writes,
 * the local run is still green, and only CI disagrees.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  discoverIdentityRoot,
  toPortablePath,
  normalizeIdentityText,
} from '../../src/core/identity-root.js'

const created: string[] = []

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
  }
})

function scratch(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-archunit-root-'))
  created.push(dir)
  return dir
}

function make(base: string, relative: string, markers: Record<string, string>): string {
  const dir = path.join(base, relative)
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, contents] of Object.entries(markers)) {
    fs.writeFileSync(path.join(dir, name), contents)
  }
  return dir
}

describe('discoverIdentityRoot', () => {
  it('finds the repository root from a nested start directory', () => {
    const base = scratch()
    const repo = make(base, 'repo', { '.git': '' })
    const nested = make(base, 'repo/apps/api/tests', {})

    expect(discoverIdentityRoot(nested)).toBe(repo)
  })

  it('treats a worktree/submodule .git FILE as a root, not just a directory', () => {
    const base = scratch()
    // git writes a `gitdir:` pointer file, not a directory, in a worktree —
    // the exact layout used to prove cross-checkout portability.
    const worktree = make(base, 'checkout', { '.git': 'gitdir: /elsewhere/.git/worktrees/x\n' })
    const nested = make(base, 'checkout/packages/core', {})

    expect(discoverIdentityRoot(nested)).toBe(worktree)
  })

  it('stops at the NEAREST repo when an ancestor is also a repo', () => {
    // The case that makes "outermost" wrong: a home directory under dotfiles
    // version control. Anchoring above the checkout leaves the machine-specific
    // `projects/<name>` segments inside the "relative" path, so identity still
    // moves between machines — the bug, reintroduced by the fix.
    const base = scratch()
    make(base, 'home', { '.git': '' })
    const inner = make(base, 'home/projects/app', { '.git': '' })
    const nested = make(base, 'home/projects/app/src/services', {})

    expect(discoverIdentityRoot(nested)).toBe(inner)
  })

  it('prefers a workspace package.json over a nested package', () => {
    const base = scratch()
    const workspaceRoot = make(base, 'mono', {
      'package.json': JSON.stringify({ name: 'mono', workspaces: ['apps/*'] }),
    })
    const app = make(base, 'mono/apps/api', { 'package.json': '{"name":"api"}' })
    const nested = make(base, 'mono/apps/api/tests', {})

    // Anchoring on `app` would leave every sibling-package path absolute.
    expect(discoverIdentityRoot(nested)).toBe(workspaceRoot)
    expect(discoverIdentityRoot(nested)).not.toBe(app)
  })

  it('recognises monorepo roots that do not use the package.json workspaces key', () => {
    // The realistic failure: `.git` is absent (Docker build, source tarball,
    // CI source artifact) and the manager is pnpm or Nx, which declare
    // workspaces in a FILE. Without these markers the walk falls through to the
    // nearest package.json — the individual package — so the dev machine and CI
    // disagree and every hash differs, silently.
    for (const marker of ['pnpm-workspace.yaml', 'lerna.json', 'rush.json', 'nx.json']) {
      const base = scratch()
      const workspaceRoot = make(base, 'mono', { [marker]: '{}' })
      const pkg = make(base, 'mono/packages/api', { 'package.json': '{"name":"api"}' })
      const nested = make(base, 'mono/packages/api/src', {})

      expect(discoverIdentityRoot(nested), marker).toBe(workspaceRoot)
      // Precondition: without the marker this would anchor on the package, so
      // the assertion above is not passing for a boring reason.
      expect(discoverIdentityRoot(nested), marker).not.toBe(pkg)
    }
  })

  it('does NOT treat turbo.json as a root marker', () => {
    // turbo.json is legal inside a package (Package Configurations), so
    // honouring it would anchor BELOW the workspace root — the divergence the
    // marker list exists to prevent. Turborepo runs on npm/pnpm/yarn
    // workspaces, so the real root is always found by another marker.
    const base = scratch()
    const workspaceRoot = make(base, 'mono', {
      'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
    })
    make(base, 'mono/packages/api', { 'package.json': '{"name":"api"}', 'turbo.json': '{}' })
    const nested = make(base, 'mono/packages/api/src', {})

    expect(discoverIdentityRoot(nested)).toBe(workspaceRoot)
  })

  it('falls back to the nearest package.json when there is no repo or workspace', () => {
    const base = scratch()
    const pkg = make(base, 'loose/project', { 'package.json': '{"name":"solo"}' })
    const nested = make(base, 'loose/project/src', {})

    expect(discoverIdentityRoot(nested)).toBe(pkg)
  })

  it('survives a malformed package.json rather than throwing', () => {
    const base = scratch()
    const repo = make(base, 'repo', { '.git': '' })
    make(base, 'repo/broken', { 'package.json': '{ not json' })
    const nested = make(base, 'repo/broken/src', {})

    expect(discoverIdentityRoot(nested)).toBe(repo)
  })
})

describe('toPortablePath', () => {
  it('strips the root prefix', () => {
    expect(toPortablePath('/repo/src/a.ts', '/repo')).toBe('src/a.ts')
    expect(toPortablePath('/repo/src/a.ts', '/repo/')).toBe('src/a.ts')
  })

  it('leaves a path outside the root alone rather than emitting ../..', () => {
    // `../../..` chains encode how deep the root sits, which is exactly the
    // machine-specific fact being removed.
    expect(toPortablePath('/elsewhere/src/a.ts', '/repo')).toBe('/elsewhere/src/a.ts')
  })

  it('normalizes Windows separators so a baseline crosses operating systems', () => {
    expect(toPortablePath('C:\\repo\\src\\a.ts', 'C:\\repo')).toBe('src/a.ts')
  })

  it('does not treat a sibling directory with a shared prefix as inside the root', () => {
    expect(toPortablePath('/repo-backup/src/a.ts', '/repo')).toBe('/repo-backup/src/a.ts')
  })
})

describe('normalizeIdentityText', () => {
  it('replaces every occurrence of the root, including several in one message', () => {
    const message = 'a (/repo/src/x.ts:2) is 90% similar to b (/repo/src/y.ts:7)'
    expect(normalizeIdentityText(message, '/repo')).toBe(
      'a (<root>src/x.ts:2) is 90% similar to b (<root>src/y.ts:7)',
    )
  })

  it('gives the same result whether or not the root has a trailing separator', () => {
    const message = 'found in /repo/src/x.ts'
    expect(normalizeIdentityText(message, '/repo')).toBe(normalizeIdentityText(message, '/repo/'))
  })

  it('leaves backslashes in the surrounding text alone', () => {
    // Rule descriptions embed regex sources. Rewriting their backslashes would
    // let two genuinely different rules collide on a single identity.
    const rule = String.raw`functions that have name matching /\bparse/ should not contain call 'x'`
    expect(normalizeIdentityText(rule, '/repo')).toBe(rule)
  })

  it('does not touch text that never mentions the root', () => {
    const message = 'OrderService imports from **/internal/**'
    expect(normalizeIdentityText(message, '/repo')).toBe(message)
  })
})
