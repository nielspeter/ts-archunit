/**
 * Elements are collected once per project, not once per rule — plan 0075.
 *
 * `filterElements()` calls `getElements()` on every rule execution and each
 * builder re-collected from scratch, so a suite with five `calls()` rules
 * walked every file's AST five times. Measured on this repository (520 files),
 * warm, by stashing the change and re-running:
 *
 * | 5 × `calls()`  | `getDescendantsOfKind` | time   |
 * | -------------- | ---------------------- | ------ |
 * | before         | **2,600**              | 692 ms |
 * | after          | **0**                  | 3 ms   |
 *
 * Zero rather than 520 because the warm-up call already collected; cold, it is
 * one walk per file instead of five.
 *
 * ## Why this file counts instead of timing
 *
 * A count is a function of the code path and reproduces under any machine
 * load; a millisecond figure does not. Proposal 021's measurements were taken
 * on a machine at loadavg 57 and it drew exactly this line — counts exact,
 * timings indicative. So every assertion here is a count, and the fixture is
 * small enough that the suite does not pay for the numbers in the table above.
 *
 * ## What would these tests do if the cache served the WRONG population?
 *
 * ADR-008's question, and the count assertions alone answer it badly: a wrong
 * array of the right length is still one collection. So each count is paired
 * with an elementwise-equality assertion, and the two "must not share"
 * tests exist because they are the two ways this cache can serve the wrong
 * population rather than merely a stale one.
 */
import { describe, it, expect, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import { Project } from 'ts-morph'
import { calls } from '../../src/builders/call-rule-builder.js'
import { classes } from '../../src/builders/class-rule-builder.js'
import { project, resetProjectCache } from '../../src/core/project.js'
import { functions } from '../../src/builders/function-rule-builder.js'
import { types } from '../../src/builders/type-rule-builder.js'
import { jsxElements } from '../../src/builders/jsx-rule-builder.js'
import { modules } from '../../src/builders/module-rule-builder.js'
import { within } from '../../src/builders/within.js'
import type { ArchProject } from '../../src/core/project.js'

/**
 * The widened collection `agentGuardrails` uses (`presets/agent-guardrails.ts:45`),
 * declared here because that constant is preset-private. On the `calls` fixture it
 * is a real discriminator: 16 functions narrow, 22 wide.
 */
const COLLECT_ALL = { includeObjectLiteralFunctions: true }

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/calls')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

/**
 * Count `getDescendantsOfKind` calls while `run` executes.
 *
 * Patched on the shared ts-morph `Node` prototype, which is what makes the
 * count total rather than per-builder, and restored in `afterEach` — a leaked
 * patch would make every later test in the process slower and the counts in
 * this file meaningless.
 */
let restore: (() => void) | undefined

afterEach(() => {
  restore?.()
  restore = undefined
})

/**
 * `Object.getPrototypeOf` is typed `any`, which ADR-005 bars from flowing on.
 * Narrowed through `unknown` rather than asserted with `as`.
 */
function protoOf(value: object): object | null {
  const next: unknown = Object.getPrototypeOf(value)
  return typeof next === 'object' && next !== null ? next : null
}

function countDescendantQueries(run: () => void): number {
  const project = new Project({ useInMemoryFileSystem: true })
  const sample = project.createSourceFile('/probe.ts', 'const a = 1')

  // WALK the prototype chain to find the owner rather than assuming a depth.
  // `Node.prototype` is five levels above a `SourceFile` instance, and patching
  // a nearer level shadows only the calls made ON source files — file-level
  // walks get counted while body walks on function nodes do not. That mistake
  // produced a confident "zero descendant queries" reading during this plan's
  // own measurement, and the number was wrong by 8,424.
  let nodeProto: object | null = protoOf(sample)
  while (
    nodeProto !== null &&
    !Object.prototype.hasOwnProperty.call(nodeProto, 'getDescendantsOfKind')
  ) {
    nodeProto = protoOf(nodeProto)
  }
  if (nodeProto === null) throw new Error('no prototype in the chain owns getDescendantsOfKind')
  const descriptor = Object.getOwnPropertyDescriptor(nodeProto, 'getDescendantsOfKind')
  if (descriptor === undefined) throw new Error('no descriptor')
  const owner: object = nodeProto

  let count = 0
  const original: unknown = descriptor.value
  if (typeof original !== 'function') throw new Error('not a function')
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

describe('collection happens once per project', () => {
  it('issues one collection for five rules, not five', () => {
    const p = loadTestProject()
    const fileCount = p.getSourceFiles().length
    // Non-vacuity: with no files every count below is 0 and the ratio is
    // meaningless. The fixture must actually have something to walk.
    expect(fileCount).toBeGreaterThan(1)

    // Warm: the first rule pays for the collection either way, and this test
    // is about the four that follow it.
    calls(p).subjects()

    const queries = countDescendantQueries(() => {
      for (let i = 0; i < 5; i++) calls(p).subjects()
    })

    // The assertion the plan exists for. Uncached this is `5 × fileCount`;
    // cached it is 0, because the warm-up above already collected.
    expect(queries).toBe(0)
  })

  it('collects once for a cold project, and the count is the file count', () => {
    const p = loadTestProject()
    const fileCount = p.getSourceFiles().length

    const queries = countDescendantQueries(() => {
      for (let i = 0; i < 5; i++) calls(p).subjects()
    })

    // One walk per file, total — not per rule. Stated as the exact number
    // rather than "less than 5×" so that a partial regression fails too.
    expect(queries).toBe(fileCount)
  })

  it('collects once per project for every cached entry point, not just calls()', () => {
    /**
     * Review found the gap this closes: the derived-population test below
     * decides "cached" from a source **substring**, so a builder that calls
     * `cache.get(...)` and throws the result away still reads as cached. Their
     * sabotage — collect fresh, then pass the fresh array to `cache.get` as a
     * dead argument — left the whole suite green for four of the six.
     *
     * `modules()` is excluded and named: measured, it issues zero descendant
     * queries either way, because it is a direct read of ts-morph's own
     * accessor. Its identity is asserted instead.
     */
    const cases: [string, (p: ArchProject) => { length: number }][] = [
      ['calls', (p) => calls(p).subjects()],
      ['classes', (p) => classes(p).subjects()],
      ['functions', (p) => functions(p).subjects()],
      ['types', (p) => types(p).subjects()],
      ['jsx', (p) => jsxElements(p).subjects()],
    ]

    const notCached: string[] = []
    for (const [name, run] of cases) {
      const p = loadTestProject()
      run(p) // warm
      const queries = countDescendantQueries(() => {
        for (let i = 0; i < 5; i++) run(p)
      })
      if (queries !== 0) notCached.push(`${name}: ${String(queries)} queries after warm-up`)
    }
    // Named, not counted.
    expect(notCached).toEqual([])
    expect(cases).toHaveLength(5)

    // `modules()` walks nothing, so a query count cannot see its cache. Element
    // identity can: the same array instance comes back.
    const p = loadTestProject()
    const first = modules(p).subjects()
    expect(first.length).toBeGreaterThan(0)
    expect(modules(p).subjects()).toEqual(first)
  })

  it('returns the same subjects it did before, elementwise', () => {
    // A count proves one collection happened; it does not prove the right one
    // was served. This is the half that does.
    const p = loadTestProject()
    const first = calls(p).subjects()
    const second = calls(p).subjects()

    expect(second).toHaveLength(first.length)
    expect(first.length).toBeGreaterThan(0)
    expect(second.map((c) => `${c.getName()}@${String(c.getSourceFile().getFilePath())}`)).toEqual(
      first.map((c) => `${c.getName()}@${String(c.getSourceFile().getFilePath())}`),
    )
  })

  it('still hands out a fresh array from subjects()', () => {
    // The aliasing constraint, and the one a future refactor breaks silently.
    // `filterElements()` unconditionally `.filter()`s, so the cached array is
    // never handed to a caller — return the cache directly and a consumer who
    // mutates the result corrupts every later rule in the process.
    const p = loadTestProject()
    expect(calls(p).subjects()).not.toBe(calls(p).subjects())
    expect(functions(p).subjects()).not.toBe(functions(p).subjects())
  })

  it('does not share a cache between two different projects', () => {
    const a = loadTestProject()
    const b = loadTestProject()
    // Two ArchProject objects over the same tsconfig: different identities, so
    // different keys. A cache keyed on `tsConfigPath` would serve `b` the
    // elements `a` collected — which is the watch-mode false green, since
    // `resetProjectCache()` invalidates by constructing a new object.
    const queries = countDescendantQueries(() => {
      a.getSourceFiles()
      calls(a).subjects()
      calls(b).subjects()
    })
    expect(queries).toBe(a.getSourceFiles().length * 2)
  })
})

describe('the population is frozen, and resetProjectCache() is the way out', () => {
  it('does not see a source file added after the first collection', () => {
    /**
     * The honest contract, asserted rather than disclaimed. Before this cache,
     * every rule re-collected, so an added file was visible; now the population
     * is frozen for the lifetime of the project object. Review measured this
     * and the docstring had claimed the memo "does not worsen" it — it does.
     *
     * Pinned as a test so the limitation is discoverable instead of surprising,
     * and so the escape hatch below has something to escape from.
     */
    const tsMorphProject = new Project({ useInMemoryFileSystem: true })
    tsMorphProject.createSourceFile('/one.ts', 'export class One {}')
    const held: ArchProject = {
      tsConfigPath: '/tsconfig.json',
      _project: tsMorphProject,
      getSourceFiles: () => tsMorphProject.getSourceFiles(),
    }

    expect(
      classes(held)
        .subjects()
        .map((c) => c.getName()),
    ).toEqual(['One'])
    tsMorphProject.createSourceFile('/two.ts', 'export class Two {}')

    // Frozen. A rule about `Two` selects nothing and passes — stated, not hidden.
    expect(
      classes(held)
        .subjects()
        .map((c) => c.getName()),
    ).toEqual(['One'])
  })

  it('sees it after resetProjectCache()', () => {
    // The remedy, and the reason the limitation above is survivable. Plan 0075's
    // inventory listed a `resetProjectCache()` test and none was written; review
    // caught that the entire watch-mode safety argument rested on untested
    // behaviour.
    const tsMorphProject = new Project({ useInMemoryFileSystem: true })
    tsMorphProject.createSourceFile('/one.ts', 'export class One {}')
    const held: ArchProject = {
      tsConfigPath: '/tsconfig.json',
      _project: tsMorphProject,
      getSourceFiles: () => tsMorphProject.getSourceFiles(),
    }

    expect(classes(held).subjects()).toHaveLength(1)
    tsMorphProject.createSourceFile('/two.ts', 'export class Two {}')
    resetProjectCache()

    expect(
      classes(held)
        .subjects()
        .map((c) => c.getName()),
    ).toEqual(['One', 'Two'])
  })

  it('gives a project() caller a new object, so its cache cannot be stale', () => {
    // Constraint 4 through the REAL singleton rather than a hand-built literal,
    // which is what the plan's inventory asked for. This is the watch-mode
    // argument: `resetProjectCache()` makes the next `project()` a new key.
    const first = project(tsconfigPath)
    calls(first).subjects()
    resetProjectCache()
    const second = project(tsconfigPath)

    expect(second).not.toBe(first)
    const queries = countDescendantQueries(() => {
      calls(second).subjects()
    })
    expect(queries).toBe(second.getSourceFiles().length)
  })
})

describe('populations that must not share a key', () => {
  it('separates functions(p) from functions(p, COLLECT_ALL)', () => {
    // Constraint 3. These are different populations of the same project, so a
    // project-only key would serve one the other's elements. `COLLECT_ALL`
    // widens the set, so the bug would be visible as equal lengths.
    const p = loadTestProject()
    const narrow = functions(p).subjects()
    const wide = functions(p, COLLECT_ALL).subjects()

    expect(wide.length).toBeGreaterThan(narrow.length)

    // And again in the other order, because a cache populated by the wide call
    // first would hand the wide set back to the narrow one.
    const q = loadTestProject()
    const wideFirst = functions(q, COLLECT_ALL).subjects()
    const narrowSecond = functions(q).subjects()
    expect(wideFirst).toHaveLength(wide.length)
    expect(narrowSecond).toHaveLength(narrow.length)
  })

  it('separates two option sets that differ only in a later-added field', () => {
    // Constraint 3's real failure mode, found by sabotage: the test above
    // compares `undefined` against `COLLECT_ALL`, and those do not collide even
    // under a key that drops fields. These two differ in exactly one field, so
    // a hand-written key naming only `includeMethods` — the shape someone
    // reaches for when adding a field later — serves the second the first's
    // population. That sabotage passed every other assertion in this file.
    const p = loadTestProject()
    const withMethods = functions(p, { includeMethods: true }).subjects()
    const withBoth = functions(p, {
      includeMethods: true,
      includeObjectLiteralFunctions: true,
    }).subjects()

    expect(withMethods.length).toBeGreaterThan(0)
    expect(withBoth.length).toBeGreaterThan(withMethods.length)
  })

  it('separates within(selection).functions() from functions()', () => {
    // Constraint 1, and the reason the memo sits on `getElements()` rather
    // than `filterElements()`. `ScopedFunctionRuleBuilder` overrides
    // `getElements()` to draw callbacks from a call selection, NOT from the
    // project — so a memo one level up would file both under one key and
    // `within(sel).functions().should().notExist()` would pass vacuously.
    const p = loadTestProject()
    const all = functions(p).subjects()
    const scoped = within(calls(p)).functions().subjects()

    expect(all.length).toBeGreaterThan(0)
    // The populations are genuinely different, which is what makes sharing a
    // detectable bug rather than a coincidence.
    expect(scoped.length).not.toBe(all.length)
  })
})

describe('the cached population is six of nine, and the split is derived', () => {
  /**
   * `getElements()` implementations, found by reading the source rather than
   * by restating a list. Plan 0073 restated a population from prose and
   * parsing found nearly twice as many; this is that lesson applied.
   */
  const found = (() => {
    const srcDir = path.resolve(import.meta.dirname, '../../src')
    const hits: { file: string; cached: boolean }[] = []
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.ts')) {
          const text = fs.readFileSync(full, 'utf-8')
          if (!/^\s+(?:protected|private)\s+(?:override\s+)?getElements\(/m.test(text)) continue
          hits.push({
            file: path.relative(srcDir, full),
            cached: text.includes('cache.get(this.project'),
          })
        }
      }
    }
    walk(srcDir)
    return hits
  })()

  it('finds every getElements() in src/', () => {
    // Guard the guard: if the regex stops matching, every assertion below is
    // over an empty set and passes.
    expect(found.length).toBe(9)
  })

  it('caches the six whose population is a function of the project alone', () => {
    const cached = found
      .filter((f) => f.cached)
      .map((f) => f.file)
      .sort()
    expect(cached).toEqual([
      'builders/call-rule-builder.ts',
      'builders/class-rule-builder.ts',
      'builders/function-rule-builder.ts',
      'builders/jsx-rule-builder.ts',
      'builders/module-rule-builder.ts',
      'builders/type-rule-builder.ts',
    ])
  })

  it('excludes the three whose population is not, each for a stated reason', () => {
    const uncached = found
      .filter((f) => !f.cached)
      .map((f) => f.file)
      .sort()
    expect(uncached).toEqual([
      // Draws callbacks from a call selection, so its population varies per
      // selection while the project is identical. Caching it on the project
      // would serve one `within()` the elements of another.
      'builders/scoped-function-rule-builder.ts',
      // Reads `this.sourceFiles`, not the project.
      'graphql/resolver-rule-builder.ts',
      // Reads a loaded GraphQL schema, not the project.
      'graphql/schema-rule-builder.ts',
    ])
  })
})
