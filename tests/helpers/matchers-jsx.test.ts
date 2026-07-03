import { describe, it, expect } from 'vitest'
import { Project, SyntaxKind } from 'ts-morph'
import { jsxElement, jsxText } from '../../src/helpers/matchers.js'

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

describe('jsxText() matcher', () => {
  // --- Matches (positive cases) ---

  it('matches JsxText with prose', () => {
    const sf = createTsxProject(`const x = <button>Save</button>`)
    const matcher = jsxText()
    const text = sf
      .getDescendantsOfKind(SyntaxKind.JsxText)
      .find((t) => t.getText().includes('Save'))!
    expect(matcher.matches(text)).toBe(true)
  })

  it('matches JsxExpression wrapping a string literal', () => {
    const sf = createTsxProject(`const x = <div>{"Save"}</div>`)
    const matcher = jsxText()
    const expr = sf.getDescendantsOfKind(SyntaxKind.JsxExpression)[0]!
    expect(matcher.matches(expr)).toBe(true)
  })

  it('matches JsxExpression wrapping a no-substitution template literal', () => {
    const sf = createTsxProject('const x = <div>{`Save`}</div>')
    const matcher = jsxText()
    const expr = sf.getDescendantsOfKind(SyntaxKind.JsxExpression)[0]!
    expect(matcher.matches(expr)).toBe(true)
  })

  it('matches only prose JsxText nodes among whitespace siblings', () => {
    // <b/>/<i/>/<u/> force whitespace-only JsxText siblings between them, so a
    // matcher that ignored the whitespace filter would match all 4, not 2.
    const sf = createTsxProject(`const x = (
  <div>
    <b />
    Hello
    <i />
    world
    <u />
  </div>
)`)
    const matcher = jsxText()
    const texts = sf.getDescendantsOfKind(SyntaxKind.JsxText)
    expect(texts.length).toBeGreaterThan(2) // includes whitespace-only siblings
    const matched = texts.filter((t) => matcher.matches(t))
    expect(matched).toHaveLength(2)
  })

  it('matches single-character text (no letter-gate baked in)', () => {
    const sf = createTsxProject(`const x = <div>×</div>`)
    const matcher = jsxText()
    const text = sf.getDescendantsOfKind(SyntaxKind.JsxText).find((t) => t.getText().includes('×'))!
    expect(matcher.matches(text)).toBe(true)
  })

  it('matches numeric-only text (no letter-gate baked in)', () => {
    const sf = createTsxProject(`const x = <div>123</div>`)
    const matcher = jsxText()
    const text = sf
      .getDescendantsOfKind(SyntaxKind.JsxText)
      .find((t) => t.getText().includes('123'))!
    expect(matcher.matches(text)).toBe(true)
  })

  it('matches text content inside a fragment', () => {
    const sf = createTsxProject(`const x = <>{"Save"}</>`)
    const matcher = jsxText()
    const expr = sf.getDescendantsOfKind(SyntaxKind.JsxExpression)[0]!
    expect(matcher.matches(expr)).toBe(true)
  })

  // --- Does NOT match (negative cases) ---

  it('does not match whitespace-only JsxText', () => {
    const sf = createTsxProject(`const x = (
  <div>
    <span />
  </div>
)`)
    const matcher = jsxText()
    const texts = sf.getDescendantsOfKind(SyntaxKind.JsxText)
    expect(texts.length).toBeGreaterThan(0)
    for (const t of texts) {
      expect(matcher.matches(t)).toBe(false)
    }
  })

  it('does not match JsxExpression wrapping an identifier', () => {
    const sf = createTsxProject(`const x = <div>{count}</div>`)
    const matcher = jsxText()
    const expr = sf.getDescendantsOfKind(SyntaxKind.JsxExpression)[0]!
    expect(matcher.matches(expr)).toBe(false)
  })

  it('does not match JsxExpression wrapping a call expression', () => {
    const sf = createTsxProject(`const x = <div>{t("save")}</div>`)
    const matcher = jsxText()
    const expr = sf.getDescendantsOfKind(SyntaxKind.JsxExpression)[0]!
    expect(matcher.matches(expr)).toBe(false)
  })

  it('does not match a template literal with substitution', () => {
    const sf = createTsxProject('const x = <div>{`Hello ${name}`}</div>')
    const matcher = jsxText()
    const expr = sf.getDescendantsOfKind(SyntaxKind.JsxExpression)[0]!
    expect(matcher.matches(expr)).toBe(false)
  })

  it('does not match an empty JsxExpression', () => {
    const sf = createTsxProject(`const x = <div>{/* comment */}</div>`)
    const matcher = jsxText()
    const expr = sf.getDescendantsOfKind(SyntaxKind.JsxExpression)[0]!
    expect(matcher.matches(expr)).toBe(false)
  })

  it('does not match a string literal in a braced attribute value', () => {
    // attributes are the domain of jsxElements() — braced attr values must not
    // leak into jsxText() the way `<div>{"x"}</div>` (a child) does
    const sf = createTsxProject(`const x = <img src={"/logo.png"} alt={"logo"} />`)
    const matcher = jsxText()
    const exprs = sf.getDescendantsOfKind(SyntaxKind.JsxExpression)
    expect(exprs).toHaveLength(2)
    for (const e of exprs) {
      expect(matcher.matches(e)).toBe(false)
    }
  })

  it('does not match a no-substitution template in a braced attribute value', () => {
    const sf = createTsxProject('const x = <img alt={`logo`} />')
    const matcher = jsxText()
    const expr = sf.getDescendantsOfKind(SyntaxKind.JsxExpression)[0]!
    expect(matcher.matches(expr)).toBe(false)
  })

  it('does not match a plain string literal outside JSX', () => {
    const sf = createTsxProject(`const x = "Save"`)
    const matcher = jsxText()
    for (const node of sf.getDescendants()) {
      expect(matcher.matches(node)).toBe(false)
    }
  })

  // --- Structural ---

  it('has correct syntaxKinds for efficient traversal', () => {
    const matcher = jsxText()
    expect(matcher.syntaxKinds).toContain(SyntaxKind.JsxText)
    expect(matcher.syntaxKinds).toContain(SyntaxKind.JsxExpression)
    expect(matcher.syntaxKinds).toHaveLength(2)
  })
})
