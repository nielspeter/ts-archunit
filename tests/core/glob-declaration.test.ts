/**
 * Set identity for `globs()` (plan 0069 R2a).
 *
 * `globs()` is concrete with an empty default rather than abstract, because an
 * abstract member on `RuleBuilder`/`TerminalBuilder` — both public exports —
 * is a compile break for anyone who has subclassed them, and R2a is the
 * release people install in order to measure. The cost of that choice is that
 * the compiler can no longer enumerate builders that forgot to implement it.
 *
 * So a test does. Ask ADR-008's question of the guard: what would the rest of
 * the suite do if every `globs()` silently returned `[]`? Pass, and `doctor`
 * would report a clean bill of health for a project full of dead globs.
 */
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import * as rootExports from '../../src/index.js'
import * as graphqlExports from '../../src/graphql/index.js'
import { RuleBuilder } from '../../src/core/rule-builder.js'
import { TerminalBuilder } from '../../src/core/terminal-builder.js'
import { globSitesOf } from '../../src/core/glob-evaluator.js'
import { and, not, or } from '../../src/core/combinators.js'
import { resideInFolder } from '../../src/predicates/identity.js'
import type { Located } from '../../src/predicates/identity.js'
import type { Predicate } from '../../src/core/predicate.js'
import type { ArchProject } from '../../src/core/project.js'

/** Stands in for any predicate that matches on something other than a path. */
const globless: Predicate<Located> = {
  description: 'declares no globs',
  test: () => true,
}

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/modules')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

/**
 * Every builder class reachable from the two public entry points, classified.
 *
 * A builder that takes a glob and does not declare it is invisible to
 * `doctor`, which is the whole mechanism silently not working for that
 * builder. A builder that takes no glob is legitimately silent. The
 * difference cannot be derived, so it is written down — and the test below
 * fails when a new builder appears in neither list, which is what stops the
 * next builder from being added without anyone deciding.
 */
const DECLARES_GLOBS = [
  'CallRuleBuilder',
  'ClassRuleBuilder',
  'FunctionRuleBuilder',
  'JsxRuleBuilder',
  'ModuleRuleBuilder',
  'TypeRuleBuilder',
  'ScopedFunctionRuleBuilder',
  'SliceRuleBuilder',
  'ResolverRuleBuilder',
  'DuplicateBodiesBuilder',
  'InconsistentSiblingsBuilder',
]

const TAKES_NO_GLOB = [
  // Takes two selections, not paths.
  'CorrespondenceBuilder',
  // Asserts compiler options; there is no glob to be wrong about.
  'TsconfigBuilder',
  // `schema()` loads through `loadSchemaFromGlob`, which THROWS on zero
  // matches (src/graphql/schema-loader.ts). That is already the outcome this
  // plan wants, so there is nothing for a diagnosis to add.
  'SchemaRuleBuilder',
  // Abstract; its concrete subclasses are in the list above.
  'SmellBuilder',
  // The intermediate step of the crossLayer chain. It is the only one of the
  // two exported: PairFinalBuilder, which holds the layers and does declare
  // them, is reachable only through the chain, so it is covered
  // behaviourally below rather than by reflection.
  'CrossLayerBuilder',
]

describe('globs() reaches every builder', () => {
  const discovered = [...Object.entries(rootExports), ...Object.entries(graphqlExports)]
    .filter(
      ([, value]) =>
        typeof value === 'function' &&
        value !== TerminalBuilder &&
        (Object.prototype.isPrototypeOf.call(TerminalBuilder, value) ||
          value === RuleBuilder ||
          Object.prototype.isPrototypeOf.call(RuleBuilder, value)),
    )
    .map(([name]) => name)

  it('actually discovers the builders', () => {
    // Guard the guard. `[].filter(...)` is `[]`, so short-circuiting the
    // reflection to nothing left "every exported builder is classified"
    // green — the guard's own question, answered "pass".
    expect(discovered).toContain('ModuleRuleBuilder')
    expect(discovered).toContain('ResolverRuleBuilder')
    expect(discovered.length).toBeGreaterThanOrEqual(13)
  })

  it('every exported builder is classified', () => {
    // `src/index.ts` does not export SchemaRuleBuilder or ResolverRuleBuilder
    // — they live behind the `./graphql` subpath — so reflecting over the main
    // entry point alone would be green while ResolverRuleBuilder, the one
    // builder R2a modifies, inherited the empty default.
    const classified = new Set([...DECLARES_GLOBS, ...TAKES_NO_GLOB, 'RuleBuilder'])
    const unclassified = discovered.filter((name) => !classified.has(name))
    expect(unclassified).toEqual([])
  })

  it('every builder said to declare globs overrides the empty default', () => {
    const notOverridden = DECLARES_GLOBS.filter((name) => {
      const cls =
        (rootExports as Record<string, unknown>)[name] ??
        (graphqlExports as Record<string, unknown>)[name]
      if (typeof cls !== 'function') return true
      // Walk to the first prototype that defines globs(). If it is the root's,
      // this builder inherited the `return []` default and declares nothing.
      let proto: object | null = cls.prototype as object
      while (proto !== null && !Object.hasOwn(proto, 'globs')) {
        proto = Object.getPrototypeOf(proto) as object | null
      }
      return proto === TerminalBuilder.prototype
    })
    expect(notOverridden).toEqual([])
  })
})

describe('what each selector declares', () => {
  const p = loadProject()

  it('resideInFolder declares parent-dir, resideInFile declares file-path', () => {
    // The distinction that two revisions of the census got wrong. It is not
    // cosmetic: '**/src/predicates/module**' matches 1 file and 0 parent
    // directories, and reading it as file-path reports a vacuous rule as fine.
    const folder = rootExports.modules(p).that().resideInFolder('**/domain/**').globs()
    expect(folder.flatMap(globSitesOf).map((s) => s.kind)).toEqual(['parent-dir'])

    const file = rootExports.modules(p).that().resideInFile('**/order.ts').globs()
    expect(file.flatMap(globSitesOf).map((s) => s.kind)).toEqual(['file-path'])
  })

  it('carries the exact glob string through to the site', () => {
    const sites = rootExports
      .modules(p)
      .that()
      .resideInFolder('**/a-very-specific-folder/**')
      .globs()
      .flatMap(globSitesOf)
    expect(sites.map((s) => s.glob)).toEqual(['**/a-very-specific-folder/**'])
  })

  it('stamps position from the phase, not from the declaration', () => {
    const rule = rootExports
      .modules(p)
      .that()
      .resideInFolder('**/domain/**')
      .should()
      .satisfy({
        description: 'a condition with a glob',
        globs: { op: 'any', children: [{ glob: '**/shared/**', kind: 'parent-dir' }] },
        evaluate: () => [],
      })
    const sites = rule.globs().flatMap(globSitesOf)
    expect(sites.map((s) => [s.glob, s.position])).toEqual([
      ['**/domain/**', 'selector'],
      ['**/shared/**', 'condition'],
    ])
  })

  it('an import glob is declared but is not a path kind', () => {
    const sites = rootExports
      .modules(p)
      .that()
      .importFrom('fastify', '**/legacy/**')
      .globs()
      .flatMap(globSitesOf)
    expect(sites.map((s) => s.kind)).toEqual(['import-target', 'import-target'])
  })
})

describe('builders reached only through a chain', () => {
  const p = loadProject()

  it('crossLayer declares one tree per layer, not one for all of them', () => {
    // Per layer, because a dead glob means THAT layer is empty and every pair
    // involving it is unchecked. One `any` node over all layers would report a
    // fault only when every layer was empty — a false green.
    const rule = rootExports
      .crossLayer(p)
      .layer('routes', '**/routes/**')
      .layer('schemas', '**/schemas/**')
      .mapping(() => true)
      .forEachPair()
      .should(
        rootExports.haveMatchingCounterpart([
          { name: 'routes', pattern: '**/routes/**', files: [] },
          { name: 'schemas', pattern: '**/schemas/**', files: [] },
        ]),
      )
    const trees = rule.globs()
    expect(trees).toHaveLength(2)
    expect(trees.flatMap(globSitesOf).map((site) => site.glob)).toEqual([
      '**/routes/**',
      '**/schemas/**',
    ])
    expect(trees.flatMap(globSitesOf).map((site) => site.position)).toEqual([
      'discovery',
      'discovery',
    ])
  })

  it('slices().matching() declares the glob the MATCHER receives, not the one written', () => {
    // `parseMatchingGlob` strips './' and '**/', normalises a trailing slash
    // and appends '*/**', so the author's spelling is never handed to
    // picomatch. Declaring it made every nested-layout rule report dead. The
    // rewritten glob is the declaration; the spelling survives in `origin`,
    // which is what the reader has to go and edit.
    const sites = rootExports.slices(p).matching('src/features/*').globs().flatMap(globSitesOf)
    expect(sites.map((site) => site.glob)).toEqual(['**/src/features/**/**'])
    expect(sites.map((site) => site.origin)).toEqual(['matching("src/features/*")'])
  })

  it('every equivalent matching() spelling declares the SAME glob', () => {
    // The four spellings `parseMatchingGlob` documents as equivalent must
    // reach the diagnosis as one string, or the two that are syntactically
    // odd — unanchored, and './'-prefixed — get reported as faults on a
    // working rule.
    const declared = ['src/features/*', 'src/features/*/', './src/features/*', '**/src/features/*']
      .map((glob) => rootExports.slices(p).matching(glob).globs().flatMap(globSitesOf))
      .map((sites) => sites.map((site) => site.glob))
    // The VALUE, not just that the four agree. `new Set(...).size === 1` is
    // satisfied by four *empty* results too, so in isolation this row passed on
    // the glob machinery returning nothing at all. It was guarded only by its
    // neighbour above pinning one spelling — real, but a guard that lives in
    // another assertion is one edit from gone.
    expect(declared).toEqual(Array<string[]>(4).fill(['**/src/features/**/**']))
  })

  it('slices().assignedFrom() declares one tree per named slice', () => {
    const trees = rootExports
      .slices(p)
      .assignedFrom({ domain: '**/domain/**', infra: '**/infra/**' })
      .globs()
    expect(trees).toHaveLength(2)
    expect(trees.flatMap(globSitesOf).map((site) => site.origin)).toEqual([
      'assignedFrom({ domain: "**/domain/**" })',
      'assignedFrom({ infra: "**/infra/**" })',
    ])
  })

  it('resolvers(p, glob) carries its glob into the declaration', () => {
    // `resolvers()` filters eagerly and hands the builder only the surviving
    // files, so without the threaded glob no `globs()` could ever report
    // `resolvers(p, 'src/reslvers/**')`. Deleting the argument at the call
    // site left the whole suite green: the reflection test proves the
    // prototype owns a `globs`, not that it ever returns anything.
    const sites = graphqlExports.resolvers(p, 'src/reslvers/**').globs().flatMap(globSitesOf)
    expect(sites.map((site) => site.glob)).toEqual(['src/reslvers/**'])
    expect(sites.map((site) => site.position)).toEqual(['discovery'])
  })

  it('a smell detector declares inFolder as file-path and ignorePaths as exclusion', () => {
    const sites = rootExports.smells
      .duplicateBodies(p)
      .inFolder('**/services/**')
      .ignorePaths('**/generated/**')
      .globs()
      .flatMap(globSitesOf)
    // `inFolder` is file-path despite the name — it matches the whole path.
    expect(sites.map((site) => [site.kind, site.position])).toEqual([
      ['file-path', 'discovery'],
      ['file-path', 'exclusion'],
    ])
  })

  it("within(selection).functions() carries the selection's globs too", () => {
    // The subjects come from the call selection, so a dead glob there empties
    // this rule just as surely as one written on the rule itself.
    const scoped = rootExports
      .within(rootExports.calls(p).that().withStringArg(0, '/api/**'))
      .functions()
      .that()
      .resideInFolder('**/domain/**')
    const sites = scoped.globs().flatMap(globSitesOf)
    expect(sites.map((site) => site.glob)).toEqual(['/api/**', '**/domain/**'])
  })
})

describe('combinator propagation', () => {
  it('and() is all, or() is any', () => {
    const conjunction = and(resideInFolder('**/a/**'), resideInFolder('**/b/**'))
    expect(conjunction.globs?.op).toBe('all')
    const disjunction = or(resideInFolder('**/a/**'), resideInFolder('**/b/**'))
    expect(disjunction.globs?.op).toBe('any')
  })

  it('not() inverts op as well as polarity', () => {
    const negated = not(and(resideInFolder('**/a/**'), resideInFolder('**/b/**')))
    expect(negated.globs?.op).toBe('any')
    const sites = negated.globs ? globSitesOf(stamp(negated.globs)) : []
    expect(sites.map((s) => s.polarity)).toEqual(['negative', 'negative'])
  })

  it('keeps a globless input as a retained child rather than dropping it', () => {
    // The shape that reds a working rule if the child is dropped:
    // or(deadGlob, byName) is dead only if BOTH are, and `areExported()`
    // declares no globs at all.
    const disjunction = or(resideInFolder<Located>('**/nowhere/**'), globless)
    expect(disjunction.globs?.children).toHaveLength(2)
    expect(disjunction.globs?.children.filter((c) => 'opaque' in c)).toHaveLength(1)
  })
})

/** Stamp a declared tree so its sites can be inspected. */
function stamp(declared: NonNullable<ReturnType<typeof resideInFolder>['globs']>) {
  return rootExports.stampGlobs(declared, 'selector', (g) => g.glob)
}
