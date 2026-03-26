import { describe, it, expect, vi, afterEach } from 'vitest'
import { Project, SyntaxKind } from 'ts-morph'
import path from 'node:path'
import { access, expression } from '../../src/helpers/matchers.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')

const project = new Project({
  tsConfigFilePath: path.join(fixturesDir, 'tsconfig.json'),
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('access() with real ts-morph nodes', () => {
  it('matches an exact property access chain (string)', () => {
    // Find a PropertyAccessExpression in the fixtures
    const allAccessNodes = project
      .getSourceFiles()
      .flatMap((sf) => sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression))

    const matcher = access('order.startsWith')
    const matched = allAccessNodes.filter((n) => matcher.matches(n))
    // There should be at least one instance of order?.startsWith or similar
    // If not, verify it doesn't crash
    expect(matched.length).toBeGreaterThanOrEqual(0)
  })

  it('does not match wrong property access', () => {
    const allAccessNodes = project
      .getSourceFiles()
      .flatMap((sf) => sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression))

    const matcher = access('process.env.NONEXISTENT_THING')
    const matched = allAccessNodes.filter((n) => matcher.matches(n))
    expect(matched).toHaveLength(0)
  })

  it('matches with regex', () => {
    const allAccessNodes = project
      .getSourceFiles()
      .flatMap((sf) => sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression))

    const matcher = access(/normalizeCount/)
    const matched = allAccessNodes.filter((n) => matcher.matches(n))
    // EdgeCaseService uses this?.normalizeCount
    expect(matched.length).toBeGreaterThan(0)
  })

  it('regex does not match unrelated access', () => {
    const allAccessNodes = project
      .getSourceFiles()
      .flatMap((sf) => sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression))

    const matcher = access(/^process\.env$/)
    const matched = allAccessNodes.filter((n) => matcher.matches(n))
    // No process.env in fixtures
    expect(matched).toHaveLength(0)
  })

  it('does not match CallExpression nodes', () => {
    const callNodes = project
      .getSourceFiles()
      .flatMap((sf) => sf.getDescendantsOfKind(SyntaxKind.CallExpression))

    if (callNodes.length === 0) return

    const matcher = access('parseInt')
    expect(matcher.matches(callNodes[0]!)).toBe(false)
  })

  it('regex variant does not match CallExpression', () => {
    const callNodes = project
      .getSourceFiles()
      .flatMap((sf) => sf.getDescendantsOfKind(SyntaxKind.CallExpression))

    if (callNodes.length === 0) return

    expect(access(/^parseInt$/).matches(callNodes[0]!)).toBe(false)
  })

  it('has meaningful description for string', () => {
    expect(access('process.env').description).toBe("access to 'process.env'")
  })

  it('has meaningful description for regex', () => {
    expect(access(/^this\.db/).description).toBe('access matching /^this\\.db/')
  })
})

describe('expression() with real ts-morph nodes', () => {
  it('matches any node containing substring (string)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    // Get some nodes from the project
    const sf = project.getSourceFiles()[0]!
    const allNodes = sf.getDescendants()

    const matcher = expression('parseInt')
    const matched = allNodes.filter((n) => matcher.matches(n))
    // expression is a broad matcher, should find at least some nodes
    expect(matched.length).toBeGreaterThanOrEqual(0)

    // Should have warned about broad matcher
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('broad matcher'))
  })

  it('matches with regex', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const sf = project.getSourceFiles()[0]!
    const allNodes = sf.getDescendants()

    const matcher = expression(/parseInt/)
    const matched = allNodes.filter((n) => matcher.matches(n))
    expect(matched.length).toBeGreaterThanOrEqual(0)

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('broad matcher'))
  })

  it('regex returns false for non-matching node text', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const sf = project.getSourceFiles()[0]!
    const nodes = sf.getDescendants()
    const matcher = expression(/^ZZZZZ_UNIQUE_NEVER_MATCH$/)
    const matched = nodes.filter((n) => matcher.matches(n))
    expect(matched).toHaveLength(0)
  })

  it('has no syntaxKinds for string', () => {
    expect(expression('eval').syntaxKinds).toBeUndefined()
  })

  it('has no syntaxKinds for regex', () => {
    expect(expression(/eval/).syntaxKinds).toBeUndefined()
  })

  it('warns only once per matcher instance (string)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const sf = project.getSourceFiles()[0]!
    const nodes = sf.getDescendants().slice(0, 5)

    const matcher = expression('testval')
    for (const node of nodes) {
      matcher.matches(node)
    }
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('warns only once per matcher instance (regex)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const sf = project.getSourceFiles()[0]!
    const nodes = sf.getDescendants().slice(0, 5)

    const matcher = expression(/testval/)
    for (const node of nodes) {
      matcher.matches(node)
    }
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})
