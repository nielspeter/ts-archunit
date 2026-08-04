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
import { Project } from 'ts-morph'
import { STUB_PATTERNS, comment } from '../../src/helpers/matchers.js'
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

describe('a shipped default pattern has not moved unnoticed (bug 0060)', () => {
  it('the set of shipped default patterns is what this file believes it is', () => {
    // Non-vacuity, and the part that rots: if a second default pattern is added and not
    // listed here, the row below passes while the new one is unguarded. Asserted by
    // identity so adding one is a deliberate edit rather than a silent omission.
    expect(SHIPPED_DEFAULTS.map(([name]) => name)).toEqual(['STUB_PATTERNS'])
  })

  it.each(SHIPPED_DEFAULTS)('%s', (name, pattern) => {
    // The exact source form, because that is what reaches the identity.
    const expected =
      '/(?:^|\\n)[ \\t]*(?:\\/\\/+|\\/\\*+|\\*+)?[ \\t]*(?:TODO|FIXME|HACK|XXX|STUB|DEFERRED|PLACEHOLDER)\\b|(?:^|\\n)[ \\t]*(?:\\/\\/+|\\/\\*+|\\*+)?[ \\t]*(?:[Nn]ot\\s+[Ii]mplemented|[Cc]oming\\s+[Ss]oon)\\b/'

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
