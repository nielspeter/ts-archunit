/**
 * A held builder is immutable (bug 0016).
 *
 * Every chain method returns a copy. Holding a builder in a variable and
 * deriving two rules from it must give two independent rules — the shape
 * `docs/core-concepts.md`, `docs/classes.md` and `docs/graphql.md` all teach.
 *
 * The bug was filed against `RuleBuilder.that()` alone. It was wider: seven
 * more builders held their own mutable state, and five of them are not in
 * `RuleBuilder`'s hierarchy at all, so a fix there could not reach them. The
 * leaks that matter most are the ones that turn a later rule GREEN —
 * `SmellBuilder.ignorePaths` (inherit an ignore, skip the files),
 * `CorrespondenceBuilder.allowEmpty` (inherit an opt-out from the empty-side
 * guard), and any narrowing predicate (inherit it, select nothing, pass).
 *
 * Two derivations, per ADR-008:
 *
 *   1. Behavioural — hold a builder, derive twice, assert both rules are
 *      right. Every assertion below is on a rule that MUST fail or MUST report
 *      an exact non-zero count; a guard whose rules pass is satisfied by the
 *      bug it guards.
 *   2. Structural — read `src/` and fail on any `return this` that follows a
 *      mutation of the builder's own state. This is what catches builder #14,
 *      which no behavioural test can know about. It disagrees with derivation
 *      1 by construction: it never runs a rule.
 */
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Project, Node, SyntaxKind } from 'ts-morph'
import type { ClassDeclaration, MethodDeclaration } from 'ts-morph'
import { project } from '../../src/core/project.js'
import { slices } from '../../src/builders/slice-rule-builder.js'
import { byName, correspondence } from '../../src/builders/correspondence-builder.js'
import { modules } from '../../src/builders/module-rule-builder.js'
import { functions } from '../../src/builders/function-rule-builder.js'
import { tsconfig } from '../../src/tsconfig/index.js'
import { crossLayer } from '../../src/builders/cross-layer-builder.js'
import { smells } from '../../src/smells/index.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'

const fixtures = (name: string): string =>
  path.resolve(import.meta.dirname, `../fixtures/${name}/tsconfig.json`)

function load(name: string): ArchProject {
  const p = new Project({ tsConfigFilePath: fixtures(name) })
  return {
    tsConfigPath: fixtures(name),
    _project: p,
    getSourceFiles: () => p.getSourceFiles(),
  }
}

describe('a held builder is immutable — behavioural', () => {
  it('RuleBuilder: narrowing twice gives two correct subject sets', () => {
    const p = load('poc')
    const parsers = functions(p)
      .that()
      .haveNameMatching(/^parse/)

    // Four parsers; three end in Order. Narrow to each disjoint half in turn.
    expect(
      parsers
        .that()
        .haveNameMatching(/Order$/)
        .should()
        .notExist()
        .violations(),
    ).toHaveLength(3)
    expect(
      parsers
        .that()
        .haveNameMatching(/^parseConfig$/)
        .should()
        .notExist()
        .violations(),
    ).toHaveLength(1)
    // The held selection is still all four. Under the bug it was the empty
    // intersection of the two narrowings, and reported none.
    expect(parsers.should().notExist().violations()).toHaveLength(4)
  })

  it('RuleBuilder: expectNonEmpty() does not leak onto the held selection', () => {
    const p = load('poc')
    const nothing = functions(p)
      .that()
      .haveNameMatching(/^definitelyNotAFunction$/)

    // Opted in: the empty selection is a config finding, so this fails.
    expect(() => nothing.expectNonEmpty().should().beExported().check()).toThrow(ArchRuleError)
    // Not opted in: an empty selection stays green. The opt-in is per rule, and
    // a leaked one turns a later legitimately-empty rule red.
    expect(() => nothing.should().beExported().check()).not.toThrow()
  })

  it('SliceRuleBuilder: a second rule off a held selection has only its own condition', () => {
    const p = load('slices')
    const held = slices(p).matching('src/')

    // `bad` depends upward, so respectLayerOrder fires; these slices are
    // acyclic, so beFreeOfCycles does not. Under the bug the second rule
    // carried both conditions and reported the first rule's violations too.
    const cyclesOnly = held.should().beFreeOfCycles().violations()
    const orderOnly = held
      .should()
      .respectLayerOrder('controllers', 'services', 'domain', 'bad')
      .violations()
    expect(orderOnly.length).toBeGreaterThan(0)
    expect(held.should().beFreeOfCycles().violations()).toHaveLength(cyclesOnly.length)
    // Re-deriving the order rule reports the same count, not double.
    expect(
      held.should().respectLayerOrder('controllers', 'services', 'domain', 'bad').violations(),
    ).toHaveLength(orderOnly.length)
  })

  it('SliceRuleBuilder: re-discovery does not edit the held selection', () => {
    const p = load('slices')
    const held = slices(p).matching('src/')
    const order = (): readonly string[] =>
      held
        .should()
        .respectLayerOrder('controllers', 'services', 'domain', 'bad')
        .violations()
        .map((v) => v.element)

    // Assert the elements, not the count. This fixture reports exactly one
    // layer-order violation, and an empty slice set reports exactly one
    // config finding — so a count-only assertion is 1 === 1 and passes under
    // the bug. Measured: it did.
    expect(order()).toEqual(['leaky-controller.ts'])

    // Discover a different, empty slice set off the same held builder.
    expect(() => held.matching('src/nowhere/*').should().beFreeOfCycles().check()).toThrow(
      ArchRuleError,
    )
    expect(order()).toEqual(['leaky-controller.ts'])
  })

  it('SmellBuilder: a leaked ignorePaths would silently skip files (false green)', () => {
    const p = project(fixtures('smells/duplicate-bodies'))
    const held = smells.duplicateBodies(p).minLines(3).withMinSimilarity(0.8)

    const all = held.violations()
    expect(all.length).toBeGreaterThan(0)

    // Ignore everything: no findings. This is the rule whose state must not
    // survive — an inherited ignore is invisible and turns the next rule green.
    expect(held.ignorePaths('**/*').violations()).toHaveLength(0)
    expect(held.violations()).toHaveLength(all.length)
  })

  it('SmellBuilder: inFolder() and minLines() do not accumulate on the held builder', () => {
    const p = project(fixtures('smells/duplicate-bodies'))
    const held = smells.duplicateBodies(p).withMinSimilarity(0.8)

    // A folder glob matching nothing scopes the detector to nothing.
    expect(held.minLines(3).inFolder('**/no-such-dir/**').violations()).toHaveLength(0)
    // The held builder never had a folder scope, so it still finds everything.
    expect(held.minLines(3).violations().length).toBeGreaterThan(0)
    // And a threshold set on a derived builder did not stick to the held one:
    // minLines(1000) finds nothing, minLines(3) still does.
    expect(held.minLines(1000).violations()).toHaveLength(0)
    expect(held.minLines(3).violations().length).toBeGreaterThan(0)
  })

  it('CorrespondenceBuilder: a leaked allowEmpty would hide an empty side', () => {
    const p = load('poc')
    const empty = functions(p)
      .that()
      .haveNameMatching(/^nothingMatchesThis$/)
    const held = correspondence(p).side('a', empty, byName()).side('b', ['x'])

    // Not opted out: the empty side is the reported root cause.
    expect(() => held.beComplete().check()).toThrow(ArchRuleError)
    // Opted out on a derived rule only.
    expect(() => held.allowEmpty('a').beComplete().check()).not.toThrow()
    // The held builder must still fail. Under the bug the opt-out leaked and
    // every later rule off this selection accepted an empty side.
    expect(() => held.beComplete().check()).toThrow(ArchRuleError)
  })

  it('TsconfigBuilder: requires() does not accumulate on the held builder', () => {
    const p = project(path.resolve(import.meta.dirname, '../../tsconfig.json'))
    const held = tsconfig(p)

    // This repo is strict, so a `strict: false` requirement fails.
    expect(() => held.requires({ strict: false }).check()).toThrow(ArchRuleError)
    // A separate rule off the same held builder must not inherit it. The two
    // requirements must use DIFFERENT keys: `requires()` merges with later keys
    // winning, so `{strict: false}` then `{strict: true}` overwrites the leak
    // and passes either way. Measured: the same-key version passed under the
    // bug. `noUncheckedIndexedAccess` is on in this repo, so this one holds.
    expect(() => held.requires({ noUncheckedIndexedAccess: true }).check()).not.toThrow()
    expect(() => held.requires({ strict: false }).check()).toThrow(ArchRuleError)
  })

  it('CrossLayerBuilder: layer() does not accumulate on the held builder', () => {
    const p = load('cross-layer')
    const held = crossLayer(p)

    // Fewer than two layers is a RangeError, which is exactly what proves the
    // held builder kept none: if `.layer()` had mutated it, the second call
    // below would find the first call's layer still there and not throw.
    expect(() => held.layer('routes', 'src/routes/**').mapping(() => true)).toThrow(RangeError)
    expect(() => held.layer('schemas', 'src/schemas/**').mapping(() => true)).toThrow(RangeError)
  })

  it('CallRuleBuilder-family: excluding() does not leak onto the held selection', () => {
    const p = load('poc')
    const held = modules(p).that().resideInFolder('**/src/**')
    const all = held.should().notExist().violations()
    expect(all.length).toBeGreaterThan(1)

    // Suppress everything on a derived rule.
    expect(held.excluding(/.*/).should().notExist().violations()).toHaveLength(0)
    // A leaked exclusion is the worst kind of leak: it silences a later rule
    // with no output at all.
    expect(held.should().notExist().violations()).toHaveLength(all.length)
  })
})

describe('a held builder is immutable — structural', () => {
  /**
   * `src/` must contain no method that mutates its own state and then returns
   * `this`. Derived from the source text, so it holds for builders this file
   * has never heard of — and it would have caught all eight original sites,
   * which is how the five beyond the bug report were found.
   */
  it('no chain method mutates its own state and returns this', () => {
    const repo = new Project({
      tsConfigFilePath: path.resolve(import.meta.dirname, '../../tsconfig.json'),
    })
    const offenders: string[] = []

    for (const sf of repo.getSourceFiles('src/**/*.ts')) {
      for (const cls of sf.getClasses()) {
        for (const method of cls.getMethods()) {
          const site = mutatesThenReturnsThis(method)
          if (site) {
            offenders.push(
              `${sf.getBaseName()}:${String(method.getStartLineNumber())} ` +
                `${cls.getName() ?? '(anonymous)'}.${method.getName()}() — ${site}`,
            )
          }
        }
      }
    }

    expect(
      offenders,
      'These methods mutate the builder and hand it back, so a held builder is ' +
        'edited in place (bug 0016). Use copy-on-write:\n' +
        '  const next = this.copy()\n  next._field = ...\n  return next\n' +
        'If the field holds a mutable container, also copy it in a `copy()` override.\n\n' +
        offenders.join('\n'),
    ).toEqual([])
  })

  /**
   * Every field that is mutated in place must be given a fresh container
   * somewhere in its own class.
   *
   * The first structural test catches a method that hands `this` back. This
   * one catches the subtler half: a method that correctly returns a copy, but
   * whose copy shares the array it pushes into. `Object.assign` copies the
   * *reference*, so `next._items.push(x)` on such a clone edits the original's
   * array and the leak survives the copy-on-write rewrite entirely.
   *
   * "Somewhere in its own class" rather than "inside `copy()`", because
   * `TerminalBuilder` factors its two containers out into `adoptFilterState`,
   * and a guard that insisted on the literal `copy()` body would have to
   * hard-code that exception. Both spellings — `clone._x = [...this._x]` and
   * `this._x = [...source._x]` — copy one instance's container into another's,
   * and that is what is actually being required.
   *
   * The earlier version of this test asserted that no `copy()` override
   * returns `this`. It passed with every fix reverted, because with the fix
   * gone there are no overrides to be wrong — a guard that is satisfied by the
   * absence of the thing it guards. This version fails there: eight fields are
   * mutated in place and nothing copies them.
   */
  it('every in-place-mutated container field is copied for the clone', () => {
    const repo = new Project({
      tsConfigFilePath: path.resolve(import.meta.dirname, '../../tsconfig.json'),
    })
    const unguarded: string[] = []

    for (const sf of repo.getSourceFiles('src/**/*.ts')) {
      for (const cls of sf.getClasses()) {
        const body = cls.getText()
        for (const field of cls.getProperties()) {
          const name = field.getName()
          if (!name.startsWith('_')) continue
          if (!mutatedInPlace(cls, name)) continue
          if (copiesContainer(body, name)) continue
          unguarded.push(
            `${sf.getBaseName()} ${cls.getName() ?? '(anonymous)'}.${name} ` +
              `is mutated in place but never re-created for a clone`,
          )
        }
      }
    }

    expect(
      unguarded,
      'A clone shares these fields with the builder it was copied from, so ' +
        'mutating the clone mutates the original (bug 0016). Add a `copy()` ' +
        'override that replaces them:\n' +
        '  protected override copy(): this {\n' +
        '    const clone = super.copy()\n' +
        '    clone._field = [...this._field]\n' +
        '    return clone\n' +
        '  }\n\n' +
        unguarded.join('\n'),
    ).toEqual([])
  })
})

/** True if any method in the class calls a mutator on `this.<field>`. */
function mutatedInPlace(cls: ClassDeclaration, field: string): boolean {
  const MUTATORS = ['push', 'add', 'set', 'unshift', 'splice', 'delete', 'clear', 'sort']
  return cls.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
    const callee = call.getExpression()
    if (!Node.isPropertyAccessExpression(callee)) return false
    if (!MUTATORS.includes(callee.getName())) return false
    const target = callee.getExpression()
    return (
      Node.isPropertyAccessExpression(target) &&
      Node.isThisExpression(target.getExpression()) &&
      target.getName() === field
    )
  })
}

/**
 * True if the class text contains an assignment that builds one instance's
 * container from another's — `x._field = [...y._field]`, `new Set(y._field)`,
 * `{ ...y._field }`. Text-based on purpose: the two spellings differ only in
 * which side is `this`, and both are correct.
 */
function copiesContainer(classText: string, field: string): boolean {
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
 * The offending mutation in a method that ends by returning `this`, or
 * `undefined` if there is none.
 *
 * Deliberately only looks at `this._field` writes: `this._field = x`,
 * `this._field.push(...)`, `.add(...)`, `.set(...)`, and compound assignment.
 * A write through a local alias would slip past — accepted, because the point
 * is to catch the idiom a builder author reaches for, and the behavioural
 * probes cover the builders that exist today.
 */
function mutatesThenReturnsThis(method: MethodDeclaration): string | undefined {
  const body = method.getBody()
  if (!body || !Node.isBlock(body)) return undefined

  const statements = body.getStatements()
  const last = statements[statements.length - 1]
  if (!last || !Node.isReturnStatement(last)) return undefined
  const returned = last.getExpression()
  if (!returned || !Node.isThisExpression(returned)) return undefined

  for (const statement of statements.slice(0, -1)) {
    for (const expr of statement.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      const left = expr.getLeft()
      if (!ownStateAccess(left)) continue
      const op = expr.getOperatorToken().getKind()
      if (op === SyntaxKind.EqualsToken || op === SyntaxKind.PlusEqualsToken) {
        return `assigns ${left.getText()}`
      }
    }
    for (const call of statement.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression()
      if (!Node.isPropertyAccessExpression(callee)) continue
      if (!['push', 'add', 'set', 'unshift', 'delete', 'clear'].includes(callee.getName())) continue
      if (!ownStateAccess(callee.getExpression())) continue
      return `calls ${callee.getText()}()`
    }
  }
  return undefined
}

/** True for `this._field` and `this._field.nested`. */
function ownStateAccess(node: Node): boolean {
  let current: Node | undefined = node
  while (Node.isPropertyAccessExpression(current)) {
    const target = current.getExpression()
    if (Node.isThisExpression(target)) return current.getName().startsWith('_')
    current = target
  }
  return false
}
