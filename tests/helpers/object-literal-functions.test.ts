import { describe, it, expect } from 'vitest'
import { Project, SyntaxKind, type Node } from 'ts-morph'
import { collectObjectLiteralFunctions } from '../../src/helpers/object-literal-functions.js'

function firstObjectLiteral(code: string): Node {
  const project = new Project({ useInMemoryFileSystem: true })
  const sf = project.createSourceFile('t.ts', code)
  return sf.getFirstDescendantByKindOrThrow(SyntaxKind.ObjectLiteralExpression)
}

describe('collectObjectLiteralFunctions (F3 — shared object-literal traversal)', () => {
  it('collects arrows, function expressions, and method shorthand; ignores non-functions', () => {
    const ol = firstObjectLiteral(
      'const x = { GET: () => {}, POST: function () {}, PUT() {}, notFn: 1, s: "x" }',
    )
    const found = collectObjectLiteralFunctions(ol)
    expect(found.map((f) => f.keyPath.join('.'))).toEqual(['GET', 'POST', 'PUT'])
    expect(found.map((f) => f.node.getKindName())).toEqual([
      'ArrowFunction',
      'FunctionExpression',
      'MethodDeclaration',
    ])
  })

  it('records the full key path through nested object literals', () => {
    const ol = firstObjectLiteral('const app = { routes: { "/a": { GET: () => {} } } }')
    const found = collectObjectLiteralFunctions(ol)
    expect(found).toHaveLength(1)
    expect(found[0]!.keyPath).toEqual(['routes', '/a', 'GET'])
  })

  it('stops at the depth limit (default 3)', () => {
    // GET sits inside the 4th object level — beyond the default depth.
    const ol = firstObjectLiteral('const x = { a: { b: { c: { GET: () => {} } } } }')
    expect(collectObjectLiteralFunctions(ol)).toHaveLength(0)
    // ...but a shallower nesting is collected.
    const ol2 = firstObjectLiteral('const x = { a: { GET: () => {} } }')
    expect(collectObjectLiteralFunctions(ol2).map((f) => f.keyPath)).toEqual([['a', 'GET']])
  })

  it('degrades a computed key to <computed>', () => {
    const ol = firstObjectLiteral('const k = "x"; const o = { [k]: () => {} }')
    // firstObjectLiteral returns the first object literal — which is `{ [k]: ... }`.
    const found = collectObjectLiteralFunctions(ol)
    expect(found.map((f) => f.keyPath)).toEqual([['<computed>']])
  })

  it('does not descend into function bodies (only nested object-literal values)', () => {
    const ol = firstObjectLiteral('const o = { GET: () => { const cfg = { onError: () => {} } } }')
    // Only GET is a property value; onError lives in a local object inside a body.
    expect(collectObjectLiteralFunctions(ol).map((f) => f.keyPath)).toEqual([['GET']])
  })

  it('returns [] for a non-object-literal node', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    const sf = project.createSourceFile('t.ts', 'const x = 1')
    expect(collectObjectLiteralFunctions(sf)).toEqual([])
  })
})
