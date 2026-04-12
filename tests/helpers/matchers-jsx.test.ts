import { describe, it, expect } from 'vitest'
import { Project, SyntaxKind } from 'ts-morph'
import { jsxElement } from '../../src/helpers/matchers.js'

function createTsxProject(code: string) {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { jsx: 2, strict: true },
  })
  return project.createSourceFile('test.tsx', code)
}

describe('jsxElement() matcher', () => {
  it('matches JsxElement by exact tag name', () => {
    const sf = createTsxProject(`const x = <div>hello</div>`)
    const matcher = jsxElement('div')
    const el = sf.getDescendantsOfKind(SyntaxKind.JsxElement)[0]!
    expect(matcher.matches(el)).toBe(true)
  })

  it('matches JsxSelfClosingElement by exact tag name', () => {
    const sf = createTsxProject(`const x = <input />`)
    const matcher = jsxElement('input')
    const el = sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)[0]!
    expect(matcher.matches(el)).toBe(true)
  })

  it('does not match different tag name', () => {
    const sf = createTsxProject(`const x = <span>text</span>`)
    const matcher = jsxElement('div')
    const el = sf.getDescendantsOfKind(SyntaxKind.JsxElement)[0]!
    expect(matcher.matches(el)).toBe(false)
  })

  it('matches with regex', () => {
    const sf = createTsxProject(`const x = <motion.div>animate</motion.div>`)
    const matcher = jsxElement(/^motion\./)
    const el = sf.getDescendantsOfKind(SyntaxKind.JsxElement)[0]!
    expect(matcher.matches(el)).toBe(true)
  })

  it('does not match non-JSX nodes', () => {
    const sf = createTsxProject(`const div = 1`)
    const matcher = jsxElement('div')
    const allNodes = sf.getDescendants()
    // None should match since there's no JSX
    for (const node of allNodes) {
      expect(matcher.matches(node)).toBe(false)
    }
  })

  it('has correct syntaxKinds for efficient traversal', () => {
    const matcher = jsxElement('div')
    expect(matcher.syntaxKinds).toContain(SyntaxKind.JsxElement)
    expect(matcher.syntaxKinds).toContain(SyntaxKind.JsxSelfClosingElement)
    expect(matcher.syntaxKinds).toHaveLength(2)
  })

  it('has descriptive description for string', () => {
    const matcher = jsxElement('div')
    expect(matcher.description).toBe('JSX element <div>')
  })

  it('has descriptive description for regex', () => {
    const matcher = jsxElement(/^Button/)
    expect(matcher.description).toContain('matching')
  })
})
