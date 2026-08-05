/**
 * Module edges are built once per file, and rebuilt when the file changes —
 * plan 0076.
 *
 * `edgesOf()` walked and resolved a file's imports from scratch on every call,
 * so rules sharing subjects paid linearly. Measured on this repository (520
 * files, 2,097 import literals): five whole-project `notImportFrom` rules made
 * **10,525 `getSymbol()` calls in 47ms** where 2,105 would do — exactly 5×.
 *
 * ## The dangerous half is invalidation, not the count
 *
 * A `SourceFile`'s object identity **survives an edit** — measured,
 * `addImportDeclaration` and `replaceWithText` both keep the same object while
 * the edges change. So the argument that makes `element-cache.ts`'s
 * `WeakMap<ArchProject, …>` safe does not transfer: `resetProjectCache()`
 * builds a *new* `ArchProject`, and nothing builds a new `SourceFile`.
 *
 * Without invalidation this cache serves pre-edit edges after an edit, and a
 * `notImportFrom` rule passes on the import the edit just added. That is
 * ADR-008's false green manufactured by a performance change, and it is what
 * the mutation tests below exist for. A count assertion cannot see it: a stale
 * array is still exactly one resolution pass.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { Project } from 'ts-morph'
import type { SourceFile } from 'ts-morph'
import { edgesOf, edgeStream, moduleEdges } from '../../src/core/module-edges.js'

/**
 * `Object.getPrototypeOf` is typed `any`, which ADR-005 bars from flowing on.
 * Narrowed through `unknown` rather than asserted with `as`.
 */
function protoOf(value: object): object | null {
  const next: unknown = Object.getPrototypeOf(value)
  return typeof next === 'object' && next !== null ? next : null
}

let restore: (() => void) | undefined
afterEach(() => {
  restore?.()
  restore = undefined
})

/**
 * Count `getSymbol()` calls while `run` executes.
 *
 * The prototype that owns the method is found by **walking the chain**, not by
 * assuming a depth: `Node.prototype` is five levels above a `SourceFile`
 * instance, and patching a nearer level counts only the calls made on source
 * files. Plan 0075 recorded a confident "zero" from exactly that mistake.
 */
function countSymbolLookups(project: Project, run: () => void): number {
  const sample = project.createSourceFile('/__probe.ts', 'const a = 1', { overwrite: true })
  let proto: object | null = protoOf(sample)
  while (proto !== null && !Object.prototype.hasOwnProperty.call(proto, 'getSymbol')) {
    proto = protoOf(proto)
  }
  if (proto === null) throw new Error('no prototype in the chain owns getSymbol')
  const owner: object = proto
  const descriptor = Object.getOwnPropertyDescriptor(owner, 'getSymbol')
  if (descriptor === undefined) throw new Error('no descriptor')
  const original: unknown = descriptor.value
  if (typeof original !== 'function') throw new Error('not a function')

  let count = 0
  const spy = function (this: unknown, ...args: unknown[]): unknown {
    count += 1
    return Reflect.apply(original, this, args)
  }
  Object.defineProperty(owner, 'getSymbol', { ...descriptor, value: spy })
  restore = () => {
    Object.defineProperty(owner, 'getSymbol', descriptor)
  }
  run()
  restore()
  restore = undefined
  return count
}

/** A project whose `main.ts` imports three local modules. */
function threeImports(): { project: Project; main: SourceFile } {
  const project = new Project({ useInMemoryFileSystem: true })
  project.createSourceFile('/a.ts', 'export const a = 1')
  project.createSourceFile('/b.ts', 'export const b = 2')
  project.createSourceFile('/c.ts', 'export const c = 3')
  const main = project.createSourceFile(
    '/main.ts',
    "import { a } from './a.js'\nimport { b } from './b.js'\nimport { c } from './c.js'\n",
  )
  return { project, main }
}

const targets = (file: SourceFile): string[] =>
  edgesOf(file).map((edge) => edge.resolvedPath ?? edge.specifier)

describe('edges are built once per file', () => {
  it('resolves once for five passes, not five times', () => {
    const { project, main } = threeImports()
    edgesOf(main) // warm

    const lookups = countSymbolLookups(project, () => {
      for (let i = 0; i < 5; i++) edgesOf(main)
    })

    // Zero, because the warm-up already resolved. Uncached this is 3 × 5.
    expect(lookups).toBe(0)
  })

  it('resolves each literal once on a cold file', () => {
    const { project, main } = threeImports()
    const literalCount = main.getImportStringLiterals().length
    // Non-vacuity: with no imports every count below is 0 and proves nothing.
    expect(literalCount).toBe(3)

    const lookups = countSymbolLookups(project, () => {
      for (let i = 0; i < 5; i++) edgesOf(main)
    })
    expect(lookups).toBe(literalCount)
  })

  it('returns identical edges, not merely the same number of them', () => {
    // A count proves one pass happened; it does not prove the right edges came
    // back. This is the half that does.
    const { main } = threeImports()
    const first = edgesOf(main).map((e) => `${e.kind}:${String(e.resolvedPath)}:${String(e.line)}`)
    const second = edgesOf(main).map((e) => `${e.kind}:${String(e.resolvedPath)}:${String(e.line)}`)
    expect(first).toHaveLength(3)
    expect(second).toEqual(first)
  })

  it('shares the cache with moduleEdges() and the predicate path', () => {
    const { project, main } = threeImports()
    moduleEdges(project.getSourceFiles())

    const lookups = countSymbolLookups(project, () => edgesOf(main))
    expect(lookups).toBe(0)
  })
})

describe('an edit invalidates the file it touched', () => {
  it('sees an import added after the edges were cached', () => {
    // THE test. A `SourceFile` keeps its identity across an edit, so a cache
    // without invalidation answers with the pre-edit edges and a
    // `notImportFrom` rule passes on the import the edit just added.
    const { main } = threeImports()
    expect(targets(main)).toEqual(['/a.ts', '/b.ts', '/c.ts'])

    main.addImportDeclaration({ moduleSpecifier: './d.js', namedImports: ['d'] })

    expect(targets(main)).toContain('./d.js')
    expect(targets(main)).toHaveLength(4)
  })

  it('sees an import removed after the edges were cached', () => {
    const { main } = threeImports()
    expect(targets(main)).toHaveLength(3)

    main.getImportDeclarations()[0]?.remove()

    expect(targets(main)).toEqual(['/b.ts', '/c.ts'])
  })

  it('sees a whole-file replacement', () => {
    const { main } = threeImports()
    expect(targets(main)).toHaveLength(3)

    main.replaceWithText("import { c } from './c.js'\n")

    expect(targets(main)).toEqual(['/c.ts'])
  })

  it('invalidates only the edited file', () => {
    // Without this, `cache.clear()`-on-any-edit would satisfy every test above
    // while making the cache worthless.
    const { project, main } = threeImports()
    const other = project.createSourceFile('/other.ts', "import { a } from './a.js'")
    edgesOf(main)
    edgesOf(other)

    main.addImportDeclaration({ moduleSpecifier: './d.js', namedImports: ['d'] })

    const lookups = countSymbolLookups(project, () => edgesOf(other))
    expect(lookups).toBe(0)
    expect(targets(other)).toEqual(['/a.ts'])
  })

  it('registers one listener per file, not one per cache miss', () => {
    const { main } = threeImports()
    let registrations = 0
    const original = main.onModified.bind(main)
    // Count registrations without changing behaviour.
    main.onModified = (...args: Parameters<typeof original>): SourceFile => {
      registrations += 1
      return original(...args)
    }

    // Force repeated misses by editing between reads.
    for (let i = 0; i < 4; i++) {
      edgesOf(main)
      main.insertText(0, `// ${String(i)}\n`)
    }
    edgesOf(main)

    // One registration total across five misses. The `watched` set is what
    // keeps a long watch session from accumulating a listener per rule
    // execution — without it this is 5.
    expect(registrations).toBe(1)
  })
})

describe('edgeStream keeps its early exit', () => {
  it('stops at the first edge on a cold file', () => {
    // `dependOn` streams so it can stop after one resolution. The comment at
    // `dependency.ts:327-334` prices the alternative at 100 checker calls on a
    // 100-import file where 1 would do. Populating the cache here would
    // reintroduce exactly that.
    //
    // Asserted as a RELATION, not as an absolute. Measured, the first symbol
    // lookup in a project costs two and later ones cost one each (2 for one
    // edge, 4 for three), so an absolute would encode a ts-morph internal and
    // break on upgrade. Early-exit < full-consumption is the property.
    const early = countSymbolLookups(threeImports().project, () => {
      const { main } = threeImports()
      const iterator = edgeStream(main)
      iterator.next()
      iterator.return(undefined)
    })
    const full = countSymbolLookups(threeImports().project, () => {
      const { main } = threeImports()
      for (const edge of edgeStream(main)) void edge.kind
    })

    expect(early).toBeGreaterThan(0)
    expect(early).toBeLessThan(full)
  })

  it('does not populate the cache from a cold stream', () => {
    const { project, main } = threeImports()
    const iterator = edgeStream(main)
    iterator.next()
    iterator.return(undefined)

    // Still cold, so `edgesOf` pays the full pass. Compared against a second
    // untouched file rather than an absolute, for the same reason as above.
    const other = project.createSourceFile('/other.ts', main.getFullText(), { overwrite: false })
    const afterStream = countSymbolLookups(project, () => edgesOf(main))
    const untouched = countSymbolLookups(project, () => edgesOf(other))
    expect(afterStream).toBe(untouched)
    expect(afterStream).toBeGreaterThan(0)
  })

  it('agrees with edgesOf as a SEQUENCE, cold and warm — since bug 0059', () => {
    /**
     * **This was a multiset comparison, and the row below told us when to change it.**
     *
     * The history is worth keeping. The first version compared sequences over a
     * three-plain-imports fixture where walk order and source order coincide, so it
     * asserted a property that did not hold and passed because the fixture could not
     * exercise it. That was corrected to a set comparison, with a companion row
     * asserting the two orders really did differ — and a comment saying that if they
     * ever coincided, someone should reconsider.
     *
     * They now coincide, deliberately.
     * [Bug 0059](../../bugs/fixed/0059-slice-conditions-and-module-conditions-disagree-about-a-dependency.md)
     * gave `ModuleEdge` an `ordinal` — the nth edge of the same kind to the same
     * specifier — because `names` is empty for `dynamic`, `require` and
     * `type-expression`, so two lazy imports of one module shared one baseline hash.
     * An ordinal that depended on whether the cache was warm would be worse than the
     * collision it fixes, so `edgeStream` now walks in source order too, and the
     * sequence is the contract.
     */
    const project = new Project({ useInMemoryFileSystem: true })
    project.createSourceFile('/a.ts', 'export const a = 1')
    project.createSourceFile('/b.ts', 'export const b = 2')
    const main = project.createSourceFile(
      '/ordered.ts',
      "const later = await import('./b.js')\nimport { a } from './a.js'\n",
    )

    const specifiers = (edges: readonly { specifier: string }[]): string[] =>
      edges.map((e) => e.specifier)

    const coldStream = specifiers([...edgeStream(main)])
    const fromEdges = specifiers(edgesOf(main))
    const warmStream = specifiers([...edgeStream(main)])

    expect(coldStream).toEqual(fromEdges)
    expect(warmStream).toEqual(fromEdges)
    // Source order, so the dynamic import on line 1 comes first.
    expect(fromEdges).toEqual(['./b.js', './a.js'])
  })

  it('yields the SAME order warm and cold — the ordinal depends on it', () => {
    // This row used to assert the opposite, and its comment said: "if the two orders
    // ever coincide for this fixture, the set comparison above has stopped being a
    // deliberate choice and someone should reconsider it — this test is what tells
    // them." It did exactly that. Kept, inverted, on the same fixture: a dynamic
    // import BEFORE a declaration import is the shape where the binder's
    // declarations-first array diverges from source order.
    const project = new Project({ useInMemoryFileSystem: true })
    project.createSourceFile('/a.ts', 'export const a = 1')
    project.createSourceFile('/b.ts', 'export const b = 2')
    const main = project.createSourceFile(
      '/ordered2.ts',
      "const later = await import('./b.js')\nimport { a } from './a.js'\n",
    )

    const cold = [...edgeStream(main)].map((e) => e.specifier)
    // The stream never populates, so warming takes an `edgesOf` call — which in
    // a real suite is any other rule that touches this file first. That is
    // precisely why the order depends on rule execution order.
    edgesOf(main)
    const warm = [...edgeStream(main)].map((e) => e.specifier)

    // Source order both ways: the dynamic import is on line 1.
    expect(cold).toEqual(['./b.js', './a.js'])
    expect(warm).toEqual(cold)
  })

  it('sees an edit through the stream too', () => {
    const { main } = threeImports()
    edgesOf(main)
    main.addImportDeclaration({ moduleSpecifier: './d.js', namedImports: ['d'] })

    expect([...edgeStream(main)].map((e) => e.specifier)).toContain('./d.js')
  })
})
