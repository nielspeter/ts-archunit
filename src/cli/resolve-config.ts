import path from 'node:path'
import fs from 'node:fs'
import type { CliConfig } from './config.js'

const CONFIG_FILENAMES = ['ts-archunit.config.ts', 'ts-archunit.config.js']

/**
 * Resolve CLI configuration from an explicit path or by searching for a config file.
 *
 * Config resolution order:
 * 1. CLI flags (highest priority) — handled by caller
 * 2. ts-archunit.config.ts in project root
 * 3. Defaults (project: 'tsconfig.json', format: 'auto')
 */
export async function resolveConfig(explicitPath?: string): Promise<CliConfig> {
  const configPath = explicitPath ?? findConfigFile()

  if (configPath === undefined) return {}

  const mod: unknown = await import(path.resolve(configPath))
  return extractDefault(mod)
}

function findConfigFile(): string | undefined {
  const cwd = process.cwd()
  for (const name of CONFIG_FILENAMES) {
    const candidate = path.join(cwd, name)
    if (fs.existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * Extract the default export from an ESM module.
 * Supports both `export default config` and `module.exports = config`.
 */
function extractDefault(mod: unknown): CliConfig {
  if (mod === null || mod === undefined || typeof mod !== 'object') {
    return {}
  }
  // Dynamic import returns a module namespace — 'in' narrows safely
  if (!('default' in mod)) {
    return {}
  }
  const defaultExport: unknown = (mod as Record<string, unknown>)['default']
  if (defaultExport === null || defaultExport === undefined || typeof defaultExport !== 'object') {
    return {}
  }
  // Runtime validate: only pick known CliConfig fields
  const obj = defaultExport as Record<string, unknown>
  const config: CliConfig = {}
  if (typeof obj['project'] === 'string') config.project = obj['project']
  if (typeof obj['baseline'] === 'string') config.baseline = obj['baseline']
  if (typeof obj['format'] === 'string') {
    const validFormats = ['terminal', 'json', 'github', 'auto']
    if (validFormats.includes(obj['format'])) {
      config.format = obj['format'] as CliConfig['format']
    }
  }
  if (Array.isArray(obj['rules']))
    config.rules = obj['rules'].filter((r): r is string => typeof r === 'string')
  return config
}
