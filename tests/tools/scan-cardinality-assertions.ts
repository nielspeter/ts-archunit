/**
 * Plan 0079's scan: `it()` blocks that assert a non-zero cardinality and never
 * say WHICH elements they expect.
 *
 * [ADR-008](../../adr/008-agent-first-failure-surfaces.md) rule 5's third
 * corollary — _counting is the shortcut; compare identities, not integers._ A
 * block asserting `toHaveLength(3)` passes when a change loses one element and
 * gains another.
 *
 * ## Why this is committed rather than run once and quoted
 *
 * [Plan 0079](../../plans/completed/0079-triage-the-cardinality-only-assertions.md)
 * was filed with a population of **215** and no script, so the number could not
 * be reproduced or audited — and its successor made the same mistake one level
 * up: the plan's write-up cited a script in a scratch directory that was never
 * committed, while claiming in the changelog to have "recorded a script rather
 * than a remembered number". Review caught it. Every number in that write-up
 * (129, 166, 143, 45) came from this code, so this code is the artifact.
 *
 * Precedent: `tests/docs/scan-markdown.ts`, committed for the same reason.
 *
 * Not a lint rule, deliberately — see plan 0079's Out of Scope. The
 * false-positive rate is the whole difficulty, so a rule enforcing this would red
 * on classes A and B forever. Run it, read the output, decide.
 */
import fs from 'node:fs'
import path from 'node:path'

/** A block in the population: where it is, and what it counts. */
export interface CountOnlyBlock {
  readonly file: string
  readonly line: number
  readonly name: string
  readonly counts: readonly string[]
}

const IT = /^(\s*)it(?:\.each\([\s\S]*?\))?\(\s*[`'"]/

/**
 * Assertions that pin a non-zero count.
 *
 * `toHaveLength(0)` is deliberately absent: the empty set **is** an identity.
 */
const CARDINALITY: readonly RegExp[] = [
  /toHaveLength\(\s*([1-9]\d*)\s*\)/,
  /\.length\s*\)\s*\.toBe\(\s*([1-9]\d*)\s*\)/,
  /\.length\s*\)\s*\.toEqual\(\s*([1-9]\d*)\s*\)/,
  /\.size\s*\)\s*\.toBe\(\s*([1-9]\d*)\s*\)/,
  /toHaveBeenCalledTimes\(\s*([1-9]\d*)\s*\)/,
]

/**
 * Matchers that pin WHICH elements.
 *
 * The test for membership here is the plan's own question: *would this block
 * still pass if one element were lost and another gained?* So `toBeTruthy`,
 * `toThrow`, `toBeGreaterThan` and `toBeDefined` are **not** identity signals —
 * a block asserting `toHaveLength(3)` alongside `toBeTruthy()` survives a swap.
 * Counting them reported a population of 129; under this definition it is 166,
 * and larger is the honest direction for an upper bound.
 */
const IDENTITY =
  /toEqual\(|toStrictEqual\(|toContain\(|toContainEqual\(|toMatchObject\(|toMatch\(|toMatchInlineSnapshot|toMatchSnapshot|toHaveProperty|toBe\(\s*['"`]|arrayContaining|objectContaining|stringContaining|toHaveBeenCalledWith|toHaveBeenLastCalledWith/

/**
 * A boolean assertion **about a specific element** is an identity assertion.
 *
 * The first version of this scan missed every one of these, and a hand-read
 * sample of 30 found five: `.some((m) => m.includes('"offset"'))`,
 * `matcher.matches(nonNullExprs[0]!)`, `REGEX.test(descriptions[0] ?? '')`. They
 * pin which element through `expect(...).toBe(true)`, which `IDENTITY` above
 * excludes on purpose because a *bare* `toBe(true)` pins nothing.
 *
 * So the subject has to reach into the collection through a **predicate over
 * members** — `.some(`, `.every(`, `.find(`, `.includes(`, `.test(`, `.matches(`.
 *
 * A bare index is deliberately NOT enough, and the first version of this signal
 * got that wrong: `expect(violations[0]).toBeTruthy()` reaches into the
 * collection and pins nothing about which element is there, so counting it
 * excluded a genuine member. Found by the probe in this module's test, which is
 * the false-negative direction a review pointed out had never been checked —
 * every earlier check could only confirm the signal shrank the population.
 *
 * All five idioms that motivated the signal are matched by the predicate list
 * alone, so removing the bare-index arm cost nothing.
 */
const ELEMENT_BOOLEAN =
  /expect\(\s*[^)]*?(?:\.some\(|\.every\(|\.find\(|\.includes\(|\.test\(|\.matches\()[\s\S]{0,200}?\)\s*\.(?:toBe\(\s*(?:true|false)\s*\)|toBeTruthy\(\)|toBeFalsy\(\))/

/** Every `it()` block in a file, as (1-based start line, source text). */
function blocksIn(text: string): { line: number; body: string }[] {
  const lines = text.split('\n')
  const out: { line: number; body: string }[] = []
  for (const [i, line] of lines.entries()) {
    const match = IT.exec(line)
    if (match === null) continue
    const indent = (match[1] ?? '').length
    const body: string[] = [line]
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j] ?? ''
      if (next.trim() !== '' && !next.startsWith(' '.repeat(indent + 1)) && j > i + 1) break
      body.push(next)
    }
    out.push({ line: i + 1, body: body.join('\n') })
  }
  return out
}

/** Every `.test.ts` under `dir`, recursively. */
export function testFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.test.ts')) out.push(full)
    }
  }
  walk(dir)
  return out.sort()
}

/**
 * Scan for count-only blocks.
 *
 * Returns the population and the total number of blocks seen — the total is what
 * makes a broken walk visible, since a scan that reads nothing reports an empty
 * population and looks like a clean repo.
 */
export function scanCardinalityAssertions(repo: string): {
  population: CountOnlyBlock[]
  blocksScanned: number
} {
  const population: CountOnlyBlock[] = []
  let blocksScanned = 0
  for (const file of testFiles(path.join(repo, 'tests'))) {
    // The mechanism does not scan itself.
    //
    // This module's test holds `it(...)` snippets as template literals — probe
    // inputs for the two signals — and the scan read them as real blocks and
    // reported its own fixtures as members. Same shape as
    // [bug 0036](../../bugs/fixed/0036-the-relative-glob-audit-is-incomplete.md),
    // where a census counted the file that defined the thing it was counting.
    if (path.basename(file) === 'scan-cardinality-assertions.test.ts') continue
    const text = fs.readFileSync(file, 'utf-8')
    for (const { line, body } of blocksIn(text)) {
      blocksScanned += 1
      const counts = CARDINALITY.flatMap((rx) => rx.exec(body)?.slice(1) ?? [])
      if (counts.length === 0) continue
      if (IDENTITY.test(body) || ELEMENT_BOOLEAN.test(body)) continue
      population.push({
        file: path.relative(repo, file),
        line,
        name: /[`'"]([^`'"]{3,120})/.exec(body)?.[1] ?? '(unnamed)',
        counts,
      })
    }
  }
  return { population, blocksScanned }
}
