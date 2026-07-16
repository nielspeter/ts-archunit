# Plan 0057: Argument-Aware Identity for `calls()` Rules

## Status

- **State:** COMPLETED 2026-06-13
- **Priority:** P1 — closes a security-shaped exclusion gap (PKG-02); generic primitive serving 7+ string-keyed registration patterns
- **Effort:** ~1 day
- **Created:** 2026-06-11
- **Implemented:** 2026-06-13 on branch `feat/call-argument-identity`, released as v0.11.0
- **Depends on:** none (additive)

## Problem

`calls()` rules can only identify violations by callee — `archCall.getName()`
at `src/models/arch-call.ts:67` returns `${object}.${method}` (e.g.
`app.post`, `bus.on`, `flags.define`). When a codebase registers many
things through the same call — any string-keyed registration pattern —
every violation collapses to the same element name, making the
distinguishing argument invisible to `.excluding()`.

The proposal at `proposals/011-call-argument-identity.md` covers the
shape, generality (8 string-keyed patterns: HTTP routes, test discovery,
PubSub, command routers, validator registries, feature flags, DI
containers, DB migrations), and rationale in full. Read it first.

**Concrete consequence (PKG-02):** the `route/prehandler-required`
rule and two schema-quality rules each exclude **nine whole route files**
because individual routes can't be named. A new authenticated route
added to those files ships **CI-exempt** — the exact highest-risk case.

## Goals

- One new opt-in builder method on `CallRuleBuilder`:
  `.identifiedByArg(index: number)`.
- Optional `withArgument?: number` parameter on `ArchCall.getName()`
  that appends the raw source text of arg `index` in parentheses when
  it's a `StringLiteral` or `NoSubstitutionTemplateLiteral`.
- Optional `identifyByArgument?: number` field on `ConditionContext`.
- All eight `archCall.getName()` call sites in `src/conditions/call.ts`
  thread the option through — element field AND violation messages
  enrich cohesively.
- Tests for every edge case in the proposal's Edge Cases table plus
  the cohesion/scope properties.
- Docs in `docs/builder-reference.md` (calls section), `docs/api-reference.md`,
  `CHANGELOG.md`.

## Non-goals

- **Changing `.excluding()` string-match semantics** (exact equality
  today). Out of scope; a separate proposal if ever pursued.
- **Numeric / boolean key support** (`flags.define("new-checkout", true)`
  with `identifiedByArg(1)`). Out of scope per proposal's "Restriction
  to string literals" section. Expand later behind the same opt-in if
  a real use case surfaces.
- **Function-form `.identifiedBy((archCall) => string | undefined)`**.
  Considered and rejected in the proposal's Alternatives section —
  index form covers the 80% case; function form would expose internal
  `ArchCall` shape.
- **Enriching what predicates see**. Predicates intentionally stay on
  the bare callee; filtering by argument value is `withStringArg` /
  `withArgMatching` territory. See proposal's "Identity scope" section.
- **`recommended()` integration.** This is an opt-in mechanism — no
  preset change. Per plan 0049 stability policy, recommended changes
  that flag previously-passing code are major bumps; this proposal
  doesn't flag anything new on its own.

## Design

The complete design (API shape, plumbing path, edge-case behavior,
identity scope, migration cost) is in
`proposals/011-call-argument-identity.md`. This plan summarizes the
implementation contract and inventories tests; it does not re-derive
the design.

### Implementation contract (summary)

**`ArchCall.getName()` extends to accept an option:**

```ts
// src/models/arch-call.ts
getName(options?: { withArgument?: number }): string | undefined
```

When `withArgument` is set, inspect `getArguments()[index]`:

- `StringLiteral` or `NoSubstitutionTemplateLiteral` → append
  `(${arg.getText()})` to the bare name.
- Anything else (including `AsExpression`, `ParenthesizedExpression`,
  `TemplateExpression` with substitutions, tagged template, identifier,
  spread, OOB index, non-string literal) → return bare name unchanged.

Use ts-morph type guards (`Node.isStringLiteral`,
`Node.isNoSubstitutionTemplateLiteral`). No `as`, no `any`. (ADR-005.)

**`ConditionContext` gains one optional primitive field:**

```ts
// src/core/condition.ts
export interface ConditionContext {
  // ... existing
  identifyByArgument?: number
}
```

**`CallRuleBuilder` stores the index and seeds the context:**

```ts
private _identifyByArgument?: number

identifiedByArg(index: number): this {
  this._identifyByArgument = index
  return this
}
```

When the builder constructs the `ConditionContext` for each rule
execution (at the same site that already populates `rule`, `because`,
`ruleId`, etc.), it includes `identifyByArgument: this._identifyByArgument`.

**`fork()` requires no change.** `Object.assign(fork, this)` at
`src/core/rule-builder.ts:276` shallow-copies the primitive
`_identifyByArgument` automatically. A test asserts the field survives
`.and()` / `.or()` branching.

**`src/conditions/call.ts` updates eight call sites:**

| Line | Role                                     | Change                                                           |
| ---- | ---------------------------------------- | ---------------------------------------------------------------- |
| 18   | element field in `createCallViolation`   | `archCall.getName({ withArgument: context.identifyByArgument })` |
| 36   | message in `notExist`                    | same                                                             |
| 61   | message in `haveCallbackContaining`      | same                                                             |
| 92   | message in `notHaveCallbackContaining`   | same                                                             |
| 169  | message in `haveArgumentWithProperty`    | same                                                             |
| 215  | message in `notHaveArgumentWithProperty` | same                                                             |
| 256  | message in `haveArgumentContaining`      | same                                                             |
| 291  | message in `notHaveArgumentContaining`   | same                                                             |

Element and rendered message agree on identity — no
`element: app.post("/auth/token") / message: app.post does not have …`
divergence.

**Long literals:** when constructing the rendered message (only —
NEVER the element field), elide the middle of the appended literal if
it exceeds 80 chars with `…`. Element string stays verbatim for
exclusion stability.

## Implementation phases

### Phase 1 — Model + context (~30 min)

1. Add `withArgument` option to `ArchCall.getName()` in
   `src/models/arch-call.ts`. Closure currently captures `fullName`;
   move the literal-detection logic into the returned `getName()` so
   it can read the underlying `CallExpression.getArguments()` lazily.
2. Add `identifyByArgument?: number` to `ConditionContext` in
   `src/core/condition.ts` with a doc comment noting it's read by
   `calls()` conditions only, ignored elsewhere.

**Files changed:**

- `src/models/arch-call.ts` — extended `getName()` (~25 LOC including
  helper for literal detection and 80-char message-elision logic)
- `src/core/condition.ts` — +1 optional field (~5 LOC including comment)

### Phase 2 — Builder method + context wiring (~30 min)

3. Add `_identifyByArgument?: number` field and `.identifiedByArg(index)`
   method to `CallRuleBuilder` in `src/builders/call-rule-builder.ts`.
4. At the existing site where `CallRuleBuilder` builds the
   `ConditionContext` for each condition execution, include
   `identifyByArgument: this._identifyByArgument`.

**Files changed:**

- `src/builders/call-rule-builder.ts` — new field + method + context
  wiring (~15 LOC)

### Phase 3 — Condition call sites (~45 min)

5. Update all eight `archCall.getName()` call sites in
   `src/conditions/call.ts` (lines 18, 36, 61, 92, 169, 215, 256, 291)
   to pass `{ withArgument: context.identifyByArgument }`.
6. **Hoist note:** at lines 92 and 291 the call sits inside an inner
   `for (const match of matches)` loop. Hoist the enriched name into
   a local before the loop (same shape as line 169 already uses) —
   otherwise the option's literal-shape walk re-runs per match.
   The other six sites fire once per element and need no hoist.
7. **Message elision:** at the seven message sites, wrap the appended
   literal portion in an elision helper. If `arg.getText().length > 80`,
   the message uses `arg.getText().slice(0, 38) + '…' + arg.getText().slice(-38)`
   (total 77 chars including ellipsis). The element field (line 18) is
   **never** elided — exclusion patterns need stable identities.

**Files changed:**

- `src/conditions/call.ts` — eight call sites updated; two hoists at
  lines 92 and 291; one elision helper for messages.

### Phase 4 — Tests (~3 hours)

8. New unit test file `tests/models/arch-call-identity.test.ts` for the
   `getName()` option behavior.
9. New integration test file `tests/builders/calls-identified-by-arg.test.ts`
   covering the builder + condition pipeline end-to-end.
10. Extend existing `tests/core/rule-builder.test.ts` (or equivalent) with
    one test asserting `_identifyByArgument` survives `fork()` via
    `.and()` / `.or()`.

**Files changed:**

- `tests/models/arch-call-identity.test.ts` — new (~10 unit tests)
- `tests/builders/calls-identified-by-arg.test.ts` — new (~8 integration
  tests)
- existing fork() test file — +1 test

### Phase 5 — Docs (~1 hour)

11. `docs/builder-reference.md` — extend the `calls()` section with a
    `.identifiedByArg(index)` entry. Include the 8-case generic-pattern
    table from the proposal so docs lead with generality.
12. `docs/api-reference.md` — add method signature to the calls
    builder table.
13. **`.identifiedByArg()` JSDoc MUST include the Identity scope warning.**
    Predicates continue to see the bare callee — redirect to
    `withStringArg(i, glob)` / `withArgMatching(i, pattern)` for
    argument-based filtering. JSDoc travels with users via IDE
    autocomplete; markdown docs don't. Without this, the
    `haveNameMatching(/app\.post\("\/auth/).identifiedByArg(0)`
    silent-no-match case becomes a support burden.
14. `CHANGELOG.md` — `### Added` entry under Unreleased:
    `- calls() rule builder: new opt-in .identifiedByArg(index) folds a string-literal argument into the violation element + message for argument-precise .excluding(). See proposals/011 for the design and 8-case generality.`

## Test inventory (~19 tests)

### Unit tests on `ArchCall.getName({ withArgument })` (10 tests)

Covers the proposal's Edge Cases table verbatim:

1. **String literal hit** — `app.post("/foo", h)` + `index=0` → `app.post("/foo")`
2. **No-substitution template hit** — ``app.post(`/foo`, h)`` + `index=0` → ``app.post(`/foo`)``
3. **Template with substitution degrade** — ``app.post(`/foo/${x}`, h)`` + `index=0` → `app.post`
4. **Tagged template degrade** — `app.post(sql\`...\`, h)`+`index=0`→`app.post`
5. **Identifier degrade** — `app.post(routes.AUTH, h)` + `index=0` → `app.post`
6. **Spread degrade** — `app.post(...args)` + `index=0` → `app.post`
7. **`as const` degrade** — `app.post("/foo" as const, h)` + `index=0` → `app.post`
8. **Parenthesized expression degrade** — `app.post(("/foo"), h)` + `index=0` → `app.post`
9. **Out-of-bounds index degrade** — `app.post("/foo")` + `index=2` → `app.post`
10. **No option = unchanged** — `app.post("/foo", h)` + no option → `app.post`

### Integration tests via `calls(p).identifiedByArg(...).check()` (8 tests)

11. **Element and message both enrich.** Rule fails with
    `element: app.post("/foo")` AND message includes `app.post("/foo")`,
    never the bare `app.post`.
12. **`.excluding()` by exact string matches enriched element.**
    `.excluding('app.post("/foo")')` correctly drops the violation.
13. **`.excluding()` by regex matches enriched element.**
    `.excluding(/app\.post\("\/foo"\)/)` correctly drops.
14. **Identity scope: predicates stay on bare callee.**
    `.that().haveNameMatching(/app\.post\("\/foo/).identifiedByArg(0)` —
    predicate sees bare `app.post`, never matches; rule produces zero
    violations regardless of source. This is the documented behavior.
15. **Filter + identity composition.** `.withStringArg(0, '/auth/**')
.identifiedByArg(0)` filters to auth routes AND names each by path.
16. **Non-literal arg degrades to bare callee in BOTH element and message.**
    Cohesion property — when one degrades, both degrade.
17. **`fork()` propagation across `.and()` / `.or()`.** Builder built
    with `.and()` between predicates still emits enriched names.
18. **Long literal: message elides > 80 chars, element verbatim.**
    Given a 100-char literal `arg`, the `element` field contains all
    100 chars of `arg.getText()` verbatim. The rendered `message`
    contains `arg.getText().slice(0, 38) + '…' + arg.getText().slice(-38)`
    (77 chars total). For an 80-char literal (at threshold, NOT
    exceeded) the message contains the literal verbatim.

### Cohesion regression test (1 test)

19. **No bare/enriched mix.** Snapshot all eight condition types
    (`notExist`, `haveCallbackContaining`, `notHaveCallbackContaining`,
    `haveArgumentWithProperty`, `notHaveArgumentWithProperty`,
    `haveArgumentContaining`, `notHaveArgumentContaining`, plus the
    `element` field path) — every one must show the enriched name in
    BOTH `element` and `message` when `.identifiedByArg(0)` is set.
    Prevents future refactors from accidentally bypassing one site.

## Stability impact

**Additive — minor version bump.** Default behavior unchanged. No
existing rules flagged that weren't flagged before. No `recommended()`
preset change.

**For users who opt in:**

- Element field shifts (e.g. `app.post` → `app.post("/foo")`).
- Violation message shifts to match.
- Existing `.excluding()` patterns may stop matching → stale-exclusion
  warning fires (a feature, not a regression — points to exactly what
  needs updating).
- Existing baseline files for the opting-in rule need regenerating.
- Downstream consumers grouping by `element` get one-time
  recategorization.

Per plan 0049 stability policy: opt-in additive behavior is a minor
bump. Migration cost is local to the rule that adopts the feature.

## ADR alignment

- **ADR-002 (ts-morph):** uses `Node.isStringLiteral`,
  `Node.isNoSubstitutionTemplateLiteral` for narrowing. No raw
  TypeScript compiler API.
- **ADR-003 (fluent builder):** `.identifiedByArg()` is a chainable
  builder method on `CallRuleBuilder` between `.that()` predicates and
  `.should()` conditions, same surface as `withStringArg` / `withArgMatching`.
- **ADR-005 (no `any`, no `as`):** all type narrowing via ts-morph
  guards. No casts. `ConditionContext.identifyByArgument` is `number | undefined`.

## Strategic note

Three reasons this earns a slot now:

1. **Real-world demand with security framing.** PKG-02
   demonstrates the gap concretely; the proposer has branched and is
   ready to TDD-implement. Not speculative.
2. **Generic primitive serving 7+ patterns.** The 8-case table in the
   proposal makes clear this is not "HTTP routes for one project" — it's
   "registration identity for any string-keyed call." Same posture as
   `jsxText()` in plan 0056: bring the registration shape, the
   framework handles the identity mechanic.
3. **Joins existing architecture, doesn't invent.** Reuses
   `.excluding()` matching, `ConditionContext` plumbing, `fork()`
   propagation, the established builder method pattern (`withStringArg`,
   `withArgMatching`). One new method, one new optional field, eight
   one-line edits in conditions. No new exclusion mechanism, no new
   builder type.

## Files Changed (summary)

**Phase 1–3 (production):**

- `src/models/arch-call.ts` — extended `getName()`
- `src/core/condition.ts` — +1 optional field
- `src/builders/call-rule-builder.ts` — new field, method, context wiring
- `src/conditions/call.ts` — 8 one-line updates

**Phase 4 (tests):**

- `tests/models/arch-call-identity.test.ts` — new
- `tests/builders/calls-identified-by-arg.test.ts` — new
- existing fork() test file — +1 test

**Phase 5 (docs):**

- `docs/builder-reference.md` — `.identifiedByArg()` entry + 8-case table
- `docs/api-reference.md` — method signature
- `CHANGELOG.md` — Added entry under Unreleased

## Out of Scope

- Changing `.excluding()` substring/exact-match semantics.
- Numeric / boolean key identity.
- Function-form `.identifiedBy((archCall) => string)`.
- Enrichment visible to predicates.
- `recommended()` preset changes.
- Identity enrichment for non-`calls()` builders. (If `modules()` or
  `classes()` ever need analogous enrichment, design separately —
  the registration-shape problem is `calls()`-specific.)
