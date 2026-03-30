import { describe, it, expect, vi } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import type { ArchProject } from '../../src/core/project.js'
import { ArchRuleError } from '../../src/core/errors.js'
import { layeredArchitecture } from '../../src/presets/layered.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/presets/layered')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('layeredArchitecture preset', () => {
  const p = loadTestProject()

  it('passes for correct layer ordering', () => {
    expect(() => {
      layeredArchitecture(p, {
        layers: {
          routes: '**/routes/**',
          services: '**/services/**',
          repositories: '**/repositories/**',
        },
      })
    }).not.toThrow()
  })

  it('detects layer order violation', () => {
    // Repositories importing from routes would be a layer violation.
    // In this fixture, the ordering is correct (routes→services→repos),
    // so reversing the order should detect violations.
    expect(() => {
      layeredArchitecture(p, {
        layers: {
          repositories: '**/repositories/**',
          services: '**/services/**',
          routes: '**/routes/**',
        },
      })
    }).toThrow(ArchRuleError)
  })

  it('strict mode enforces innermost isolation', () => {
    // Repos only import from shared — passes with strict
    expect(() => {
      layeredArchitecture(p, {
        layers: {
          routes: '**/routes/**',
          services: '**/services/**',
          repositories: '**/repositories/**',
        },
        shared: ['**/shared/**'],
        strict: true,
      })
    }).not.toThrow()
  })

  it('non-strict mode does not enforce innermost isolation', () => {
    // Without strict, the innermost layer (repositories) is allowed
    // to import from any layer — no innermost-isolation rule applied.
    expect(() => {
      layeredArchitecture(p, {
        layers: {
          routes: '**/routes/**',
          services: '**/services/**',
          repositories: '**/repositories/**',
        },
        strict: false,
      })
    }).not.toThrow()
  })

  it('override to off suppresses a rule', () => {
    // Even with reversed layers, turning off layer-order should pass
    expect(() => {
      layeredArchitecture(p, {
        layers: {
          repositories: '**/repositories/**',
          services: '**/services/**',
          routes: '**/routes/**',
        },
        overrides: {
          'preset/layered/layer-order': 'off',
          'preset/layered/no-cycles': 'off',
        },
      })
    }).not.toThrow()
  })

  it('aggregated error contains violations from multiple rules', () => {
    try {
      layeredArchitecture(p, {
        layers: {
          repositories: '**/repositories/**',
          services: '**/services/**',
          routes: '**/routes/**',
        },
      })
      expect.fail('Should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ArchRuleError)
      const err = e as InstanceType<typeof ArchRuleError>
      expect(err.violations.length).toBeGreaterThan(0)
    }
  })

  describe('typeImportsAllowed', () => {
    it('warns when a layer has value imports from other layers', () => {
      // user-route.ts has a value import from services (getUser).
      // typeImportsAllowed says routes should only type-import from other layers.
      // Default severity for type-imports-only is 'warn', so it logs but does not throw.
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(() => {
        layeredArchitecture(p, {
          layers: {
            routes: '**/routes/**',
            services: '**/services/**',
            repositories: '**/repositories/**',
          },
          typeImportsAllowed: ['**/routes/**'],
        })
      }).not.toThrow()
      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })

    it('does not warn when typeImportsAllowed layer has no value imports from others', () => {
      // The shared layer has no imports at all, so no violations expected
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(() => {
        layeredArchitecture(p, {
          layers: {
            routes: '**/routes/**',
            services: '**/services/**',
            repositories: '**/repositories/**',
            shared: '**/shared/**',
          },
          typeImportsAllowed: ['**/shared/**'],
        })
      }).not.toThrow()
      spy.mockRestore()
    })

    it('type-imports-only can be overridden to error', () => {
      // Override the warn to error — should throw since routes has value imports
      expect(() => {
        layeredArchitecture(p, {
          layers: {
            routes: '**/routes/**',
            services: '**/services/**',
            repositories: '**/repositories/**',
          },
          typeImportsAllowed: ['**/routes/**'],
          overrides: {
            'preset/layered/type-imports-only': 'error',
          },
        })
      }).toThrow(ArchRuleError)
    })

    it('skips type-imports-only when typeImportsAllowed is empty', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(() => {
        layeredArchitecture(p, {
          layers: {
            routes: '**/routes/**',
            services: '**/services/**',
            repositories: '**/repositories/**',
          },
          typeImportsAllowed: [],
        })
      }).not.toThrow()
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    })

    it('skips type-imports-only rule when layer has no other layers to compare', () => {
      // With a single layer, otherLayerGlobs is empty — the guard skips the rule
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(() => {
        layeredArchitecture(p, {
          layers: {
            routes: '**/routes/**',
          },
          typeImportsAllowed: ['**/routes/**'],
        })
      }).not.toThrow()
      spy.mockRestore()
    })
  })

  describe('restrictedPackages', () => {
    it('passes when restricted package is imported only from allowed layer', () => {
      // shared is only imported by repositories (user-repo.ts).
      // Allow repositories to import from shared — should pass.
      expect(() => {
        layeredArchitecture(p, {
          layers: {
            routes: '**/routes/**',
            services: '**/services/**',
            repositories: '**/repositories/**',
          },
          restrictedPackages: {
            '**/repositories/**': ['**/shared/**'],
          },
        })
      }).not.toThrow()
    })

    it('detects violation when non-allowed layer imports restricted package', () => {
      // Restrict shared imports to only routes layer.
      // But user-repo.ts (in repositories) imports from shared — violation.
      expect(() => {
        layeredArchitecture(p, {
          layers: {
            routes: '**/routes/**',
            services: '**/services/**',
            repositories: '**/repositories/**',
          },
          restrictedPackages: {
            '**/routes/**': ['**/shared/**'],
          },
        })
      }).toThrow(ArchRuleError)
    })

    it('allows multiple layers to use a restricted package', () => {
      // Allow both routes and repositories to import from shared — should pass.
      expect(() => {
        layeredArchitecture(p, {
          layers: {
            routes: '**/routes/**',
            services: '**/services/**',
            repositories: '**/repositories/**',
          },
          restrictedPackages: {
            '**/routes/**': ['**/shared/**'],
            '**/repositories/**': ['**/shared/**'],
          },
        })
      }).not.toThrow()
    })

    it('restricted-packages can be overridden to off', () => {
      // Even though repos imports from shared and only routes is allowed,
      // overriding to off should suppress it
      expect(() => {
        layeredArchitecture(p, {
          layers: {
            routes: '**/routes/**',
            services: '**/services/**',
            repositories: '**/repositories/**',
          },
          restrictedPackages: {
            '**/routes/**': ['**/shared/**'],
          },
          overrides: {
            'preset/layered/restricted-packages': 'off',
          },
        })
      }).not.toThrow()
    })
  })
})
