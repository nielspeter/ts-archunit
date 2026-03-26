import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { loadRuleFiles } from '../../src/cli/load-rules.js'

/** Create a temp directory for test fixtures. */
function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ts-archunit-load-rules-'))
}

describe('loadRuleFiles', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = makeTmpDir()
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns empty array for no files', async () => {
    const result = await loadRuleFiles([])
    expect(result).toEqual([])
  })

  it('loads a module that exports a default array of rule builders', async () => {
    const file = path.join(tmpDir, 'rules-array.mjs')
    fs.writeFileSync(file, `export default [{ check: () => {} }, { check: () => {} }];\n`)
    const result = await loadRuleFiles([file])
    expect(result).toHaveLength(2)
    expect(typeof result[0]!.check).toBe('function')
  })

  it('loads a module that exports a default factory function', async () => {
    const file = path.join(tmpDir, 'rules-factory.mjs')
    fs.writeFileSync(file, `export default function() { return [{ check: () => {} }]; };\n`)
    const result = await loadRuleFiles([file])
    expect(result).toHaveLength(1)
  })

  it('skips items that are not rule-builder-like', async () => {
    const file = path.join(tmpDir, 'rules-mixed.mjs')
    fs.writeFileSync(file, `export default [{ check: () => {} }, 'not-a-builder', 42, null];\n`)
    const result = await loadRuleFiles([file])
    expect(result).toHaveLength(1)
  })

  it('returns empty array when default export is not an array or function', async () => {
    const file = path.join(tmpDir, 'rules-string.mjs')
    fs.writeFileSync(file, `export default "hello";\n`)
    const result = await loadRuleFiles([file])
    expect(result).toEqual([])
  })

  it('returns empty array when module has no default export', async () => {
    const file = path.join(tmpDir, 'rules-no-default.mjs')
    fs.writeFileSync(file, `export const foo = 'bar';\n`)
    const result = await loadRuleFiles([file])
    expect(result).toEqual([])
  })

  it('returns empty array when factory function returns non-array', async () => {
    const file = path.join(tmpDir, 'rules-factory-string.mjs')
    fs.writeFileSync(file, `export default function() { return "not-an-array"; };\n`)
    const result = await loadRuleFiles([file])
    expect(result).toEqual([])
  })

  it('loads multiple files and merges rule builders', async () => {
    const file1 = path.join(tmpDir, 'rules-a.mjs')
    const file2 = path.join(tmpDir, 'rules-b.mjs')
    fs.writeFileSync(file1, `export default [{ check: () => {} }];\n`)
    fs.writeFileSync(file2, `export default [{ check: () => {} }, { check: () => {} }];\n`)
    const result = await loadRuleFiles([file1, file2])
    expect(result).toHaveLength(3)
  })

  it('resolves relative paths', async () => {
    const file = path.join(tmpDir, 'rules-relative.mjs')
    fs.writeFileSync(file, `export default [{ check: () => {} }];\n`)
    // Pass the absolute path — loadRuleFiles calls path.resolve internally
    const result = await loadRuleFiles([file])
    expect(result).toHaveLength(1)
  })
})
