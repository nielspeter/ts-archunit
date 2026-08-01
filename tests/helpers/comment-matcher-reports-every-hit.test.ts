import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { comment, expression } from '../../src/helpers/matchers.js'
import { moduleNotContain, moduleUseInsteadOf } from '../../src/conditions/body-analysis-module.js'
import { functionNotContain } from '../../src/conditions/body-analysis-function.js'
import { functions, calls } from '../../src/index.js'
import { notHaveCallbackContaining } from '../../src/conditions/call.js'
import type { ConditionContext } from '../../src/core/condition.js'
import type { ArchProject } from '../../src/core/project.js'

const fixtureDir = path.resolve(import.meta.dirname, '../fixtures/comments')
const tsconfigPath = path.join(fixtureDir, 'tsconfig.json')
const directivesPath = path.join(fixtureDir, 'src/directives.ts')

function loadProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

const p = loadProject()
const ctx: ConditionContext = { rule: 'test rule' }

const byName = (name: string) => {
  const found = p.getSourceFiles().find((f) => f.getBaseName() === name)
  if (found === undefined) throw new Error(`fixture ${name} missing`)
  return found
}
const sourceFile = () => byName('directives.ts')
const linesOf = (matcher = comment('@ts-ignore'), file = sourceFile()) =>
  moduleNotContain(matcher)
    .evaluate([file], ctx)
    .map((v) => v.line)

/**
 * An INDEPENDENT derivation of where the directives are: a raw text scan, no
 * ts-morph. Hard-coding `[1, 3, 5, …]` was how the first version of this file
 * came to pin an under-report as correct — the number looked plausible and only
 * the fixture could contradict it. A maintainer who adds a line to the fixture
 * now gets a passing test instead of a renumbering exercise, and a regression
 * cannot hide behind an expectation that was edited to match it.
 */
function directiveLinesFromText(): number[] {
  return fs
    .readFileSync(directivesPath, 'utf8')
    .split('\n')
    .flatMap((text, i) => (text.includes('@ts-ignore') ? [i + 1] : []))
}

/**
 * Bug 0034 — `comment()` under-reported, named the wrong line, and went silent
 * on re-evaluation.
 *
 * All three were present while **2767 tests passed**, because every existing
 * test builds a fresh matcher and asserts *that* a violation was found rather
 * than *which*. These assert which.
 */
describe('the comment matcher reports every hit, once, at the right line (bug 0034)', () => {
  it('reports EVERY directive in the file, and nothing else', () => {
    const expected = directiveLinesFromText()
    // Fixture-shape guard: fails loudly if someone guts the fixture, rather
    // than letting the comparison below succeed over two shrinking sets.
    expect(expected.length).toBeGreaterThanOrEqual(11)
    expect(linesOf()).toEqual(expected)
  })

  it('reports BOTH of two comments stacked on one node', () => {
    // The residual the first fix shipped with, and the reason this file exists
    // in its second form. One finding per NODE collapsed these to one — a
    // ratchet hole in `noStubComments()` exactly where an agent stacks stubs:
    // measured, four `// TODO` lines under one statement produced one finding,
    // so appending more never turned a baselined build red.
    expect(linesOf().filter((l) => l === 15 || l === 16)).toEqual([15, 16])
  })

  it('the remedy remediates — deleting every reported line clears the rule', () => {
    // ADR-008 rule 2, asked of this fix's own output. An agent told "remove the
    // directive at line N" removes it, re-runs, and must not find a new one
    // that was there all along. This is the assertion that catches an
    // under-report without knowing what the right count is.
    const kill = new Set(linesOf())
    const remaining = fs
      .readFileSync(directivesPath, 'utf8')
      .split('\n')
      .filter((_, i) => !kill.has(i + 1))
      .join('\n')
    const scratch = new Project({ useInMemoryFileSystem: true })
    const cleaned = scratch.createSourceFile('/after-remedy.ts', remaining)
    expect(moduleNotContain(comment('@ts-ignore')).evaluate([cleaned], ctx)).toEqual([])
  })

  it('names the COMMENT line, exactly, not the line of the node it leads', () => {
    // `toContain('at line 1')` was the first version and is satisfied by "at
    // line 15" — measured. Assert the whole message.
    const [first] = moduleNotContain(comment('@ts-ignore')).evaluate([sourceFile()], ctx)
    expect(first?.line).toBe(1)
    expect(first?.message).toBe("directives.ts contains comment containing '@ts-ignore' at line 1")
  })

  it('names the OPENING line of a multi-line block comment', () => {
    // `getPos()` vs `getEnd()`: for `//` comments the two share a line, so an
    // all-`//` fixture cannot tell them apart and the sabotage row passed.
    // Here they differ by three lines.
    // The comment opens at 29 and closes at 32; `getEnd()` would name 32.
    expect(linesOf()).toContain(29)
    expect(linesOf()).not.toContain(32)
  })

  it('covers block, JSDoc and trailing comments, not just line comments', () => {
    const lines = linesOf()
    expect(lines).toContain(19) // /* block */
    expect(lines).toContain(22) // /** jsdoc */
    expect(lines).toContain(27) // trailing
  })

  it('reports a comment that is the entire file', () => {
    // The `@ts-nocheck` kill-switch shape: attached to EndOfFileToken, with no
    // statement to lead.
    expect(linesOf(comment('@ts-ignore'), byName('only-a-comment.ts'))).toEqual([1])
  })

  it('returns the same result when the SAME rule object runs twice', () => {
    // The severest defect: a dedup Set in the matcher's closure was never
    // reset, so a hoisted builder reported findings once and then nothing.
    // `docs/running-in-tests.md` recommends hoisting, so this hit people
    // following the documentation.
    const condition = moduleNotContain(comment('@ts-ignore'))
    const first = condition.evaluate([sourceFile()], ctx)
    const second = condition.evaluate([sourceFile()], ctx)
    expect(first.length).toBeGreaterThan(0)
    expect(second).toEqual(first)
  })

  it('reports every hit in EVERY file of one evaluation', () => {
    // Narrower than the above and not implied by it: dedup scoped to an
    // evaluation rather than to a file would pass the re-evaluation test while
    // the second file went silent, because two files' comment positions
    // collide.
    // A separate project: adding files to `p` leaks them into every later
    // lookup in this file — measured, `outer` was then found twice and the
    // function-scope test reported each comment twice.
    const scratch = new Project({ useInMemoryFileSystem: true })
    const text = fs.readFileSync(directivesPath, 'utf8')
    const a = scratch.createSourceFile('/a.ts', text)
    const b = scratch.createSourceFile('/b.ts', text)
    const found = moduleNotContain(comment('@ts-ignore')).evaluate([a, b], ctx)
    const expected = directiveLinesFromText().length
    expect(found.filter((v) => v.element === 'a.ts').length).toBe(expected)
    expect(found.filter((v) => v.element === 'b.ts').length).toBe(expected)
  })

  it('does not report one comment twice', () => {
    const found = moduleNotContain(comment('@ts-ignore')).evaluate([sourceFile()], ctx)
    // Non-empty first: `new Set([]).size === 0 === [].length` passes for a
    // matcher that finds nothing, which is the vacuity this file is about.
    expect(found.length).toBeGreaterThan(0)
    const keys = found.map((v) => `${v.file}:${String(v.line)}:${v.message}`)
    expect(new Set(keys).size).toBe(found.length)
  })

  it('reports per-hit lines at function scope too', () => {
    const fn = functions(p)
      .that()
      .haveNameMatching(/^outer$/)
      .subjects()
    const found = functionNotContain(comment('@ts-ignore')).evaluate([...fn], ctx)
    // The `line` FIELD is the function's, by design — `createFunctionViolation`
    // attributes the finding to the element, as class scope does. The per-hit
    // line is in the message.
    expect(found.map((v) => /at line (\d+)/.exec(v.message)?.[1])).toEqual(['9', '11'])
  })

  it('threads the right matcher through useInsteadOf, which takes two', () => {
    // `reportedLine(node, good)` instead of `bad` compiles, type-checks, reads
    // correctly and was caught by nothing. Two comment matchers discriminate:
    // the reported line must be the BAD one's comment.
    const found = moduleUseInsteadOf(comment('@ts-ignore'), comment('@ts-expect-error')).evaluate(
      [sourceFile()],
      ctx,
    )
    // Plus one trailing finding for "the good matcher found nothing", which is
    // this condition's pre-existing shape and not about a comment.
    const perHit = found.filter((v) => v.message.includes('contains'))
    expect(perHit.map((v) => v.line)).toEqual(directiveLinesFromText())
  })

  it('reports in SOURCE order, even when the traversal does not visit that way', () => {
    // Pre-order visits an enclosing node's TRAILING range before the statements
    // it spans, so a file whose first line ends in a trailing comment comes out
    // `4,1,2` without the sort — measured. Findings out of order read badly and
    // fix the baseline ordinals in that order too.
    expect(linesOf(comment('@ts-ignore'), byName('ordering.ts'))).toEqual([1, 2, 4])
  })

  it('names the comment line inside a callback, which is a separate code path', () => {
    // `notHaveCallbackContaining` and `notHaveArgumentContaining` build their
    // own messages in `conditions/call.ts` and were missed by the first fix —
    // defect B stayed live there, reported one line low, and nothing failed.
    const found = calls(p)
      .that()
      .onObject('items')
      .should()
      .satisfy(notHaveCallbackContaining(comment('@ts-ignore')))
      .violations()
    expect(found).toHaveLength(1)
    expect(found[0]?.message).toContain('at line 5')
  })

  it('CONTROL: a pattern that matches nothing reports nothing, and one that matches still does', () => {
    // Paired, because on its own an empty result cannot distinguish "no match"
    // from "the traversal is dead".
    expect(linesOf(comment('@ts-nothing-here'))).toEqual([])
    expect(linesOf(comment('@ts-ignore')).length).toBeGreaterThan(0)
  })

  it('CONTROL: a non-trivia matcher keeps the deepest-match rule', () => {
    // `expression()` matches at every ancestor level and the innermost is the
    // real hit. Weakening the containment test to STRICT — the obvious edit
    // after reading the "identical spans annihilate" note — produced 5 findings
    // where there are 2, and a `toBeLessThan(6)` bound accepted it.
    const found = moduleNotContain(expression(/inner/)).evaluate([sourceFile()], ctx)
    expect(found.map((v) => v.line)).toEqual([10, 12])
  })

  it('CONTROL: presence of matchedTriviaPositions is what marks a trivia matcher', () => {
    // One member, so the two cannot disagree. The previous shape was a flag
    // beside an accessor, and both mismatched states were silently wrong.
    expect('matchedTriviaPositions' in comment('x')).toBe(true)
    expect('matchedTriviaPositions' in expression(/x/)).toBe(false)
  })
})
