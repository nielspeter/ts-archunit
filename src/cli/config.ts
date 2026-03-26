import type { OutputFormat } from '../core/check-options.js'

export interface CliConfig {
  /** Path to tsconfig.json. Default: 'tsconfig.json' */
  project?: string
  /** Rule files to load. Default: discovered via glob */
  rules?: string[]
  /** Baseline file path */
  baseline?: string
  /** Output format. 'auto' uses detectFormat() */
  format?: OutputFormat | 'auto'
}

/**
 * Define a CLI configuration with type safety.
 *
 * @example
 * ```ts
 * // ts-archunit.config.ts
 * import { defineConfig } from 'ts-archunit'
 *
 * export default defineConfig({
 *   project: 'tsconfig.json',
 *   rules: ['arch.rules.ts'],
 *   baseline: 'arch-baseline.json',
 *   format: 'auto',
 * })
 * ```
 */
export function defineConfig(config: CliConfig): CliConfig {
  return config
}
