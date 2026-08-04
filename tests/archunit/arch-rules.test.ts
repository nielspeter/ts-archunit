/**
 * Architecture rules for ts-archunit itself.
 *
 * These rules enforce our own ADRs on our own codebase.
 * Uses .rule() metadata for educational violation messages.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, afterAll } from 'vitest'
import type { GlobSite, Located, Predicate } from '../../src/index.js'
import type { DiagnosableRule } from '../../src/core/diagnose.js'
import { diagnose } from '../../src/core/diagnose.js'
import { orphanExclusions } from '../../src/core/orphan-exclusions.js'
import { resetCommentSuppression, commentSuppressions } from '../../src/core/comment-suppression.js'
import { isDeadSite } from '../../src/core/glob-evaluator.js'
import { edgesOf } from '../../src/core/module-edges.js'
import { pathUniverse } from '../../src/core/path-universe.js'
import { project, modules, classes, functions, slices, call } from '../../src/index.js'
import {
  noAnyProperties,
  noTypeAssertions,
  moduleNoTypeAssertions,
} from '../../src/rules/typescript.js'
import {
  noEval,
  noConsoleLog,
  functionNoEval,
  functionNoJsonParse,
  moduleNoEval,
} from '../../src/rules/security.js'
import { noGenericErrors, functionNoGenericErrors } from '../../src/rules/errors.js'
import { noEmptyBodies, noStubComments } from '../../src/rules/hygiene.js'

const p = project('tsconfig.json')

/**
 * This project's own `src/`, derived from the tsconfig's location rather than
 * matched by a glob.
 *
 * Thirteen rules below used to scope with `resideInFolder('**\/ts-archunit/src/**')`,
 * which requires the *checkout directory* to be named `ts-archunit` — not a
 * property of this repository. From a git worktree, a clone into `arch/`, or a
 * renamed folder, that glob selected 0 modules, 0 functions and 0 classes and
 * all thirteen passed while enforcing nothing (bug 0011). Measured: it matches
 * 14 parent directories here and **0** with the checkout renamed.
 *
 * Two obvious replacements are both wrong, and both were measured:
 *
 * - `'**\/src/**'` also matches `tests/fixtures/**\/src/**` — the corpus built
 *   to *violate* these very rules. It reds 13 rules on 89 hits, every one a
 *   fixture.
 * - `` `${dirname(p.tsConfigPath)}/src/**` `` passes here and returns to 0
 *   subjects at any checkout path containing glob metacharacters, because
 *   picomatch reads `My (work)/` as an extglob. It reproduces the bug it closes.
 *
 * So this is a prefix test, not a glob: a path either starts with this
 * project's src directory or it does not, and no character in the checkout
 * path can change that. ADR-008 rule 5 — the derivation is the tsconfig's own
 * resolved location, which is independent of what anyone named the folder.
 */
/**
 * Every rule in this file, as a value — plan 0074's gate.
 *
 * The rules used to be built and discarded inside their own `it()` callbacks,
 * which is why the source-text glob scan below carries the residual _"the real
 * closure is handing the rule objects themselves to `diagnose()`, which needs
 * the rules built as values first."_ This is that. `gate()` records the built
 * rule and hands it straight back, so each `it()` still runs exactly the rule
 * it always ran and the only change is that the object survives the callback.
 *
 * Plan 0074 called this population 43. It is 36 — 41 `it()` blocks, five of
 * which are the meta-guards in this file rather than architecture rules.
 */
/**
 * A glob that matches nothing, on purpose.
 *
 * Named once so the scan below can exempt it by identity and the control at the
 * bottom can use it — two places that must refer to the same string, and would
 * silently diverge if each spelled its own.
 */
const DELIBERATELY_DEAD = '**/no-such-folder-anywhere/**'

/** Every file under `dir`, recursively — for the directive-scan vacuity guard. */
function readdirRecursive(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? readdirRecursive(full) : [full]
  })
}

const BUILT: DiagnosableRule[] = []

function gate<T extends DiagnosableRule>(rule: T): T {
  BUILT.push(rule)
  return rule
}

const SRC_PREFIX = path.dirname(path.resolve('tsconfig.json')).replaceAll('\\', '/') + '/src/'

function inProjectSrc<T extends Located>(): Predicate<T> {
  return {
    description: `reside in this project's src/ ("${SRC_PREFIX}")`,
    test: (element) => element.getSourceFile().getFilePath().startsWith(SRC_PREFIX),
  }
}

// ─── The scope of every rule below, guarded ─────────────────────────
//
// Ask ADR-008's question of this file: what would these 36 rules do if their
// scope selected nothing? Pass — all of them, silently. That is bug 0011, and
// it went unnoticed from the day the rules were written. A green suite is
// therefore not evidence that the suite is enforcing anything, so the scope
// gets its own guard with an INDEPENDENT derivation: ts-morph's module graph
// on one side, a filesystem walk on the other. A bug that empties one cannot
// empty the other.

/**
 * Do the 39 rules below actually see anything?
 *
 * **Measured: with `edgesOf` returning `[]`, every rule in this file passes —
 * 39/39, exit 0.** Twenty-two of them are dependency rules. So a blind engine
 * produces a fully green architecture suite, and by this project's own standard
 * (ADR-008: a check that cannot fail is counted as coverage, and that is a lie)
 * that is a defect in *this file*, not merely a gap somewhere else.
 *
 * The temptation is to answer it in the module-edge tests, where the walk is the
 * subject. That is where the equivalent control also lives — but it is the wrong
 * place for *this* file's reader: someone opening `arch-rules.test.ts` and seeing
 * 39 green needs the non-vacuity assurance here, next to the rules it protects,
 * the same way every corpus loop in this repo carries its own `checked > N`.
 *
 * This is not a test of the walk. It is the anchor that stops the 39 below from
 * being vacuous, and it is deliberately crude: floors far below the real counts,
 * so ordinary churn never touches it and only a collapse toward zero trips it.
 */
describe('the rules in this file are not vacuous', () => {
  it('sees real dependency edges in our own src/', () => {
    // Scoped by the SAME predicate the 39 rules use, not a second derivation of
    // "our src/" that could drift away from theirs.
    const kinds = new Map<string, number>()
    for (const sourceFile of modules(p).that().satisfy(inProjectSrc()).subjects()) {
      for (const edge of edgesOf(sourceFile)) {
        kinds.set(edge.kind, (kinds.get(edge.kind) ?? 0) + 1)
      }
    }
    // Measured at 607 imports / 153 re-exports over src/. Floors, not counts.
    expect(kinds.get('import') ?? 0).toBeGreaterThan(400)
    expect(kinds.get('reexport') ?? 0).toBeGreaterThan(100)
  })

  it('selects real subjects for the scoping predicate all 39 rules share', () => {
    // `inProjectSrc()` is the predicate every rule below is scoped by (bug 0011).
    // If it selected nothing, all 39 would pass over the empty set.
    // Measured 140 / 822 / 25. Floors well below, so ordinary churn never touches
    // them and only a collapse toward zero — which is bug 0011's shape — trips them.
    expect(modules(p).that().satisfy(inProjectSrc()).subjects().length).toBeGreaterThan(100)
    expect(functions(p).that().satisfy(inProjectSrc()).subjects().length).toBeGreaterThan(500)
    expect(classes(p).that().satisfy(inProjectSrc()).subjects().length).toBeGreaterThan(15)
  })
})

describe('rule scope (bug 0011)', () => {
  it('inProjectSrc() selects exactly the TypeScript on disk under src/', () => {
    const fromCompiler = modules(p)
      .that()
      .satisfy(inProjectSrc())
      .subjects()
      .map((sourceFile) => sourceFile.getFilePath())
      .sort()

    const fromDisk: string[] = []
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name).replaceAll('\\', '/')
        if (entry.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) fromDisk.push(full)
      }
    }
    walk(SRC_PREFIX)

    // Both non-empty, or the comparison is two empty sets agreeing — which is
    // precisely the false green this test exists to catch.
    expect(fromCompiler.length).toBeGreaterThan(0)
    expect(fromDisk.length).toBeGreaterThan(0)
    expect(fromCompiler).toEqual(fromDisk.sort())
  })

  it('no glob written in this file can ever match', () => {
    // The guard that closes bug 0011: reverting `api/no-single-glob-predicates`
    // to its vacuous `resideInFolder('**/src/predicates/module**')` scope left
    // all 165 test files green, because the two guards beside this one cannot
    // see it — the file-set check only covers `inProjectSrc()`, and the name
    // ban only bans one string.
    //
    // Every path glob in this file goes through the SHIPPED evaluator, so this
    // cannot drift from what `doctor` would say, and it does not depend on what
    // the checkout is called.
    //
    // Residual, stated rather than hidden: only single-line literals at a
    // recognised call site are extracted. A glob held in a `const`, or split
    // across lines by prettier, is invisible here — undecidable from source
    // text. The real closure is handing the rule objects themselves to
    // `diagnose()`, which needs the 36 rules built as values first.
    const KIND: Record<string, 'parent-dir' | 'file-path'> = {
      resideInFolder: 'parent-dir',
      resideInFile: 'file-path',
      havePathMatching: 'file-path',
      inFolder: 'file-path',
      matching: 'file-path',
      assignedFrom: 'file-path',
      layer: 'file-path',
    }
    /** Selectors whose globs are deliberately not path-checkable. */
    const EXEMPT = new Set([
      'importFrom',
      'notImportFrom',
      'importFromCondition',
      'notImportFromCondition',
      'onlyImportFrom',
      'onlyHaveTypeImportsFrom',
      'withStringArg',
      'excluding',
      'ignorePaths',
      'describe',
      'it',
      'toEqual',
      'toContain',
      'rule',
      'because',
      'test',
      // String methods in this file's own guards, not selectors.
      'startsWith',
      'endsWith',
      'includes',
    ])

    // The fixture corpus is built to VIOLATE these rules, so a glob matching
    // only a fixture path enforces nothing about src/ — bug 0011's shape one
    // level down, and the sibling guard's own comment already warns about it.
    const all = pathUniverse(p)
    const keep = (candidate: string): boolean => !/(^|\/)tests\/fixtures\//.test(candidate)
    const universe = {
      filePaths: all.filePaths.filter(keep),
      parentDirs: all.parentDirs.filter(keep),
      tsconfigRelativeFilePaths: all.tsconfigRelativeFilePaths.filter(keep),
      tsconfigRelativeParentDirs: all.tsconfigRelativeParentDirs.filter(keep),
    }

    const dead: string[] = []
    const unclassified: string[] = []
    fs.readFileSync(import.meta.filename, 'utf-8')
      .split('\n')
      .forEach((line, index) => {
        const text = line.trim()
        if (text.startsWith('*') || text.startsWith('//')) return
        const check = (selector: string, glob: string, kind: 'parent-dir' | 'file-path'): void => {
          // The one deliberately-dead glob in this file: the control that proves
          // the `diagnose()` guard at the bottom can still report a fault. It is
          // exempted by its exact text rather than by hiding it in a `const`,
          // which would defeat this scan for real globs too.
          if (glob === DELIBERATELY_DEAD) return
          const site: GlobSite = {
            glob,
            kind,
            position: 'selector',
            origin: `${selector}("${glob}")`,
          }
          if (isDeadSite(site, universe)) dead.push(`${String(index + 1)}: ${site.origin}`)
        }

        // A call: `.resideInFolder('**/src/x/**')`.
        for (const match of text.matchAll(/\.(\w+)\(\s*'([^']*\*[^']*)'/g)) {
          const selector = match[1] ?? ''
          const glob = match[2]
          if (glob === undefined || EXEMPT.has(selector)) continue
          const kind = KIND[selector]
          if (kind === undefined) {
            // Fail CLOSED. Skipping an unrecognised selector silently is how a
            // dead glob gets through — "I cannot check this" is a finding, not
            // a reason to move on.
            unclassified.push(`${String(index + 1)}: ${selector}('${glob}')`)
            continue
          }
          check(selector, glob, kind)
        }

        // A map entry: `core: '**/src/core/**'` inside `assignedFrom({...})`.
        // The old regex required a call prefix, so the six globs in the
        // slice-definition rule were checked by nothing at all — and that rule
        // is the one whose globs name every layer of this codebase.
        for (const match of text.matchAll(/(?:^|[{,])\s*(\w+)\s*:\s*'([^']*\*[^']*)'/g)) {
          const key = match[1] ?? ''
          const glob = match[2]
          if (glob === undefined || EXEMPT.has(key)) continue
          // `assignedFrom` is the only map-of-globs shape here, and it declares
          // `file-path`.
          check(`assignedFrom({ ${key}: … })`, glob, 'file-path')
        }
      })

    expect(unclassified).toEqual([])
    expect(dead).toEqual([])
  })

  it('no rule scopes by the name of the checkout directory', () => {
    // The original defect was not "a wrong glob" but "a glob that encodes the
    // folder name", which is a property of the machine, not the repository.
    // Renaming the checkout is enough to silence any rule written that way, so
    // ban the shape rather than the one string that happened to be used.
    const checkoutName = path.basename(path.dirname(path.resolve('tsconfig.json')))
    const source = fs.readFileSync(import.meta.filename, 'utf-8')
    const offending = source
      .split('\n')
      .map((line, index) => ({ text: line.trim(), number: index + 1 }))
      // Comments are excluded deliberately: the JSDoc above quotes the banned
      // glob as the counter-example, and that is the most useful line in the
      // file. A leading `*` or `//` is not a comment parser — it is enough for
      // this file's style, and a false negative here only means the ban misses
      // a glob someone hid inside a trailing comment, which no rule executes.
      .filter(({ text }) => !text.startsWith('*') && !text.startsWith('//'))
      .filter(({ text }) => /'[^']*\*[^']*'/.test(text) && text.includes(checkoutName))

    expect(offending.map((o) => `${String(o.number)}: ${o.text}`)).toEqual([])
  })
})

// ─── ADR-005: No any types, no type assertions ──────────────────────

describe('ADR-005: Type Safety', () => {
  it('source classes must not have any-typed properties', () => {
    gate(
      classes(p).that().satisfy(inProjectSrc()).should().satisfy(noAnyProperties()).rule({
        id: 'adr005/no-any',
        because: 'any bypasses the type checker, hiding bugs that strict mode catches',
        suggestion: 'Use a specific type, unknown with narrowing, or a generic',
        docs: 'https://github.com/NielsPeter/ts-archunit/blob/main/adr/005-no-any-no-type-assertions.md',
      }),
    ).check()
  })

  it('NO source file may use a type assertion, whatever shape it is written in', () => {
    // The scope fix from [bug 0049](../../bugs/fixed/0049-the-type-assertion-self-check-selected-classes.md).
    //
    // The rule below this one selects **classes**. This codebase has 19 files with
    // a class and 128 with a function, so the guard covered the shape we barely
    // use — and every `as` cast we shipped lived in a function. A hand-written
    // grep filed the bug at "four casts"; this rule found **22**, in eight files,
    // which is the difference between a list and a derivation.
    //
    // `moduleNoTypeAssertions` traverses the whole file, so it subsumes the class
    // rule rather than sitting beside it. The class rule is kept because it names
    // the class in its message, which is a better failure for the commonest case.
    gate(
      modules(p).that().satisfy(inProjectSrc()).should().satisfy(moduleNoTypeAssertions()).rule({
        id: 'adr005/no-as-cast-module',
        because: 'as casts bypass the type checker — refactoring silently breaks',
        suggestion:
          'Use a type guard (`value is T`), or narrow with `in`/`typeof` — which is usually already there, since 17 of the 22 casts this rule first found sat directly after the check that made them unnecessary. At a genuine JS-interop boundary, waive it with a `// ts-archunit-exclude adr005/no-as-cast-module: <reason>` comment naming the boundary.',
        docs: 'https://github.com/NielsPeter/ts-archunit/blob/main/adr/005-no-any-no-type-assertions.md',
      }),
    ).check()
  })

  it('source classes must not use type assertions in methods', () => {
    gate(
      classes(p).that().satisfy(inProjectSrc()).should().satisfy(noTypeAssertions()).rule({
        id: 'adr005/no-as-cast',
        because: 'as casts bypass the type checker — refactoring silently breaks',
        suggestion:
          'Use ts-morph Node type guards (Node.isClassDeclaration etc.) or explicit type annotations',
        docs: 'https://github.com/NielsPeter/ts-archunit/blob/main/adr/005-no-any-no-type-assertions.md',
      }),
    ).check()
  })
})

// ─── ADR-004: ESM only ──────────────────────────────────────────────

describe('ADR-004: ESM', () => {
  it('no require() calls in source', () => {
    gate(
      classes(p).that().satisfy(inProjectSrc()).should().notContain(call('require')).rule({
        id: 'adr004/no-require',
        because: 'ts-archunit is ESM-only — CommonJS require() breaks module resolution',
        suggestion: "Use import ... from '...' (static) or import('...') (dynamic)",
        docs: 'https://github.com/NielsPeter/ts-archunit/blob/main/adr/004-esm-only-package.md',
      }),
    ).check()
  })

  it('no require() in source functions', () => {
    gate(
      functions(p).that().satisfy(inProjectSrc()).should().notContain(call('require')).rule({
        id: 'adr004/no-require-fn',
        because: 'ESM only',
        docs: 'https://github.com/NielsPeter/ts-archunit/blob/main/adr/004-esm-only-package.md',
      }),
    ).check()
  })
})

// ─── ADR-002: ts-morph only ─────────────────────────────────────────

describe('ADR-002: ts-morph as AST engine', () => {
  it('source must not import typescript compiler API directly', () => {
    gate(
      modules(p)
        .that()
        .satisfy(inProjectSrc())
        .should()
        .notImportFromCondition('**/node_modules/typescript/**')
        .rule({
          id: 'adr002/no-raw-ts',
          because:
            'ts-morph wraps the TypeScript compiler API — using it directly creates version coupling and verbose code',
          suggestion: 'Use ts-morph APIs: Project, Node, SyntaxKind, type checker methods',
          docs: 'https://github.com/NielsPeter/ts-archunit/blob/main/adr/002-ts-morph-ast-engine.md',
        }),
    ).check()
  })
})

// ─── Code Quality ───────────────────────────────────────────────────

describe('Code Quality', () => {
  it('no eval()', () => {
    gate(
      classes(p).that().satisfy(inProjectSrc()).should().satisfy(noEval()).rule({
        id: 'security/no-eval',
        because: 'eval executes arbitrary code — security risk and prevents static analysis',
      }),
    ).check()
  })

  it('no generic Error', () => {
    gate(
      classes(p).that().satisfy(inProjectSrc()).should().satisfy(noGenericErrors()).rule({
        id: 'quality/typed-errors',
        because: 'Generic Error loses context. Typed errors enable consistent handling.',
        suggestion: 'Use ArchRuleError or a specific Error subclass',
      }),
    ).check()
  })

  it('builders must be exported', () => {
    gate(
      classes(p)
        .that()
        .haveNameEndingWith('Builder')
        .and()
        .resideInFolder('**/src/builders/**')
        .should()
        .beExported()
        .rule({
          id: 'quality/builders-exported',
          because: 'Builders are the public API — unexported builders are unreachable',
        }),
    ).check()
  })

  it('entry point functions must be exported', () => {
    gate(
      functions(p)
        .that()
        .haveNameMatching(/^(modules|classes|functions|types|slices|project)$/)
        .and()
        .satisfy(inProjectSrc())
        .should()
        .beExported()
        .rule({
          id: 'quality/entry-points-exported',
          because: 'Entry point functions are the primary user API',
        }),
    ).check()
  })
})

// ─── Architecture ───────────────────────────────────────────────────

describe('Architecture', () => {
  it('helpers must not import from builders', () => {
    gate(
      modules(p)
        .that()
        .resideInFolder('**/src/helpers/**')
        .should()
        .notImportFromCondition('**/src/builders/**')
        // within() starts a rule chain, so it constructs a builder. Waived here since
        // plan 0015 — and arch/no-cycles independently reds on the SAME file from the
        // other direction. Two rules, two waivers, one misplaced file: bugs/0054.
        .excluding('within.ts')
        .rule({
          id: 'arch/helpers-no-builders',
          because:
            'Helpers are lower-level primitives — builders depend on helpers, not the reverse',
          // NOT "move it to src/helpers/" — the violating file is already there, so
          // that remedy is a no-op. ADR-008 rule 2: verified to remediate.
          suggestion:
            'Move the shared logic down to src/core/, or — if the helper starts a rule chain — move the file itself to src/builders/ (see bugs/0054)',
        }),
    ).check()
  })

  it('core must not import from builders', () => {
    gate(
      modules(p)
        .that()
        .resideInFolder('**/src/core/**')
        .should()
        .notImportFromCondition('**/src/builders/**')
        .rule({
          id: 'arch/core-no-builders',
          because: 'Core is the foundation — it must not depend on entry points',
          suggestion: 'If core needs builder functionality, extract it to core first',
        }),
    ).check()
  })

  it('core must not import from predicates', () => {
    gate(
      modules(p)
        .that()
        .resideInFolder('**/src/core/**')
        .should()
        .notImportFromCondition('**/src/predicates/**')
        .rule({
          id: 'arch/core-no-predicates',
          because: 'Core must not depend on predicate implementations',
        }),
    ).check()
  })

  it('core must not import from conditions', () => {
    gate(
      modules(p)
        .that()
        .resideInFolder('**/src/core/**')
        .should()
        .notImportFromCondition('**/src/conditions/**')
        .rule({
          id: 'arch/core-no-conditions',
          because: 'Core must not depend on condition implementations',
        }),
    ).check()
  })

  it('core must not import from smells', () => {
    gate(
      modules(p)
        .that()
        .resideInFolder('**/src/core/**')
        .should()
        .notImportFromCondition('**/src/smells/**')
        .rule({
          id: 'arch/core-no-smells',
          because: 'Core must not depend on smell detectors',
        }),
    ).check()
  })

  it('core must not import from rules', () => {
    gate(
      modules(p)
        .that()
        .resideInFolder('**/src/core/**')
        .should()
        .notImportFromCondition('**/src/rules/**')
        .rule({
          id: 'arch/core-no-rules',
          because: 'Core must not depend on standard rule implementations',
        }),
    ).check()
  })

  it('core must not import from graphql', () => {
    gate(
      modules(p)
        .that()
        .resideInFolder('**/src/core/**')
        .should()
        .notImportFromCondition('**/src/graphql/**')
        .rule({
          id: 'arch/core-no-graphql',
          because: 'Core must not depend on the graphql extension',
        }),
    ).check()
  })

  it('core must not import from cli', () => {
    gate(
      modules(p)
        .that()
        .resideInFolder('**/src/core/**')
        .should()
        .notImportFromCondition('**/src/cli/**')
        .rule({
          id: 'arch/core-no-cli',
          because: 'Core must not depend on the CLI layer',
        }),
    ).check()
  })

  it('core must not import from helpers', () => {
    gate(
      modules(p)
        .that()
        .resideInFolder('**/src/core/**')
        .should()
        .notImportFromCondition('**/src/helpers/**')
        .rule({
          id: 'arch/core-no-helpers',
          because: 'Core is the foundation — helpers depend on core, not the reverse',
        }),
    ).check()
  })

  it('standard rules must not import from builders', () => {
    gate(
      modules(p)
        .that()
        .resideInFolder('**/src/rules/**')
        .should()
        .notImportFromCondition('**/src/builders/**')
        .rule({
          id: 'arch/rules-no-builders',
          because: 'Standard rules are conditions, not builders',
        }),
    ).check()
  })

  it('predicates must not import from conditions', () => {
    gate(
      modules(p)
        .that()
        .resideInFolder('**/src/predicates/**')
        .should()
        .notImportFromCondition('**/src/conditions/**')
        .rule({
          id: 'arch/predicates-independent',
          because: 'Predicates filter, conditions assert — they are independent concerns',
        }),
    ).check()
  })

  it('models must not import from builders', () => {
    gate(
      modules(p)
        .that()
        .resideInFolder('**/src/models/**')
        .should()
        .notImportFromCondition('**/src/builders/**')
        .rule({
          id: 'arch/models-no-builders',
          because: 'Models are data representations — they must not depend on the rule engine',
        }),
    ).check()
  })

  it('conditions must not import from builders', () => {
    gate(
      modules(p)
        .that()
        .resideInFolder('**/src/conditions/**')
        .should()
        .notImportFromCondition('**/src/builders/**')
        .rule({
          id: 'arch/conditions-no-builders',
          because: 'Conditions are reusable — they must not depend on specific entry points',
        }),
    ).check()
  })

  it('no cycles between source modules', () => {
    gate(
      slices(p)
        .assignedFrom({
          core: '**/src/core/**',
          builders: '**/src/builders/**',
          predicates: '**/src/predicates/**',
          conditions: '**/src/conditions/**',
          helpers: '**/src/helpers/**',
          models: '**/src/models/**',
        })
        .should()
        .beFreeOfCycles()
        // The one cycle that survives, and the edge that closes it:
        // `helpers/within.ts` imports `ScopedFunctionRuleBuilder` as a VALUE, so a
        // helper constructs a builder. Pre-existing since plan 0015, and a design
        // question — `within()` may simply belong in `builders/` — so it is
        // [bug 0054](../../bugs/0054-within-makes-helpers-depend-on-builders.md)
        // rather than a change smuggled into this one.
        //
        // Excluded BY IDENTITY, not by lowering the severity. If the cycle's shape
        // changes — a slice joining or leaving — this pattern stops matching and the
        // rule reds on the new shape, which is the fail-closed direction. That is
        // the difference between an exclusion and a `.warn()`.
        .excluding('[builders, conditions, helpers, predicates]')
        .rule({
          id: 'arch/no-cycles',
          because:
            'Circular dependencies between modules prevent independent testing and reasoning',
          suggestion: 'Extract shared code to a lower-level module (core or helpers)',
        }),
      // `.check()` at last — plan 0084. This sat at `.warn()` with a comment saying
      // "switch to .check() when beFreeOfCycles ignores import type", and while it
      // sat there it let a cycle in overnight: plan 0082's fix added a value edge
      // `helpers → models` that closed one, and nothing failed. A rule that cannot
      // fail is not a rule.
    ).check()
  })
})

// ─── Hygiene: function variants (plan 0042) ────────────────────────

describe('Hygiene', () => {
  it('source functions must not have empty bodies', () => {
    gate(
      functions(p).that().satisfy(inProjectSrc()).should().satisfy(noEmptyBodies()).rule({
        id: 'hygiene/no-empty-bodies',
        because: 'An empty function compiles but does nothing — dead code or unfinished work',
      }),
    ).check()
  })

  it('source functions must not have stub comments', () => {
    gate(
      functions(p).that().satisfy(inProjectSrc()).should().satisfy(noStubComments()).rule({
        id: 'hygiene/no-stubs',
        because: 'TODO/FIXME/HACK comments indicate unfinished work — resolve before merging',
      }),
    ).check()
  })

  it('source functions must not use eval', () => {
    gate(
      functions(p)
        .that()
        .satisfy(inProjectSrc())
        .should()
        .satisfy(functionNoEval())
        .rule({ id: 'security/no-eval-fn' }),
    ).check()
  })

  it('source functions must not throw generic Error (excluding argument validation)', () => {
    gate(
      functions(p)
        .that()
        .satisfy(inProjectSrc())
        .should()
        .satisfy(functionNoGenericErrors())
        .excluding(
          // Argument validation in predicate/condition factories — thrown at construction time, not evaluation
          /haveMaxExports/,
          /havePropertyNamed/,
          /notHavePropertyNamed/,
          /haveArgumentWithProperty/,
          /notHaveArgumentWithProperty/,
          'areHtmlElements',
          // Project loader — single point of failure with descriptive message
          'project',
          'workspace',
          // Precondition guard — caller must verify the initializer
          'fromArrowVariableDeclaration',
          // GraphQL schema loader — requires graphql peer dep
          'requireGraphQL',
          'loadSchemaFromGlob',
        )
        .rule({
          id: 'quality/typed-errors-fn',
          because: 'Use ArchRuleError or a specific Error subclass',
        }),
    ).check()
  })

  it('source modules must not contain eval', () => {
    gate(
      modules(p)
        .that()
        .satisfy(inProjectSrc())
        .should()
        .satisfy(moduleNoEval())
        .rule({ id: 'security/no-eval-module' }),
    ).check()
  })

  it('source functions must not use JSON.parse (excluding CLI and baseline)', () => {
    gate(
      functions(p)
        .that()
        .satisfy(inProjectSrc())
        .should()
        .satisfy(functionNoJsonParse())
        .excluding(
          'getVersion', // CLI: reads package.json version
          'withBaseline', // baseline: parses baseline JSON file
          'readPriorHashes', // baseline: parses the file about to be overwritten, for the delta (plan 0071)
          'readJsonc', // init: parses the user's tsconfig for source-root detection
          'planPackageJson', // init: parses the user's package.json to merge scripts
          'declaresWorkspaces', // identity root: reads package.json to detect a monorepo root
        )
        .rule({
          id: 'security/no-json-parse',
          because: 'ts-archunit analyzes AST, not JSON — JSON.parse should not appear in source',
        }),
    ).check()
  })

  it('presets must not import from graphql', () => {
    gate(
      modules(p)
        .that()
        .resideInFolder('**/src/presets/**')
        .should()
        .notImportFrom('**/src/graphql/**')
        .rule({
          id: 'arch/presets-no-graphql',
          because: 'Presets are core — they must not depend on the optional graphql extension',
        }),
    ).check()
  })

  it('presets must not import from cli', () => {
    gate(
      modules(p)
        .that()
        .resideInFolder('**/src/presets/**')
        .should()
        .notImportFrom('**/src/cli/**')
        .rule({
          id: 'arch/presets-no-cli',
          because: 'Presets are used programmatically — they must not depend on CLI infrastructure',
        }),
    ).check()
  })

  it('modules must not have default exports (except index)', () => {
    gate(
      modules(p)
        .that()
        .satisfy(inProjectSrc())
        .and()
        .haveNameMatching(/^(?!index\.ts$)/)
        .should()
        .notHaveDefaultExport()
        .rule({
          id: 'quality/no-default-exports',
          because: 'Named exports are easier to refactor and tree-shake',
        }),
    ).check()
  })
})

// ─── No console.log ──────────────────────────────────────────────────

describe('No console.log in Source', () => {
  it('source classes must not call console.log', () => {
    gate(
      classes(p).that().satisfy(inProjectSrc()).should().satisfy(noConsoleLog()).rule({
        id: 'quality/no-console-log',
        because: 'Use console.warn for user-facing warnings or throw for errors',
        suggestion: 'Replace console.log() with console.warn() or remove it',
      }),
    ).check()
  })

  it('source functions must not call console.log', () => {
    gate(
      functions(p).that().satisfy(inProjectSrc()).should().notContain(call('console.log')).rule({
        id: 'quality/no-console-log-fn',
        because: 'Use console.warn for user-facing warnings or throw for errors',
      }),
    ).check()
  })
})

// ─── API Consistency ─────────────────────────

describe('Import Hygiene', () => {
  it('test files should not use aliased imports', () => {
    gate(
      modules(p)
        .that()
        .resideInFile('**/tests/**/*.test.ts')
        .should()
        .notHaveAliasedImports()
        .rule({
          id: 'quality/no-aliased-imports',
          because: 'aliases hide API naming problems — use the real export name',
          suggestion:
            'Import the symbol by its original name, or fix the export if the name conflicts',
        }),
    ).check()
  })
})

describe('API Consistency', () => {
  it('module predicate functions must not accept a single "glob" parameter', () => {
    // Regression guard for the .notImportFrom() variadic bug.
    // Module predicates like importFrom/notImportFrom should accept ...globs
    // so users can write .notImportFrom('fastify', 'knex', 'bullmq').
    //
    // Identity predicates (resideInFile, resideInFolder, havePathMatching) are
    // legitimately single-glob — you match one location pattern, not a
    // blacklist. That carve-out used to live in a comment here while the scope
    // covered them anyway; now it IS the scope, because those predicates live
    // in identity.ts and this rule names module.ts (bug 0011, plan 0069 R-any).
    //
    // resideInFile, not resideInFolder: resideInFolder matches the DIRECTORY
    // portion of the path, so '**/src/predicates/module**' matched 1 file and
    // 0 directories and this rule selected nothing, everywhere, since it was
    // written. Widening to '**/src/predicates/**' is not the fix either — it
    // would red on identity.ts's own single-glob predicates.
    gate(
      functions(p)
        .that()
        .resideInFile('**/src/predicates/module.ts')
        .and()
        .areExported()
        .and()
        .haveParameterNamed('glob')
        .and()
        .haveParameterCount(1)
        .should()
        .notExist()
        .rule({
          id: 'api/no-single-glob-predicates',
          because: 'Single-glob predicates silently ignore extra arguments — use ...globs variadic',
          suggestion: 'Change (glob: string) to (...globs: string[]) to match condition variants',
        }),
    ).check()
  })
})

// ─── The pre-flight over this file's own rules (plan 0074) ──────────

describe('the rules in this file can all enforce something', () => {
  // Declared LAST on purpose: `BUILT` fills as the `it()` callbacks above run,
  // so this must see all of them. That ordering dependency is not left to
  // convention — the first assertion below catches it.
  it('diagnoses every rule in this file, and finds nothing wrong', () => {
    // ADR-008 rule 5: the runtime population is checked against a DIFFERENTLY
    // DERIVED one — the `gate(` call sites in this file's own source text. A
    // guard that ran before the rules were built would see a short array and
    // report a clean bill of health for the rules it never saw; a rule added
    // below this block would be missed the same way. Neither can happen while
    // the two derivations must agree.
    // Counted from the TERMINALS, not from `gate(` — the two derivations must be
    // able to disagree, or this is one derivation written twice. Unwrapping a
    // rule deletes its `gate(` and its runtime entry together, so a
    // `gate(`-based count would move with the array and agree while that rule
    // quietly stopped being diagnosed. `.check()` survives the unwrap. (An
    // entry-point head does not work either: prettier collapses the short
    // chains onto one line, and the meta-guards in this file call the entry
    // points too.)
    const source = fs.readFileSync(import.meta.filename, 'utf-8')
    const terminals = source
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => !line.startsWith('//') && !line.startsWith('*'))
      .filter((line) => /^\)?\.(?:check|warn)\(\)/.test(line)).length
    expect(terminals).toBeGreaterThan(30)
    expect(BUILT.length).toBe(terminals)

    // The real closure of the source-text scan above, which can only see
    // single-line literals at a recognised call site: these are the rule
    // OBJECTS, so a glob held in a `const`, assembled, or split across lines by
    // prettier is diagnosed here exactly as `doctor` would diagnose it.
    //
    // Identities, never a count — ADR-008 rule 4. A count tells the next reader
    // that something is wrong; this tells them which rule and which glob.
    const findings = diagnose(BUILT).map(
      (f) =>
        `${f.kind}: ${f.rule}${f.glob === undefined ? '' : ` [${f.position ?? '?'} ${f.glob}]`}`,
    )
    expect(findings).toEqual([])
  })

  it('would report a fault if one were introduced', () => {
    // The assertion above is `toEqual([])`, which is exactly what a `diagnose()`
    // that had stopped working would also produce — the ADR-008 question, asked
    // of the guard rather than of the rules. Plan 0074's gate run recorded ZERO
    // findings for this repository, so without this control that zero is not
    // evidence of clean rules; it is evidence of nothing.
    const deadSelector = modules(p)
      .that()
      .resideInFolder(DELIBERATELY_DEAD)
      .should()
      .notImportFrom('**/x/**')
    const noCondition = modules(p).that().satisfy(inProjectSrc())

    expect(diagnose([deadSelector]).map((f) => f.kind)).toEqual(['dead-glob'])
    expect(diagnose([noCondition]).map((f) => f.kind)).toEqual(['no-condition'])
    // And a healthy rule stays silent, or the control would pass for a
    // `diagnose()` that simply reported everything.
    expect(diagnose([BUILT[0] as DiagnosableRule])).toEqual([])
  })
})

// Runs LAST on purpose: `gate()` fills `BUILT` as each rule-building test
// executes, so the declared-id set is only complete once they all have. Placed
// in `afterAll` rather than a trailing `it` so it cannot be reordered into
// passing on a half-filled set — a check whose correctness depends on test
// order is the kind of green this file exists to distrust.
afterAll(() => {
  // **Dogfooding the fix for our own bug.**
  // [Bug 0044](../../bugs/fixed/0044-an-inline-exclusion-comment-has-no-feedback-channel.md):
  // a `// ts-archunit-exclude` naming a renamed rule id suppresses nothing and
  // says nothing — inert forever, because a comment is only read in a file that
  // already produced a finding for that rule. We shipped `orphanExclusions` to
  // catch it, and then exercised it only in its own unit test.
  //
  // Meanwhile v0.45.6 put two real waivers into `src/` — `members.ts` and
  // `graphql/schema-loader.ts`, both naming `adr005/no-as-cast-module` at genuine
  // JS-interop boundaries. Rename that rule and both go silently inert, and the
  // casts they cover stop being waived-with-a-reason and start being unexplained.
  // Exactly the defect we fixed, on waivers we had just written, in the repo that
  // ships the fix.
  //
  // `BUILT` is every rule this file gated, so the declared-id set is derived
  // rather than listed — `orphanExclusions` wants the union across all rule
  // files, and this is that union.
  const orphans = orphanExclusions(BUILT)
  const named = orphans.map(
    (o) => `${o.file}:${String(o.line)} names "${o.ruleId}", which no rule declares`,
  )
  expect(named, `orphaned exclusion directives:\n  ${named.join('\n  ')}`).toEqual([])
})

it('VACUITY: the orphan check really reads our directives', () => {
  // Without this the row above passes on a scan that found no comments at all —
  // and it would have, silently, for as long as nobody looked. The two waivers
  // are asserted BY IDENTITY, so deleting one is visible here rather than
  // shrinking a count nobody reads.
  const files = readdirRecursive(path.resolve('src'))
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => /^\s*\/\/ ts-archunit-exclude(-start)? /m.test(fs.readFileSync(f, 'utf-8')))
    .map((f) => path.relative(path.resolve('src'), f).replaceAll('\\', '/'))
    .sort()
  expect(files).toEqual(['conditions/members.ts', 'graphql/schema-loader.ts'])
})

it('every waiver in src/ actually suppresses something', () => {
  // A DIFFERENT derivation from the vacuity row above, and that is the point
  // (ADR-008 rule 5). That row scans source text and proves a directive is
  // **present**; this one runs the rule and proves it is **load-bearing**.
  //
  // They disagree in the case that matters: remove the cast a waiver covers and
  // the directive still scans, still names a live rule, still reads as "there is
  // an interop boundary here" — and suppresses nothing. Dead weight that lies
  // about the code. Only the suppression list can see it.
  //
  // This also dogfoods the disclosure shipped for
  // [bug 0041](../../bugs/fixed/0041-an-exclusion-comment-is-a-no-op-for-most-conditions.md):
  // we built a channel to report what comments silenced, then never pointed it at
  // ourselves.
  resetCommentSuppression()
  modules(p)
    .that()
    .satisfy(inProjectSrc())
    .should()
    .satisfy(moduleNoTypeAssertions())
    .rule({ id: 'adr005/no-as-cast-module' })
    .violations()

  const silenced = commentSuppressions()
    .map((entry) => path.relative(path.resolve('src'), entry.file).replaceAll('\\', '/'))
    .sort()
  expect([...new Set(silenced)]).toEqual(['conditions/members.ts', 'graphql/schema-loader.ts'])
})
