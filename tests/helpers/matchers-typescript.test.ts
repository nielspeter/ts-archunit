import { describe, it, expect } from 'vitest'
import { Project, SyntaxKind } from 'ts-morph'
import { typeAssertion, nonNullAssertion } from '../../src/helpers/matchers.js'

function createTsProject(code: string) {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { strict: true },
  })
  return project.createSourceFile('test.ts', code)
}

describe('typeAssertion() matcher', () => {
  it('matches `data as User` expressions', () => {
    const sf = createTsProject(`
      interface User { name: string }
      const data: unknown = {}
      const user = data as User
    `)
    const matcher = typeAssertion()
    const asExprs = sf.getDescendantsOfKind(SyntaxKind.AsExpression)
    expect(asExprs).toHaveLength(1)
    expect(matcher.matches(asExprs[0]!)).toBe(true)
  })

  it('does NOT match `as const` by default', () => {
    const sf = createTsProject(`const ROLES = ['admin', 'user'] as const`)
    const matcher = typeAssertion()
    const asExprs = sf.getDescendantsOfKind(SyntaxKind.AsExpression)
    expect(asExprs).toHaveLength(1)
    expect(matcher.matches(asExprs[0]!)).toBe(false)
  })

  it('matches `as const` when allowConst is false', () => {
    const sf = createTsProject(`const ROLES = ['admin', 'user'] as const`)
    const matcher = typeAssertion({ allowConst: false })
    const asExprs = sf.getDescendantsOfKind(SyntaxKind.AsExpression)
    expect(matcher.matches(asExprs[0]!)).toBe(true)
  })

  it('matches `as Type` even when allowConst is false', () => {
    const sf = createTsProject(`
      interface User { name: string }
      const data: unknown = {}
      const user = data as User
    `)
    const matcher = typeAssertion({ allowConst: false })
    const asExprs = sf.getDescendantsOfKind(SyntaxKind.AsExpression)
    expect(matcher.matches(asExprs[0]!)).toBe(true)
  })

  it('does NOT match CallExpression, NewExpression, etc.', () => {
    const sf = createTsProject(`
      const x = fn()
      const y = new Error('msg')
      const z = obj.prop
    `)
    const matcher = typeAssertion()
    const callNode = sf.getDescendantsOfKind(SyntaxKind.CallExpression)[0]!
    const newNode = sf.getDescendantsOfKind(SyntaxKind.NewExpression)[0]!
    const accessNode = sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)[0]!
    expect(matcher.matches(callNode)).toBe(false)
    expect(matcher.matches(newNode)).toBe(false)
    expect(matcher.matches(accessNode)).toBe(false)
  })

  it('matches BOTH casts in `as unknown as T` double-cast', () => {
    const sf = createTsProject(`
      interface User { name: string }
      const data: object = {}
      const user = data as unknown as User
    `)
    const matcher = typeAssertion()
    const asExprs = sf.getDescendantsOfKind(SyntaxKind.AsExpression)
    expect(asExprs).toHaveLength(2)
    expect(matcher.matches(asExprs[0]!)).toBe(true)
    expect(matcher.matches(asExprs[1]!)).toBe(true)
  })

  it('matches angle-bracket `<Type>value` assertions (allowConst has no effect)', () => {
    // `<const>x` is invalid TS syntax; angle-bracket can't express `as const`,
    // so allowConst has no effect on angle-bracket matches
    const sf = createTsProject(`
      interface User { name: string }
      const data: unknown = {}
      const user = <User>data
    `)
    const angleExprs = sf.getDescendantsOfKind(SyntaxKind.TypeAssertionExpression)
    expect(angleExprs).toHaveLength(1)
    expect(typeAssertion().matches(angleExprs[0]!)).toBe(true)
    expect(typeAssertion({ allowConst: true }).matches(angleExprs[0]!)).toBe(true)
    expect(typeAssertion({ allowConst: false }).matches(angleExprs[0]!)).toBe(true)
  })

  it('matches `as` portion of mixed `satisfies`/`as` expression', () => {
    const sf = createTsProject(`
      type Config = { readonly port: number }
      const raw = { port: 8080 }
      const config = raw satisfies Config as Readonly<Config>
    `)
    const matcher = typeAssertion()
    const asExprs = sf.getDescendantsOfKind(SyntaxKind.AsExpression)
    expect(asExprs).toHaveLength(1)
    expect(matcher.matches(asExprs[0]!)).toBe(true)
  })

  it('description is "type assertion"', () => {
    const matcher = typeAssertion()
    expect(matcher.description).toBe('type assertion')
  })

  it('has syntaxKinds: [AsExpression, TypeAssertionExpression]', () => {
    const matcher = typeAssertion()
    expect(matcher.syntaxKinds).toEqual([
      SyntaxKind.AsExpression,
      SyntaxKind.TypeAssertionExpression,
    ])
  })
})

describe('nonNullAssertion() matcher', () => {
  it('matches `user!` expressions', () => {
    const sf = createTsProject(`
      const user: { name: string } | undefined = undefined as unknown as { name: string }
      const name = user!.name
    `)
    const matcher = nonNullAssertion()
    const nonNullExprs = sf.getDescendantsOfKind(SyntaxKind.NonNullExpression)
    expect(nonNullExprs).toHaveLength(1)
    expect(matcher.matches(nonNullExprs[0]!)).toBe(true)
  })

  it('matches `arr[0]!` element access non-null assertions', () => {
    const sf = createTsProject(`
      const arr: string[] = []
      const first = arr[0]!
    `)
    const matcher = nonNullAssertion()
    const nonNullExprs = sf.getDescendantsOfKind(SyntaxKind.NonNullExpression)
    expect(nonNullExprs).toHaveLength(1)
    expect(matcher.matches(nonNullExprs[0]!)).toBe(true)
  })

  it('does NOT match logical `!x` (PrefixUnaryExpression)', () => {
    const sf = createTsProject(`
      const x = true
      const y = !x
    `)
    const matcher = nonNullAssertion()
    // !x is a PrefixUnaryExpression, not NonNullExpression
    const prefixUnary = sf.getDescendantsOfKind(SyntaxKind.PrefixUnaryExpression)[0]!
    expect(matcher.matches(prefixUnary)).toBe(false)
  })

  it('does NOT match CallExpression or other unrelated nodes', () => {
    const sf = createTsProject(`
      const x = fn()
      const y = new Error('msg')
    `)
    const matcher = nonNullAssertion()
    const callNode = sf.getDescendantsOfKind(SyntaxKind.CallExpression)[0]!
    const newNode = sf.getDescendantsOfKind(SyntaxKind.NewExpression)[0]!
    expect(matcher.matches(callNode)).toBe(false)
    expect(matcher.matches(newNode)).toBe(false)
  })

  it('does NOT match `as` expressions', () => {
    const sf = createTsProject(`
      interface User { name: string }
      const data: unknown = {}
      const user = data as User
    `)
    const matcher = nonNullAssertion()
    const asExprs = sf.getDescendantsOfKind(SyntaxKind.AsExpression)
    expect(matcher.matches(asExprs[0]!)).toBe(false)
  })

  it('description is "non-null assertion"', () => {
    const matcher = nonNullAssertion()
    expect(matcher.description).toBe('non-null assertion')
  })

  it('has syntaxKinds: [NonNullExpression]', () => {
    const matcher = nonNullAssertion()
    expect(matcher.syntaxKinds).toEqual([SyntaxKind.NonNullExpression])
  })
})
