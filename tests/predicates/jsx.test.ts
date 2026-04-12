import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { collectJsxElements } from '../../src/models/arch-jsx-element.js'
import {
  areHtmlElements,
  areComponents,
  withAttribute,
  withAttributeMatching,
} from '../../src/predicates/jsx.js'
import {
  haveNameMatching,
  haveNameStartingWith,
  haveNameEndingWith,
  resideInFile,
  resideInFolder,
} from '../../src/predicates/identity.js'
import type { ArchJsxElement } from '../../src/models/arch-jsx-element.js'

function createElements(code: string, fileName = 'test.tsx'): ArchJsxElement[] {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { jsx: 2, strict: true },
  })
  const sf = project.createSourceFile(fileName, code)
  return collectJsxElements(sf)
}

describe('JSX predicates', () => {
  describe('areHtmlElements', () => {
    it('matches specified HTML tags', () => {
      const elements = createElements(`
        const x = <div>
          <button>click</button>
          <Button>click</Button>
          <input />
        </div>
      `)
      const pred = areHtmlElements('button', 'input')
      const matched = elements.filter((e) => pred.test(e))
      expect(matched.map((e) => e.getName())).toEqual(['button', 'input'])
    })

    it('uses STANDARD_HTML_TAGS for common tags', async () => {
      const elements = createElements(`
        const x = <div><span>text</span></div>
      `)
      const { STANDARD_HTML_TAGS } = await import('../../src/models/arch-jsx-element.js')
      const pred = areHtmlElements(...STANDARD_HTML_TAGS)
      const matched = elements.filter((e) => pred.test(e))
      expect(matched.map((e) => e.getName())).toContain('div')
      expect(matched.map((e) => e.getName())).toContain('span')
    })

    it('throws when called with zero tags', () => {
      expect(() => areHtmlElements()).toThrow('requires at least one tag name')
    })

    it('does not match custom web components like <my-widget>', () => {
      const elements = createElements(`const x = <my-widget />`)
      const pred = areHtmlElements('div', 'span')
      const matched = elements.filter((e) => pred.test(e))
      expect(matched).toHaveLength(0)
    })
  })

  describe('areComponents', () => {
    it('matches all components when no args', () => {
      const elements = createElements(`
        const x = <div>
          <Button>click</Button>
          <Icons.Check />
        </div>
      `)
      const pred = areComponents()
      const matched = elements.filter((e) => pred.test(e))
      expect(matched.map((e) => e.getName())).toEqual(['Button', 'Icons.Check'])
    })

    it('matches specific components with args', () => {
      const elements = createElements(`
        const x = <div>
          <Button>click</Button>
          <Input />
        </div>
      `)
      const pred = areComponents('Button')
      const matched = elements.filter((e) => pred.test(e))
      expect(matched).toHaveLength(1)
      expect(matched[0]!.getName()).toBe('Button')
    })

    it('matches dotted component with full name', () => {
      const elements = createElements(`const x = <Icons.Check />`)
      const pred = areComponents('Icons.Check')
      const matched = elements.filter((e) => pred.test(e))
      expect(matched).toHaveLength(1)
    })

    it('classifies motion.div as component', () => {
      const elements = createElements(`const x = <motion.div>x</motion.div>`)
      const pred = areComponents()
      expect(pred.test(elements[0]!)).toBe(true)
    })
  })

  describe('withAttribute', () => {
    it('filters to elements that have the named attribute', () => {
      const elements = createElements(`
        const x = <div>
          <button onClick={() => {}}>click</button>
          <span>text</span>
        </div>
      `)
      const pred = withAttribute('onClick')
      const matched = elements.filter((e) => pred.test(e))
      expect(matched).toHaveLength(1)
      expect(matched[0]!.getName()).toBe('button')
    })
  })

  describe('withAttributeMatching', () => {
    it('filters by string value match', () => {
      const elements = createElements(`
        const x = <div>
          <input type="text" />
          <input type="submit" />
        </div>
      `)
      const pred = withAttributeMatching('type', 'submit')
      const matched = elements.filter((e) => pred.test(e))
      expect(matched).toHaveLength(1)
    })

    it('filters by regex value match', () => {
      const elements = createElements(`
        const x = <div>
          <div className="error-box">bad</div>
          <div className="info-box">ok</div>
        </div>
      `)
      const pred = withAttributeMatching('className', /error/)
      const matched = elements.filter((e) => pred.test(e))
      expect(matched).toHaveLength(1)
    })
  })

  describe('identity predicates on ArchJsxElement', () => {
    it('haveNameMatching works with regex', () => {
      const elements = createElements(`
        const x = <div><Button>a</Button><Input /></div>
      `)
      const pred = haveNameMatching<ArchJsxElement>(/^B/)
      const matched = elements.filter((e) => pred.test(e))
      expect(matched).toHaveLength(1)
      expect(matched[0]!.getName()).toBe('Button')
    })

    it('haveNameStartingWith works', () => {
      const elements = createElements(`const x = <div><Button>a</Button></div>`)
      const pred = haveNameStartingWith<ArchJsxElement>('But')
      expect(elements.filter((e) => pred.test(e))).toHaveLength(1)
    })

    it('haveNameEndingWith works', () => {
      const elements = createElements(`const x = <div><MyButton>a</MyButton></div>`)
      const pred = haveNameEndingWith<ArchJsxElement>('Button')
      expect(elements.filter((e) => pred.test(e))).toHaveLength(1)
    })

    it('resideInFile works with glob', () => {
      const elements = createElements(`const x = <div>hi</div>`, 'src/components/App.tsx')
      const pred = resideInFile<ArchJsxElement>('**/components/**')
      expect(pred.test(elements[0]!)).toBe(true)
    })

    it('resideInFolder works with glob', () => {
      const elements = createElements(`const x = <div>hi</div>`, 'src/pages/Home.tsx')
      const pred = resideInFolder<ArchJsxElement>('**/pages')
      expect(pred.test(elements[0]!)).toBe(true)
    })
  })
})
