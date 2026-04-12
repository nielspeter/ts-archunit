import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { collectJsxElements } from '../../src/models/arch-jsx-element.js'
import {
  notExist,
  haveAttribute,
  notHaveAttribute,
  haveAttributeMatching,
  notHaveAttributeMatching,
} from '../../src/conditions/jsx.js'
import type { ConditionContext } from '../../src/core/condition.js'

function createElements(code: string) {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { jsx: 2, strict: true },
  })
  const sf = project.createSourceFile('test.tsx', code)
  return collectJsxElements(sf)
}

const context: ConditionContext = {
  rule: 'test rule',
  because: 'test reason',
}

describe('JSX conditions', () => {
  describe('notExist', () => {
    it('returns no violations when set is empty', () => {
      const condition = notExist()
      expect(condition.evaluate([], context)).toHaveLength(0)
    })

    it('returns violations for each element in the set', () => {
      const elements = createElements(`
        const x = <div><span>text</span></div>
      `)
      const condition = notExist()
      const violations = condition.evaluate(elements, context)
      expect(violations.length).toBeGreaterThan(0)
      expect(violations[0]!.element).toBe('<div>')
    })
  })

  describe('haveAttribute', () => {
    it('returns no violations when all elements have the attribute', () => {
      const elements = createElements(`
        const x = <div>
          <img src="a.png" alt="A" />
          <img src="b.png" alt="B" />
        </div>
      `)
      const imgElements = elements.filter((e) => e.getName() === 'img')
      const condition = haveAttribute('alt')
      expect(condition.evaluate(imgElements, context)).toHaveLength(0)
    })

    it('returns violations when elements are missing the attribute', () => {
      const elements = createElements(`
        const x = <div>
          <img src="a.png" alt="A" />
          <img src="b.png" />
        </div>
      `)
      const imgElements = elements.filter((e) => e.getName() === 'img')
      const condition = haveAttribute('alt')
      const violations = condition.evaluate(imgElements, context)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.message).toContain('missing required attribute "alt"')
    })

    it('violation includes code frame', () => {
      const elements = createElements(`const x = <img src="a.png" />`)
      const condition = haveAttribute('alt')
      const violations = condition.evaluate(elements, context)
      expect(violations[0]!.codeFrame).toBeDefined()
    })
  })

  describe('notHaveAttribute', () => {
    it('returns no violations when no elements have the attribute', () => {
      const elements = createElements(`
        const x = <div><span>text</span></div>
      `)
      const condition = notHaveAttribute('style')
      expect(condition.evaluate(elements, context)).toHaveLength(0)
    })

    it('returns violations when elements have the forbidden attribute', () => {
      const elements = createElements(`
        const x = <div style={{color: 'red'}}>styled</div>
      `)
      const condition = notHaveAttribute('style')
      const violations = condition.evaluate(elements, context)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.message).toContain('should not have attribute "style"')
    })
  })

  describe('haveAttributeMatching', () => {
    it('passes when attribute matches string value', () => {
      const elements = createElements(`const x = <input type="text" />`)
      const condition = haveAttributeMatching('type', 'text')
      expect(condition.evaluate(elements, context)).toHaveLength(0)
    })

    it('fails when attribute value does not match', () => {
      const elements = createElements(`const x = <input type="submit" />`)
      const condition = haveAttributeMatching('type', 'text')
      const violations = condition.evaluate(elements, context)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.message).toContain('does not match')
    })

    it('fails when attribute is absent', () => {
      const elements = createElements(`const x = <input />`)
      const condition = haveAttributeMatching('type', 'text')
      const violations = condition.evaluate(elements, context)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.message).toContain('missing attribute')
    })

    it('matches with regex', () => {
      const elements = createElements(`const x = <div className="error-box" />`)
      const condition = haveAttributeMatching('className', /error/)
      expect(condition.evaluate(elements, context)).toHaveLength(0)
    })

    it('fails with valueless message when attribute is present but valueless', () => {
      const elements = createElements(`const x = <input disabled />`)
      const condition = haveAttributeMatching('disabled', 'true')
      const violations = condition.evaluate(elements, context)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.message).toContain('valueless')
    })
  })

  describe('notHaveAttributeMatching', () => {
    it('passes when attribute is absent', () => {
      const elements = createElements(`const x = <div />`)
      const condition = notHaveAttributeMatching('className', /hidden/)
      expect(condition.evaluate(elements, context)).toHaveLength(0)
    })

    it('passes when attribute value does not match', () => {
      const elements = createElements(`const x = <div className="visible" />`)
      const condition = notHaveAttributeMatching('className', /hidden/)
      expect(condition.evaluate(elements, context)).toHaveLength(0)
    })

    it('fails when attribute value matches', () => {
      const elements = createElements(`const x = <div className="hidden-panel" />`)
      const condition = notHaveAttributeMatching('className', /hidden/)
      const violations = condition.evaluate(elements, context)
      expect(violations).toHaveLength(1)
    })
  })

  describe('spread attribute safety', () => {
    it('haveAttribute works correctly with mixed named and spread attrs', () => {
      const elements = createElements(`
        const x = <Button {...props} disabled />
      `)
      const condition = haveAttribute('disabled')
      expect(condition.evaluate(elements, context)).toHaveLength(0)
    })
  })
})
