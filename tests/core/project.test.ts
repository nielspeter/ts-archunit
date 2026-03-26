import { describe, it, expect, beforeEach } from 'vitest'
import path from 'node:path'
import { project, _resetProjectCache } from '../../src/core/project.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

describe('project()', () => {
  beforeEach(() => {
    _resetProjectCache()
  })

  it('loads a project from a tsconfig path', () => {
    const p = project(tsconfigPath)
    expect(p.tsConfigPath).toBe(tsconfigPath)
    expect(p._project).toBeDefined()
  })

  it('returns source files matching the tsconfig include', () => {
    const p = project(tsconfigPath)
    const files = p.getSourceFiles()
    const fileNames = files.map((f) => path.basename(f.getFilePath()))

    expect(fileNames).toContain('routes.ts')
    expect(fileNames).toContain('good-service.ts')
    expect(fileNames).toContain('bad-service.ts')
    expect(fileNames).toContain('base-service.ts')
    expect(fileNames).toContain('domain.ts')
    expect(fileNames).toContain('edge-cases.ts')
    expect(fileNames).toContain('options.ts')
  })

  describe('singleton caching', () => {
    it('returns the same instance for the same path', () => {
      const p1 = project(tsconfigPath)
      const p2 = project(tsconfigPath)
      expect(p1).toBe(p2)
    })

    it('returns the same instance for relative and absolute paths to the same file', () => {
      const relativePath = path.relative(process.cwd(), tsconfigPath)
      const p1 = project(tsconfigPath)
      const p2 = project(relativePath)
      expect(p1).toBe(p2)
    })

    it('returns different instances for different tsconfig files', () => {
      // Use the project's own root tsconfig as a second, different project
      const rootTsconfig = path.resolve(import.meta.dirname, '../../tsconfig.json')
      const p1 = project(tsconfigPath)
      const p2 = project(rootTsconfig)
      expect(p1).not.toBe(p2)
    })

    it('returns a fresh instance after cache reset', () => {
      const p1 = project(tsconfigPath)
      _resetProjectCache()
      const p2 = project(tsconfigPath)
      expect(p1).not.toBe(p2)
    })
  })

  describe('error handling', () => {
    it('throws a clear error for a non-existent tsconfig', () => {
      expect(() => project('/does/not/exist/tsconfig.json')).toThrowError(/tsconfig not found/)
    })

    it('includes the resolved path in the error message', () => {
      const badPath = '/does/not/exist/tsconfig.json'
      expect(() => project(badPath)).toThrowError(badPath)
    })

    it('includes a hint about valid paths in the error message', () => {
      expect(() => project('/nope/tsconfig.json')).toThrowError(/Provide a valid path/)
    })
  })

  it('exposes the resolved absolute path as tsConfigPath', () => {
    const relativePath = path.relative(process.cwd(), tsconfigPath)
    const p = project(relativePath)
    // tsConfigPath should always be absolute, even when loaded with a relative path
    expect(path.isAbsolute(p.tsConfigPath)).toBe(true)
    expect(p.tsConfigPath).toBe(tsconfigPath)
  })
})
