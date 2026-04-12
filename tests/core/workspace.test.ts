import { describe, it, expect, beforeEach } from 'vitest'
import path from 'node:path'
import { workspace, resetProjectCache } from '../../src/core/project.js'
import { beImported } from '../../src/conditions/reverse-dependency.js'
import type { ConditionContext } from '../../src/core/condition.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/workspace')
const sharedTsconfig = path.join(fixturesDir, 'packages/shared/tsconfig.json')
const appTsconfig = path.join(fixturesDir, 'packages/app/tsconfig.json')

const ctx: ConditionContext = { rule: 'test rule' }

describe('workspace()', () => {
  beforeEach(() => {
    resetProjectCache()
  })

  it('loads source files from all tsconfigs', () => {
    const ws = workspace([sharedTsconfig, appTsconfig])
    const fileNames = ws.getSourceFiles().map((f) => path.basename(f.getFilePath()))

    expect(fileNames).toContain('utils.ts')
    expect(fileNames).toContain('orphan.ts')
    expect(fileNames).toContain('main.ts')
  })

  it('sets tsConfigPath to the alphabetically first tsconfig', () => {
    const ws = workspace([sharedTsconfig, appTsconfig])
    // Paths are sorted — app < shared alphabetically
    expect(ws.tsConfigPath).toBe(appTsconfig)
  })

  it('makes cross-workspace imports visible to beImported()', () => {
    // With workspace: app/main.ts imports shared/utils.ts, so utils.ts IS imported
    const ws = workspace([sharedTsconfig, appTsconfig])
    const utils = ws.getSourceFiles().find((f) => f.getBaseName() === 'utils.ts')!

    const condition = beImported()
    const violations = condition.evaluate([utils], ctx)
    expect(violations).toHaveLength(0) // utils.ts is imported by main.ts
  })

  it('detects genuinely dead modules in the unified workspace', () => {
    const ws = workspace([sharedTsconfig, appTsconfig])
    const orphan = ws.getSourceFiles().find((f) => f.getBaseName() === 'orphan.ts')!

    const condition = beImported()
    const violations = condition.evaluate([orphan], ctx)
    expect(violations).toHaveLength(1) // orphan.ts is not imported by anything
  })

  it('returns the same instance for the same set of tsconfigs', () => {
    const ws1 = workspace([sharedTsconfig, appTsconfig])
    const ws2 = workspace([sharedTsconfig, appTsconfig])
    expect(ws1).toBe(ws2)
  })

  it('returns the same instance regardless of tsconfig order', () => {
    const ws1 = workspace([sharedTsconfig, appTsconfig])
    const ws2 = workspace([appTsconfig, sharedTsconfig])
    // Paths are sorted before loading, so order is irrelevant
    expect(ws1).toBe(ws2)
  })

  it('returns a fresh instance after cache reset', () => {
    const ws1 = workspace([sharedTsconfig, appTsconfig])
    resetProjectCache()
    const ws2 = workspace([sharedTsconfig, appTsconfig])
    expect(ws1).not.toBe(ws2)
  })

  describe('error handling', () => {
    it('throws for empty paths array', () => {
      expect(() => workspace([])).toThrowError(/at least one tsconfig/)
    })

    it('throws for a non-existent tsconfig', () => {
      expect(() => workspace(['/does/not/exist/tsconfig.json'])).toThrowError(/tsconfig not found/)
    })

    it('throws for a mix of valid and invalid paths', () => {
      expect(() => workspace([sharedTsconfig, '/does/not/exist/tsconfig.json'])).toThrowError(
        /tsconfig not found/,
      )
    })
  })
})
