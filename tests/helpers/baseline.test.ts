import { describe, it, expect, afterEach } from 'vitest'
import type { ArchViolation } from '../../src/core/violation.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  hashViolation,
  generateBaseline,
  withBaseline,
  Baseline,
} from '../../src/helpers/baseline.js'
import type { BaselineFile } from '../../src/helpers/baseline.js'
import { makeViolation } from '../support/test-rule-builder.js'

// --- Helpers ---

/** Shorthand with baseline-test defaults. */
function mv(overrides: Partial<Parameters<typeof makeViolation>[0]> = {}) {
  return makeViolation({
    element: 'ProductService',
    rule: 'should not contain call to parseInt',
    file: '/project/src/services/product.ts',
    line: 42,
    message: 'contains call to parseInt',
    ...overrides,
  })
}

let tmpDir: string | undefined

function createTmpDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-archunit-baseline-'))
  return tmpDir
}

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true })
    tmpDir = undefined
  }
})

describe('hashViolation', () => {
  it('produces consistent hashes for the same violation', () => {
    const v = mv()
    const hash1 = hashViolation(v)
    const hash2 = hashViolation(v)
    expect(hash1).toBe(hash2)
    expect(hash1).toHaveLength(16)
  })

  it('produces different hashes for different violations', () => {
    const v1 = mv({ element: 'ProductService' })
    const v2 = mv({ element: 'OrderService' })
    expect(hashViolation(v1)).not.toBe(hashViolation(v2))
  })

  it('survives line number change (same hash)', () => {
    const v1 = mv({ line: 42 })
    const v2 = mv({ line: 99 })
    expect(hashViolation(v1)).toBe(hashViolation(v2))
  })

  it('changes when element name changes', () => {
    const v1 = mv({ element: 'OldName' })
    const v2 = mv({ element: 'NewName' })
    expect(hashViolation(v1)).not.toBe(hashViolation(v2))
  })
})

describe('generateBaseline', () => {
  it('writes valid JSON with correct structure', () => {
    const dir = createTmpDir()
    const outputPath = path.join(dir, 'baseline.json')
    const violations = [mv(), mv({ element: 'OrderService' })]

    generateBaseline(violations, outputPath)

    const raw = fs.readFileSync(outputPath, 'utf-8')
    const data = JSON.parse(raw) as BaselineFile
    expect(data.count).toBe(2)
    expect(data.violations).toHaveLength(2)
    expect(data.generatedAt).toBeDefined()
    expect(data.violations[0]?.hash).toHaveLength(16)
  })

  it('stores relative paths', () => {
    const dir = createTmpDir()
    const outputPath = path.join(dir, 'baseline.json')
    const violations = [mv({ file: path.join(dir, 'src', 'services', 'product.ts') })]

    generateBaseline(violations, outputPath)

    const raw = fs.readFileSync(outputPath, 'utf-8')
    const data = JSON.parse(raw) as BaselineFile
    const entry = data.violations[0]
    expect(entry).toBeDefined()
    expect(entry?.file).toBe(path.join('src', 'services', 'product.ts'))
    expect(path.isAbsolute(entry?.file ?? '')).toBe(false)
  })
})

describe('withBaseline', () => {
  it('loads hashes and isKnown works', () => {
    const dir = createTmpDir()
    const outputPath = path.join(dir, 'baseline.json')
    const v = mv()
    generateBaseline([v], outputPath)

    const baseline = withBaseline(outputPath)
    expect(baseline.isKnown(v)).toBe(true)
    expect(baseline.size).toBe(1)
  })

  it('returns empty baseline for missing file', () => {
    const baseline = withBaseline('/nonexistent/path/baseline.json')
    expect(baseline.size).toBe(0)
    expect(baseline.isKnown(mv())).toBe(false)
  })
})

describe('Baseline', () => {
  it('filterNew removes known violations', () => {
    const known1 = mv({ element: 'Known1' })
    const known2 = mv({ element: 'Known2' })
    const unknown1 = mv({ element: 'Unknown1' })

    const dir = createTmpDir()
    const outputPath = path.join(dir, 'baseline.json')
    generateBaseline([known1, known2], outputPath)

    const baseline = withBaseline(outputPath)
    const newViolations = baseline.filterNew([known1, known2, unknown1])
    expect(newViolations).toHaveLength(1)
    expect(newViolations[0]?.element).toBe('Unknown1')
  })

  it('filterNew returns all when baseline is empty', () => {
    const baseline = new Baseline(new Set(), '/tmp')
    const violations = [mv({ element: 'A' }), mv({ element: 'B' })]
    const result = baseline.filterNew(violations)
    // "returns all" means these two, in order — returning A twice also had length 2.
    expect(result.map((v) => v.element)).toEqual(['A', 'B'])
  })
})

describe('bypassFilters meta-findings (plan 0067)', () => {
  it('never baselines away a bypassFilters finding, even when its hash is known (ADR-008)', () => {
    const outputPath = path.join(createTmpDir(), 'baseline.json')
    // Seed with a NON-bypass finding; hash is rule::element::message (excludes
    // bypassFilters), so a same-shaped bypass finding hashes identically.
    const seed = mv({ element: 'selector', message: 'empty selector' })
    generateBaseline([seed], outputPath)
    const baseline = withBaseline(outputPath)
    // Vacuity guard: the non-bypass finding IS known → correctly dropped.
    expect(baseline.filterNew([seed])).toEqual([])
    // The same finding flagged bypassFilters survives despite being "known".
    const meta = mv({ element: 'selector', message: 'empty selector', bypassFilters: true })
    expect(baseline.filterNew([meta])).toEqual([meta])
  })

  it('generateBaseline does not write bypassFilters findings into the file', () => {
    const outputPath = path.join(createTmpDir(), 'baseline.json')
    const meta = mv({ rule: 'empty-selector', message: 'empty selector', bypassFilters: true })
    const normal = mv({ element: 'A' })
    generateBaseline([meta, normal], outputPath)
    const written = JSON.parse(fs.readFileSync(outputPath, 'utf-8')) as BaselineFile
    expect(written.count).toBe(1)
    expect(written.violations.some((e) => e.rule === 'empty-selector')).toBe(false)
  })
})

describe('which violations plan 0082 actually moved in the baseline', () => {
  // Plan 0082's Phase 2 row 1 called this "not optional and not a follow-up", and
  // then it did not ship — so the migration note went out unverified, and was
  // WRONG for the rule it quoted. `docs/upgrading.md` said the hash is "over rule
  // + element + message"; `hashViolation` is `identity ?? \`${element}::${message}\``,
  // and a producer that sets `identity` supersedes both.
  //
  // The consequence is the opposite of what was published: body-analysis rules —
  // the ones an adopter would most likely write about a callback — keep their
  // hashes, because their identity is the call site, not the function's name.
  // Telling those adopters to regenerate is advice that costs them work and fixes
  // nothing. ADR-008 rule 2's behavioural corollary: nobody applied the remedy and
  // checked it cleared.
  const before = (extra: Partial<ArchViolation>): ArchViolation =>
    mv({ element: '<anonymous>', message: "does not contain call to 'x'", ...extra })
  const after = (extra: Partial<ArchViolation>): ArchViolation =>
    mv({ element: 'handler', message: "does not contain call to 'x'", ...extra })

  it('a producer that sets identity keeps its hash — the name is not in it', () => {
    const identity = "function-body::/src/a.ts::CallExpression::call to 'x'#1"
    expect(hashViolation(before({ identity }))).toBe(hashViolation(after({ identity })))
  })

  it('a producer with no identity DOES move, which is what the note should say', () => {
    // Structural conditions compose the subject from element + message, so renaming
    // `<anonymous>` to `handler` is a different violation as far as the baseline is
    // concerned. These are the entries that need regenerating — and only these.
    expect(hashViolation(before({}))).not.toBe(hashViolation(after({})))
  })

  it('VACUITY: the two fixtures differ only in element', () => {
    // Without this the rows above could pass on two violations that differ in some
    // other field, and the first would be asserting nothing about names at all.
    const a = before({})
    const b = after({})
    const diff = (Object.keys(a) as (keyof ArchViolation)[]).filter((k) => a[k] !== b[k])
    expect(diff).toEqual(['element'])
  })
})
