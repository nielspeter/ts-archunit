/**
 * One body walk per (node, kind), shared across matchers.
 *
 * `findMatchesByKind` walks a body with `getDescendantsOfKind(kind)` and then
 * filters with the matcher. The walk is a function of the node and the kind;
 * only the filter differs. So N matchers over one body did N identical
 * traversals — and `agentGuardrails` emits one `functions()` rule per banned
 * API, which is exactly that shape.
 *
 * Measured on this repository, eight banned APIs: **88 ms → 16 ms**, identical
 * findings. The element cache from plan 0075 does not help here; it removed the
 * redundant *collection* of the functions and left the body walks in place.
 *
 * ## The invalidation is the dangerous part, and a node key alone is unsafe
 *
 * Measured before the cache was written:
 *
 *     f.getDescendantsOfKind(CallExpression)   -> 1 call
 *     f.addStatements('eval("z")')
 *     same f object = true, f.wasForgotten() = false
 *     f.getDescendantsOfKind(CallExpression)   -> 2 calls
 *
 * A function node **survives an edit to its own body and is not forgotten**, so
 * a `WeakMap<Node, …>` serves the pre-edit list — the same trap plan 0076 found
 * one level up with `SourceFile`, except `Node` has no `onModified` to escape it.
 * Entries are therefore grouped by source file and dropped when that file
 * changes. A count assertion cannot see staleness, so the mutation tests below
 * are the ones that matter.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { Project, SyntaxKind } from 'ts-morph'
import type { SourceFile } from 'ts-morph'
import { descendantsOfKind } from '../../src/core/descendant-cache.js'
import { functions } from '../../src/index.js'
import { call } from '../../src/helpers/matchers.js'
import { resetProjectCache } from '../../src/core/project.js'
import type { ArchProject } from '../../src/core/project.js'

/**
 * `Object.getPrototypeOf` is typed `any`, which ADR-005 bars from flowing on.
 */
function protoOf(value: object): object | null {
  const next: unknown = Object.getPrototypeOf(value)
  return typeof next === 'object' && next !== null ? next : null
}

let restore: (() => void) | undefined
afterEach(() => {
  restore?.()
  restore = undefined
  resetProjectCache()
})

/**
 * Count real `getDescendantsOfKind` traversals while `run` executes.
 *
 * The owner prototype is found by walking the chain, not by assuming a depth —
 * `Node.prototype` is five levels above a `SourceFile` instance and patching a
 * nearer level counts only the calls made on source files. Plan 0075 recorded a
 * wrong-by-8,424 conclusion from exactly that mistake.
 */
function countWalks(project: Project, run: () => void): number {
  const sample = project.createSourceFile('/__probe.ts', 'const a = 1', { overwrite: true })
  let proto: object | null = protoOf(sample)
  while (proto !== null && !Object.prototype.hasOwnProperty.call(proto, 'getDescendantsOfKind')) {
    proto = protoOf(proto)
  }
  if (proto === null) throw new Error('no prototype owns getDescendantsOfKind')
  const owner: object = proto
  const descriptor = Object.getOwnPropertyDescriptor(owner, 'getDescendantsOfKind')
  if (descriptor === undefined) throw new Error('no descriptor')
  const original: unknown = descriptor.value
  if (typeof original !== 'function') throw new Error('not a function')

  let count = 0
  const spy = function (this: unknown, ...args: unknown[]): unknown {
    count += 1
    return Reflect.apply(original, this, args)
  }
  Object.defineProperty(owner, 'getDescendantsOfKind', { ...descriptor, value: spy })
  restore = () => {
    Object.defineProperty(owner, 'getDescendantsOfKind', descriptor)
  }
  run()
  restore()
  restore = undefined
  return count
}

/** Two functions, each with one call, in one file. */
function twoBodies(): { project: Project; file: SourceFile } {
  const project = new Project({ useInMemoryFileSystem: true })
  const file = project.createSourceFile(
    '/src/a.ts',
    'export function f() { console.log(1) }\nexport function g() { eval("x") }',
  )
  return { project, file }
}

describe('a body is walked once per kind', () => {
  it('serves the second matcher from the cache', () => {
    const { project, file } = twoBodies()
    const fn = file.getFunctionOrThrow('f')

    const walks = countWalks(project, () => {
      descendantsOfKind(fn, SyntaxKind.CallExpression)
      descendantsOfKind(fn, SyntaxKind.CallExpression)
      descendantsOfKind(fn, SyntaxKind.CallExpression)
    })

    expect(walks).toBe(1)
  })

  it('does not conflate two kinds', () => {
    // A single cache slot per node would serve `Identifier` descendants to a
    // `CallExpression` matcher, which is a wrong-population bug rather than a
    // stale one.
    const { file } = twoBodies()
    const fn = file.getFunctionOrThrow('f')

    const callsFound = descendantsOfKind(fn, SyntaxKind.CallExpression)
    const identifiers = descendantsOfKind(fn, SyntaxKind.Identifier)

    expect(callsFound).toHaveLength(1)
    expect(identifiers.length).toBeGreaterThan(1)
    expect(identifiers.length).not.toBe(callsFound.length)
  })

  it('does not conflate two nodes', () => {
    const { file } = twoBodies()
    const f = descendantsOfKind(file.getFunctionOrThrow('f'), SyntaxKind.CallExpression)
    const g = descendantsOfKind(file.getFunctionOrThrow('g'), SyntaxKind.CallExpression)

    expect(f.map((n) => n.getText())).toEqual(['console.log(1)'])
    expect(g.map((n) => n.getText())).toEqual(['eval("x")'])
  })

  it('returns the same descendants it would have walked', () => {
    // A count proves one walk happened; it does not prove the right nodes came
    // back. Compared against the uncached call on an untouched sibling file, so
    // the expectation is derived rather than written down.
    const { project, file } = twoBodies()
    const other = project.createSourceFile('/src/b.ts', 'export function h() { console.log(1) }')

    const cached = descendantsOfKind(file.getFunctionOrThrow('f'), SyntaxKind.CallExpression)
    const direct = other.getFunctionOrThrow('h').getDescendantsOfKind(SyntaxKind.CallExpression)

    expect(cached.map((n) => n.getText())).toEqual(direct.map((n) => n.getText()))
  })
})

describe('an edit to the file invalidates it', () => {
  it('sees a call added to the walked body', () => {
    // THE test. The node survives the edit and is not forgotten, so a node-keyed
    // cache without file-level invalidation answers with the pre-edit list and a
    // `notContain` rule passes on the call the edit just added.
    const { file } = twoBodies()
    const fn = file.getFunctionOrThrow('f')
    expect(descendantsOfKind(fn, SyntaxKind.CallExpression)).toHaveLength(1)

    file.getFunctionOrThrow('f').addStatements('eval("z")')

    const after = descendantsOfKind(file.getFunctionOrThrow('f'), SyntaxKind.CallExpression)
    expect(after.map((n) => n.getText())).toContain('eval("z")')
    expect(after).toHaveLength(2)
  })

  it('sees a call added to a DIFFERENT body in the same file', () => {
    // The node object for `f` is untouched by an edit to `g`, so a per-node
    // invalidation would miss this while a per-file one catches it. Measured:
    // editing `g` leaves `f`'s object identical and unforgotten.
    const { file } = twoBodies()
    expect(descendantsOfKind(file.getFunctionOrThrow('g'), SyntaxKind.CallExpression)).toHaveLength(
      1,
    )

    file.getFunctionOrThrow('f').addStatements('fetch("y")')

    expect(descendantsOfKind(file.getFunctionOrThrow('g'), SyntaxKind.CallExpression)).toHaveLength(
      1,
    )
    expect(descendantsOfKind(file.getFunctionOrThrow('f'), SyntaxKind.CallExpression)).toHaveLength(
      2,
    )
  })

  it('invalidates only the edited file', () => {
    // Without this, dropping everything on any edit satisfies every test above
    // while making the cache worthless.
    const { project, file } = twoBodies()
    const other = project.createSourceFile('/src/b.ts', 'export function h() { console.log(1) }')
    descendantsOfKind(file.getFunctionOrThrow('f'), SyntaxKind.CallExpression)
    descendantsOfKind(other.getFunctionOrThrow('h'), SyntaxKind.CallExpression)

    file.getFunctionOrThrow('f').addStatements('eval("z")')

    const walks = countWalks(project, () => {
      descendantsOfKind(other.getFunctionOrThrow('h'), SyntaxKind.CallExpression)
    })
    expect(walks).toBe(0)
  })

  it('registers one listener per file, not one per miss', () => {
    const { file } = twoBodies()
    let registrations = 0
    const original = file.onModified.bind(file)
    file.onModified = (...args: Parameters<typeof original>): SourceFile => {
      registrations += 1
      return original(...args)
    }

    for (let i = 0; i < 4; i++) {
      descendantsOfKind(file.getFunctionOrThrow('f'), SyntaxKind.CallExpression)
      file.insertText(0, `// ${String(i)}\n`)
    }
    descendantsOfKind(file.getFunctionOrThrow('f'), SyntaxKind.CallExpression)

    expect(registrations).toBe(1)
  })
})

describe('the rule that pays for it', () => {
  it('is actually wired into body-traversal, not merely available', () => {
    /**
     * The gap sabotage found: every other test here calls `descendantsOfKind`
     * directly, so reverting `findMatchesByKind` to `node.getDescendantsOfKind`
     * left them all green while removing the entire benefit. This asserts the
     * wiring by counting real traversals through the RULE path.
     *
     * Two matchers over the same bodies: uncached that is two walks per function
     * body, cached it is one.
     */
    const tsMorphProject = new Project({ useInMemoryFileSystem: true })
    tsMorphProject.createSourceFile(
      '/src/danger.ts',
      'export function a() { eval("x") }\nexport function b() { console.log(1) }',
    )
    const project: ArchProject = {
      tsConfigPath: '/tsconfig.json',
      _project: tsMorphProject,
      getSourceFiles: () => tsMorphProject.getSourceFiles(),
    }

    // Warm: the first matcher pays for the walk either way, and this test is
    // about the second.
    functions(project).should().notContain(call('eval')).violations()

    const walks = countWalks(tsMorphProject, () => {
      functions(project).should().notContain(call('console.log')).violations()
    })

    // Zero: every body was walked by the warm-up. Uncached this is one per
    // function body, and the assertion reds.
    expect(walks).toBe(0)
  })

  it('reports the same violations cached as uncached', () => {
    // The behavioural contract: the whole point is that nothing observable
    // changes. Two matchers over the same bodies, the second served from cache.
    const tsMorphProject = new Project({ useInMemoryFileSystem: true })
    tsMorphProject.createSourceFile(
      '/src/danger.ts',
      'export function a() { eval("x") }\nexport function b() { console.log(1) }\nexport function c() { eval("y"); console.log(2) }',
    )
    const project: ArchProject = {
      tsConfigPath: '/tsconfig.json',
      _project: tsMorphProject,
      getSourceFiles: () => tsMorphProject.getSourceFiles(),
    }

    const evals = functions(project).should().notContain(call('eval')).violations()
    const logs = functions(project).should().notContain(call('console.log')).violations()
    // Second pass, now fully warm — must be identical, not merely the same size.
    const evalsAgain = functions(project).should().notContain(call('eval')).violations()

    expect(evals.map((v) => v.element).sort()).toEqual(['a', 'c'])
    expect(logs.map((v) => v.element).sort()).toEqual(['b', 'c'])
    expect(evalsAgain.map((v) => v.element).sort()).toEqual(evals.map((v) => v.element).sort())
  })
})
