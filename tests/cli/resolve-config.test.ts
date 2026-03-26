import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { resolveConfig } from '../../src/cli/resolve-config.js'

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ts-archunit-resolve-config-'))
}

describe('resolveConfig', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = makeTmpDir()
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns empty config when no config file exists and no path given', async () => {
    const config = await resolveConfig()
    expect(config).toEqual({})
  })

  it('loads config from explicit path with all fields', async () => {
    const configFile = path.join(tmpDir, 'full-config.mjs')
    fs.writeFileSync(
      configFile,
      `export default {
        project: 'tsconfig.app.json',
        baseline: 'my-baseline.json',
        format: 'json',
        rules: ['rule1.ts', 'rule2.ts'],
      };\n`,
    )
    const config = await resolveConfig(configFile)
    expect(config.project).toBe('tsconfig.app.json')
    expect(config.baseline).toBe('my-baseline.json')
    expect(config.format).toBe('json')
    expect(config.rules).toEqual(['rule1.ts', 'rule2.ts'])
  })

  it('picks only valid format values', async () => {
    const configFile = path.join(tmpDir, 'format-terminal.mjs')
    fs.writeFileSync(configFile, `export default { format: 'terminal' };\n`)
    const config = await resolveConfig(configFile)
    expect(config.format).toBe('terminal')
  })

  it('ignores invalid format values', async () => {
    const configFile = path.join(tmpDir, 'format-bad.mjs')
    fs.writeFileSync(configFile, `export default { format: 'invalid-format' };\n`)
    const config = await resolveConfig(configFile)
    expect(config.format).toBeUndefined()
  })

  it('returns empty config when default export is not an object', async () => {
    const configFile = path.join(tmpDir, 'string-export.mjs')
    fs.writeFileSync(configFile, `export default "not-an-object";\n`)
    const config = await resolveConfig(configFile)
    expect(config).toEqual({})
  })

  it('returns empty config when default export is null', async () => {
    const configFile = path.join(tmpDir, 'null-export.mjs')
    fs.writeFileSync(configFile, `export default null;\n`)
    const config = await resolveConfig(configFile)
    expect(config).toEqual({})
  })

  it('returns empty config when module has no default export', async () => {
    const configFile = path.join(tmpDir, 'no-default.mjs')
    fs.writeFileSync(configFile, `export const something = 42;\n`)
    const config = await resolveConfig(configFile)
    expect(config).toEqual({})
  })

  it('filters non-string values from rules array', async () => {
    const configFile = path.join(tmpDir, 'mixed-rules.mjs')
    fs.writeFileSync(
      configFile,
      `export default { rules: ['valid.ts', 42, null, 'also-valid.ts'] };\n`,
    )
    const config = await resolveConfig(configFile)
    expect(config.rules).toEqual(['valid.ts', 'also-valid.ts'])
  })

  it('ignores non-string project field', async () => {
    const configFile = path.join(tmpDir, 'bad-project.mjs')
    fs.writeFileSync(configFile, `export default { project: 42 };\n`)
    const config = await resolveConfig(configFile)
    expect(config.project).toBeUndefined()
  })

  it('ignores non-string baseline field', async () => {
    const configFile = path.join(tmpDir, 'bad-baseline.mjs')
    fs.writeFileSync(configFile, `export default { baseline: true };\n`)
    const config = await resolveConfig(configFile)
    expect(config.baseline).toBeUndefined()
  })

  it('accepts github format', async () => {
    const configFile = path.join(tmpDir, 'format-github.mjs')
    fs.writeFileSync(configFile, `export default { format: 'github' };\n`)
    const config = await resolveConfig(configFile)
    expect(config.format).toBe('github')
  })

  it('accepts auto format', async () => {
    const configFile = path.join(tmpDir, 'format-auto.mjs')
    fs.writeFileSync(configFile, `export default { format: 'auto' };\n`)
    const config = await resolveConfig(configFile)
    expect(config.format).toBe('auto')
  })

  it('discovers config file from cwd', async () => {
    // Create a config file in a temp dir and mock process.cwd()
    const cwdDir = path.join(tmpDir, 'cwd-test')
    fs.mkdirSync(cwdDir, { recursive: true })
    const configFile = path.join(cwdDir, 'ts-archunit.config.js')
    fs.writeFileSync(configFile, `export default { project: 'found-it.json' };\n`)

    vi.spyOn(process, 'cwd').mockReturnValue(cwdDir)

    const config = await resolveConfig()
    expect(config.project).toBe('found-it.json')
  })
})
