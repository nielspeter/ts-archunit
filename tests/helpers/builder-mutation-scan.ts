/**
 * Source-level detectors for the two ways a builder can leak state across a
 * copy (bug 0016).
 *
 * These live in their own module rather than beside the guards that use them
 * because a detector applied to `src/` reports `[]` both when the code is
 * clean and when the detector is broken. Those two states are indistinguishable
 * from the guard's own output, and the second one had actually happened:
 *
 *   - `mutatedInPlace` required the mutation to be spelled `this._x.push(...)`.
 *     The fix rewrote all 15 of those to `next._x.push(...)`, so it matched
 *     **0 of 32** candidate fields. Setting its mutator list to `[]` did not
 *     fail a single test.
 *   - `mutatesThenReturnsThis` required the last statement to be `return this`,
 *     so it missed `const next = this; next._x.push(y); return next` — which is
 *     a complete revert of one of the 40 fixed methods, and produced 0 failures
 *     across 2340 tests.
 *
 * Split out, they can be pointed at a fixture whose expected verdict is known
 * independently of `src/` — a differently-derived value that can disagree
 * (ADR-008 rule 5). `builder-mutation-scan.test.ts` is that fixture.
 */
import { Node, SyntaxKind } from 'ts-morph'
import type { ClassDeclaration, Expression, MethodDeclaration } from 'ts-morph'

const MUTATORS = ['push', 'add', 'set', 'unshift', 'splice', 'delete', 'clear', 'sort']

/**
 * True if any method in the class calls a mutator on `<anything>.<field>`.
 *
 * The receiver is deliberately not constrained. The property being tested is
 * "this field's container is mutated in place somewhere", from which it follows
 * that every instance must own its own container — and that is equally true
 * whether the mutation is written on `this`, on a clone, or on a local alias.
 * Constraining it to `this` is what made this detector inert.
 */
export function mutatedInPlace(cls: ClassDeclaration, field: string): boolean {
  return cls.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
    const callee = call.getExpression()
    if (!Node.isPropertyAccessExpression(callee)) return false
    if (!MUTATORS.includes(callee.getName())) return false
    const target = callee.getExpression()
    return Node.isPropertyAccessExpression(target) && target.getName() === field
  })
}

/**
 * True if the class text contains an assignment that builds one instance's
 * container from another's — `x._field = [...y._field]`, `new Set(y._field)`,
 * `{ ...y._field }`.
 *
 * Text-based on purpose. The two correct spellings differ only in which side is
 * `this` (`clone._x = [...this._x]` inside a `copy()` override, and
 * `this._x = [...source._x]` inside `TerminalBuilder.adoptFilterState`), and
 * requiring one of them would hard-code an exception for the other.
 */
export function copiesContainer(classText: string, field: string): boolean {
  const assignment = new RegExp(`\\.${field}\\s*=\\s*([^\\n;]*)`, 'g')
  for (const match of classText.matchAll(assignment)) {
    const rhs = match[1] ?? ''
    if (rhs.includes(`.${field}`) && /\[\.\.\.|new Set\(|new Map\(|\{ \.\.\./.test(rhs)) {
      return true
    }
  }
  return false
}

/**
 * The offending mutation in a method that ends by handing back the receiver,
 * or `undefined` if there is none.
 *
 * "Hands back the receiver" resolves one alias hop: `return this`, and
 * `return next` where `next` was initialized from a bare `this`. Without that
 * hop, reverting a fixed method by changing `const next = this.copy()` to
 * `const next = this` restores the bug and passes every test — measured.
 *
 * An initializer of `this.copy()` / `super.copy()` / `shallowClone(this)` is a
 * genuine copy and is not a hop.
 */
export function mutatesThenReturnsThis(method: MethodDeclaration): string | undefined {
  const body = method.getBody()
  if (!body || !Node.isBlock(body)) return undefined

  const statements = body.getStatements()
  const last = statements[statements.length - 1]
  if (!last || !Node.isReturnStatement(last)) return undefined

  const returned = last.getExpression()
  if (!returned) return undefined
  const receiver = receiverName(returned, method)
  if (receiver === undefined) return undefined

  for (const statement of statements.slice(0, -1)) {
    for (const expr of statement.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      const left = expr.getLeft()
      if (!ownStateAccess(left, receiver)) continue
      const op = expr.getOperatorToken().getKind()
      if (op === SyntaxKind.EqualsToken || op === SyntaxKind.PlusEqualsToken) {
        return `assigns ${left.getText()}`
      }
    }
    for (const call of statement.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression()
      if (!Node.isPropertyAccessExpression(callee)) continue
      if (!MUTATORS.includes(callee.getName())) continue
      if (!ownStateAccess(callee.getExpression(), receiver)) continue
      return `calls ${callee.getText()}()`
    }
  }
  return undefined
}

/**
 * The name the returned expression refers to when it is the receiver itself:
 * `'this'` for `return this`, or the identifier for `return next` where `next`
 * aliases a bare `this`. `undefined` when the method returns something that is
 * not the receiver — including a real copy.
 */
function receiverName(returned: Expression, method: MethodDeclaration): string | undefined {
  if (Node.isThisExpression(returned)) return 'this'
  if (!Node.isIdentifier(returned)) return undefined

  const name = returned.getText()
  for (const decl of method.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    if (decl.getName() !== name) continue
    const init = decl.getInitializer()
    if (init && Node.isThisExpression(init)) return name
    return undefined
  }
  return undefined
}

/** True for `<receiver>._field` and `<receiver>._field.nested`. */
function ownStateAccess(node: Node, receiver: string): boolean {
  let current: Node | undefined = node
  while (Node.isPropertyAccessExpression(current)) {
    const target = current.getExpression()
    const isReceiver =
      receiver === 'this'
        ? Node.isThisExpression(target)
        : Node.isIdentifier(target) && target.getText() === receiver
    if (isReceiver) return current.getName().startsWith('_')
    current = target
  }
  return false
}
