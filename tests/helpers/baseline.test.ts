import { describe, it, expect, afterEach } from 'vitest'
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
    expect(result).toHaveLength(2)
  })
})
