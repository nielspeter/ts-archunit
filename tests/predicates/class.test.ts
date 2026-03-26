import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import {
  extend,
  implement,
  haveDecorator,
  haveDecoratorMatching,
  areAbstract,
  haveMethodNamed,
  haveMethodMatching,
  havePropertyNamed,
} from '../../src/predicates/class.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')
const project = new Project({ tsConfigFilePath: tsconfigPath })

function getClass(name: string) {
  for (const sf of project.getSourceFiles()) {
    const cls = sf.getClass(name)
    if (cls) return cls
  }
  throw new Error(`Class ${name} not found in fixtures`)
}

describe('class predicates', () => {
  describe('extend()', () => {
    it('matches a class extending the named base', () => {
      const pred = extend('BaseService')
      expect(pred.test(getClass('OrderService'))).toBe(true)
      expect(pred.test(getClass('ProductService'))).toBe(true)
      expect(pred.test(getClass('EdgeCaseService'))).toBe(true)
    })

    it('does not match a class that does not extend the named base', () => {
      const pred = extend('BaseService')
      expect(pred.test(getClass('BaseService'))).toBe(false)
      expect(pred.test(getClass('DomainError'))).toBe(false)
    })

    it('does not match when extends clause has a different class', () => {
      const pred = extend('SomeOtherClass')
      expect(pred.test(getClass('OrderService'))).toBe(false)
    })

    it('has a meaningful description', () => {
      expect(extend('BaseService').description).toBe('extend "BaseService"')
    })
  })

  describe('areAbstract()', () => {
    it('matches abstract classes', () => {
      const pred = areAbstract()
      expect(pred.test(getClass('BaseService'))).toBe(true)
    })

    it('does not match non-abstract classes', () => {
      const pred = areAbstract()
      expect(pred.test(getClass('OrderService'))).toBe(false)
    })
  })

  describe('haveMethodNamed()', () => {
    it('matches a class with the named method', () => {
      const pred = haveMethodNamed('getTotal')
      expect(pred.test(getClass('OrderService'))).toBe(true)
    })

    it('does not match a class without the named method', () => {
      const pred = haveMethodNamed('nonExistentMethod')
      expect(pred.test(getClass('OrderService'))).toBe(false)
    })
  })

  describe('haveMethodMatching()', () => {
    it('matches a class with a method whose name matches the regex', () => {
      const pred = haveMethodMatching(/^get/)
      expect(pred.test(getClass('OrderService'))).toBe(true)
    })

    it('does not match when no method names match', () => {
      const pred = haveMethodMatching(/^zzz/)
      expect(pred.test(getClass('OrderService'))).toBe(false)
    })
  })

  describe('havePropertyNamed()', () => {
    it('matches a class with the named property', () => {
      const pred = havePropertyNamed('db')
      expect(pred.test(getClass('BaseService'))).toBe(true)
    })

    it('does not match a class without the named property', () => {
      const pred = havePropertyNamed('nonExistent')
      expect(pred.test(getClass('BaseService'))).toBe(false)
    })
  })
})

describe('class predicates (decorator fixture)', () => {
  describe('implement()', () => {
    it('matches a class implementing the named interface', () => {
      const pred = implement('Serializable')
      expect(pred.test(getClass('UserController'))).toBe(true)
      expect(pred.test(getClass('UserRepository'))).toBe(true)
    })

    it('does not match a class not implementing the interface', () => {
      const pred = implement('Serializable')
      expect(pred.test(getClass('PlainClass'))).toBe(false)
    })

    it('matches specific interface when class implements multiple', () => {
      const pred = implement('Loggable')
      expect(pred.test(getClass('UserRepository'))).toBe(true)
      expect(pred.test(getClass('UserController'))).toBe(false)
    })
  })

  describe('haveDecorator()', () => {
    it('matches a class with the named decorator', () => {
      const pred = haveDecorator('Controller')
      expect(pred.test(getClass('UserController'))).toBe(true)
    })

    it('does not match a class without the decorator', () => {
      const pred = haveDecorator('Controller')
      expect(pred.test(getClass('PlainClass'))).toBe(false)
    })
  })

  describe('haveDecoratorMatching()', () => {
    it('matches a class with a decorator matching the regex', () => {
      const pred = haveDecoratorMatching(/able$/)
      expect(pred.test(getClass('UserRepository'))).toBe(true) // @Injectable
    })

    it('does not match when no decorator matches', () => {
      const pred = haveDecoratorMatching(/^NonExistent/)
      expect(pred.test(getClass('UserController'))).toBe(false)
    })
  })
})
