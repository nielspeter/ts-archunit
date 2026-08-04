/**
 * A shipped default pattern is part of a baseline identity, so changing it is a migration.
 *
 * [Bug 0060](../../bugs/fixed/0060-a-pattern-change-silently-invalidates-every-baselined-finding.md).
 * v0.47.0 rebuilt `STUB_PATTERNS` from a ~90-character case-insensitive regex to a
 * ~200-character anchored one, and **every baselined `noStubComments` finding stopped
 * matching**. Measured following the documented upgrade recipe: 0 of 4 entries matched.
 * The v0.47.0 upgrade note mentioned baselines only for cycles.
 *
 * ## Why the pattern is in the identity at all
 *
 * `identifyMatches` builds `kind::filePath::element::matcherDescription#ordinal`, and for
 * `comment(STUB_PATTERNS)` the matcher description **is** `comment matching /…/`. So the
 * pattern text is inside the identity, not merely inside the rendered message — which is
 * why "just set an identity" does not fix it, and why removing it from the identity is a
 * genuine design decision with no free option (the report has the table).
 *
 * ## What this file is, and what it is not
 *
 * It is a **change detector**, not a behavioural assertion. ADR-008 is against snapshot
 * pins, and rightly — a pin that stands in for a real assertion is coverage theatre. This
 * one stands in for nothing: `tests/conditions/stubs.test.ts` asserts what the pattern
 * MATCHES, by identity, in sixteen rows. This asserts only that the pattern's `String()`
 * form has not moved without anyone noticing, because that form is a baseline input and
 * the failure mode is silent.
 *
 * Its whole job is to make a release note impossible to forget. If it fails, the change may
 * be entirely correct — see the remedy in the failure message.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { Project } from 'ts-morph'
import { STUB_PATTERNS, comment, anyCase } from '../../src/helpers/matchers.js'
import { identifyMatches } from '../../src/conditions/match-identity.js'

/**
 * Every pattern that is BOTH a shipped default and a public export.
 *
 * Both halves matter. A default means a user's rule inherits it without naming it, so they
 * cannot see the dependency; a public export means they may also have written it into a
 * rule themselves.
 */
const SHIPPED_DEFAULTS: ReadonlyArray<readonly [string, RegExp]> = [
  ['STUB_PATTERNS', STUB_PATTERNS],
]

const REMEDY = [
  'A shipped default pattern changed its String() form.',
  '',
  'That is a BASELINE MIGRATION, not a cosmetic edit: the pattern text is part of',
  "`identifyMatches`'s identity, so every baselined finding produced through it stops",
  'matching and is reported as new. The tool cannot diagnose this at runtime — both the',
  'rule description and the subject move together, so the rename detector stays silent',
  'and the reader is left guessing at their `root`.',
  '',
  'If the change is correct, do all three:',
  '  1. update the expected string below;',
  '  2. add a CHANGELOG entry saying baselines for the affected rules must be regenerated;',
  '  3. add the row to docs/upgrading.md, scoped by the rules a user would recognise.',
].join('\n')

describe('anyCase builds a pattern that matches the word it was built from', () => {
  // `anyCase` exists because the `i` flag cannot be used — the MARKER branch must stay
  // case-sensitive — so the phrase branch alternates its own letters. Exported for this
  // test only; it is deliberately absent from `src/index.ts`, so it is not public API.
  //
  // Two silent-wrongness traps were found in it, one release apart, and BOTH by review
  // rather than by any failing test:
  //
  //  1. metacharacters were unescaped, so `todo(x)` became a capture group;
  //  2. a case mapping is not one-to-one — `'ß'.toUpperCase()` is `'SS'` — so a character
  //     CLASS silently could not match its own uppercase form.
  //
  // Neither threw. The property that catches both is the round trip: whatever the input,
  // the pattern must match that input in every casing.
  const WORDS = [
    'not',
    'implemented',
    'coming',
    'soon',
    // regex metacharacters
    'todo(x)',
    'wip.',
    'a+b',
    'c[d]',
    'e|f',
    // multi-character case mappings
    'straße',
    'ß',
    'ﬁ',
  ]

  it.each(WORDS)('%s round-trips in every casing', (word) => {
    const re = new RegExp(`^(?:${anyCase(word)})$`)
    expect(re.test(word)).toBe(true)
    expect(re.test(word.toLowerCase())).toBe(true)
    expect(re.test(word.toUpperCase())).toBe(true)
  })

  it('and does NOT match a different word — the discrimination', () => {
    // Without this, `anyCase` returning `.*` would satisfy every row above.
    const re = new RegExp(`^(?:${anyCase('not')})$`)
    expect(re.test('nut')).toBe(false)
    expect(re.test('no')).toBe(false)
    expect(re.test('nott')).toBe(false)
  })

  it('a metacharacter is matched LITERALLY, not interpreted', () => {
    // The specific failure: `todo(x)` as a capture group would match `todox`.
    const re = new RegExp(`^(?:${anyCase('todo(x)')})$`)
    expect(re.test('todo(x)')).toBe(true)
    expect(re.test('TODO(X)')).toBe(true)
    expect(re.test('todox')).toBe(false)
  })
})

describe('a shipped default pattern has not moved unnoticed (bug 0060)', () => {
  it('the guarded set is DERIVED from source, not believed', () => {
    // This row asserted `toEqual(['STUB_PATTERNS'])` — a hand-maintained belief about a
    // hand-maintained list, which is the shape plan 0079 exists to reject: it pins what I
    // think the population is, so a second default pattern arriving is invisible to it.
    //
    // Derive it instead. A "shipped default pattern" is a `RegExp`-typed parameter with a
    // default, in a function `src/index.ts` exports — that is what makes a user's rule
    // inherit the pattern without ever naming it, which is the whole exposure.
    const srcRoot = path.resolve(import.meta.dirname, '../../src')
    const files = (function walk(dir: string): string[] {
      return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name)
        return e.isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : []
      })
    })(srcRoot)

    // Non-vacuity on the walk itself, before it is used to justify anything.
    expect(files.length).toBeGreaterThan(100)

    const found = new Set<string>()
    for (const file of files) {
      for (const match of fs
        .readFileSync(file, 'utf-8')
        .matchAll(/:\s*RegExp\s*=\s*([A-Z][A-Z0-9_]*)/g)) {
        // `match[1]` is `string | undefined` under `noUncheckedIndexedAccess`, and a
        // narrowing guard rather than a cast (ADR-005). A group that somehow did not
        // capture would silently add `undefined` to a `Set<string>` otherwise.
        const name = match[1]
        if (name !== undefined) found.add(name)
      }
    }

    // Every derived default must be guarded below. If this fails, add it to
    // SHIPPED_DEFAULTS — do not relax the derivation.
    expect([...found].sort()).toEqual(SHIPPED_DEFAULTS.map(([n]) => n).sort())
  })

  it('VACUITY: the derivation really finds something', () => {
    // The row above compares two sets, so it passes when BOTH are empty — a broken regex
    // and an empty list agree perfectly. Assert the derivation is non-empty separately, and
    // prove the pattern matches the shape it is looking for.
    expect(SHIPPED_DEFAULTS.length).toBeGreaterThan(0)
    expect('export function f(pattern: RegExp = STUB_PATTERNS): void {}').toMatch(
      /:\s*RegExp\s*=\s*([A-Z][A-Z0-9_]*)/,
    )
    // And that it does NOT match a non-default RegExp parameter, or every function taking
    // one would be listed.
    expect('export function g(pattern: RegExp): void {}').not.toMatch(
      /:\s*RegExp\s*=\s*([A-Z][A-Z0-9_]*)/,
    )
  })

  it.each(SHIPPED_DEFAULTS)('%s', (name, pattern) => {
    // The exact source form, because that is what reaches the identity.
    // Updated for v0.55.0 (bug 0061), following this file's own three-step remedy: the
    // phrase branch's casing is now derived per letter rather than hand-alternated on the
    // first. The CHANGELOG and upgrading rows are steps 2 and 3.
    const expected =
      '/(?:^|\\n)[ \\t]*(?:\\/\\/+|\\/\\*+|\\*+)?[ \\t]*(?:TODO|FIXME|HACK|XXX|STUB|DEFERRED|PLACEHOLDER)\\b|(?:^|\\n)[ \\t]*(?:\\/\\/+|\\/\\*+|\\*+)?[ \\t]*(?:[Nn][Oo][Tt]\\s+[Ii][Mm][Pp][Ll][Ee][Mm][Ee][Nn][Tt][Ee][Dd]|[Cc][Oo][Mm][Ii][Nn][Gg]\\s+[Ss][Oo][Oo][Nn])\\b/'

    expect(String(pattern), `${name}\n\n${REMEDY}\n`).toBe(expected)
  })

  it('the pattern really is inside the identity — the reason this file exists', () => {
    // Without this row the file is an unexplained snapshot, and the next reader deletes it
    // as churn. Prove the coupling instead of asserting it in a comment: the matcher's
    // description carries the pattern, and `identifyMatches` puts the description in the
    // identity.
    //
    // My first version of this row was `expect(\`comment matching \${p}\`).toContain(p)` —
    // a tautology that proves nothing about the library. Caught reviewing my own file.
    // The real coupling runs through the MATCHER's description and then through
    // `identifyMatches`, so assert both links.
    const description = comment(STUB_PATTERNS).description
    expect(description).toContain(String(STUB_PATTERNS))

    const identities = identifyMatches('function-body', '/f.ts', [], description)
    expect(identities).toEqual([]) // no nodes, no identities — the shape, not the content

    // With a node, the description (and therefore the pattern) is in the identity.
    const tsm = new Project({ useInMemoryFileSystem: true })
    const sf = tsm.createSourceFile('/f.ts', 'export function f(): number {\n  return 1\n}\n')
    const fn = sf.getFunctions()[0]!
    const withNode = identifyMatches('function-body', '/f.ts', [fn], description)
    expect(withNode[0]).toContain(String(STUB_PATTERNS))
  })
})
