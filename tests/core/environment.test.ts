import { describe, it, expect, afterEach } from 'vitest'
import { detectFormat, isCI } from '../../src/core/environment.js'

describe('detectFormat', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    // Restore original env vars
    process.env['GITHUB_ACTIONS'] = originalEnv['GITHUB_ACTIONS']
    process.env['CI'] = originalEnv['CI']
    if (originalEnv['GITHUB_ACTIONS'] === undefined) {
      delete process.env['GITHUB_ACTIONS']
    }
    if (originalEnv['CI'] === undefined) {
      delete process.env['CI']
    }
  })

  it('returns "github" when GITHUB_ACTIONS=true', () => {
    process.env['GITHUB_ACTIONS'] = 'true'
    expect(detectFormat()).toBe('github')
  })

  it('returns "terminal" by default', () => {
    delete process.env['GITHUB_ACTIONS']
    expect(detectFormat()).toBe('terminal')
  })
})

describe('isCI', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env['GITHUB_ACTIONS'] = originalEnv['GITHUB_ACTIONS']
    process.env['CI'] = originalEnv['CI']
    if (originalEnv['GITHUB_ACTIONS'] === undefined) {
      delete process.env['GITHUB_ACTIONS']
    }
    if (originalEnv['CI'] === undefined) {
      delete process.env['CI']
    }
  })

  it('returns true when CI=true', () => {
    delete process.env['GITHUB_ACTIONS']
    process.env['CI'] = 'true'
    expect(isCI()).toBe(true)
  })
})
