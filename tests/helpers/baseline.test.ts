import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { ArchViolation } from '../../src/core/violation.js'
import {
  hashViolation,
  generateBaseline,
  withBaseline,
  Baseline,
} from '../../src/helpers/baseline.js'
import type { BaselineFile } from '../../src/helpers/baseline.js'

// --- Helpers ---

function makeViolation(overrides: Partial<ArchViolation> = {}): ArchViolation {
  return {
    rule: 'should not contain call to parseInt',
    element: 'ProductService',
    file: '/project/src/services/product.ts',
    line: 42,
    message: 'contains call to parseInt',
    ...overrides,
  }
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
    const v = makeViolation()
    const hash1 = hashViolation(v)
    const hash2 = hashViolation(v)
    expect(hash1).toBe(hash2)
    expect(hash1).toHaveLength(16)
  })

  it('produces different hashes for different violations', () => {
    const v1 = makeViolation({ element: 'ProductService' })
    const v2 = makeViolation({ element: 'OrderService' })
    expect(hashViolation(v1)).not.toBe(hashViolation(v2))
  })

  it('survives line number change (same hash)', () => {
    const v1 = makeViolation({ line: 42 })
    const v2 = makeViolation({ line: 99 })
    expect(hashViolation(v1)).toBe(hashViolation(v2))
  })

  it('changes when element name changes', () => {
    const v1 = makeViolation({ element: 'OldName' })
    const v2 = makeViolation({ element: 'NewName' })
    expect(hashViolation(v1)).not.toBe(hashViolation(v2))
  })
})

describe('generateBaseline', () => {
  it('writes valid JSON with correct structure', () => {
    const dir = createTmpDir()
    const outputPath = path.join(dir, 'baseline.json')
    const violations = [makeViolation(), makeViolation({ element: 'OrderService' })]

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
    const violations = [makeViolation({ file: path.join(dir, 'src', 'services', 'product.ts') })]

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
    const v = makeViolation()
    generateBaseline([v], outputPath)

    const baseline = withBaseline(outputPath)
    expect(baseline.isKnown(v)).toBe(true)
    expect(baseline.size).toBe(1)
  })

  it('returns empty baseline for missing file', () => {
    const baseline = withBaseline('/nonexistent/path/baseline.json')
    expect(baseline.size).toBe(0)
    expect(baseline.isKnown(makeViolation())).toBe(false)
  })
})

describe('Baseline', () => {
  it('filterNew removes known violations', () => {
    const known1 = makeViolation({ element: 'Known1' })
    const known2 = makeViolation({ element: 'Known2' })
    const unknown1 = makeViolation({ element: 'Unknown1' })

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
    const violations = [makeViolation({ element: 'A' }), makeViolation({ element: 'B' })]
    const result = baseline.filterNew(violations)
    expect(result).toHaveLength(2)
  })
})
