import type { OutputFormat } from './check-options.js'

/**
 * Detect the current CI environment and return the appropriate output format.
 *
 * - GitHub Actions: detected via GITHUB_ACTIONS env var
 * - Other CI: detected via CI env var (falls back to terminal)
 * - Local: terminal
 */
export function detectFormat(): OutputFormat {
  if (process.env['GITHUB_ACTIONS'] === 'true') {
    return 'github'
  }
  return 'terminal'
}

/**
 * Check if running in any CI environment.
 */
export function isCI(): boolean {
  return process.env['CI'] === 'true' || process.env['GITHUB_ACTIONS'] === 'true'
}
