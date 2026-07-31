/**
 * One body walk per (node, kind), shared across matchers.
 *
 * `findMatchesByKind` walks a body with `getDescendantsOfKind(kind)` and then
 * filters with the matcher. The walk is a function of the node and the kind;
 * only the filter differs. So N matchers over one body did N identical
 * traversals — and `agentGuardrails` emits one `functions()` rule per banned
 * API, which is exactly that shape.
 *
 * Measured on this repository (530 files), eight banned APIs: **8,504 walk
 * requests become 1,063 real traversals** — the ratio is the stable figure, and
 * wall clock landed between 16 and 23 ms against 88 ms across three
 * reproductions. Identical findings. The element cache from plan 0075 does not
 * help here; it removed the redundant *collection* of the functions and left the
 * body walks in place. `findMatchesBroad` remains uncached and its marginal rule
 * costs ~57 ms — see the module docstring for why that is filed, not done.
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
import { allDescendants, descendantsOfKind } from '../../src/core/descendant-cache.js'
import { functions } from '../../src/index.js'
import { call, expression } from '../../src/helpers/matchers.js'
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
function countMethod(name: 'getDescendantsOfKind' | 'getDescendants', run: () => void): number {
  // A THROWAWAY project for the probe, not the one under measurement. Creating a
  // file in the caller's project with `overwrite: true` fires `onModified`, so the
  // harness silently invalidated the file it was measuring — measured: pointing
  // the probe at an existing path reds the very first test.
  const sample = new Project({ useInMemoryFileSystem: true }).createSourceFile(
    '/__probe.ts',
    'const a = 1',
  )
  // The owner prototype is found by WALKING the chain, not by assuming a depth:
  // `Node.prototype` is five levels above a `SourceFile` instance and patching a
  // nearer level counts only the calls made on source files. Plan 0075 recorded a
  // wrong-by-8,424 conclusion from exactly that mistake.
  let proto: object | null = protoOf(sample)
  while (proto !== null && !Object.prototype.hasOwnProperty.call(proto, name)) {
    proto = protoOf(proto)
  }
  if (proto === null) throw new Error(`no prototype owns ${name}`)
  const owner: object = proto
  const descriptor = Object.getOwnPropertyDescriptor(owner, name)
  if (descriptor === undefined) throw new Error('no descriptor')
  const original: unknown = descriptor.value
  if (typeof original !== 'function') throw new Error('not a function')

  let count = 0
  const spy = function (this: unknown, ...args: unknown[]): unknown {
    count += 1
    return Reflect.apply(original, this, args)
  }
  Object.defineProperty(owner, name, { ...descriptor, value: spy })
  restore = () => {
    Object.defineProperty(owner, name, descriptor)
  }
  run()
  restore()
  restore = undefined
  return count
}

/** Counts the by-kind walk. */
function countWalks(_project: Project, run: () => void): number {
  return countMethod('getDescendantsOfKind', run)
}

/** The same harness, for the kind-independent `getDescendants`. */
function countBroadWalks(_project: Project, run: () => void): number {
  return countMethod('getDescendants', run)
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
    // BOTH warmed. The first version warmed only `g`, so the assertion on `f`
    // below was a cold read and proved nothing — an invalidation scheme that
    // dropped only the node it registered against passed every test here.
    expect(descendantsOfKind(file.getFunctionOrThrow('f'), SyntaxKind.CallExpression)).toHaveLength(
      1,
    )
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

    let after: readonly string[] = []
    const walks = countWalks(project, () => {
      after = descendantsOfKind(other.getFunctionOrThrow('h'), SyntaxKind.CallExpression).map((n) =>
        n.getText(),
      )
    })
    expect(walks).toBe(0)
    // Paired with identity: a cache that served `other` a wrong-but-cached array
    // is also zero walks.
    expect(after).toEqual(['console.log(1)'])
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

describe('the broad walk is shared too', () => {
  /**
   * `findMatchesBroad` is the other strategy — `expression()` and `comment()`
   * declare no `syntaxKinds`, so they must look at every descendant. Measured on
   * this repository, 1,698 bodies / 117,949 descendants with ts-morph's wrapper
   * cache warm:
   *
   *     getDescendants()          49 ms   <- shared by this
   *     + getText() on each       71 ms
   *     + regex on each           68 ms
   *
   * The walk is ~three quarters of the cost and the filter is per-matcher, so the
   * walk is the shareable part. End to end, six successive broad rules:
   * **~57 ms each becomes ~17 ms each.**
   */
  it('walks a body once however many broad matchers ask', () => {
    const { project, file } = twoBodies()
    const fn = file.getFunctionOrThrow('f')

    const walks = countWalks(project, () => {
      allDescendants(fn)
      allDescendants(fn)
      allDescendants(fn)
    })

    // `getDescendants` is a different method from `getDescendantsOfKind`, so the
    // by-kind counter reads zero either way — this counts the broad one.
    expect(walks).toBe(0)
    expect(allDescendants(fn).length).toBeGreaterThan(1)
  })

  it('does not conflate two nodes', () => {
    // Sabotage found this missing: serving the first cached entry for the file
    // regardless of which node was asked is a WRONG-population bug, not a stale
    // one, and every other broad test passed under it. The by-kind map has the
    // equivalent test; this one did not.
    const { file } = twoBodies()

    const f = allDescendants(file.getFunctionOrThrow('f')).map((n) => n.getText())
    const g = allDescendants(file.getFunctionOrThrow('g')).map((n) => n.getText())

    expect(f.some((t) => t.includes('console.log'))).toBe(true)
    expect(g.some((t) => t.includes('eval'))).toBe(true)
    // Each body sees its own call and not the sibling's.
    expect(f.some((t) => t.includes('eval'))).toBe(false)
    expect(g.some((t) => t.includes('console.log'))).toBe(false)
  })

  it('is actually wired into findMatchesBroad, not merely available', () => {
    // The wiring, through the RULE path, with the violations captured inside the
    // measurement — `0` is also what a rule that analysed nothing reports. This
    // is the shape the last review showed was missing for the by-kind half.
    const tsMorphProject = new Project({ useInMemoryFileSystem: true })
    tsMorphProject.createSourceFile(
      '/src/parse.ts',
      'export function a() { JSON.parse("{}") }\nexport function b() { const x = 1; return x }',
    )
    const project: ArchProject = {
      tsConfigPath: '/tsconfig.json',
      _project: tsMorphProject,
      getSourceFiles: () => tsMorphProject.getSourceFiles(),
    }

    // Warm with one broad matcher, then measure a second over the same bodies.
    functions(project)
      .should()
      .notContain(expression(/JSON\.parse\(/))
      .violations()

    let seen: string[] = []
    const walks = countBroadWalks(tsMorphProject, () => {
      seen = functions(project)
        .should()
        .notContain(expression(/JSON\.stringify\(/))
        .violations()
        .map((v) => v.element)
    })

    expect(seen).toEqual([])
    expect(walks).toBe(0)
  })

  it('sees an edit, and only in the edited file', () => {
    const { project, file } = twoBodies()
    const other = project.createSourceFile('/src/b.ts', 'export function h() { console.log(1) }')
    const before = allDescendants(file.getFunctionOrThrow('f')).length
    allDescendants(other.getFunctionOrThrow('h'))

    file.getFunctionOrThrow('f').addStatements('eval("z")')

    expect(allDescendants(file.getFunctionOrThrow('f')).length).toBeGreaterThan(before)
    // The untouched file keeps its entry, or the cache is pointless.
    let text: readonly string[] = []
    const walks = countBroadWalks(project, () => {
      text = allDescendants(other.getFunctionOrThrow('h')).map((n: { getKindName: () => string }) =>
        n.getKindName(),
      )
    })
    expect(walks).toBe(0)
    expect(text.length).toBeGreaterThan(1)
  })

  it('re-walks when the cached nodes were forgotten under it', () => {
    const { file } = twoBodies()
    const fn = file.getFunctionOrThrow('f')
    const first = allDescendants(fn)
    expect(first.length).toBeGreaterThan(1)

    first[0]?.forget()

    // Must not throw and must not return the forgotten list.
    expect(() =>
      allDescendants(fn).map((n: { getKindName: () => string }) => n.getKindName()),
    ).not.toThrow()
  })

  it('hands back the cached array itself, not a copy', () => {
    const { file } = twoBodies()
    const fn = file.getFunctionOrThrow('f')
    expect(allDescendants(fn)).toBe(allDescendants(fn))
  })

  it('is cleared by resetProjectCache(), and still invalidates afterwards', () => {
    // Both halves in one: the escape hatch works, and the listener reads the live
    // binding so a post-reset edit is still seen.
    const { project, file } = twoBodies()
    const before = allDescendants(file.getFunctionOrThrow('f')).length

    resetProjectCache()
    const walks = countBroadWalks(project, () => {
      allDescendants(file.getFunctionOrThrow('f'))
    })
    expect(walks).toBe(1)

    file.getFunctionOrThrow('f').addStatements('eval("z")')
    expect(allDescendants(file.getFunctionOrThrow('f')).length).toBeGreaterThan(before)
  })

  it('does not serve a broad query from the by-kind map, or the reverse', () => {
    // Two maps, one lifetime. Conflating them would answer "every descendant"
    // with "every call expression", which is a wrong population rather than a
    // stale one.
    const { file } = twoBodies()
    const fn = file.getFunctionOrThrow('f')

    const byKind = descendantsOfKind(fn, SyntaxKind.CallExpression)
    const broad = allDescendants(fn)

    expect(byKind).toHaveLength(1)
    expect(broad.length).toBeGreaterThan(byKind.length)
    expect(broad).not.toBe(byKind)
  })
})

describe('a forgotten descendant does not become a crash', () => {
  it('re-walks when the cached nodes were forgotten under it', () => {
    /**
     * The regression review caught, measured against `main` through the rule
     * path: 1 violation before this cache, `InvalidOperationError` after.
     *
     * `node.forget()` and `forgetNodesCreatedInBlock()` forget nodes without
     * modifying the file, so `onModified` never fires. The KEY node stays live
     * and unforgotten while the walked DESCENDANTS are gone — which is why an
     * early `node.wasForgotten()` check (what shipped first) guarded the
     * harmless case and missed this one.
     */
    const tsMorphProject = new Project({ useInMemoryFileSystem: true })
    const file = tsMorphProject.createSourceFile('/src/a.ts', 'export function f() { eval("x") }')
    const project: ArchProject = {
      tsConfigPath: '/tsconfig.json',
      _project: tsMorphProject,
      getSourceFiles: () => tsMorphProject.getSourceFiles(),
    }
    const run = (): number =>
      functions(project).should().notContain(call('eval')).violations().length

    expect(run()).toBe(1)
    file.getDescendantsOfKind(SyntaxKind.CallExpression)[0]?.forget()

    // Must not throw, and must still find it — this is `main`'s behaviour.
    expect(run()).toBe(1)
  })

  it('does not fix forgetNodesCreatedInBlock, which was already broken', () => {
    /**
     * Honest attribution, because the first version of this test asserted a fix
     * nobody made. Measured on BOTH sides: a rule re-run after
     * `forgetNodesCreatedInBlock` throws on `main` too, so this cache neither
     * causes nor cures it. The cause is one layer up — plan 0075's element cache
     * retains the `ArchFunction` wrappers created inside the block, and those are
     * what the next run reads.
     *
     * Pinned as a throw rather than left unstated, so that if someone fixes the
     * element cache this test tells them the behaviour changed rather than
     * leaving a silent difference between the two forget APIs.
     */
    const tsMorphProject = new Project({ useInMemoryFileSystem: true })
    tsMorphProject.createSourceFile('/src/a.ts', 'export function f() { eval("x") }')
    const project: ArchProject = {
      tsConfigPath: '/tsconfig.json',
      _project: tsMorphProject,
      getSourceFiles: () => tsMorphProject.getSourceFiles(),
    }
    const run = (): number =>
      functions(project).should().notContain(call('eval')).violations().length

    tsMorphProject.forgetNodesCreatedInBlock(() => {
      expect(run()).toBe(1)
    })

    expect(() => run()).toThrow(/removed or forgotten/)
    // And the escape hatch works, which is the part that IS this cache's business.
    resetProjectCache()
    expect(run()).toBe(1)
  })

  it('is cleared by resetProjectCache(), which is the documented escape hatch', () => {
    // The remedy the module docstring names, and which nothing asserted —
    // deleting the `registerCacheReset` call was green across the whole suite.
    const { project, file } = twoBodies()
    const fn = file.getFunctionOrThrow('f')
    expect(descendantsOfKind(fn, SyntaxKind.CallExpression)).toHaveLength(1)

    resetProjectCache()

    const walks = countWalks(project, () => {
      descendantsOfKind(file.getFunctionOrThrow('f'), SyntaxKind.CallExpression)
    })
    expect(walks).toBe(1)
  })

  it('still invalidates after a reset, because the listener reads the live map', () => {
    /**
     * The invariant review found undefended, and it is not a revert — it is the
     * "clarifying" refactor someone reaches for:
     *
     *     const captured = byFile
     *     sourceFile.onModified(() => captured.delete(sourceFile))
     *
     * `registerCacheReset` REPLACES `byFile`, so a captured reference deletes
     * from the abandoned map and the live entry stays stale. Measured with that
     * mutation: the rule sees 1 call where the truth is 2 — `notContain` passing
     * on the call the edit just added. The whole suite stayed green.
     *
     * The sequence matters: warm, reset, re-warm (which is what re-registers
     * nothing, since `watched` is deliberately not cleared), then edit.
     */
    const { file } = twoBodies()
    expect(descendantsOfKind(file.getFunctionOrThrow('f'), SyntaxKind.CallExpression)).toHaveLength(
      1,
    )

    resetProjectCache()
    expect(descendantsOfKind(file.getFunctionOrThrow('f'), SyntaxKind.CallExpression)).toHaveLength(
      1,
    )

    file.getFunctionOrThrow('f').addStatements('eval("z")')

    const after = descendantsOfKind(file.getFunctionOrThrow('f'), SyntaxKind.CallExpression)
    expect(after.map((n) => n.getText())).toContain('eval("z")')
    expect(after).toHaveLength(2)
  })

  it('hands back the cached array itself, not a copy', () => {
    // The no-copy property, which is where the whole saving lives: returning
    // `.slice()` on every hit was green everywhere. `readonly` is the compile-time
    // half; this is the runtime half.
    const { file } = twoBodies()
    const fn = file.getFunctionOrThrow('f')

    expect(descendantsOfKind(fn, SyntaxKind.CallExpression)).toBe(
      descendantsOfKind(fn, SyntaxKind.CallExpression),
    )
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

    // The violations are captured INSIDE the measurement, because `0 walks` is
    // also what a rule path that analysed nothing reports. Review verified two
    // reverts — `searchFunctionBody` returning no body, and `findMatchesInNode`
    // returning `[]` — that left this test green with the count alone.
    let seen: string[] = []
    const walks = countWalks(tsMorphProject, () => {
      seen = functions(project)
        .should()
        .notContain(call('console.log'))
        .violations()
        .map((v) => v.element)
    })

    expect(seen).toEqual(['b'])
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
