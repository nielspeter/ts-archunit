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
import { Project } from 'ts-morph'
import { collectFunctions } from '../../src/models/arch-function.js'
import {
  maxFunctionComplexity,
  maxFunctionLines,
  maxFunctionParameters,
} from '../../src/rules/metrics-function.js'
import type { ArchViolation } from '../../src/core/violation.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/metrics')
const project = new Project({ tsConfigFilePath: path.join(fixturesDir, 'tsconfig.json') })

const sourceFile = project.getSourceFileOrThrow((sf) =>
  sf.getFilePath().endsWith('nested-object-literal.ts'),
)
/** The object-literal arrows are the subjects at issue, so they must be collected. */
const functions = collectFunctions(sourceFile, { includeObjectLiteralFunctions: true })
const context = { rule: 'test rule' }

const namesIn = (vs: ArchViolation[]): string[] => vs.map((v) => v.message.split(' has ')[0] ?? '')

describe('a function metric identifies the function its message names (bug 0068)', () => {
  // Guarding the guard: if the fixture stopped producing BOTH findings, every
  // identity assertion below would hold vacuously over one element.
  it('CONTROL: the fixture makes the inner and outer function both breach', () => {
    const found = namesIn(maxFunctionLines(3).evaluate(functions, context))
    expect(found).toContain('makeAlpha')
    expect(found).toContain('errorResponseBuilder')
  })

  it.each([
    ['lines', maxFunctionLines(3)],
    ['complexity', maxFunctionComplexity(0)],
    ['parameters', maxFunctionParameters(4)],
  ])('%s: every finding carries its own identity', (_metric, condition) => {
    const violations = condition.evaluate(functions, context)
    // Not a count assertion — a count is exactly what survives the bug.
    expect(violations.length).toBeGreaterThan(1)
    const identities = new Set(violations.map((v) => v.identity))
    expect(identities.size).toBe(violations.length)
  })

  it('the identity and element agree with the name in the message', () => {
    for (const condition of [maxFunctionLines(3), maxFunctionParameters(4)]) {
      for (const v of condition.evaluate(functions, context)) {
        const named = v.message.split(' has ')[0] ?? ''
        expect(v.identity).toContain(`::${named}::`)
        // `element` is what the terminal prints, what JSON reports, and one of
        // the three fields string-form `.excluding()` matches by exact
        // membership — so it has to agree too, not just the identity.
        expect(v.element).toBe(named)
      }
    }
  })

  // The census the bug asked for, derived rather than listed: a call site that
  // omits `qualifiedName` is a candidate for the same defect, and a NEW metric
  // rule added tomorrow joins this check by existing.
  it('every metricViolation call site passes qualifiedName', () => {
    const roots = ['src/rules', 'src/conditions']
    const files = roots.flatMap((dir) => {
      const abs = path.resolve(import.meta.dirname, '../../', dir)
      return fs
        .readdirSync(abs, { recursive: true, encoding: 'utf8' })
        .filter((f) => f.endsWith('.ts'))
        .map((f) => path.join(abs, f))
    })

    const offenders: string[] = []
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8')
      // Each `metricViolation(` call, up to the closing of its options object.
      for (const match of text.matchAll(/metricViolation\(([\s\S]*?)\n {12}context,/g)) {
        if (!match[1]?.includes('qualifiedName')) {
          offenders.push(path.relative(process.cwd(), file))
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
