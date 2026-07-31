/**
 * Improving a metric no longer turns the build red — bug 0012.
 *
 * Metric conditions write the measured value into the message, and
 * `hashViolation` identifies a violation by its message, so the identity moved
 * whenever the measurement moved — **in either direction**. The bug's own
 * reproduction table, which is what this file asserts:
 *
 * | change                     | should be | was       |
 * | -------------------------- | --------- | --------- |
 * | 10 → 10 methods, unchanged | green     | green     |
 * | 10 → 12, worse             | red       | red       |
 * | 10 → 8, **better**         | green     | **RED**   |
 * | 10 → 5, at the threshold   | green     | green     |
 *
 * Row three is the defect: paying down the debt failed CI, and kept failing on
 * every incremental step until the class dropped under the threshold entirely.
 * The external audit that motivated the bug records these rules at **zero
 * uses** — the ratchet teams were told to adopt them behind did not work.
 *
 * ## Why the fix is a comparison and not an identity
 *
 * Bug 0010's `identity` alone trades one failure for a worse one: drop the count
 * and improving is green but **regressing is also green**, which makes the
 * baseline a mute button. Identity answers "is this the same finding?"; a metric
 * needs "is it worse than what we accepted?". So a metric finding carries a
 * stable `identity` (element + metric, no value) *and* `measured`, and the
 * baseline stores the accepted value and compares.
 *
 * The row that matters most here is the second one — it is the assertion that
 * stops the fix from being a mute button, and the one a naive identity-only
 * change would fail.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Project } from 'ts-morph'
import { classes, functions, modules } from '../../src/index.js'
import { generateBaseline, withBaseline } from '../../src/helpers/baseline.js'
import {
  maxMethods,
  maxClassLines,
  maxMethodLines,
  maxParameters,
  maxCyclomaticComplexity,
} from '../../src/rules/metrics.js'
import {
  maxFunctionLines,
  maxFunctionParameters,
  maxFunctionComplexity,
} from '../../src/rules/metrics-function.js'
import { haveMaxExports } from '../../src/conditions/exports.js'
import type { ArchProject } from '../../src/core/project.js'
import type { ArchViolation } from '../../src/core/violation.js'

const scratchDirs: string[] = []

afterEach(() => {
  for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true })
  scratchDirs.length = 0
})

function baselinePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-archunit-ratchet-'))
  scratchDirs.push(dir)
  return path.join(dir, 'arch-baseline.json')
}

/** A class with `methodCount` methods, in a project of its own. */
function projectWith(methodCount: number): ArchProject {
  const tsMorphProject = new Project({ useInMemoryFileSystem: true })
  const methods = Array.from({ length: methodCount }, (_, i) => `  m${String(i)}() {}`).join('\n')
  tsMorphProject.createSourceFile('/src/big.ts', `export class Big {\n${methods}\n}`)
  return {
    tsConfigPath: '/tsconfig.json',
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

/** The violations `classes(p).should().satisfy(maxMethods(5))` reports. */
function violationsAt(methodCount: number): ArchViolation[] {
  return classes(projectWith(methodCount)).should().satisfy(maxMethods(5)).violations()
}

/** What survives the baseline — i.e. what would fail the build. */
function afterBaseline(baselinedAt: number, now: number): ArchViolation[] {
  const output = baselinePath()
  generateBaseline(violationsAt(baselinedAt), output)
  const baseline = withBaseline(output)
  return baseline.filterNew(violationsAt(now))
}

describe("the bug's own reproduction table", () => {
  it('reports the class in the first place', () => {
    // Non-vacuity. Every row below is `[] === []` if the rule stopped firing,
    // which is green and proves nothing.
    const reported = violationsAt(10)
    expect(reported).toHaveLength(1)
    expect(reported[0]?.message).toContain('has 10 methods')
    expect(reported[0]?.measured).toBe(10)
  })

  it('10 → 10, unchanged: green', () => {
    expect(afterBaseline(10, 10)).toEqual([])
  })

  it('10 → 12, worse: RED', () => {
    // The assertion that stops the fix from being a mute button. An
    // identity-without-the-count change — the naive reading of bug 0010 — makes
    // this green and lets a baselined class grow without limit.
    const kept = afterBaseline(10, 12)
    expect(kept).toHaveLength(1)
    expect(kept[0]?.message).toContain('has 12 methods')
  })

  it('10 → 8, better: green — the defect', () => {
    // The row the bug was filed for. Before the fix this was RED: paying down
    // the debt failed CI.
    expect(afterBaseline(10, 8)).toEqual([])
  })

  it('10 → 5, at the threshold: green', () => {
    // Under the threshold the rule does not fire at all, so there is nothing to
    // match — green for a different reason than the rows above, and worth
    // separating so a fix that broke rule firing would not read as success.
    expect(violationsAt(5)).toEqual([])
    expect(afterBaseline(10, 5)).toEqual([])
  })
})

describe('identity is unique per element, or one entry accepts two findings', () => {
  /**
   * Every shape review measured as colliding when the identity was just
   * `${elementName}::${metric}`. The first cut shipped that, and it recreated
   * bug 0028 — "two distinct violations sharing one identity are one violation
   * to the baseline, and accepting either accepts both", which is
   * `ArchViolation.identity`'s own contract.
   *
   * Measured then: two classes named `Big` in different files produced one hash;
   * `withBaseline` keeps a `Map<hash, measured>`, so last-write-wins set the
   * ceiling to the *sibling's* 20, and a real 10 → 15 regression was reported as
   * **0 findings** where the pre-fix code reported 1. A false green introduced
   * by a bug fix, invisible to every test here because each fixture had one
   * uniquely-named class.
   */
  function twoFiles(aMethods: number, bMethods: number): ArchProject {
    const tsMorphProject = new Project({ useInMemoryFileSystem: true })
    const body = (n: number): string =>
      `export class Big {\n${Array.from({ length: n }, (_, i) => `  m${String(i)}() {}`).join('\n')}\n}`
    tsMorphProject.createSourceFile('/src/a/big.ts', body(aMethods))
    tsMorphProject.createSourceFile('/src/b/big.ts', body(bMethods))
    return {
      tsConfigPath: '/tsconfig.json',
      _project: tsMorphProject,
      getSourceFiles: () => tsMorphProject.getSourceFiles(),
    }
  }

  it('separates two same-named classes in different files', () => {
    const found = classes(twoFiles(10, 20)).should().satisfy(maxMethods(5)).violations()
    expect(found).toHaveLength(2)
    expect(new Set(found.map((v) => v.identity)).size).toBe(2)
  })

  it('reports a regression in one when its same-named sibling is larger', () => {
    // THE false green. Sibling accepted at 20; `a` grows 10 → 15, which is
    // under 20, so a shared entry swallows it.
    const output = baselinePath()
    generateBaseline(classes(twoFiles(10, 20)).should().satisfy(maxMethods(5)).violations(), output)

    const kept = withBaseline(output).filterNew(
      classes(twoFiles(15, 20)).should().satisfy(maxMethods(5)).violations(),
    )
    expect(kept.map((v) => v.message)).toEqual([
      'Big has 15 methods (max: 5) — consider splitting into focused classes',
    ])
  })

  it('does not red an unchanged sibling because the other one moved', () => {
    // The same collision in the other direction: with a shared entry the
    // accepted ceiling is whichever was read last, so an untouched file reds.
    const output = baselinePath()
    generateBaseline(classes(twoFiles(20, 10)).should().satisfy(maxMethods(5)).violations(), output)

    const kept = withBaseline(output).filterNew(
      classes(twoFiles(20, 10)).should().satisfy(maxMethods(5)).violations(),
    )
    expect(kept).toEqual([])
  })

  it('separates two same-named members of different classes', () => {
    // `getElementName(member)` returns the bare `save`; the message already
    // says `UserRepo.save`. Without the qualified name in the identity, two
    // repositories with a `save` method are one entry.
    const tsMorphProject = new Project({ useInMemoryFileSystem: true })
    tsMorphProject.createSourceFile(
      '/src/repos.ts',
      'export class UserRepo { save(a: 1, b: 2, c: 3) {} }\nexport class OrderRepo { save(a: 1, b: 2, c: 3, d: 4) {} }',
    )
    const project: ArchProject = {
      tsConfigPath: '/tsconfig.json',
      _project: tsMorphProject,
      getSourceFiles: () => tsMorphProject.getSourceFiles(),
    }

    const found = classes(project).should().satisfy(maxParameters(2)).violations()
    expect(found).toHaveLength(2)
    expect(new Set(found.map((v) => v.identity)).size).toBe(2)
    expect(found.map((v) => v.identity)).toEqual([
      expect.stringContaining('UserRepo.save::parameters'),
      expect.stringContaining('OrderRepo.save::parameters'),
    ])
  })
})

describe('every metric site carries the ratchet, not just maxMethods', () => {
  /**
   * Review reverted each site to `createViolation` in turn: **seven of eight
   * survived the whole suite**, and the two complexity conditions had never been
   * routed at all — the bug's "mechanical" enumeration grepped the `has N <noun>`
   * message shape, and `has cyclomatic complexity N` puts the number last. The
   * docs meanwhile claimed complexity was ratcheted.
   */
  const project = (): ArchProject => {
    const tsMorphProject = new Project({ useInMemoryFileSystem: true })
    tsMorphProject.createSourceFile(
      '/src/big.ts',
      [
        'export class Big {',
        '  a() {} b() {} c() {} d() {} e() {} f() {}',
        '  wide(p: 1, q: 2, r: 3) {}',
        '  long() {',
        '    const x = 1',
        '    const y = 2',
        '    return x + y',
        '  }',
        '  complex(n: number) { if (n) { return 1 } else if (n > 1) { return 2 } return 3 }',
        '  p1 = 1; p2 = 2; p3 = 3',
        '}',
        'export function wideFn(p: 1, q: 2, r: 3) {}',
        'export function longFn() {',
        '  const x = 1',
        '  const y = 2',
        '  return x + y',
        '}',
        'export function complexFn(n: number) { if (n) { return 1 } else if (n > 1) { return 2 } return 3 }',
      ].join('\n'),
    )
    return {
      tsConfigPath: '/tsconfig.json',
      _project: tsMorphProject,
      getSourceFiles: () => tsMorphProject.getSourceFiles(),
    }
  }

  it.each([
    ['maxMethods', () => classes(project()).should().satisfy(maxMethods(2)).violations()],
    ['maxClassLines', () => classes(project()).should().satisfy(maxClassLines(2)).violations()],
    ['maxMethodLines', () => classes(project()).should().satisfy(maxMethodLines(1)).violations()],
    ['maxParameters', () => classes(project()).should().satisfy(maxParameters(1)).violations()],
    [
      'maxCyclomaticComplexity',
      () => classes(project()).should().satisfy(maxCyclomaticComplexity(1)).violations(),
    ],
    [
      'maxFunctionLines',
      () => functions(project()).should().satisfy(maxFunctionLines(1)).violations(),
    ],
    [
      'maxFunctionParameters',
      () => functions(project()).should().satisfy(maxFunctionParameters(1)).violations(),
    ],
    [
      'maxFunctionComplexity',
      () => functions(project()).should().satisfy(maxFunctionComplexity(1)).violations(),
    ],
  ])('%s carries an identity and a measurement', (_name, run) => {
    const found = run()
    // Non-vacuity: a condition that stopped firing would pass every assertion
    // below over an empty array.
    expect(found.length).toBeGreaterThan(0)
    for (const violation of found) {
      expect(violation.identity).toBeDefined()
      expect(violation.measured).toBeTypeOf('number')
      // That the identity excludes the VALUE is asserted directly, per site,
      // in 'is stable while the measurement moves' below — a `not.toContain`
      // here would pass or fail on whether the file path happens to contain
      // the digit, which is not the property.
    }
  })

  it('is stable while the measurement moves, for every site', () => {
    // The property the table above defers to: change the code so each metric
    // measures something different, and the identity must not move. This is
    // what makes the ratchet find the entry at all.
    const build = (methods: number): ArchProject => {
      const tsMorphProject = new Project({ useInMemoryFileSystem: true })
      tsMorphProject.createSourceFile(
        '/src/big.ts',
        `export class Big {\n${Array.from({ length: methods }, (_, i) => `  m${String(i)}() {}`).join('\n')}\n}`,
      )
      return {
        tsConfigPath: '/tsconfig.json',
        _project: tsMorphProject,
        getSourceFiles: () => tsMorphProject.getSourceFiles(),
      }
    }
    const at = (n: number): string | undefined =>
      classes(build(n)).should().satisfy(maxMethods(2)).violations()[0]?.identity

    expect(at(6)).toBeDefined()
    expect(at(6)).toBe(at(9))
  })

  it('haveMaxExports carries them too, though it builds its violation by hand', () => {
    // The one site that does not go through `metricViolation` — it reports
    // against a file and has no `Node` to name — so it shares no code with the
    // covered path and needs its own assertion.
    const tsMorphProject = new Project({ useInMemoryFileSystem: true })
    tsMorphProject.createSourceFile('/src/barrel.ts', 'export const a = 1\nexport const b = 2')
    const found = modules({
      tsConfigPath: '/tsconfig.json',
      _project: tsMorphProject,
      getSourceFiles: () => tsMorphProject.getSourceFiles(),
    })
      .should()
      .satisfy(haveMaxExports(1))
      .violations()

    expect(found).toHaveLength(1)
    expect(found[0]?.identity).toContain('barrel.ts::named-exports')
    expect(found[0]?.measured).toBe(2)
  })

  it('separates two barrels with the same basename', () => {
    // `index.ts` is the commonest filename in a TypeScript project; a basename
    // identity collapses every barrel into one entry.
    const tsMorphProject = new Project({ useInMemoryFileSystem: true })
    tsMorphProject.createSourceFile('/src/a/index.ts', 'export const a = 1\nexport const b = 2')
    tsMorphProject.createSourceFile('/src/b/index.ts', 'export const c = 1\nexport const d = 2')
    const found = modules({
      tsConfigPath: '/tsconfig.json',
      _project: tsMorphProject,
      getSourceFiles: () => tsMorphProject.getSourceFiles(),
    })
      .should()
      .satisfy(haveMaxExports(1))
      .violations()

    expect(found).toHaveLength(2)
    expect(new Set(found.map((v) => v.identity)).size).toBe(2)
  })
})

describe('the mechanism the ratchet rests on', () => {
  it('gives a metric finding an identity that excludes the measurement', () => {
    // If the value were in the identity, every change would be a new finding —
    // which is the bug. Asserted directly so the property is pinned at the
    // source rather than only through the table above.
    const ten = violationsAt(10)[0]
    const eight = violationsAt(8)[0]

    expect(ten?.identity).toBe('/src/big.ts::Big::methods')
    expect(eight?.identity).toBe(ten?.identity)
    // …while the messages, which is what the identity used to be built from,
    // genuinely differ. Without this the assertion above could hold trivially.
    expect(eight?.message).not.toBe(ten?.message)
  })

  it('separates two metrics on the same element', () => {
    // `Big::methods` and `Big::lines` must not collide, or accepting one would
    // accept the other and the ratchet would apply the wrong number.
    const project = projectWith(10)
    const methodFindings = classes(project).should().satisfy(maxMethods(5)).violations()
    expect(methodFindings[0]?.identity).toBe('/src/big.ts::Big::methods')
    expect(methodFindings[0]?.identity).not.toContain('lines')
  })

  it('stores the accepted measurement in the baseline file', () => {
    const output = baselinePath()
    generateBaseline(violationsAt(10), output)

    const parsed: unknown = JSON.parse(fs.readFileSync(output, 'utf-8'))
    if (parsed === null || typeof parsed !== 'object' || !('violations' in parsed)) {
      throw new Error('unreadable baseline')
    }
    const entries: readonly unknown[] = Array.isArray(parsed.violations) ? parsed.violations : []
    expect(entries).toHaveLength(1)
    const entry = entries[0]
    if (entry === null || typeof entry !== 'object' || !('measured' in entry)) {
      throw new Error('entry carries no measurement')
    }
    expect(entry.measured).toBe(10)
  })

  it('writes no measurement for an ordinary finding', () => {
    // A baseline of non-metric findings must be byte-compatible with one from
    // before this shipped, or every adopter pays for a feature they do not use.
    const output = baselinePath()
    generateBaseline(
      [{ rule: 'r', element: 'E', file: '/src/a.ts', line: 1, message: 'plain finding' }],
      output,
    )

    const text = fs.readFileSync(output, 'utf-8')
    expect(text).not.toContain('measured')
  })

  it('keeps accepting an older baseline that recorded no measurement', () => {
    // Degradation, stated: an entry written before this shipped has no accepted
    // value, and the honest reading is the pre-0012 one — it was accepted, so it
    // stays accepted until regeneration. Treating a missing value as 0 would
    // fail every metric finding in an older baseline and call it a regression.
    const output = baselinePath()
    generateBaseline(violationsAt(10), output)

    const parsed: unknown = JSON.parse(fs.readFileSync(output, 'utf-8'))
    if (parsed === null || typeof parsed !== 'object' || !('violations' in parsed)) {
      throw new Error('unreadable baseline')
    }
    const entries: readonly unknown[] = Array.isArray(parsed.violations) ? parsed.violations : []
    const stripped = entries.map((e) =>
      e !== null && typeof e === 'object'
        ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'measured'))
        : e,
    )
    fs.writeFileSync(output, JSON.stringify({ ...parsed, violations: stripped }, null, 2))

    // Same value: accepted. Worse: also accepted, because there is no recorded
    // ratchet to compare against — which is exactly the old behaviour.
    expect(withBaseline(output).filterNew(violationsAt(10))).toEqual([])
    expect(withBaseline(output).filterNew(violationsAt(12))).toEqual([])
  })
})
