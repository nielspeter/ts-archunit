/**
 * The assertion gate's warning must be VISIBLE where consumers actually run
 * (plan 0070, 0.22.0). Review measured `console.warn` from a passing test
 * being dropped by vitest's default reporter in every CI-relevant
 * configuration — 0 of 19 real gate firings visible in this repo's own suite
 * run — which made the pre-flight dark for exactly the audience it exists to
 * warn. The gate therefore writes to `process.stderr` directly.
 *
 * No in-process test can see this property: spying on the write proves the
 * call, never the delivery. This spawns a real `vitest run` on a one-test
 * fixture (default reporter, CI env, non-TTY) and asserts the warning reaches
 * the captured output. Under the `console.warn` channel this test fails —
 * measured; that failure is the finding it pins.
 */
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'

const fixtureDir = path.resolve(import.meta.dirname, '../fixtures/gate-visibility')

describe('gate visibility under a default-reporter vitest run', () => {
  it('the warning reaches the output of a green, non-TTY, CI-env run', () => {
    const result = spawnSync(
      'npx',
      [
        'vitest',
        'run',
        '--root',
        fixtureDir,
        '--config',
        path.join(fixtureDir, 'vitest.config.mts'),
      ],
      {
        encoding: 'utf8',
        cwd: path.resolve(import.meta.dirname, '../..'),
        env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
      },
    )
    const output = `${result.stdout}\n${result.stderr}`
    // The child suite is GREEN — the warning must not depend on a failure.
    expect(result.status, output.slice(-2000)).toBe(0)
    expect(output).toContain("[ts-archunit] Rule '")
    expect(output).toContain('asserts nothing')
  })
})
