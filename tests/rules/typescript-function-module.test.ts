import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import {
  functionNoTypeAssertions,
  functionNoNonNullAssertions,
  moduleNoTypeAssertions,
  moduleNoNonNullAssertions,
} from '../../src/rules/typescript.js'
import { collectFunctions } from '../../src/models/arch-function.js'

const context = { rule: 'test rule' }

function makeProject(code: string) {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { strict: true },
  })
  return project.createSourceFile('test.ts', code)
}

describe('functionNoTypeAssertions()', () => {
  it('catches `as Type` in a standalone function', () => {
    const sf = makeProject(`
      interface User { name: string }
      export function loadUser(data: unknown): User {
        return data as User
      }
    `)
    const fns = collectFunctions(sf)
    const violations = functionNoTypeAssertions().evaluate(fns, context)
    expect(violations).toHaveLength(1)
  })

  it('passes when function uses type guards instead', () => {
    const sf = makeProject(`
      interface User { name: string }
      function isUser(x: unknown): x is User {
        return typeof x === 'object' && x !== null && 'name' in x
      }
      export function loadUser(data: unknown): User {
        if (!isUser(data)) throw new Error('invalid')
        return data
      }
    `)
    const fns = collectFunctions(sf)
    const violations = functionNoTypeAssertions().evaluate(fns, context)
    expect(violations).toHaveLength(0)
  })

  it('allows `as const`', () => {
    const sf = makeProject(`
      export function roles() {
        return ['admin', 'user'] as const
      }
    `)
    const fns = collectFunctions(sf)
    const violations = functionNoTypeAssertions().evaluate(fns, context)
    expect(violations).toHaveLength(0)
  })

  it('catches angle-bracket `<Type>value` assertions in function bodies', () => {
    const sf = makeProject(`
      interface User { name: string }
      export function loadUser(data: unknown): User {
        return <User>data
      }
    `)
    const fns = collectFunctions(sf)
    const violations = functionNoTypeAssertions().evaluate(fns, context)
    expect(violations).toHaveLength(1)
  })

  it('catches `as Type` in arrow function block bodies', () => {
    const sf = makeProject(`
      interface User { name: string }
      export const loadUser = (data: unknown): User => {
        const user = data as User
        return user
      }
    `)
    const fns = collectFunctions(sf)
    const violations = functionNoTypeAssertions().evaluate(fns, context)
    expect(violations).toHaveLength(1)
  })

  it('reports each cast in `as unknown as T` double-cast as a separate violation', () => {
    const sf = makeProject(`
      interface User { name: string }
      export function loadUser(data: object): User {
        return data as unknown as User
      }
    `)
    const fns = collectFunctions(sf)
    const violations = functionNoTypeAssertions().evaluate(fns, context)
    expect(violations).toHaveLength(2)
  })
})

describe('functionNoNonNullAssertions()', () => {
  it('catches `user!` in an arrow function', () => {
    const sf = makeProject(`
      type User = { name: string } | undefined
      export const getName = (user: User) => user!.name
    `)
    const fns = collectFunctions(sf)
    const violations = functionNoNonNullAssertions().evaluate(fns, context)
    expect(violations).toHaveLength(1)
  })

  it('passes when function handles null explicitly', () => {
    const sf = makeProject(`
      type User = { name: string } | undefined
      export function getName(user: User): string {
        if (!user) throw new Error('user required')
        return user.name
      }
    `)
    const fns = collectFunctions(sf)
    const violations = functionNoNonNullAssertions().evaluate(fns, context)
    expect(violations).toHaveLength(0)
  })
})

describe('moduleNoTypeAssertions()', () => {
  it('catches `as Type` at module top-level', () => {
    const sf = makeProject(`
      interface Config { port: number }
      const raw: unknown = {}
      export const config = raw as Config
    `)
    const violations = moduleNoTypeAssertions().evaluate([sf], context)
    expect(violations).toHaveLength(1)
  })

  it('catches `as Type` inside a class method (broader scope)', () => {
    const sf = makeProject(`
      interface User { name: string }
      export class UserService {
        load(data: unknown): User {
          return data as User
        }
      }
    `)
    const violations = moduleNoTypeAssertions().evaluate([sf], context)
    expect(violations).toHaveLength(1)
  })

  it('catches `as Type` inside a class constructor (full-file traversal)', () => {
    const sf = makeProject(`
      interface Config { port: number }
      export class Server {
        private config: Config
        constructor(raw: unknown) {
          this.config = raw as Config
        }
      }
    `)
    const violations = moduleNoTypeAssertions().evaluate([sf], context)
    expect(violations).toHaveLength(1)
  })

  it('catches angle-bracket `<Type>value` assertions', () => {
    const sf = makeProject(`
      interface User { name: string }
      const data: unknown = {}
      export const user = <User>data
    `)
    const violations = moduleNoTypeAssertions().evaluate([sf], context)
    expect(violations).toHaveLength(1)
  })

  it('passes when file only has `as const`', () => {
    const sf = makeProject(`
      export const ROLES = ['admin', 'user'] as const
      export function names() {
        return ['a', 'b'] as const
      }
    `)
    const violations = moduleNoTypeAssertions().evaluate([sf], context)
    expect(violations).toHaveLength(0)
  })
})

describe('moduleNoNonNullAssertions()', () => {
  it('catches `!` anywhere in the file', () => {
    const sf = makeProject(`
      type User = { name: string } | undefined
      const user: User = undefined
      export const name = user!.name
    `)
    const violations = moduleNoNonNullAssertions().evaluate([sf], context)
    expect(violations).toHaveLength(1)
  })

  it('passes when file has no `!` assertions', () => {
    const sf = makeProject(`
      type User = { name: string }
      export function getName(u: User): string {
        return u.name
      }
    `)
    const violations = moduleNoNonNullAssertions().evaluate([sf], context)
    expect(violations).toHaveLength(0)
  })
})
