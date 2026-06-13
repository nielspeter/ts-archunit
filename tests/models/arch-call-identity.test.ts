import { describe, it, expect } from 'vitest'
import { Project, SyntaxKind } from 'ts-morph'
import { fromCallExpression } from '../../src/models/arch-call.js'

/**
 * Proposal 011 / Plan 0057 — argument-aware identity.
 *
 * `getName({ withArgument })` folds a string-literal argument into the
 * call's element name so rules can name and exclude individual
 * string-keyed registrations. `{ elide: true }` truncates long literals
 * in the message form; the element form NEVER elides.
 */
function firstCall(code: string) {
  const project = new Project({ useInMemoryFileSystem: true })
  const sf = project.createSourceFile('test.ts', code)
  return fromCallExpression(sf.getDescendantsOfKind(SyntaxKind.CallExpression)[0]!)
}

describe('ArchCall.getName({ withArgument })', () => {
  // --- Positive cases (literal hit) ---

  it('appends a string-literal argument, preserving quote style', () => {
    expect(firstCall(`app.post("/auth/token", h)`).getName({ withArgument: 0 })).toBe(
      `app.post("/auth/token")`,
    )
    expect(firstCall(`app.post('/auth/token', h)`).getName({ withArgument: 0 })).toBe(
      `app.post('/auth/token')`,
    )
  })

  it('appends a no-substitution template literal verbatim, including backticks', () => {
    expect(firstCall('app.post(`/auth/token`, h)').getName({ withArgument: 0 })).toBe(
      'app.post(`/auth/token`)',
    )
  })

  it('targets an argument by index, not just the first', () => {
    expect(firstCall(`flags.define(opts, "new-checkout")`).getName({ withArgument: 1 })).toBe(
      `flags.define("new-checkout")`,
    )
  })

  // --- Degrade cases (graceful fallback to bare callee) ---

  it('degrades on template-literal with substitution', () => {
    expect(firstCall('app.post(`/auth/${env}`, h)').getName({ withArgument: 0 })).toBe('app.post')
  })

  it('degrades on tagged templates', () => {
    expect(firstCall('app.post(sql`SELECT 1`, h)').getName({ withArgument: 0 })).toBe('app.post')
  })

  it('degrades on identifier and property-access arguments', () => {
    expect(firstCall(`app.post(ROUTES.AUTH, h)`).getName({ withArgument: 0 })).toBe('app.post')
    expect(firstCall(`app.post(routeName, h)`).getName({ withArgument: 0 })).toBe('app.post')
  })

  it('degrades on spread arguments', () => {
    expect(firstCall(`app.post(...routeArgs)`).getName({ withArgument: 0 })).toBe('app.post')
  })

  it('degrades on `as const` wrapping a string literal', () => {
    // `'/foo' as const` is an AsExpression whose `expression` is a StringLiteral —
    // the AsExpression itself is not a StringLiteral, so it degrades.
    expect(firstCall(`app.post('/foo' as const, h)`).getName({ withArgument: 0 })).toBe('app.post')
  })

  it('degrades on parenthesized expressions wrapping a string literal', () => {
    // `('/foo')` is a ParenthesizedExpression, not a StringLiteral — degrades.
    expect(firstCall(`app.post(('/foo'), h)`).getName({ withArgument: 0 })).toBe('app.post')
  })

  it('degrades on out-of-bounds index', () => {
    expect(firstCall(`app.post("/x")`).getName({ withArgument: 5 })).toBe('app.post')
  })

  it('degrades on non-string literals (numeric, boolean, null)', () => {
    expect(firstCall(`flags.define("k", true)`).getName({ withArgument: 1 })).toBe('flags.define')
    expect(firstCall(`version.set(2, h)`).getName({ withArgument: 0 })).toBe('version.set')
    expect(firstCall(`feature.set("k", null)`).getName({ withArgument: 1 })).toBe('feature.set')
  })

  // --- No-option backward compat ---

  it('returns the bare callee when no option is passed (backward compatible)', () => {
    expect(firstCall(`app.post("/auth/token", h)`).getName()).toBe('app.post')
  })

  it('returns the bare callee when withArgument is undefined (predicate-visible identity)', () => {
    expect(firstCall(`app.post("/auth/token", h)`).getName({})).toBe('app.post')
  })

  // --- Bare-function calls (no object — canonical non-HTTP shape) ---

  it('enriches bare-function calls (describe("auth") shape from proposal)', () => {
    // No object → fullName is just the function name. Enrichment still appends.
    expect(firstCall(`describe("auth", () => {})`).getName({ withArgument: 0 })).toBe(
      `describe("auth")`,
    )
  })

  it('enriches bare-function calls with template-literal arg', () => {
    expect(firstCall('describe(`auth flow`, () => {})').getName({ withArgument: 0 })).toBe(
      'describe(`auth flow`)',
    )
  })

  // --- Boundary literals ---

  it('enriches empty string-literal arguments (preserved verbatim)', () => {
    // `""` is still a StringLiteral — element becomes `app.post("")`.
    // Exclusion-stability requires the empty quotes to round-trip exactly.
    expect(firstCall(`app.post("", h)`).getName({ withArgument: 0 })).toBe(`app.post("")`)
  })

  // --- Edge inputs to identifiedByArg / withArgument ---

  it('negative index degrades to bare callee (does not crash)', () => {
    // expr.getArguments()[-1] === undefined → buildEnrichedSuffix returns undefined → bare.
    // Pins behavior against a future `args.at(-1)` refactor that would silently flip semantics.
    expect(firstCall(`app.post("/foo", h)`).getName({ withArgument: -1 })).toBe('app.post')
  })
})

describe('ArchCall.getName({ withArgument, elide })', () => {
  // The elide algorithm: if arg.getText().length > 80, the appended
  // literal is `slice(0, 38) + '…' + slice(-38)` (77 chars total
  // including the ellipsis). At-threshold (== 80) is NOT elided.

  it('elides literals longer than 80 chars in the message form', () => {
    // Literal getText is `"AAAA...AAAA"` — 100 letters between two quotes = 102 chars total.
    const longLiteral = '"' + 'A'.repeat(100) + '"' // 102 chars > 80
    const code = `app.post(${longLiteral}, h)`
    const elided = firstCall(code).getName({ withArgument: 0, elide: true })
    expect(elided).toBeDefined()
    // First 38 chars of getText: opening quote + 37 A's
    const firstSlice = longLiteral.slice(0, 38)
    // Last 38 chars: 37 A's + closing quote
    const lastSlice = longLiteral.slice(-38)
    expect(elided).toBe(`app.post(${firstSlice}…${lastSlice})`)
    // Literal portion (between parens) is exactly 77 chars
    const literalPortion = elided!.slice('app.post('.length, -1)
    expect(literalPortion.length).toBe(77)
  })

  it('does NOT elide literals at or below 80 chars (threshold is strictly >)', () => {
    // Exactly 80 chars of getText: opening quote + 78 chars + closing quote
    const at80 = '"' + 'B'.repeat(78) + '"'
    expect(at80.length).toBe(80)
    const elided = firstCall(`app.post(${at80}, h)`).getName({ withArgument: 0, elide: true })
    expect(elided).toBe(`app.post(${at80})`)
  })

  it('never elides the element form (elide: false / default)', () => {
    const longLiteral = '"' + 'C'.repeat(200) + '"'
    const verbatim = firstCall(`app.post(${longLiteral}, h)`).getName({ withArgument: 0 })
    expect(verbatim).toBe(`app.post(${longLiteral})`)
    expect(verbatim!.length).toBeGreaterThan(80 + 'app.post()'.length)
  })

  it('degrades cleanly when withArgument hits a non-literal even with elide: true', () => {
    expect(firstCall(`app.post(ROUTES.AUTH, h)`).getName({ withArgument: 0, elide: true })).toBe(
      'app.post',
    )
  })
})
