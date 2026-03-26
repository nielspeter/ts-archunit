import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'
import { project } from '../../src/core/project.js'
import { smells } from '../../src/smells/index.js'
import { call } from '../../src/helpers/matchers.js'
import { ArchRuleError } from '../../src/core/errors.js'

const dupFixturesDir = path.resolve(import.meta.dirname, '../fixtures/smells/duplicate-bodies')
const sibFixturesDir = path.resolve(import.meta.dirname, '../fixtures/smells/inconsistent-siblings')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SmellBuilder.ignoreTests()', () => {
  it('ignoreTests on duplicateBodies does not crash', () => {
    const p = project(path.join(dupFixturesDir, 'tsconfig.json'))
    const builder = smells.duplicateBodies(p).minLines(3).withMinSimilarity(0.8).ignoreTests()
    // The fixture dir has no test files so ignoreTests is a no-op but should not error
    expect(() => builder.check()).toThrow(ArchRuleError)
  })

  it('ignoreTests on inconsistentSiblings does not crash', () => {
    const p = project(path.join(sibFixturesDir, 'tsconfig.json'))
    const builder = smells
      .inconsistentSiblings(p)
      .forPattern(call('this.extractCount'))
      .minLines(2)
      .ignoreTests()
    expect(() => builder.check()).toThrow(ArchRuleError)
  })
})

describe('SmellBuilder.ignorePaths()', () => {
  it('ignorePaths excludes matching files from duplicateBodies', () => {
    const p = project(path.join(dupFixturesDir, 'tsconfig.json'))
    // Ignoring all .ts files should result in no functions to compare
    const builder = smells
      .duplicateBodies(p)
      .minLines(3)
      .withMinSimilarity(0.8)
      .ignorePaths('**/*.ts')
    expect(() => builder.check()).not.toThrow()
  })

  it('ignorePaths excludes matching files from inconsistentSiblings', () => {
    const p = project(path.join(sibFixturesDir, 'tsconfig.json'))
    const builder = smells
      .inconsistentSiblings(p)
      .forPattern(call('this.extractCount'))
      .minLines(2)
      .ignorePaths('**/*.ts')
    // With all files ignored, no violations possible
    expect(() => builder.check()).not.toThrow()
  })

  it('ignorePaths can be called multiple times', () => {
    const p = project(path.join(dupFixturesDir, 'tsconfig.json'))
    const builder = smells
      .duplicateBodies(p)
      .minLines(3)
      .withMinSimilarity(0.8)
      .ignorePaths('**/nonexistent/**')
      .ignorePaths('**/also-nonexistent/**')
    // No paths match so original violations still apply
    expect(() => builder.check()).toThrow(ArchRuleError)
  })
})

describe('SmellBuilder.inFolder()', () => {
  it('inFolder restricts scope to matching files', () => {
    const p = project(path.join(dupFixturesDir, 'tsconfig.json'))
    const builder = smells
      .duplicateBodies(p)
      .minLines(3)
      .withMinSimilarity(0.8)
      .inFolder('**/nonexistent/**')
    // No files in nonexistent folder, so no violations
    expect(() => builder.check()).not.toThrow()
  })
})

describe('SmellBuilder.warn() output formats', () => {
  it('warn with json format outputs JSON', () => {
    const p = project(path.join(dupFixturesDir, 'tsconfig.json'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    smells.duplicateBodies(p).minLines(3).withMinSimilarity(0.8).warn({ format: 'json' })
    expect(warnSpy).toHaveBeenCalled()
    // JSON output should start with [ or { or be valid JSON
    const output = String(warnSpy.mock.calls[0]?.[0] ?? '')
    expect(output.startsWith('[') || output.startsWith('{')).toBe(true)
  })

  it('warn with github format writes to stdout', () => {
    const p = project(path.join(dupFixturesDir, 'tsconfig.json'))
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    smells.duplicateBodies(p).minLines(3).withMinSimilarity(0.8).warn({ format: 'github' })
    expect(writeSpy).toHaveBeenCalled()
    const output = String(writeSpy.mock.calls[0]?.[0] ?? '')
    expect(output).toContain('::warning')
  })

  it('warn with terminal format outputs to console.warn', () => {
    const p = project(path.join(dupFixturesDir, 'tsconfig.json'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    smells.duplicateBodies(p).minLines(3).withMinSimilarity(0.8).warn({ format: 'terminal' })
    expect(warnSpy).toHaveBeenCalled()
  })

  it('warn does nothing when no violations', () => {
    const p = project(path.join(dupFixturesDir, 'tsconfig.json'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    smells.duplicateBodies(p).minLines(1000).withMinSimilarity(0.5).warn()
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

describe('SmellBuilder.check() output formats', () => {
  it('check with github format writes annotations before throwing', () => {
    const p = project(path.join(dupFixturesDir, 'tsconfig.json'))
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    expect(() => {
      smells.duplicateBodies(p).minLines(3).withMinSimilarity(0.8).check({ format: 'github' })
    }).toThrow(ArchRuleError)
    expect(writeSpy).toHaveBeenCalled()
    const output = String(writeSpy.mock.calls[0]?.[0] ?? '')
    expect(output).toContain('::error')
  })
})
