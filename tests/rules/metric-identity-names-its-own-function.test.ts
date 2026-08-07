/**
 * A function metric's identity and `element` name the function the message names — bug 0068.
 *
 * The defect: the three function metrics built their `message` from `fn.getName()` — correct —
 * and then handed `fn.getNode()` to `metricViolation` with no `qualifiedName`, so the identity
 * re-derived a name from the AST. `getElementName` resolves an unnamed node up to its nearest
 * NAMED ancestor, which for an object-literal function is the enclosing function. Two name
 * derivations inside one violation, disagreeing:
 *
 *     element=makeAlpha  id=…::makeAlpha::lines     "makeAlpha has 12 lines (max: 3)"
 *     element=makeAlpha  id=…::makeAlpha::lines#1   "errorResponseBuilder has 8 lines (max: 3)"
 *
 * v0.57.0's `disambiguateIdentities` made the second unique (`#1`) without making it correct,
 * and `BaselineEntry.measured` is a per-identity ceiling — so the ceilings were keyed to a
 * positional slot rather than to a function.
 *
 * Two traps this file is built to avoid, both named in the bug report:
 *
 *   1. A fixture with ONE object-literal function per file cannot show it. The inner and outer
 *      findings must both fire, in the same file, for the collision to exist.
 *   2. `expect(findings).toHaveLength(4)` passes with the bug fully intact — the bug loses
 *      IDENTITIES, not findings. So every assertion here is on identity, never on a count.
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import { Project, SyntaxKind, Node } from 'ts-morph'
import { collectFunctions } from '../../src/models/arch-function.js'
import {
  maxFunctionComplexity,
  maxFunctionLines,
  maxFunctionParameters,
} from '../../src/rules/metrics-function.js'
import type { ArchViolation } from '../../src/core/violation.js'
import { functions } from '../../src/builders/function-rule-builder.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/metrics')
const project = new Project({ tsConfigFilePath: path.join(fixturesDir, 'tsconfig.json') })

const sourceFile = project.getSourceFileOrThrow((sf) =>
  sf.getFilePath().endsWith('nested-object-literal.ts'),
)
/** The object-literal arrows are the subjects at issue, so they must be collected. */
const subjects = collectFunctions(sourceFile, { includeObjectLiteralFunctions: true })
const context = { rule: 'test rule' }

/** The fixture project, through the public entry point, scoped to this file. */
const functionsIn = () =>
  functions(
    {
      tsConfigPath: path.join(fixturesDir, 'tsconfig.json'),
      _project: project,
      getSourceFiles: () => [sourceFile],
    },
    { includeObjectLiteralFunctions: true },
  )
    .that()
    .haveNameMatching(/.*/)

const namesIn = (vs: ArchViolation[]): string[] => vs.map((v) => v.message.split(' has ')[0] ?? '')

describe('a function metric identifies the function its message names (bug 0068)', () => {
  // The file's one INDEPENDENT derivation: literal expected names, written out,
  // compared against what the conditions produce. Every other assertion here
  // compares `element`/`identity` against the message — and all three now come
  // from one `fn.getName()`, so they agree even if that source is wrong. This is
  // the row that notices. (Proven: replacing the shared source with
  // `getElementName(fn.getNode())` reds exactly this test and the identity rows.)
  it('CONTROL: the fixture produces the elements this file reasons about', () => {
    expect(new Set(namesIn(maxFunctionLines(3).evaluate(subjects, context)))).toEqual(
      new Set([
        'makeAlpha',
        'errorResponseBuilder',
        'takesFive',
        'makeBeta',
        'makeGamma',
        'makeDelta',
        'makeEpsilon',
        'save',
        'build',
      ]),
    )
    // `build` four times — two arrow spellings and two METHOD SHORTHAND ones.
    expect(
      namesIn(maxFunctionLines(3).evaluate(subjects, context)).filter((n) => n === 'build'),
    ).toHaveLength(4)
    expect(new Set(namesIn(maxFunctionParameters(4).evaluate(subjects, context)))).toEqual(
      new Set(['makeAlpha', 'manyParams', 'takesFive']),
    )
  })

  it.each([
    ['lines', maxFunctionLines(3)],
    // Threshold 0: minimum complexity is 1, so every function enters and the
    // whole file is one group. Not complexity coverage — a maximal identity row.
    ['complexity', maxFunctionComplexity(0)],
    ['parameters', maxFunctionParameters(4)],
  ])('%s: every finding carries its own identity', (_metric, condition) => {
    const violations = condition.evaluate(subjects, context)
    // Vacuity floor: one subject cannot collide with anything.
    expect(violations.length).toBeGreaterThan(1)
    // The duplicates BY NAME, not a size comparison — `identities.size ===
    // violations.length` is two counts, and counting is the shortcut ADR-008
    // names. This repo's own cardinality scanner flagged the count version.
    const ids = violations.map((v) => String(v.identity))
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([])
  })

  // The regression the first fix introduced, kept as its own row. Passing the own
  // name alone made two factory-returned `build` arrows byte-identical in element,
  // message AND identity, where before they were distinct — moving the fail-open
  // instead of closing it, into the very shape the release notes advertise.
  it('two object-literal functions with the same own name stay distinct', () => {
    const builds = maxFunctionLines(3)
      .evaluate(subjects, context)
      .filter((v) => v.element === 'build')
    // The identity NAMES, asserted as a list — not `size === length`, which is
    // two counts and would pass on any two distinct strings including a
    // positional `#N` suffix. `disambiguateIdentities` would have supplied
    // exactly that, and a `#N` keys a ratchet ceiling to a slot rather than to a
    // function, which is the fail-open bug 0068's severity rests on.
    const names = builds.map((v) => String(v.identity).split('::')[1] ?? '').sort()
    // All FOUR spellings. `makeDelta`/`makeEpsilon` use method shorthand, which is
    // a MethodDeclaration and therefore HAS its own name — so a scope taken from
    // `getElementName` returned `build` and skipped the prefix. The arrow rows
    // passed while these collided: same code, two spellings, one guarded.
    expect(names).toEqual([
      'makeBeta.build',
      'makeDelta.build',
      'makeEpsilon.build',
      'makeGamma.build',
    ])
  })

  it('a nested function whose name equals its enclosing function stays distinct', () => {
    // The `own === scope` short-circuit read this as "the scope is me" and dropped
    // the prefix, so `save`'s own finding and the `save` it returns shared one
    // identity — bug 0068's exact shape, surviving inside its own fix.
    const saves = maxFunctionLines(3)
      .evaluate(subjects, context)
      .filter((v) => v.element === 'save')
    const names = saves.map((v) => String(v.identity).split('::')[1] ?? '').sort()
    expect(names).toEqual(['save', 'save.save'])
  })

  it('the identity and element name the function the message names', () => {
    for (const condition of [
      maxFunctionLines(3),
      maxFunctionParameters(4),
      maxFunctionComplexity(0),
    ]) {
      for (const v of condition.evaluate(subjects, context)) {
        const named = v.message.split(' has ')[0] ?? ''
        // ENDS WITH, not contains-exactly: the identity may carry a scope prefix
        // (`makeAlpha.errorResponseBuilder`) that the display name does not. The
        // defect was the identity naming a DIFFERENT function, not a longer one.
        expect(v.identity).toContain(`${named}::`)
        // `element` is what the terminal prints, what JSON reports, and one of
        // the three fields string-form `.excluding()` matches by exact
        // membership — so it has to agree exactly, not just the identity.
        expect(v.element).toBe(named)
      }
    }
  })

  // The census the bug asked for. It is a ts-morph parse, not a regex: the first
  // version matched `\n {12}context,` and every real call site is indented 14 or
  // 16, so it inspected 0 of 9 and could never fail — shipped inside the guard for
  // a bug filed under ADR-008, and caught only because five reviewers measured it.
  //
  // Two lessons are encoded here. The FIRST is the vacuity guard below: a census
  // asserts something about a population, so it must first assert the population
  // is the one it means. The SECOND is that the invariant the first version stated
  // was false anyway — three call sites legitimately omit `qualifiedName` because
  // their node IS the named element, so `offenders === []` would have redded on
  // correct code. They are listed by name, which makes an addition to that list a
  // reviewed decision rather than a silent one.
  it('every metricViolation call site is accounted for', () => {
    const EXEMPT_BECAUSE_THE_NODE_IS_THE_NAMED_ELEMENT = [
      'metrics.ts:maxClassLines',
      'metrics.ts:maxMethods',
      'members.ts:maxProperties',
    ]

    const project = new Project({ compilerOptions: { allowJs: false } })
    // All of `src`, not two chosen folders: a metric producer added under
    // `src/smells/` or `src/builders/` would otherwise ship the same defect with
    // the census green, and "derived, not listed" would hold only where someone
    // remembered to look.
    const roots = [path.resolve(import.meta.dirname, '../../src')]
    const files = roots.flatMap((abs) =>
      fs
        .readdirSync(abs, { recursive: true, encoding: 'utf8' })
        .filter((f) => f.endsWith('.ts'))
        .map((f) => path.join(abs, f)),
    )

    let textualOccurrences = 0
    const parsed: { where: string; passes: boolean }[] = []
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8')
      // CALLS only. Widening the scan to all of `src` brought in the function's
      // own declaration (`export function metricViolation(`), and the vacuity
      // guard below caught the 10-vs-9 mismatch rather than letting the census
      // quietly under-count — which is the whole point of asserting the
      // population before asserting anything about it.
      textualOccurrences += [...text.matchAll(/(?<!function\s)metricViolation\(/g)].length
      const sf = project.createSourceFile(file, text, { overwrite: true })
      for (const callNode of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        if (callNode.getExpression().getText() !== 'metricViolation') continue
        const options = callNode.getArguments()[1]
        const passes =
          options !== undefined &&
          Node.isObjectLiteralExpression(options) &&
          options.getProperty('qualifiedName') !== undefined
        const owner = callNode.getFirstAncestor(
          (a) => Node.isVariableDeclaration(a) || Node.isFunctionDeclaration(a),
        )
        const name =
          Node.isVariableDeclaration(owner) || Node.isFunctionDeclaration(owner)
            ? (owner.getName() ?? '?')
            : '?'
        parsed.push({ where: `${path.basename(file)}:${name}`, passes })
      }
    }

    // The census's own vacuity guard: every textual occurrence was parsed, and
    // there are enough of them that this is a population and not an accident.
    // `0 === 0` is green, which is exactly how the first version passed.
    expect(parsed.length).toBe(textualOccurrences)
    expect(parsed.length).toBeGreaterThanOrEqual(9)

    // Identity, not emptiness — rule 5: "counting is the shortcut".
    expect(
      parsed
        .filter((c) => !c.passes)
        .map((c) => c.where)
        .sort(),
    ).toEqual([...EXEMPT_BECAUSE_THE_NODE_IS_THE_NAMED_ELEMENT].sort())
  })
})

/**
 * The claim `docs/upgrading.md` makes about this release, tested behaviourally
 * rather than by reading the message — ADR-008 rule 2's corollary: apply the
 * stated remedy and assert the finding clears.
 *
 * Bug 0068's own "Not measured" section named this and it was still not measured
 * when the fix shipped: *"`.excluding()` matches against [element, file, message],
 * so an exclusion written against the message may not match the element."*
 */
describe('what the element change does to .excluding() (bug 0068)', () => {
  const rule = (): ReturnType<typeof functionsIn> => functionsIn()

  it('an exclusion written against the printed name now silences that finding', () => {
    const before = rule().should().satisfy(maxFunctionLines(3)).violations()
    expect(before.map((v) => v.element)).toContain('errorResponseBuilder')

    const after = rule()
      .should()
      .satisfy(maxFunctionLines(3))
      .excluding('errorResponseBuilder')
      .violations()
    expect(after.map((v) => v.element)).not.toContain('errorResponseBuilder')
  })

  it('excluding the enclosing function no longer silences the arrows inside it', () => {
    // The over-broad exclusion. Before this release the inner arrow's element WAS
    // `makeAlpha`, so one pattern silenced findings the author never named — and
    // silently, because the pattern still matched the outer finding, so the
    // stale-exclusion warning never fired.
    const after = rule().should().satisfy(maxFunctionLines(3)).excluding('makeAlpha').violations()
    expect(after.map((v) => v.element)).not.toContain('makeAlpha')
    expect(after.map((v) => v.element)).toContain('errorResponseBuilder')
  })
})
