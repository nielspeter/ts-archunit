import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { calls } from '../../src/builders/call-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import { call } from '../../src/helpers/matchers.js'
import type { ArchProject } from '../../src/core/project.js'

/**
 * Integration tests for proposal 011 / plan 0057 — `.identifiedByArg()`.
 *
 * Each test constructs an in-memory project with TSX/TS source, runs a
 * `calls()` rule, captures violations via `.violations()`, and asserts
 * properties of `element`, `message`, and exclusion behavior.
 */
function inMemoryProject(code: string): ArchProject {
  const tsMorphProject = new Project({ useInMemoryFileSystem: true })
  tsMorphProject.createSourceFile('routes.ts', code)
  return {
    tsConfigPath: '/virtual/tsconfig.json',
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

const SAMPLE_ROUTES = `
declare const app: any
declare const handler: any

app.post("/auth/token", handler)
app.get("/.well-known/openid-configuration", handler)
app.post("/oidc/authorize", handler)
app.post("/users", handler)
`

describe('calls().identifiedByArg() — integration', () => {
  it('test #11 — element AND message both enrich (cohesion)', () => {
    const p = inMemoryProject(SAMPLE_ROUTES)
    const violations = calls(p)
      .that()
      .onObject('app')
      .and()
      .withMethod(/^(get|post)$/)
      .identifiedByArg(0)
      .should()
      .notExist()
      .violations()

    // Every violation's element AND message must contain the enriched form
    expect(violations.length).toBeGreaterThan(0)
    for (const v of violations) {
      expect(v.element).toMatch(/^app\.(get|post)\("/) // enriched form
      expect(v.element).not.toMatch(/^app\.(get|post)$/) // not bare
      // Message starts with the enriched name (same identity as element)
      expect(v.message.startsWith(v.element)).toBe(true)
    }
  })

  it('test #12 — .excluding() by exact string matches enriched element', () => {
    const p = inMemoryProject(SAMPLE_ROUTES)
    const violations = calls(p)
      .that()
      .onObject('app')
      .and()
      .withMethod(/^(get|post)$/)
      .identifiedByArg(0)
      .should()
      .notExist()
      .excluding('app.post("/auth/token")')
      .violations()

    const elements = violations.map((v) => v.element)
    expect(elements).not.toContain('app.post("/auth/token")')
    // Other routes still flagged
    expect(elements).toContain('app.get("/.well-known/openid-configuration")')
  })

  it('test #13 — .excluding() by regex matches enriched element', () => {
    const p = inMemoryProject(SAMPLE_ROUTES)
    const violations = calls(p)
      .that()
      .onObject('app')
      .and()
      .withMethod(/^(get|post)$/)
      .identifiedByArg(0)
      .should()
      .notExist()
      .excluding(/app\.post\("\/oidc\//)
      .violations()

    const elements = violations.map((v) => v.element)
    expect(elements.some((e) => /\/oidc\//.test(e))).toBe(false)
    expect(elements).toContain('app.post("/auth/token")')
  })

  it('test #14 — identity scope: predicates stay on bare callee (with positive control)', () => {
    const p = inMemoryProject(SAMPLE_ROUTES)

    // Negative case: the predicate filters on the BARE callee (app.post), not the
    // enriched name. A regex matching the enriched form sees only "app.post" and
    // never matches — silent zero-violation result. Documented in the JSDoc on
    // .identifiedByArg() and proposal 011's "Identity scope".
    const negativeViolations = calls(p)
      .that()
      .haveNameMatching(/app\.post\("\/auth/)
      .identifiedByArg(0)
      .should()
      .notExist()
      .violations()

    expect(negativeViolations).toEqual([])

    // Positive control: the SAME predicate against the BARE form DOES match —
    // proves the empty result above is due to predicate-scope behavior, not an
    // empty fixture or broken predicate engine.
    const positiveViolations = calls(p)
      .that()
      .haveNameMatching(/^app\.post$/)
      .identifiedByArg(0)
      .should()
      .notExist()
      .violations()

    expect(positiveViolations.length).toBeGreaterThan(0)
    // And the enrichment is still active in the output (element form):
    for (const v of positiveViolations) {
      expect(v.element).toMatch(/^app\.post\("/)
    }
  })

  it('test #15 — filter + identity composition (withStringArg + identifiedByArg)', () => {
    const p = inMemoryProject(SAMPLE_ROUTES)
    const violations = calls(p)
      .that()
      .onObject('app')
      .and()
      .withStringArg(0, '/auth/**') // filters to /auth routes (predicate)
      .identifiedByArg(0) // names them by path (identity)
      .should()
      .notExist()
      .violations()

    expect(violations).toHaveLength(1)
    expect(violations[0]!.element).toBe('app.post("/auth/token")')
  })

  it('test #16 — non-literal arg degrades to bare callee in BOTH element and message', () => {
    const p = inMemoryProject(`
declare const app: any
declare const handler: any
declare const ROUTES: { AUTH: string }

app.post(ROUTES.AUTH, handler)
`)
    const violations = calls(p)
      .that()
      .onObject('app')
      .identifiedByArg(0)
      .should()
      .notExist()
      .violations()

    expect(violations).toHaveLength(1)
    expect(violations[0]!.element).toBe('app.post')
    expect(violations[0]!.message.startsWith('app.post ')).toBe(true)
  })

  it('test #17 — _identifyByArgument is copied at fork (not aliased to upstream)', () => {
    // RuleBuilder.fork() runs at .should() (rule-builder.ts:276 — Object.assign).
    // CallRuleBuilder follows the standard fluent pattern: predicate methods
    // including .identifiedByArg() MUTATE the builder and return `this`. So
    // the fork's job is to snapshot the field value AT the moment .should()
    // is called, then leave the forked rule untouched by later upstream
    // mutations.
    //
    // This test pins that property: fork copies by value, not by reference.
    const p = inMemoryProject(SAMPLE_ROUTES)

    // Set identifiedByArg(0), then fork via .should() — fork must snapshot 0.
    const upstream = calls(p)
      .that()
      .onObject('app')
      .and()
      .withMethod(/^(get|post)$/)
    const ruleA = upstream.identifiedByArg(0).should().notExist()

    // Mutate the upstream builder AFTER the fork.
    // Index 1 in our sample is `handler` (an identifier — non-literal),
    // which would degrade `getName({withArgument: 1})` back to bare `app.post`.
    // If fork aliased the field, ruleA.violations() would NOW emit bare names.
    upstream.identifiedByArg(1)

    // If fork COPIED the primitive: ruleA still uses index=0 → enriched paths.
    // If fork ALIASED: ruleA now sees index=1 → degrades to bare "app.post".
    const ruleAViolations = ruleA.violations()
    expect(ruleAViolations.length).toBeGreaterThan(0)
    expect(ruleAViolations.every((v) => v.element.includes('('))).toBe(true)
  })

  it('test #18 — long literal: message elides > 80 chars, element verbatim', () => {
    // Build a literal whose getText() is 102 chars (well past the 80 threshold).
    const longPath = '/' + 'a'.repeat(100)
    const code = `
declare const app: any
declare const handler: any
app.post("${longPath}", handler)
`
    const p = inMemoryProject(code)
    const violations = calls(p)
      .that()
      .onObject('app')
      .identifiedByArg(0)
      .should()
      .notExist()
      .violations()

    expect(violations).toHaveLength(1)
    const v = violations[0]!

    // Element field: verbatim, all 102 chars of the literal preserved
    expect(v.element).toBe(`app.post("${longPath}")`)
    expect(v.element).toContain('aaaaaaaaaa') // sanity — substring of the literal

    // Message field: elided. The literal "...102 chars..." inside the
    // appended portion becomes slice(0,38) + '…' + slice(-38).
    const literal = `"${longPath}"`
    const expectedElidedLiteral = literal.slice(0, 38) + '…' + literal.slice(-38)
    expect(v.message).toContain(`app.post(${expectedElidedLiteral})`)
    expect(expectedElidedLiteral.length).toBe(77) // 38 + 1 + 38
  })

  it('test #19 — cohesion across all 8 condition types', () => {
    // Snapshot property: for every condition type that produces violations
    // on an opted-in calls() rule, the violation's element AND message must
    // both reflect the enriched name. Prevents regressions where a future
    // refactor accidentally bypasses the option at one of the eight sites.
    const p = inMemoryProject(`
declare const app: any
declare const handler: any
declare function legacy(): void

app.post("/foo", () => { legacy() })
app.post("/bar", { mode: 'strict' })
`)

    // Site 36 — notExist
    const notExist = calls(p)
      .that()
      .onObject('app')
      .identifiedByArg(0)
      .should()
      .notExist()
      .violations()
    expect(notExist.length).toBeGreaterThan(0)
    for (const v of notExist) {
      expect(v.element).toMatch(/^app\.post\("/)
      expect(v.message.startsWith(v.element)).toBe(true)
    }

    // Site 61 — haveCallbackContaining (no callback contains target → violation)
    const haveCb = calls(p)
      .that()
      .onObject('app')
      .and()
      .withStringArg(0, '/bar')
      .identifiedByArg(0)
      .should()
      .haveCallbackContaining(call('handler'))
      .violations()
    expect(haveCb.length).toBeGreaterThan(0)
    for (const v of haveCb) {
      expect(v.element).toBe('app.post("/bar")')
      expect(v.message.startsWith('app.post("/bar")')).toBe(true)
    }

    // Site 92 — notHaveCallbackContaining (callback contains legacy() → violation)
    const notHaveCb = calls(p)
      .that()
      .onObject('app')
      .and()
      .withStringArg(0, '/foo')
      .identifiedByArg(0)
      .should()
      .notHaveCallbackContaining(call('legacy'))
      .violations()
    expect(notHaveCb.length).toBeGreaterThan(0)
    for (const v of notHaveCb) {
      expect(v.element).toBe('app.post("/foo")')
      expect(v.message.startsWith('app.post("/foo")')).toBe(true)
    }

    // Site 169 — haveArgumentWithProperty (no arg has `preHandler` → violation)
    const haveProp = calls(p)
      .that()
      .onObject('app')
      .identifiedByArg(0)
      .should()
      .haveArgumentWithProperty('preHandler')
      .violations()
    expect(haveProp.length).toBeGreaterThan(0)
    for (const v of haveProp) {
      expect(v.element).toMatch(/^app\.post\("/)
      expect(v.message.startsWith(v.element)).toBe(true)
    }

    // Site 215 — notHaveArgumentWithProperty (`mode` is forbidden → violation)
    const notHaveProp = calls(p)
      .that()
      .onObject('app')
      .and()
      .withStringArg(0, '/bar')
      .identifiedByArg(0)
      .should()
      .notHaveArgumentWithProperty('mode')
      .violations()
    expect(notHaveProp.length).toBeGreaterThan(0)
    for (const v of notHaveProp) {
      expect(v.element).toBe('app.post("/bar")')
      expect(v.message.startsWith('app.post("/bar")')).toBe(true)
    }

    // Sites 256, 291 — haveArgumentContaining / notHaveArgumentContaining
    const haveArg = calls(p)
      .that()
      .onObject('app')
      .and()
      .withStringArg(0, '/foo')
      .identifiedByArg(0)
      .should()
      .haveArgumentContaining(call('nonexistent_helper_X9Z'))
      .violations()
    expect(haveArg.length).toBeGreaterThan(0)
    for (const v of haveArg) {
      expect(v.element).toBe('app.post("/foo")')
      expect(v.message.startsWith('app.post("/foo")')).toBe(true)
    }

    const notHaveArg = calls(p)
      .that()
      .onObject('app')
      .and()
      .withStringArg(0, '/foo')
      .identifiedByArg(0)
      .should()
      .notHaveArgumentContaining(call('legacy'))
      .violations()
    expect(notHaveArg.length).toBeGreaterThan(0)
    for (const v of notHaveArg) {
      expect(v.element).toBe('app.post("/foo")')
      expect(v.message.startsWith('app.post("/foo")')).toBe(true)
    }
  })

  it('check() with .identifiedByArg() carries enriched element strings on the thrown error', () => {
    const p = inMemoryProject(SAMPLE_ROUTES)
    // ArchRuleError's `message` is a summary; element strings live on
    // `error.violations[]`. Tighter than just `toThrow(ArchRuleError)`:
    // assert the violations carry the enriched form — catches a regression
    // where .check() bypassed the identity path that .violations() uses.
    let caught: ArchRuleError | undefined
    try {
      calls(p)
        .that()
        .onObject('app')
        .and()
        .withMethod('post')
        .identifiedByArg(0)
        .should()
        .notExist()
        .check()
    } catch (e) {
      caught = e as ArchRuleError
    }
    expect(caught).toBeInstanceOf(ArchRuleError)
    expect(caught!.violations.length).toBeGreaterThan(0)
    expect(caught!.violations.some((v) => v.element === 'app.post("/auth/token")')).toBe(true)
  })

  it('mid-chain re-call of .identifiedByArg() is last-write-wins', () => {
    // Behavior pin: stacking `.identifiedByArg(0).identifiedByArg(1)` uses the
    // last index. Field assignment in the builder, no merge. A future refactor
    // that introduces multi-arg identity (unlikely) would have to address this
    // test explicitly.
    const p = inMemoryProject(`
declare const flags: any
declare const handler: any
flags.define(handler, "new-checkout")
`)

    const violations = calls(p)
      .that()
      .onObject('flags')
      .identifiedByArg(0) // first call — would target the handler (degrades, non-literal)
      .identifiedByArg(1) // second call — wins; targets the string literal
      .should()
      .notExist()
      .violations()

    expect(violations).toHaveLength(1)
    expect(violations[0]!.element).toBe('flags.define("new-checkout")')
  })

  it('element verbatim at the 81-char crossover (just past the message-elision threshold)', () => {
    // Tightens test #18: at exactly 81 chars in the literal, the element MUST
    // stay verbatim. A future bug that confused the element/message branches
    // would only show up at the boundary, not at 200 chars.
    const literal78 = 'd'.repeat(79) // 79 chars; with surrounding quotes → 81-char getText()
    const code = `
declare const app: any
declare const handler: any
app.post("${literal78}", handler)
`
    const p = inMemoryProject(code)
    const violations = calls(p)
      .that()
      .onObject('app')
      .identifiedByArg(0)
      .should()
      .notExist()
      .violations()

    expect(violations).toHaveLength(1)
    expect(violations[0]!.element).toBe(`app.post("${literal78}")`)
  })
})
