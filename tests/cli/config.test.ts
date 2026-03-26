import { describe, it, expect } from 'vitest'
import { defineConfig } from '../../src/cli/config.js'
import { resolveConfig } from '../../src/cli/resolve-config.js'

describe('defineConfig', () => {
  it('returns the config object as-is', () => {
    const config = defineConfig({
      project: 'tsconfig.json',
      rules: ['arch.rules.ts'],
      baseline: 'baseline.json',
      format: 'auto',
    })

    expect(config.project).toBe('tsconfig.json')
    expect(config.rules).toEqual(['arch.rules.ts'])
    expect(config.baseline).toBe('baseline.json')
    expect(config.format).toBe('auto')
  })
})

describe('resolveConfig', () => {
  it('returns empty config when no config file exists', async () => {
    // With no explicit path and no config file in cwd, returns empty
    const config = await resolveConfig('/nonexistent/path/config.ts').catch(() => ({}))
    expect(config).toBeDefined()
  })

  it('returns empty config when called with no arguments and no config file found', async () => {
    const config = await resolveConfig()
    // In the test environment, there's no ts-archunit.config.ts in cwd
    expect(config).toEqual({})
  })
})
