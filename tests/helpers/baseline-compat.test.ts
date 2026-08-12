/**
 * The two ways a baseline can be wrong about itself (bug 0010, review round).
 *
 * Both were reproduced by reviewers against code that had no test covering
 * them, and both fail in the same direction: the run goes red and the reason
 * given is not the real one.
 *
 * 1. A v1 baseline that still matches. v2 hashing is byte-identical to v1 for
 *    any violation whose fields contain no path, so most existing baselines
 *    were never broken. Failing them on the version field alone is a false red
 *    carrying a false statement.
 * 2. Generation and loading discovering different roots. Silent, because the
 *    format version is identical on both sides.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { generateBaseline, withBaseline, hashViolation } from '../../src/helpers/baseline.js'
import type { ArchViolation } from '../../src/core/violation.js'

const created: string[] = []

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
  }
})

function scratch(marker: '.git' | 'package.json' | 'pnpm-workspace.yaml' | 'none'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archunit-compat-'))
  created.push(dir)
  if (marker === '.git') fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /elsewhere\n')
  if (marker === 'package.json') fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"x"}')
  if (marker === 'pnpm-workspace.yaml')
    fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")
  return dir
}

/** A violation with no path anywhere in it — the common case. */
const pathFree: ArchViolation = {
  rule: 'classes should not contain call to parseInt',
  element: 'OrderService.total',
  file: '/anywhere/src/order.ts',
  line: 12,
  message: 'OrderService.total contains call to parseInt',
}

describe('a v1 baseline that still matches must not be failed (review C1)', () => {
  it('stays green when its entries match, despite the older format', () => {
    const root = scratch('.git')
    const file = path.join(root, 'baseline.json')
    // A genuine v1 file: no hashVersion, hashes computed without a root.
    fs.writeFileSync(
      file,
      JSON.stringify({
        generatedAt: '2026-01-01T00:00:00.000Z',
        count: 1,
        violations: [
          { rule: pathFree.rule, file: 'src/order.ts', line: 12, hash: hashViolation(pathFree) },
        ],
      }),
    )

    const baseline = withBaseline(file)
    // Precondition: the entry really does still match, or this proves nothing.
    expect(baseline.isKnown(pathFree), 'v1 hash must still match for path-free fields').toBe(true)

    const remaining = baseline.filterNew([pathFree])
    expect(remaining, 'a working baseline must not be failed for being v1').toEqual([])
  })

  it('fails, and says so accurately, when the entries match nothing', () => {
    const root = scratch('.git')
    const file = path.join(root, 'baseline.json')
    fs.writeFileSync(
      file,
      JSON.stringify({
        generatedAt: '2026-01-01T00:00:00.000Z',
        count: 2,
        violations: [
          { rule: 'r', file: 'a.ts', line: 1, hash: 'deadbeefdeadbeef' },
          { rule: 'r', file: 'b.ts', line: 2, hash: 'cafebabecafebabe' },
        ],
      }),
    )

    const remaining = withBaseline(file).filterNew([pathFree])
    const meta = remaining.filter((v) => v.bypassFilters === true)
    expect(meta).toHaveLength(1)
    // The message must state the measurement, not a guess from the version field.
    expect(meta[0]?.message).toContain('matched 0 of its 2 entries')
    expect(meta[0]?.message).toContain('identity format v1')
    // The real finding is still reported — the meta-finding is additional.
    expect(remaining).toHaveLength(2)
  })

  it('says nothing when the run produced nothing to match', () => {
    const root = scratch('.git')
    const file = path.join(root, 'baseline.json')
    fs.writeFileSync(
      file,
      JSON.stringify({
        generatedAt: '2026-01-01T00:00:00.000Z',
        count: 1,
        violations: [{ rule: 'r', file: 'a.ts', line: 1, hash: 'deadbeefdeadbeef' }],
      }),
    )
    // An empty run is not evidence about the baseline.
    expect(withBaseline(file).filterNew([])).toEqual([])
  })

  it('a same-version baseline that matches nothing keeps the root explanation', () => {
    // 0.23.0 drafted HASH_VERSION 2 -> 3 to signal that accumulate (bug 0020)
    // changes the hashed rule description. Withdrawn, and this test is the
    // inversion: `hashViolation` never reads the constant, so the bump matched
    // no entry differently — its ONLY effect was to route every pre-0.23.0
    // baseline into the version-mismatch branch and tell the reader the format
    // was "the likely cause", which cannot be true. The current version is what
    // any live baseline declares, so the branch a real user reaches is this one,
    // and it must keep naming the cause that can actually be theirs.
    const root = scratch('.git')
    const file = path.join(root, 'baseline.json')
    fs.writeFileSync(
      file,
      JSON.stringify({
        generatedAt: '2026-07-28T00:00:00.000Z',
        hashVersion: 5,
        count: 1,
        violations: [{ rule: 'r', file: 'a.ts', line: 1, hash: 'deadbeefdeadbeef' }],
      }),
    )
    const meta = withBaseline(file)
      .filterNew([pathFree])
      .filter((v) => v.bypassFilters === true)
    // **It must NOT assert a single cause.** This asserted `'different repository root'`
    // as "the likely cause" until v0.54.0, and the code had checked none of the
    // alternatives — bug 0060, where a shipped default pattern changed, both the rule
    // and the subject moved together so the rename detector stayed silent, and a reader
    // spent an hour on `root` before regenerating.
    expect(meta[0]?.message).toContain('one of its INPUTS moved')
    expect(meta[0]?.message).toContain('This code cannot tell which')
    // The candidate the old text omitted, and the commonest one: upgrading.
    expect(meta[0]?.message).toContain('CHANGELOG')
    // The root is still offered — as a candidate, not as a verdict.
    expect(meta[0]?.message).toContain('different repository root')
    expect(meta[0]?.message).not.toContain('the likely cause is')
    expect(meta[0]?.message).not.toContain('identity format v2 and this version reads')
    // And the remedy it prints must be runnable. It named `baseline --output X`
    // with no rule files, which exits 1 with "No rule files specified" — a
    // remedy that cannot remediate (ADR-008 rule 2), measured.
    expect(meta[0]?.suggestion).toContain('Regenerate')
    expect(meta[0]?.suggestion).toContain('<your-rule-files>')
  })

  it('the declared version is what the current constant writes, so v2 files still match', () => {
    // The two derivations that must agree: what `generateBaseline` stamps, and
    // what `withBaseline` treats as current. Any bump is caught here — the
    // suite once pinned only "older than current", so a bump was caught by
    // nothing. Updated deliberately at 3 -> 4 (bug 0012: metric findings carry
    // an identity and an accepted measurement, so their hashes moved), and at
    // 4 -> 5 (plan 0104: cycle findings carry a per-edge identity).
    const root = scratch('.git')
    const file = path.join(root, 'baseline.json')
    generateBaseline([pathFree], file, { root })
    const written: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'))
    expect(JSON.stringify(written)).toContain('"hashVersion":5')
    // Same file, read back: matches, and produces no meta-finding.
    expect(withBaseline(file, { root }).filterNew([pathFree])).toEqual([])
  })

  it('tells the reader to upgrade, not regenerate, when the file is newer', () => {
    const root = scratch('.git')
    const file = path.join(root, 'baseline.json')
    fs.writeFileSync(
      file,
      JSON.stringify({
        generatedAt: '2026-01-01T00:00:00.000Z',
        hashVersion: 99,
        count: 1,
        violations: [{ rule: 'r', file: 'a.ts', line: 1, hash: 'deadbeefdeadbeef' }],
      }),
    )
    const meta = withBaseline(file)
      .filterNew([pathFree])
      .filter((v) => v.bypassFilters === true)
    expect(meta[0]?.suggestion).toContain('Upgrade ts-archunit')
    expect(meta[0]?.suggestion).not.toContain('Regenerate')
  })
})

describe('the recorded root keeps generate and load in agreement (review C2)', () => {
  it('matches even when the loading machine would discover a different root', () => {
    // Generate inside a repo that HAS a marker at the top…
    const repo = scratch('pnpm-workspace.yaml')
    const pkgDir = path.join(repo, 'packages', 'api')
    fs.mkdirSync(pkgDir, { recursive: true })
    fs.writeFileSync(path.join(pkgDir, 'package.json'), '{"name":"api"}')

    const finding: ArchViolation = {
      rule: 'no direct db access',
      element: 'handler',
      file: path.join(pkgDir, 'src', 'handler.ts'),
      line: 3,
      message: `handler reads ${path.join(pkgDir, 'src', 'handler.ts')} directly`,
    }
    const file = path.join(pkgDir, 'baseline.json')
    generateBaseline([finding], file)

    const written: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'))
    expect(written).toHaveProperty('root')

    // …then remove the marker, which is what a container build does to `.git`.
    // Re-discovery would now anchor on packages/api instead of the repo root.
    fs.rmSync(path.join(repo, 'pnpm-workspace.yaml'))
    expect(withBaseline(file).filterNew([finding])).toEqual([])
  })

  it('an explicit root still overrides the recorded one', () => {
    const repo = scratch('.git')
    const finding: ArchViolation = { ...pathFree, file: path.join(repo, 'a.ts') }
    const file = path.join(repo, 'baseline.json')
    generateBaseline([finding], file)
    // Deliberately wrong root — the caller is overriding on purpose, so the
    // override must win even though the file records the right answer.
    const other = scratch('.git')
    expect(withBaseline(file, { root: other }).isKnown(finding)).toBe(true)
    // (path-free identity, so it matches either way — assert the override is
    // actually consulted by checking a path-bearing finding instead.)
    const pathBearing: ArchViolation = {
      ...finding,
      message: `reads ${path.join(repo, 'a.ts')}`,
    }
    generateBaseline([pathBearing], file)
    expect(withBaseline(file).isKnown(pathBearing), 'recorded root matches').toBe(true)
    expect(
      withBaseline(file, { root: other }).isKnown(pathBearing),
      'a wrong explicit root must NOT match — proving the option is honoured',
    ).toBe(false)
  })
})
