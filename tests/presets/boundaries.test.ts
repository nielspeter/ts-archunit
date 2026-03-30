import { describe, it, expect, vi } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import type { ArchProject } from '../../src/core/project.js'
import { ArchRuleError } from '../../src/core/errors.js'
import { strictBoundaries } from '../../src/presets/boundaries.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/presets/boundaries')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('strictBoundaries preset', () => {
  const p = loadTestProject()

  it('passes for correct boundaries (each feature only imports from shared)', () => {
    expect(() => {
      strictBoundaries(p, {
        folders: '**/src/feature-*',
        shared: ['**/shared/**'],
      })
    }).not.toThrow()
  })

  it('override to off suppresses no-cross-boundary', () => {
    expect(() => {
      strictBoundaries(p, {
        folders: '**/src/feature-*',
        shared: ['**/shared/**'],
        overrides: {
          'preset/boundaries/no-cross-boundary': 'off',
          'preset/boundaries/no-cycles': 'off',
          'preset/boundaries/shared-isolation': 'off',
        },
      })
    }).not.toThrow()
  })

  it('passes when no boundary folders match the glob', () => {
    // A glob that matches nothing means no boundary rules are applied
    expect(() => {
      strictBoundaries(p, {
        folders: '**/src/nonexistent-*',
      })
    }).not.toThrow()
  })

  it('throws when shared is not specified and features import from shared', () => {
    // shared defaults to [] — features importing from shared/ become cross-boundary violations
    expect(() => {
      strictBoundaries(p, {
        folders: '**/src/feature-*',
      })
    }).toThrow(ArchRuleError)
  })

  describe('isolateTests', () => {
    it('passes when test files do not import from other boundaries', () => {
      // Each feature's test file only imports from within its own boundary
      expect(() => {
        strictBoundaries(p, {
          folders: '**/src/feature-*',
          shared: ['**/shared/**'],
          isolateTests: true,
        })
      }).not.toThrow()
    })

    it('test-isolation can be overridden to off', () => {
      expect(() => {
        strictBoundaries(p, {
          folders: '**/src/feature-*',
          shared: ['**/shared/**'],
          isolateTests: true,
          overrides: {
            'preset/boundaries/test-isolation': 'off',
          },
        })
      }).not.toThrow()
    })
  })

  describe('noCopyPaste', () => {
    it('warns on duplicate function bodies across boundaries', () => {
      // feature-a/helper.ts and feature-b/helper.ts have identical bodies.
      // noCopyPaste triggers smells.duplicateBodies which is dispatched as 'warn'.
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(() => {
        strictBoundaries(p, {
          folders: '**/src/feature-*',
          shared: ['**/shared/**'],
          noCopyPaste: true,
        })
      }).not.toThrow()
      // The duplicate bodies smell should produce warnings
      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })

    it('no-duplicate-bodies can be overridden to error', () => {
      expect(() => {
        strictBoundaries(p, {
          folders: '**/src/feature-*',
          shared: ['**/shared/**'],
          noCopyPaste: true,
          overrides: {
            'preset/boundaries/no-duplicate-bodies': 'error',
          },
        })
      }).toThrow(ArchRuleError)
    })

    it('no-duplicate-bodies can be overridden to off', () => {
      expect(() => {
        strictBoundaries(p, {
          folders: '**/src/feature-*',
          shared: ['**/shared/**'],
          noCopyPaste: true,
          overrides: {
            'preset/boundaries/no-duplicate-bodies': 'off',
          },
        })
      }).not.toThrow()
    })
  })
})
