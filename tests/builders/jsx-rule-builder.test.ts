import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { jsxElements } from '../../src/builders/jsx-rule-builder.js'
import { not } from '../../src/core/combinators.js'
import { areComponents } from '../../src/predicates/jsx.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'

function createProject(files: Record<string, string>): ArchProject {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { jsx: 2, strict: true },
  })
  for (const [name, code] of Object.entries(files)) {
    project.createSourceFile(name, code)
  }
  return {
    tsConfigPath: '/virtual/tsconfig.json',
    getSourceFiles: () => project.getSourceFiles(),
    _project: project,
  }
}

describe('JsxRuleBuilder', () => {
  describe('areHtmlElements + notExist (pass)', () => {
    it('passes when no banned HTML elements exist', () => {
      const p = createProject({
        'app.tsx': `const x = <Button>click</Button>`,
      })
      expect(() =>
        jsxElements(p).that().areHtmlElements('button').should().notExist().check(),
      ).not.toThrow()
    })
  })

  describe('areHtmlElements + notExist (fail)', () => {
    it('throws ArchRuleError when banned HTML elements exist', () => {
      const p = createProject({
        'app.tsx': `const x = <button>click</button>`,
      })
      expect(() =>
        jsxElements(p).that().areHtmlElements('button').should().notExist().check(),
      ).toThrow(ArchRuleError)
    })
  })

  describe('areComponents + haveAttribute (pass)', () => {
    it('passes when all components have the required attribute', () => {
      const p = createProject({
        'app.tsx': `
          const x = <div>
            <Button data-testid="btn">click</Button>
            <Input data-testid="inp" />
          </div>
        `,
      })
      expect(() =>
        jsxElements(p).that().areComponents().should().haveAttribute('data-testid').check(),
      ).not.toThrow()
    })
  })

  describe('areComponents + haveAttribute (fail)', () => {
    it('throws ArchRuleError when a component is missing the required attribute', () => {
      const p = createProject({
        'app.tsx': `
          const x = <div>
            <Button data-testid="btn">click</Button>
            <Input />
          </div>
        `,
      })
      expect(() =>
        jsxElements(p).that().areComponents().should().haveAttribute('data-testid').check(),
      ).toThrow(ArchRuleError)
    })
  })

  describe('.excluding()', () => {
    it('excludes elements by tag name in violation', () => {
      const p = createProject({
        'app.tsx': `const x = <div><button>a</button><input /></div>`,
      })
      // Excluding <button> still throws because <input> violates
      expect(() =>
        jsxElements(p)
          .that()
          .areHtmlElements('button', 'input')
          .should()
          .notExist()
          .excluding('<button>')
          .check(),
      ).toThrow(ArchRuleError)
    })

    it('passes when all violations are excluded', () => {
      const p = createProject({
        'app.tsx': `const x = <div><button>a</button><input /></div>`,
      })
      expect(() =>
        jsxElements(p)
          .that()
          .areHtmlElements('button', 'input')
          .should()
          .notExist()
          .excluding('<button>', '<input>')
          .check(),
      ).not.toThrow()
    })
  })

  describe('.because()', () => {
    it('includes reason in error message', () => {
      const p = createProject({
        'app.tsx': `const x = <button>click</button>`,
      })
      expect(() =>
        jsxElements(p)
          .that()
          .areHtmlElements('button')
          .should()
          .notExist()
          .because('use design system components')
          .check(),
      ).toThrowError(/use design system components/)
    })
  })

  describe('.warn()', () => {
    it('does not throw on violations', () => {
      const p = createProject({
        'app.tsx': `const x = <button>click</button>`,
      })
      expect(() =>
        jsxElements(p).that().areHtmlElements('button').should().notExist().warn(),
      ).not.toThrow()
    })
  })

  describe('.and() combinator', () => {
    it('combines predicates with and', () => {
      const p = createProject({
        'components/App.tsx': `
          const x = <div>
            <button onClick={() => {}}>click</button>
            <span>text</span>
          </div>
        `,
      })
      // button has onClick, span does not
      expect(() =>
        jsxElements(p)
          .that()
          .areHtmlElements('button')
          .and()
          .withAttribute('onClick')
          .should()
          .notExist()
          .check(),
      ).toThrow(ArchRuleError)
    })
  })

  describe('withAttribute predicate + haveAttribute condition', () => {
    it('filters then asserts on different attributes', () => {
      const p = createProject({
        'app.tsx': `
          const x = <div>
            <button onClick={() => {}} aria-label="save">Save</button>
            <button onClick={() => {}}>Delete</button>
          </div>
        `,
      })
      // Filter to elements with onClick, assert they have aria-label
      expect(() =>
        jsxElements(p).that().withAttribute('onClick').should().haveAttribute('aria-label').check(),
      ).toThrow(ArchRuleError) // Delete button lacks aria-label
    })
  })

  describe('withAttributeMatching predicate through builder', () => {
    it('filters by attribute value then asserts', () => {
      const p = createProject({
        'app.tsx': `
          const x = <div>
            <input type="submit" data-testid="sub" />
            <input type="text" />
          </div>
        `,
      })
      // Filter to submit inputs, assert they have data-testid
      expect(() =>
        jsxElements(p)
          .that()
          .withAttributeMatching('type', 'submit')
          .should()
          .haveAttribute('data-testid')
          .check(),
      ).not.toThrow()
    })
  })

  describe('notHaveAttribute condition through builder', () => {
    it('throws when elements have the forbidden attribute', () => {
      const p = createProject({
        'app.tsx': `const x = <div style={{color: 'red'}}>styled</div>`,
      })
      expect(() => jsxElements(p).should().notHaveAttribute('style').check()).toThrow(ArchRuleError)
    })

    it('passes when no elements have the forbidden attribute', () => {
      const p = createProject({
        'app.tsx': `const x = <div className="box">clean</div>`,
      })
      expect(() => jsxElements(p).should().notHaveAttribute('style').check()).not.toThrow()
    })
  })

  describe('haveAttributeMatching condition through builder', () => {
    it('throws when attribute value does not match', () => {
      const p = createProject({
        'app.tsx': `const x = <input type="submit" />`,
      })
      expect(() =>
        jsxElements(p)
          .that()
          .areHtmlElements('input')
          .should()
          .haveAttributeMatching('type', 'text')
          .check(),
      ).toThrow(ArchRuleError)
    })
  })

  describe('notHaveAttributeMatching condition through builder', () => {
    it('throws when attribute value matches forbidden pattern', () => {
      const p = createProject({
        'app.tsx': `const x = <div className="hidden-panel">secret</div>`,
      })
      expect(() =>
        jsxElements(p)
          .should()
          .notHaveAttributeMatching('className', /hidden/)
          .check(),
      ).toThrow(ArchRuleError)
    })
  })

  describe('resideInFile scoping', () => {
    it('limits rules to matching files', () => {
      const p = createProject({
        'src/components/App.tsx': `const x = <button>click</button>`,
        'src/pages/Home.tsx': `const x = <button>click</button>`,
      })
      // Only ban in pages, not components
      expect(() =>
        jsxElements(p)
          .that()
          .areHtmlElements('button')
          .and()
          .resideInFile('**/pages/**')
          .should()
          .notExist()
          .check(),
      ).toThrow(ArchRuleError)
    })
  })

  describe('resideInFolder scoping', () => {
    it('limits rules to matching folders', () => {
      const p = createProject({
        'src/components/App.tsx': `const x = <button>click</button>`,
        'src/lib/utils.tsx': `const x = <span>text</span>`,
      })
      expect(() =>
        jsxElements(p)
          .that()
          .areHtmlElements('button')
          .and()
          .resideInFolder('**/components')
          .should()
          .notExist()
          .check(),
      ).toThrow(ArchRuleError)
    })
  })

  describe('not() combinator', () => {
    it('negates a predicate', () => {
      const p = createProject({
        'app.tsx': `
          const x = <div>
            <Button>click</Button>
            <span>text</span>
          </div>
        `,
      })
      // All non-component elements should not exist
      expect(() =>
        jsxElements(p).that().satisfy(not(areComponents())).should().notExist().check(),
      ).toThrow(ArchRuleError) // div and span are not components
    })
  })

  describe('empty project (zero .tsx files)', () => {
    it('passes any rule', () => {
      const p = createProject({
        'app.ts': `const x = 1`,
      })
      expect(() =>
        jsxElements(p).that().areHtmlElements('button').should().notExist().check(),
      ).not.toThrow()
    })
  })

  describe('nested JSX in ternary/arrow returns', () => {
    it('collects elements inside ternary expressions', () => {
      const p = createProject({
        'app.tsx': `
          const x = true ? <button>yes</button> : <span>no</span>
        `,
      })
      expect(() =>
        jsxElements(p).that().areHtmlElements('button').should().notExist().check(),
      ).toThrow(ArchRuleError)
    })

    it('collects elements in arrow function returns', () => {
      const p = createProject({
        'app.tsx': `
          const App = () => <button>click</button>
        `,
      })
      expect(() =>
        jsxElements(p).that().areHtmlElements('button').should().notExist().check(),
      ).toThrow(ArchRuleError)
    })
  })
})
