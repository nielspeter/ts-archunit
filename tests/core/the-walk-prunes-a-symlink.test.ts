/**
 * A pruned directory is pruned whether it is a real directory or a symlink —
 * [bug 0045](../../bugs/fixed/0045-two-tests-fail-by-environment-and-corrupt-sabotage-verdicts.md).
 *
 * `Dirent.isDirectory()` is **false** for a symlink under `withFileTypes`, which
 * `disk-set.ts` relies on to make symlink loops impossible. The cost was that a
 * symlinked `node_modules` never reached the prune list: it was recorded as a
 * *file*, so a glob beneath it classified `absent` — "no such path" — instead of
 * `not-determined` — "this walk cannot say". Those carry different advice, and
 * `absent` is the one that asserts something false.
 *
 * ## Why it is not only a test-infra bug
 *
 * `pnpm` builds `node_modules` out of symlinks, and `git worktree add` leaves a
 * symlinked one behind in this repo's usual setup. Both get the wrong diagnosis
 * on the shipped code path, not just in CI. It surfaced as a flaky test because
 * that is where it was noticed, not because that is where it lived.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Project } from 'ts-morph'
import { buildDiskSet } from '../../src/core/disk-set.js'
import type { ArchProject } from '../../src/core/project.js'

let root: string
let project: ArchProject

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-archunit-prune-'))
  // A real directory somewhere else, symlinked in as `node_modules` — what pnpm
  // produces, and what `git worktree add` leaves behind in this repo.
  const real = path.join(root, 'elsewhere')
  fs.mkdirSync(path.join(real, 'pkg'), { recursive: true })
  fs.writeFileSync(path.join(real, 'pkg', 'index.ts'), 'export const x = 1\n')
  fs.symlinkSync(real, path.join(root, 'node_modules'))
  // Ordinary source, so the walk has something real to find.
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export const a = 1\n')
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ include: ['src'] }))

  const p = new Project({ tsConfigFilePath: path.join(root, 'tsconfig.json') })
  project = {
    tsConfigPath: path.join(root, 'tsconfig.json'),
    _project: p,
    getSourceFiles: () => p.getSourceFiles(),
  }
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('the walk prunes a symlinked directory by name (bug 0045)', () => {
  it('VACUITY: the fixture really is a symlink, and the walk really classifies', () => {
    // Two ways this file could pass while testing nothing: a fixture whose
    // `node_modules` is an ordinary directory, or a walk that classifies
    // everything the same.
    expect(fs.lstatSync(path.join(root, 'node_modules')).isSymbolicLink()).toBe(true)
    expect(buildDiskSet(project).classify('**/src/**')).toBe('holds-typescript')
  })

  it('a glob under the symlinked node_modules is not-determined, not absent', () => {
    // The bug. `Dirent.isDirectory()` is false for a symlink, so the entry fell
    // past the prune check and was recorded as a FILE — nothing beneath it could
    // ever be `not-determined`, and the glob classified `absent` instead.
    // `absent` says "no such path", which is a claim; `not-determined` says
    // "this walk cannot tell", which is the truth.
    expect(buildDiskSet(project).classify('**/node_modules/nothing-here/**')).toBe('not-determined')
  })

  it('CONTROL: a genuinely absent path is still absent', () => {
    // Without this, "return not-determined for everything" passes the row above
    // — and would destroy the distinction the whole classification exists for.
    expect(buildDiskSet(project).classify('**/no-such-folder-anywhere/**')).toBe('absent')
  })
})
