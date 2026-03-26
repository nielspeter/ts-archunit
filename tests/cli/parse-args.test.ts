import { describe, it, expect } from 'vitest'
import { parseCliArgs } from '../../src/cli/index.js'

describe('parseCliArgs', () => {
  it('parses check command with rule file', () => {
    const result = parseCliArgs(['check', 'arch.rules.ts'])
    expect(result.positionals[0]).toBe('check')
    expect(result.positionals[1]).toBe('arch.rules.ts')
  })

  it('parses --baseline flag', () => {
    const result = parseCliArgs(['check', '--baseline', 'baseline.json'])
    expect(result.values.baseline).toBe('baseline.json')
  })

  it('parses --changed --base develop', () => {
    const result = parseCliArgs(['check', '--changed', '--base', 'develop'])
    expect(result.values.changed).toBe(true)
    expect(result.values.base).toBe('develop')
  })

  it('parses --format json', () => {
    const result = parseCliArgs(['check', '--format', 'json'])
    expect(result.values.format).toBe('json')
  })

  it('parses --help flag', () => {
    const result = parseCliArgs(['--help'])
    expect(result.values.help).toBe(true)
  })

  it('defaults --base to main', () => {
    const result = parseCliArgs(['check', '--changed'])
    expect(result.values.changed).toBe(true)
    expect(result.values.base).toBe('main')
  })

  it('parses --version flag', () => {
    const result = parseCliArgs(['--version'])
    expect(result.values.version).toBe(true)
  })

  it('parses -v short flag', () => {
    const result = parseCliArgs(['-v'])
    expect(result.values.version).toBe(true)
  })
})
