import { describe, it, expect } from 'vitest'
import { Project, SyntaxKind } from 'ts-morph'
import {
  fromJsxElement,
  fromJsxSelfClosingElement,
  collectJsxElements,
  STANDARD_HTML_TAGS,
} from '../../src/models/arch-jsx-element.js'

function createTsxProject(code: string, fileName = 'test.tsx') {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { jsx: 2 /* React */, strict: true },
  })
  const sf = project.createSourceFile(fileName, code)
  return { project, sf }
}

describe('ArchJsxElement model', () => {
  describe('fromJsxElement (has children)', () => {
    it('getName() returns "div" for a <div> element', () => {
      const { sf } = createTsxProject(`const x = <div>hello</div>`)
      const el = sf.getDescendantsOfKind(SyntaxKind.JsxElement)[0]!
      const arch = fromJsxElement(el)
      expect(arch.getName()).toBe('div')
    })

    it('getName() returns "Button" for a <Button> element', () => {
      const { sf } = createTsxProject(`const x = <Button>click</Button>`)
      const el = sf.getDescendantsOfKind(SyntaxKind.JsxElement)[0]!
      const arch = fromJsxElement(el)
      expect(arch.getName()).toBe('Button')
    })

    it('getName() returns "Icons.Check" for dotted component', () => {
      const { sf } = createTsxProject(`const x = <Icons.Check>ok</Icons.Check>`)
      const el = sf.getDescendantsOfKind(SyntaxKind.JsxElement)[0]!
      const arch = fromJsxElement(el)
      expect(arch.getName()).toBe('Icons.Check')
    })

    it('getName() returns "motion.div" for framer-motion element', () => {
      const { sf } = createTsxProject(`const x = <motion.div>animate</motion.div>`)
      const el = sf.getDescendantsOfKind(SyntaxKind.JsxElement)[0]!
      const arch = fromJsxElement(el)
      expect(arch.getName()).toBe('motion.div')
    })

    it('hasChildren() returns true', () => {
      const { sf } = createTsxProject(`const x = <div>hello</div>`)
      const el = sf.getDescendantsOfKind(SyntaxKind.JsxElement)[0]!
      expect(fromJsxElement(el).hasChildren()).toBe(true)
    })
  })

  describe('fromJsxSelfClosingElement', () => {
    it('getName() returns "input" for a <input /> element', () => {
      const { sf } = createTsxProject(`const x = <input type="text" />`)
      const el = sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)[0]!
      const arch = fromJsxSelfClosingElement(el)
      expect(arch.getName()).toBe('input')
    })

    it('hasChildren() returns false', () => {
      const { sf } = createTsxProject(`const x = <input />`)
      const el = sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)[0]!
      expect(fromJsxSelfClosingElement(el).hasChildren()).toBe(false)
    })
  })

  describe('isHtmlElement / isComponent classification', () => {
    it('isHtmlElement() returns true for lowercase simple tags', () => {
      const { sf } = createTsxProject(`const x = <div>hi</div>`)
      const el = sf.getDescendantsOfKind(SyntaxKind.JsxElement)[0]!
      const arch = fromJsxElement(el)
      expect(arch.isHtmlElement()).toBe(true)
      expect(arch.isComponent()).toBe(false)
    })

    it('isComponent() returns true for uppercase tags', () => {
      const { sf } = createTsxProject(`const x = <Button>click</Button>`)
      const el = sf.getDescendantsOfKind(SyntaxKind.JsxElement)[0]!
      const arch = fromJsxElement(el)
      expect(arch.isComponent()).toBe(true)
      expect(arch.isHtmlElement()).toBe(false)
    })

    it('isComponent() returns true for dot-notation lowercase (motion.div)', () => {
      const { sf } = createTsxProject(`const x = <motion.div>x</motion.div>`)
      const el = sf.getDescendantsOfKind(SyntaxKind.JsxElement)[0]!
      const arch = fromJsxElement(el)
      expect(arch.isComponent()).toBe(true)
      expect(arch.isHtmlElement()).toBe(false)
    })

    it('isComponent() returns true for dot-notation uppercase (Icons.Check)', () => {
      const { sf } = createTsxProject(`const x = <Icons.Check />`)
      const el = sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)[0]!
      const arch = fromJsxSelfClosingElement(el)
      expect(arch.isComponent()).toBe(true)
    })

    it('isHtmlElement() returns true for namespaced tags (svg:rect)', () => {
      const { sf } = createTsxProject(`const x = <svg:rect />`)
      const el = sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)[0]!
      const arch = fromJsxSelfClosingElement(el)
      // svg:rect does not contain '.', and first char is lowercase
      expect(arch.isHtmlElement()).toBe(true)
    })
  })

  describe('getAttribute', () => {
    it('returns string literal value without quotes', () => {
      const { sf } = createTsxProject(`const x = <img src="logo.png" alt="Logo" />`)
      const el = sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)[0]!
      const arch = fromJsxSelfClosingElement(el)
      expect(arch.getAttribute('alt')).toBe('Logo')
    })

    it('returns raw text for expression attributes', () => {
      const { sf } = createTsxProject(`const x = <button onClick={() => {}} />`)
      const el = sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)[0]!
      const arch = fromJsxSelfClosingElement(el)
      expect(arch.getAttribute('onClick')).toBe('{() => {}}')
    })

    it('returns undefined for valueless attributes', () => {
      const { sf } = createTsxProject(`const x = <input disabled />`)
      const el = sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)[0]!
      const arch = fromJsxSelfClosingElement(el)
      expect(arch.getAttribute('disabled')).toBeUndefined()
    })

    it('returns undefined for absent attributes', () => {
      const { sf } = createTsxProject(`const x = <input type="text" />`)
      const el = sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)[0]!
      const arch = fromJsxSelfClosingElement(el)
      expect(arch.getAttribute('disabled')).toBeUndefined()
    })
  })

  describe('hasAttribute', () => {
    it('returns true for named attributes', () => {
      const { sf } = createTsxProject(`const x = <input type="text" />`)
      const el = sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)[0]!
      const arch = fromJsxSelfClosingElement(el)
      expect(arch.hasAttribute('type')).toBe(true)
    })

    it('returns true for valueless attributes', () => {
      const { sf } = createTsxProject(`const x = <input disabled />`)
      const el = sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)[0]!
      const arch = fromJsxSelfClosingElement(el)
      expect(arch.hasAttribute('disabled')).toBe(true)
    })

    it('returns false for absent attributes', () => {
      const { sf } = createTsxProject(`const x = <input />`)
      const el = sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)[0]!
      const arch = fromJsxSelfClosingElement(el)
      expect(arch.hasAttribute('disabled')).toBe(false)
    })
  })

  describe('getAttributeNames', () => {
    it('returns named attributes only, skips spread', () => {
      const { sf } = createTsxProject(`const x = <Button className="btn" {...props} disabled />`)
      const el = sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)[0]!
      const arch = fromJsxSelfClosingElement(el)
      expect(arch.getAttributeNames()).toEqual(['className', 'disabled'])
    })

    it('returns empty array for elements with no named attributes', () => {
      const { sf } = createTsxProject(`const x = <div>hello</div>`)
      const el = sf.getDescendantsOfKind(SyntaxKind.JsxElement)[0]!
      const arch = fromJsxElement(el)
      expect(arch.getAttributeNames()).toEqual([])
    })
  })

  describe('getStartLineNumber', () => {
    it('returns correct line number', () => {
      const { sf } = createTsxProject(`\n\nconst x = <div>hello</div>`)
      const el = sf.getDescendantsOfKind(SyntaxKind.JsxElement)[0]!
      expect(fromJsxElement(el).getStartLineNumber()).toBe(3)
    })
  })

  describe('collectJsxElements', () => {
    it('collects JsxElement and JsxSelfClosingElement', () => {
      const { sf } = createTsxProject(`
        const x = <div><span>text</span></div>
        const y = <input />
      `)
      const elements = collectJsxElements(sf)
      const names = elements.map((e) => e.getName())
      expect(names).toContain('div')
      expect(names).toContain('span')
      expect(names).toContain('input')
    })

    it('skips JsxFragment', () => {
      const { sf } = createTsxProject(`
        const x = <>
          <div>hello</div>
          <span>world</span>
        </>
      `)
      const elements = collectJsxElements(sf)
      // Fragment itself not collected, but children are
      const names = elements.map((e) => e.getName())
      expect(names).toContain('div')
      expect(names).toContain('span')
      expect(names).not.toContain('')
    })

    it('returns empty for .ts files', () => {
      const project = new Project({
        useInMemoryFileSystem: true,
        compilerOptions: { jsx: 2, strict: true },
      })
      const sf = project.createSourceFile('test.ts', `const x = 1`)
      expect(collectJsxElements(sf)).toEqual([])
    })

    it('returns empty for .js files', () => {
      const project = new Project({
        useInMemoryFileSystem: true,
        compilerOptions: { jsx: 2, strict: true, allowJs: true },
      })
      const sf = project.createSourceFile('test.js', `const x = 1`)
      expect(collectJsxElements(sf)).toEqual([])
    })

    it('collects from .jsx files', () => {
      const project = new Project({
        useInMemoryFileSystem: true,
        compilerOptions: { jsx: 2, strict: true, allowJs: true },
      })
      const sf = project.createSourceFile('test.jsx', `const x = <div>hello</div>`)
      const elements = collectJsxElements(sf)
      expect(elements).toHaveLength(1)
      expect(elements[0]!.getName()).toBe('div')
    })
  })

  describe('STANDARD_HTML_TAGS', () => {
    it('includes common tags', () => {
      expect(STANDARD_HTML_TAGS).toContain('div')
      expect(STANDARD_HTML_TAGS).toContain('button')
      expect(STANDARD_HTML_TAGS).toContain('input')
      expect(STANDARD_HTML_TAGS).toContain('img')
      expect(STANDARD_HTML_TAGS).toContain('a')
    })

    it('does not include non-HTML tags', () => {
      expect(STANDARD_HTML_TAGS).not.toContain('Button')
      expect(STANDARD_HTML_TAGS).not.toContain('React')
    })
  })
})
