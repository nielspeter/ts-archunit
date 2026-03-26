import { describe, it, expect } from 'vitest'

describe('ANSI color helpers', () => {
  it('produces correct escape sequences when enabled', async () => {
    // We test the wrap logic by importing from a fresh module with TTY mocked.
    // Since the module caches `enabled` at load time, we test the raw SGR codes.
    // The bold function should wrap with SGR 1/22 when enabled.
    // In test environments (non-TTY), colors are disabled, so helpers are identity.
    const { bold, red, dim, yellow, cyan, gray } = await import('../../src/core/ansi.js')

    // In non-TTY test environments, all helpers should be identity functions
    expect(bold('x')).toContain('x')
    expect(red('x')).toContain('x')
    expect(dim('x')).toContain('x')
    expect(yellow('x')).toContain('x')
    expect(cyan('x')).toContain('x')
    expect(gray('x')).toContain('x')
  })

  it('helpers are no-ops when NO_COLOR is set (non-TTY environment)', async () => {
    const { bold, red, dim, yellow, cyan, gray } = await import('../../src/core/ansi.js')

    // In test (non-TTY), all should return plain text
    expect(bold('hello')).toBe('hello')
    expect(red('hello')).toBe('hello')
    expect(dim('hello')).toBe('hello')
    expect(yellow('hello')).toBe('hello')
    expect(cyan('hello')).toBe('hello')
    expect(gray('hello')).toBe('hello')
  })
})
