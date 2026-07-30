/**
 * Every condition that takes a path glob declares it — plan 0073.
 *
 * `Condition.globs` (`src/core/condition.ts:63`) and the gathering that stamps
 * `position: 'condition'` (`src/core/rule-builder.ts:183-186`) both shipped in
 * 0069 R2a. **No condition populated the field**, so 0069's decision table
 * reasoned about `condition` rows that no site ever occupied, and a
 * `notImportFrom` rule exposed 0 glob trees.
 *
 * ## The population is 12, not the 7 the plan wrote
 *
 * Derived by parsing rather than by reading the plan, which is the difference
 * that mattered:
 *
 *     exported Condition-returning fns with a string-ish param      31
 *       of which a param is named `glob` / `globs`                  12
 *         declared directly in src/conditions/                       9
 *         aliases in src/rules/ that delegate to those               3
 *
 * The plan's table listed seven and missed `structural.ts`'s `resideInFile` /
 * `resideInFolder` — the **generic element** twins, exported publicly as
 * `conditionResideInFile` / `conditionResideInFolder` (`src/index.ts:81-82`) and
 * used by the class, module and type builders. They were the more reachable half
 * of the hole. `function.ts`'s pair is the `ArchFunction` version and is
 * internal, reached through `FunctionRuleBuilder`.
 *
 * ## Why this file does not assert on `explain`
 *
 * The plan's fourth guard was *"assert a `notImportFrom` rule's `explain` output
 * names the forbidden path"*, on the stated ground that a reader of `explain`
 * cannot see which paths a rule forbids. **Measured, that ground is false.**
 * `explain` renders `describeRule()`, and with every declaration in this file
 * reverted it still emits:
 *
 *     Do NOT import from "**\/legacy/**" (in code that reside in folder …)
 *
 * because the glob is interpolated into the condition's `description` string and
 * always was. So an `explain` assertion would pass with the whole change gone —
 * ADR-008's question answered "pass". The real consumers of `globs()` are
 * `doctor` and `diagnose()`, and the guard is that the tree arrives there. The
 * discriminator is asserted below rather than left as a comment, so nobody
 * re-adds the vacuous version.
 */
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import type { ClassDeclaration, SourceFile } from 'ts-morph'
import {
  onlyImportFrom,
  notImportFrom,
  dependOn,
  onlyHaveTypeImportsFrom,
} from '../../src/conditions/dependency.js'
import { onlyBeImportedVia } from '../../src/conditions/reverse-dependency.js'
// Namespace imports, because `resideInFile` and `resideInFolder` are exported
// under those names by BOTH modules — the `ArchFunction` version and the generic
// element version. `quality/no-aliased-imports` caught the aliased form and its
// remedy is "fix the export if the name conflicts"; the conflict here is real and
// intended, so naming the module at the call site is the honest resolution.
import * as functionConditions from '../../src/conditions/function.js'
import * as elementConditions from '../../src/conditions/structural.js'
import { onlyDependOn, mustNotDependOn, typeOnlyFrom } from '../../src/rules/dependencies.js'
import { mustNotEndWith } from '../../src/rules/naming.js'
import { shouldExtend, shouldImplement, shouldHaveMethodNamed } from '../../src/conditions/class.js'
import { havePropertyNamed, notHavePropertyNamed } from '../../src/conditions/members.js'
import { haveAttribute } from '../../src/conditions/jsx.js'
import { modules } from '../../src/index.js'
import { diagnose } from '../../src/core/diagnose.js'
import { isGlobNode, isOpaqueGlob } from '../../src/core/glob-site.js'
import { globSitesOf } from '../../src/core/glob-evaluator.js'
import type { DeclaredGlob, DeclaredGlobs, GlobKind } from '../../src/core/glob-site.js'
import type { Condition } from '../../src/core/condition.js'
import type { ArchProject } from '../../src/core/project.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/modules')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

/**
 * A real tsconfig-backed project, because `diagnose()` builds a `PathUniverse`
 * from `project.tsConfigPath`. An in-memory ts-morph `Project` is not an
 * `ArchProject` and does not typecheck at `modules()`, so there is no supported
 * way to reach the diagnosis machinery without one.
 */
function loadProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

/** The declared leaves of a condition's own tree, before any builder stamps it. */
function declaredLeaves(tree: DeclaredGlobs): DeclaredGlob[] {
  const leaves: DeclaredGlob[] = []
  const walk = (current: DeclaredGlobs): void => {
    for (const child of current.children) {
      if (isGlobNode(child)) walk(child)
      else if (!isOpaqueGlob(child)) leaves.push(child)
    }
  }
  walk(tree)
  return leaves
}

const G = '**/legacy/**'

/**
 * Every condition that takes a path glob, with the kind its glob is matched
 * against and how to build one.
 *
 * `id` is `<path-under-src>::<exported name>` so it can be compared against a
 * set derived from the source by parsing — the two must agree, which is what
 * makes a condition added later fail rather than pass unnoticed.
 */
const DECLARED: readonly {
  id: string
  kind: GlobKind
  make: () => Condition<never> | Condition<SourceFile>
}[] = [
  // The variadic import family. `import-target`, because the glob is matched
  // against `candidatesFor(edge)` — a resolved path *or* a bare specifier.
  {
    id: 'conditions/dependency.ts::onlyImportFrom',
    kind: 'import-target',
    make: () => onlyImportFrom(G),
  },
  {
    id: 'conditions/dependency.ts::notImportFrom',
    kind: 'import-target',
    make: () => notImportFrom(G),
  },
  { id: 'conditions/dependency.ts::dependOn', kind: 'import-target', make: () => dependOn(G) },
  {
    id: 'conditions/dependency.ts::onlyHaveTypeImportsFrom',
    kind: 'import-target',
    make: () => onlyHaveTypeImportsFrom(G),
  },
  // The row to get right: the glob names the files ALLOWED TO IMPORT the
  // subject, matched against an importer's own path.
  {
    id: 'conditions/reverse-dependency.ts::onlyBeImportedVia',
    kind: 'file-path',
    make: () => onlyBeImportedVia(G),
  },
  {
    id: 'conditions/function.ts::resideInFile',
    kind: 'file-path',
    make: () => functionConditions.resideInFile(G),
  },
  {
    id: 'conditions/function.ts::resideInFolder',
    kind: 'parent-dir',
    make: () => functionConditions.resideInFolder(G),
  },
  {
    id: 'conditions/structural.ts::resideInFile',
    kind: 'file-path',
    make: () => elementConditions.resideInFile(G),
  },
  {
    id: 'conditions/structural.ts::resideInFolder',
    kind: 'parent-dir',
    make: () => elementConditions.resideInFolder(G),
  },
  // Aliases in the standard-rules layer. They are `return notImportFrom(...globs)`,
  // so they inherit the declaration — asserted, because a future refactor that
  // reimplements one inline would silently stop declaring.
  { id: 'rules/dependencies.ts::onlyDependOn', kind: 'import-target', make: () => onlyDependOn(G) },
  {
    id: 'rules/dependencies.ts::mustNotDependOn',
    kind: 'import-target',
    make: () => mustNotDependOn(G),
  },
  { id: 'rules/dependencies.ts::typeOnlyFrom', kind: 'import-target', make: () => typeOnlyFrom(G) },
]

describe('conditions declare their globs', () => {
  it('populates globs on every condition that takes one, with the right kind', () => {
    const missing: string[] = []
    const wrongKind: string[] = []
    for (const entry of DECLARED) {
      const declared: DeclaredGlobs | undefined = entry.make().globs
      if (declared === undefined) {
        missing.push(entry.id)
        continue
      }
      const leaves = declaredLeaves(declared)
      if (leaves.length !== 1 || leaves[0]?.glob !== G) {
        missing.push(`${entry.id} (declared ${String(leaves.length)} leaves)`)
        continue
      }
      if (leaves[0]?.kind !== entry.kind) {
        wrongKind.push(`${entry.id}: expected ${entry.kind}, got ${String(leaves[0]?.kind)}`)
      }
    }
    // Named, not counted — ADR-008 rule 4. Dropping any one declaration names
    // that condition here rather than moving a total from 12 to 11.
    expect(missing).toEqual([])
    expect(wrongKind).toEqual([])
  })

  it('declares a set, not a single glob, for the variadic family', () => {
    // `op: 'any'`, and it is load-bearing: `importFrom(...globs)` is
    // `matchers.some`, so the set is dead only when EVERY glob in it is. An
    // `all` node here reads a set with one live glob as dead — the 0.18.1
    // withdrawal in the other direction (`glob-site.ts:185`).
    const tree = notImportFrom('**/legacy/**', '**/vendor/**').globs
    expect(tree?.op).toBe('any')
    expect(declaredLeaves(tree ?? { op: 'any', children: [] }).map((l) => l.glob)).toEqual([
      '**/legacy/**',
      '**/vendor/**',
    ])
  })

  it('does not hand a path-universe kind to the import family, or withhold one from onlyBeImportedVia', () => {
    // The single most consequential row, stated as its own assertion because
    // getting it wrong fails in the direction that looks fine. `import-target`
    // deliberately has no path-universe views (`path-universe.ts:72`) because a
    // bare specifier legitimately matches no project path — bug 0014. So
    // declaring `onlyBeImportedVia` as `import-target` would hand a genuinely
    // checkable path glob to machinery that cannot check it, silently.
    const importerPath = declaredLeaves(onlyBeImportedVia(G).globs ?? { op: 'any', children: [] })
    expect(importerPath.map((l) => l.kind)).toEqual(['file-path'])

    const importTarget = declaredLeaves(notImportFrom(G).globs ?? { op: 'any', children: [] })
    expect(importTarget.map((l) => l.kind)).toEqual(['import-target'])
  })

  it('leaves conditions that take a name rather than a path undeclared', () => {
    // The discriminator for the whole change. `shouldExtend('BaseService')` and
    // `havePropertyNamed('id')` take strings that are NOT paths, and declaring
    // them would feed identifiers to the path universe as if they were globs —
    // every one of them unsatisfiable, every one a false finding once R3b
    // flips. Without this, "declare globs on everything with a string param"
    // satisfies every other assertion in this file.
    const notPaths: [string, Condition<never> | Condition<ClassDeclaration>][] = [
      ['shouldExtend', shouldExtend('BaseService')],
      ['shouldImplement', shouldImplement('Repository')],
      ['shouldHaveMethodNamed', shouldHaveMethodNamed('save')],
      ['havePropertyNamed', havePropertyNamed('id')],
      ['notHavePropertyNamed', notHavePropertyNamed('secret')],
      ['haveAttribute', haveAttribute('key')],
      ['mustNotEndWith', mustNotEndWith('Impl')],
    ]
    const wronglyDeclared = notPaths
      .filter(([, condition]) => condition.globs !== undefined)
      .map(([name]) => name)
    expect(wronglyDeclared).toEqual([])
    // Non-vacuity: `[].filter(...)` is `[]`, so an empty list here would make
    // the assertion above green while testing nothing. This is the exact shape
    // the first draft of this test shipped as, and it is worth naming.
    expect(notPaths).toHaveLength(7)
  })
})

/**
 * Conditions that take a string which is **not** a path, with the reason.
 *
 * The list exists so that a condition added later lands in neither list and
 * fails the classification test below, rather than joining `Condition.globs`'s
 * three-release history of being declared and never populated.
 */
const TAKES_NO_PATH_GLOB: readonly string[] = [
  // Property and argument names.
  'conditions/call.ts::haveArgumentWithProperty',
  'conditions/call.ts::notHaveArgumentWithProperty',
  'conditions/members.ts::havePropertyNamed',
  'conditions/members.ts::notHavePropertyNamed',
  'conditions/type-level.ts::havePropertyType',
  // Type and member names.
  'conditions/class.ts::shouldExtend',
  'conditions/class.ts::shouldImplement',
  'conditions/class.ts::shouldHaveMethodNamed',
  // JSX attribute names and values.
  'conditions/jsx.ts::haveAttribute',
  'conditions/jsx.ts::notHaveAttribute',
  'conditions/jsx.ts::haveAttributeMatching',
  'conditions/jsx.ts::notHaveAttributeMatching',
  // Slice NAMES, resolved from the discovery glob before these ever see them.
  // The glob that produced the slices is declared at the discovery site, which
  // is where a diagnosis can act on it.
  'conditions/slice.ts::respectLayerOrder',
  'conditions/slice.ts::notDependOn',
  // GraphQL field and argument names.
  'graphql/schema-conditions.ts::haveFields',
  'graphql/schema-conditions.ts::acceptArgs',
  // A name suffix, not a path.
  'rules/naming.ts::mustNotEndWith',
  // The two factories. Their `string` is a description, and any globs belong to
  // the caller's condition, which declares them itself — `elementCondition` now
  // takes them as an optional parameter for exactly that.
  'conditions/helpers.ts::elementCondition',
  'core/define.ts::defineCondition',
]

/**
 * The population, derived from the source rather than restated.
 *
 * A hard-coded table of twelve is green forever once a thirteenth condition
 * appears — which is precisely how this hole opened, since `Condition.globs` was
 * added in R2a and populated by nobody for three releases. So the table above is
 * checked against two independent derivations from the source, and all three
 * must agree.
 */
describe('the population is derived, not restated', () => {
  const STRINGISH = new Set(['string', 'string[]', 'readonly string[]'])
  const project = new Project({
    tsConfigFilePath: path.resolve(import.meta.dirname, '../../tsconfig.json'),
  })

  const candidates: string[] = []
  const globNamed: string[] = []
  for (const sourceFile of project.getSourceFiles('src/**/*.ts')) {
    for (const fn of sourceFile.getFunctions()) {
      if (!fn.isExported()) continue
      // Overloads included, and that is not a detail: `onlyImportFrom`'s
      // implementation signature is `(...args: [string[], ImportOptions] |
      // string[])`, whose text is neither `string` nor `string[]`. A derivation
      // that read implementation signatures alone missed three of the four
      // dependency conditions — measured, on the first version of this walk.
      const signatures = [fn, ...fn.getOverloads()]
      const returnsCondition = signatures.some((s) =>
        (s.getReturnTypeNode()?.getText() ?? '').startsWith('Condition<'),
      )
      if (!returnsCondition) continue
      const stringish = signatures
        .flatMap((s) => s.getParameters())
        .filter((p) => STRINGISH.has(p.getTypeNode()?.getText() ?? ''))
      if (stringish.length === 0) continue
      const relative = sourceFile.getFilePath().split('/src/')[1] ?? ''
      const id = `${relative}::${fn.getName() ?? '<anonymous>'}`
      candidates.push(id)
      if (stringish.some((p) => p.getName() === 'glob' || p.getName() === 'globs')) {
        globNamed.push(id)
      }
    }
  }

  it('actually walks the conditions', () => {
    // Guard the guard. Every assertion below is over an empty set if the glob
    // fails to match or `getSourceFiles` returns nothing, and `[].filter(…)` is
    // `[]` — green, and testing nothing. Measured at 31 candidates, 12 named.
    expect(candidates.length).toBeGreaterThan(25)
    expect(globNamed.length).toBeGreaterThan(6)
    expect(candidates).toContain('conditions/dependency.ts::notImportFrom')
    // The one the plan's own table missed, so the walk that would have caught
    // it is pinned rather than assumed.
    expect(candidates).toContain('conditions/structural.ts::resideInFolder')
  })

  it('classifies every condition that takes a string', () => {
    const classified = new Set([...DECLARED.map((d) => d.id), ...TAKES_NO_PATH_GLOB])
    const unclassified = candidates.filter((id) => !classified.has(id))
    expect(unclassified).toEqual([])
  })

  it('agrees with a differently-derived population', () => {
    // ADR-008 rule 5: the table is unguarded until a value derived another way
    // disagrees with it. This derivation is by PARAMETER NAME — the codebase's
    // own convention, `glob` / `globs` — and is independent of the hand-written
    // table and of the no-path list. If someone adds a path condition whose
    // parameter is named `glob` and forgets the declaration, this reds; if they
    // name it something else, the classification test above reds instead.
    expect([...globNamed].sort()).toEqual([...DECLARED.map((d) => d.id)].sort())
  })

  it('does not classify the same condition both ways', () => {
    const declaredIds = new Set(DECLARED.map((d) => d.id))
    expect(TAKES_NO_PATH_GLOB.filter((id) => declaredIds.has(id))).toEqual([])
  })
})

describe('the declaration reaches the surfaces that consume it', () => {
  it('arrives at globs() stamped position: condition', () => {
    const p = loadProject()
    const rule = modules(p).that().resideInFolder('**/src/**').should().notImportFrom(G)

    const trees = rule.globs()
    // Two: the selector's `parent-dir` and the condition's `import-target`.
    // Before this plan it was ONE — the selector only — which is the entry in
    // 0073's consequences table and the measurement this assertion pins.
    expect(trees).toHaveLength(2)

    // `globSitesOf`, not the local `declaredLeaves`: it returns `GlobSite`, the
    // stamped type that carries `position` and `origin`. Walking the same tree as
    // `DeclaredGlob` would compile and then be unable to see the two fields this
    // assertion exists for.
    const sites = trees.flatMap((tree) => globSitesOf(tree))
    const condition = sites.filter((s) => s.position === 'condition')
    expect(condition.map((s) => s.glob)).toEqual([G])
    expect(condition.map((s) => s.kind)).toEqual(['import-target'])
    // Self-naming origin, so `doctor` prints which site the glob came from
    // rather than the glob alone.
    expect(condition.at(0)?.origin).toContain('not import from')
  })

  it('is not what makes the glob visible in a rule description', () => {
    // The anti-vacuity assertion, and the reason the plan's `explain` guard was
    // dropped: `describeRule()` interpolates the glob into the condition's
    // description string, so it names the forbidden path with or without this
    // plan. A test that asserted on `explain` would pass against a full revert.
    const p = loadProject()
    const rule = modules(p).that().resideInFolder('**/src/**').should().notImportFrom(G)

    const described = rule.describeRule()
    expect(described.imperative).toContain(G)
    // …and that string is built from `description`, which is not `globs`. If
    // this ever stops holding, `explain` becomes a legitimate surface to guard
    // and this comment is the record of why it was not one.
    expect(rule.describeRule().rule).toContain('not import from')
  })

  it('reports nothing new, which is the point', () => {
    const p = loadProject()
    const rule = modules(p).that().resideInFolder('**/src/**').should().notImportFrom(G)

    // `diagnose.ts` skips `position === 'condition'` sites, so a condition glob
    // that matches nothing is still not a finding. This plan makes the globs
    // VISIBLE; whether an unsatisfiable one is a fault is 0069's R3b (selectors)
    // and 0072's refuted business (denylists). `'**\/legacy/**'` matches nothing
    // in the fixture and must still produce no dead-glob finding.
    const findings = diagnose([rule])
    expect(findings.filter((f) => f.position === 'condition')).toEqual([])
    expect(findings.filter((f) => f.glob === G)).toEqual([])
  })

  it('reports nothing new for a condition glob that IS checkable', () => {
    /**
     * The assertion above is **vacuous with respect to the skip**, and that was
     * measured rather than reasoned: removing
     * `site.position === 'condition'` from `diagnose.ts:169` leaves it green.
     *
     * `notImportFrom` declares `import-target`, which `path-universe.ts:72`
     * deliberately gives no views, so `isDeadSite` is false for it whether the
     * skip is there or not — it is exempt by **kind** before the position is ever
     * consulted. So the test proved the exemption it did not intend to test.
     *
     * `onlyBeImportedVia` declares `file-path`, which has real views, so a glob
     * matching nothing IS dead and the **position** is the only thing keeping it
     * out of the report. Found while fixing bug 0030, whose own guard used
     * `file-path` for exactly this reason.
     */
    const p = loadProject()
    const dead = '**/nonexistent-folder/**'
    const rule = modules(p).that().resideInFolder('**/src/**').should().onlyBeImportedVia(dead)

    const sites = rule
      .globs()
      .flatMap((tree) => globSitesOf(tree))
      .filter((s) => s.position === 'condition')
    // Non-vacuity: the site exists, is `file-path`, and carries the dead glob —
    // so "no finding" below is the position doing the work, not an absent site.
    expect(sites.map((s) => `${s.kind}:${s.glob}`)).toEqual([`file-path:${dead}`])

    expect(diagnose([rule]).filter((f) => f.glob === dead)).toEqual([])
  })
})
