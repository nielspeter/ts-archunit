import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Project } from 'ts-morph'
import { classes } from '../../src/builders/class-rule-builder.js'
import { call } from '../../src/helpers/matchers.js'
import { collectViolations } from '../../src/helpers/baseline-generator.js'
import { generateBaseline, withBaseline } from '../../src/helpers/baseline.js'
import type { BaselineFile } from '../../src/helpers/baseline.js'
import type { ArchProject } from '../../src/core/project.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

let tmpDir: string | undefined

function createTmpDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-archunit-integration-'))
  return tmpDir
}

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true })
    tmpDir = undefined
  }
})

describe('Integration: baseline mode', () => {
  it('end-to-end: generate baseline then check with it suppresses known violations', () => {
    const p = loadTestProject()
    const dir = createTmpDir()
    const baselinePath = path.join(dir, 'baseline.json')

    // Collect all violations from the rule
    const rule = classes(p)
      .that()
      .extend('BaseService')
      .should()
      .notContain(call('parseInt'))
      .because('use this.normalizeCount() instead')

    const violations = collectViolations(rule)
    expect(violations.length).toBeGreaterThan(0)

    // Generate baseline from collected violations
    generateBaseline(violations, baselinePath)

    // Now check with baseline — all violations are known, should pass
    const baseline = withBaseline(baselinePath)
    const rule2 = classes(p)
      .that()
      .extend('BaseService')
      .should()
      .notContain(call('parseInt'))
      .because('use this.normalizeCount() instead')

    expect(() => {
      rule2.check({ baseline })
    }).not.toThrow()
  })

  it('baseline file is valid JSON and human-readable', () => {
    const p = loadTestProject()
    const dir = createTmpDir()
    const baselinePath = path.join(dir, 'baseline.json')

    const violations = collectViolations(
      classes(p).that().extend('BaseService').should().notContain(call('parseInt')),
    )

    generateBaseline(violations, baselinePath)

    const raw = fs.readFileSync(baselinePath, 'utf-8')
    const data = JSON.parse(raw) as BaselineFile

    // Structure is correct
    expect(data.generatedAt).toBeDefined()
    expect(typeof data.count).toBe('number')
    expect(Array.isArray(data.violations)).toBe(true)
    expect(data.count).toBe(data.violations.length)

    // Each entry has the expected fields
    for (const entry of data.violations) {
      expect(typeof entry.rule).toBe('string')
      expect(typeof entry.file).toBe('string')
      expect(typeof entry.line).toBe('number')
      expect(typeof entry.hash).toBe('string')
      expect(entry.hash).toHaveLength(16)
    }

    // File is pretty-printed (human-readable)
    expect(raw).toContain('\n')
    expect(raw.endsWith('\n')).toBe(true)
  })
})
