# Plan 0047: TypeScript Escape-Hatch Matchers (Tier 1)

## Status

- **State:** PROPOSED
- **Review (2026-07-13):** Ship with changes. **Decisions applied 2026-07-13:** (1) scope — `anyAnnotation`/`broadType`/`tsDirective` ship module-only, `doubleCast` all 3 scopes (Option A, no signature-aware traversal); (2) `tsDirective` kept with a shared `matchCommentRanges()` helper + `{ allow: [...] }` shape; (3) added the "Position relative to typescript-eslint" section. Plan text ready; build scheduled later. See "Review findings" below.
- **Priority:** P2 — extends the existing `rules/typescript` family; no blockers
- **Effort:** ~1 day (module-only scope; no signature-aware traversal)
- **Created:** 2026-04-19
- **Depends on:** 0046 (typeAssertion + nonNullAssertion matchers landed the pattern)

## Problem

ts-archunit already bans two of TypeScript's escape hatches via matchers
shipped in plan 0046: `typeAssertion()` (`as X`) and `nonNullAssertion()`
(`!`). The rest of the "fake type safety" catalog that every
"type-safe TypeScript" guide flags is still uncovered:

1. **`any` annotations** — `let x: any`, `any[]`, `Promise<any>`,
   `function f(x: any)`, `(): any => ...`. The single biggest source of
   silent-hole type safety. `noAnyProperties()` covers **class property
   declarations only**; explicit `any` anywhere else is not caught.

2. **TypeScript suppression comments** — `@ts-ignore`,
   `@ts-expect-error`, `@ts-nocheck`. These turn off the compiler at a
   single point or for an entire file. The existing `comment()` matcher
   can detect them by pattern, but gives a weak violation message
   (`comment containing '@ts-ignore'`) and forces users to remember three
   directive names.

3. **Broad types** — `Function`, `Object`, `{}`, `unknown[]` used as
   type annotations. They compile and look safe but accept virtually
   anything. TypeScript's `typescript-eslint` community already flags
   these via `no-unsafe-function-type` / `no-empty-object-type`; there's
   no equivalent in ts-archunit.

4. **Double-cast laundering** — `x as unknown as T`. A well-known
   workaround for "TypeScript won't let me assert `A` to `B`". Each cast
   is individually matched by `typeAssertion()`, but the distinctive
   **pattern** (`AsExpression` whose inner expression is also an
   `AsExpression`, commonly with `unknown` as the middle type) is not.
   This is the most abused escape hatch in practice because it looks
   intentional rather than lazy.

These four primitives close the remaining gaps flagged by the "type-safe
TS" discipline literature. All four fit the existing `ExpressionMatcher`
pattern (target `SyntaxKind`, inspect node with type guards) — they
belong next to `typeAssertion()` and `nonNullAssertion()` in
`src/helpers/matchers.ts`.

## Goals

- Four new matchers in `src/helpers/matchers.ts`:
  - `anyAnnotation()` — every explicit `any` type
  - `tsDirective(options?)` — `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`
  - `broadType(options?)` — `Function` / `Object` / `{}`
  - `doubleCast(options?)` — nested `as X as Y`
- Rule variants in `src/rules/typescript.ts` (one-line delegations to
  `classNotContain` / `functionNotContain` / `moduleNotContain`), scoped
  to where the body-traversal engine can actually reach the target nodes
  (see "Rule-variant scope"):
  - `anyAnnotation` / `broadType` / `tsDirective` — **module variant only**
  - `doubleCast` — class / function / module (all three)
- A "Position relative to typescript-eslint" section (see below) — why
  these matchers earn their place next to the lint catalog.
- Tests for each matcher and each rule variant.
- Documentation in `docs/body-analysis.md`, `docs/standard-rules.md`,
  `docs/api-reference.md`, and `CHANGELOG.md`.

## Non-goals

- **Implicit `any` detection** (values inferred as `any` because a type
  isn't declared, a `.d.ts` is missing, or `JSON.parse` returns `any`).
  Requires type resolution, not AST inspection. Separate plan — likely
  piggybacks on the `noAnyProperties()` custom-`evaluate` style.
- **`as any`** is already caught by `typeAssertion()`. We don't add a
  dedicated matcher for it; it's the intersection of two existing
  concepts.
- **`as const`** — correct TS, not an escape hatch. Already handled
  by `typeAssertion({ allowConst })`.
- **`satisfies`** — the solution, not the problem. No rule.
- **Tier 2 boundary-validation preset** — deferred to plan 0048.
- **Tier 3 dataflow-lite** — out of scope; design phase only, not a
  ticket yet.

## Position relative to typescript-eslint

These matchers overlap established lint rules — `@typescript-eslint/no-explicit-any`, `ban-ts-comment`, `no-unsafe-function-type`, `no-empty-object-type`. Shipping them does not replace those tools; it puts the same checks in the **primitive layer** where they compose with project-shape predicates:

- **Architectural cut.** `modules(p).that().resideInFolder('src/domain/**').should().satisfy(moduleNoAnyAnnotations())` bans `any` in the domain layer while tolerating it at `src/adapters/**` untyped-library boundaries — a folder-scoped policy that a flat lint rule + `overrides` matrix grows brittle expressing past a couple of splits.
- **Baseline adoption.** Adopt incrementally on an existing codebase via the same `withBaseline()` flow as every other rule.
- **One test artifact.** Architecture rules live in one place, fail PRs like unit tests, no second tool / config / CI step.

Same generic-primitive-vs-rule-catalog distinction as vitest vs. a preconfigured runner (mirrors plan 0048's positioning). The catalog is convenient when its rules match your needs; the primitive layer is what you compose when they don't. Many teams run both.

## Rule-variant scope — why `anyAnnotation`/`broadType`/`tsDirective` are module-only

The rule variants delegate to `classNotContain` / `functionNotContain` / `moduleNotContain`, which walk different node sets:

- `moduleNotContain` → `searchModuleBody` does a **full-file descendant walk** — it reaches every `any`/broad-type position (parameters, return types, property declarations, locals).
- `classNotContain` / `functionNotContain` → `searchClassBody` / `searchFunctionBody` (`src/helpers/body-traversal.ts:84,130`) walk only method/constructor/accessor **bodies**. Parameter types, return types, and property declarations are _siblings_ of the body, not descendants — so a class/function-scoped `anyAnnotation`/`broadType` rule would silently miss `data: any`, `m(x: any)`, `m(): any`, `function f(a: any): any`. False confidence, worse than not shipping.

**Decision (2026-07-13):** ship `anyAnnotation`, `broadType`, and `tsDirective` as **module-scoped rules only**. Module scope fully covers the common "ban `any`/broad types in this area of the codebase" rule (scope by folder with a `resideInFolder` predicate). `doubleCast` is an in-body expression, so it ships all three scopes unaffected. `tsDirective` is module-only for the additional reason that suppression comments are file-level trivia.

Class/function-scoped `any`/broad-type bans — the niche "strict this class, loose its file-mate" case — are deferred to a future plan that adds a signature-aware traversal (params + return + property positions) to `body-traversal.ts`. Not built on speculation here.

## Design

### Matcher 1: `anyAnnotation()`

**What it matches:** every `any` used as a type. Target
`SyntaxKind.AnyKeyword` — TypeScript emits this node wherever `any`
appears in type position. One matcher, one SyntaxKind, covers every
context:

- `let x: any`, `function f(x: any)`, `(): any =>`
- `any[]`, `Array<any>`, `Promise<any>`, `Record<string, any>`
- `type X = any`, `interface I { f: any }`
- Rest params `(...args: any[])`

**Why a single SyntaxKind works:** `AnyKeyword` only appears in type
syntax. It is not used at value positions.

**Interaction with `typeAssertion()`:** `as any` contains both an
`AsExpression` (caught by `typeAssertion()`) and an `AnyKeyword` (caught
by `anyAnnotation()`). If both rules are enabled the code gets two
violations on the same line — that's the correct behavior; the user
asked for both bans.

**Implementation sketch:**

```typescript
export function anyAnnotation(): ExpressionMatcher {
  return {
    description: "'any' type annotation",
    syntaxKinds: [SyntaxKind.AnyKeyword],
    matches(node: Node): boolean {
      return node.getKind() === SyntaxKind.AnyKeyword
    },
  }
}
```

No options. The matcher is blunt on purpose — `any` is never correct in
production code. Teams that need to allow it in a specific folder use
per-rule exclusions (plan 0026) or `resideInFolder` predicates, not
matcher options.

### Matcher 2: `tsDirective(options?)`

**What it matches:** the three TypeScript suppression comments.

| Directive          | Effect                                    |
| ------------------ | ----------------------------------------- |
| `@ts-ignore`       | suppress next-line type errors (untyped)  |
| `@ts-expect-error` | suppress next-line, error if none present |
| `@ts-nocheck`      | disable checking for the entire file      |

**Why not just use `comment()`?** Three reasons:

1. Ergonomics — users don't have to memorize the three names.
2. Message quality — `file contains @ts-ignore directive at line 42` is
   clearer than `comment containing '@ts-ignore'`.
3. Selective allowance — `tsDirective({ allow: ['ts-expect-error'] })`
   bans `@ts-ignore` and `@ts-nocheck` while keeping `@ts-expect-error`
   (which is safer because it fails when the suppression becomes
   unnecessary).

**Implementation sketch:** first **extract a shared
`matchCommentRanges(node, predicate)` helper** from the existing
`comment()` matcher — it currently owns the leading/trailing
comment-range traversal + dedup inside its closure (`matchers.ts:303-333`).
Both `comment()` and `tsDirective()` call the shared helper; no
copy-pasted trivia logic. `tsDirective()` tests each comment against the
directive set rather than a user-supplied pattern.

```typescript
export type TsDirective = 'ts-ignore' | 'ts-expect-error' | 'ts-nocheck'

export interface TsDirectiveOptions {
  /**
   * Directives to ALLOW (not flag). Default `[]` — all three are banned.
   * e.g. `{ allow: ['ts-expect-error'] }` bans `@ts-ignore` + `@ts-nocheck`
   * but permits `@ts-expect-error` (safer — it errors when the suppression
   * becomes unnecessary).
   */
  readonly allow?: readonly TsDirective[]
}

export function tsDirective(options?: TsDirectiveOptions): ExpressionMatcher {
  const allowed = new Set<TsDirective>(options?.allow ?? [])
  const banned = (['ts-ignore', 'ts-expect-error', 'ts-nocheck'] as const).filter(
    (d) => !allowed.has(d),
  )
  // match comments whose text contains any BANNED directive,
  // via the shared matchCommentRanges() helper.
  ...
}
```

**Default:** all three directives banned. `{ allow: [...] }` opts specific
directives out — an explicit allow-list, not the inverted "pass the ones
you keep" shape of the original sketch.

**Edge case:** `@ts-nocheck` only has effect as the first non-trivia
line of a file. We don't enforce position — if a user writes it
anywhere, it's still an intent to suppress and we flag it. That's
strictly safer.

### Matcher 3: `broadType(options?)`

**What it matches:** three broad-type annotations that TypeScript
accepts but provide no safety:

- `Function` (typed as `TypeReference` named `Function`)
- `Object` (typed as `TypeReference` named `Object`)
- `{}` (empty `TypeLiteral`, zero members)

**Why one matcher not three:** they're the same problem (types that
accept almost anything). One matcher with sensible defaults, options
to narrow:

```typescript
export interface BroadTypeOptions {
  readonly function?: boolean // default true — ban `Function`
  readonly object?: boolean // default true — ban `Object`
  readonly empty?: boolean // default true — ban `{}`
}

export function broadType(options?: BroadTypeOptions): ExpressionMatcher {
  const banFunction = options?.function ?? true
  const banObject = options?.object ?? true
  const banEmpty = options?.empty ?? true
  return {
    description: 'broad type annotation',
    syntaxKinds: [SyntaxKind.TypeReference, SyntaxKind.TypeLiteral],
    matches(node: Node): boolean {
      if (Node.isTypeReference(node)) {
        const name = node.getTypeName().getText()
        if (banFunction && name === 'Function') return true
        if (banObject && name === 'Object') return true
        return false
      }
      if (Node.isTypeLiteral(node)) {
        return banEmpty && node.getMembers().length === 0
      }
      return false
    },
  }
}
```

**Out of scope for this matcher:**

- `any[]`, `Array<any>` — already caught by `anyAnnotation()`
  (contains an `AnyKeyword`).
- `unknown[]` — not a broad type in the same sense; `unknown` forces
  narrowing at use. A team that wants to ban it can `expression(/: unknown/)`.

**Known limitations (document these):**

- Name-based, no symbol resolution — a user-defined `interface Function {}` or
  a local type named `Object` would match (false positive). Acceptable given
  the pure-AST constraint (ADR-002), but call it out. Namespaced forms like
  `NS.Function` (a `QualifiedName`) won't match.
- `empty: true` (default) bans the legitimate `<T extends {}>` "non-nullish"
  generic-constraint idiom. Teams that use it override `broadType({ empty: false })`
  or scope the rule. Documented so it isn't a surprise; the default stays on
  because bare `: {}` annotations are far more often a mistake than intent.

### Matcher 4: `doubleCast(options?)`

**What it matches:** `AsExpression` whose direct child expression is
also an `AsExpression`. The common form is
`x as unknown as T` — casting through `unknown` to bypass TypeScript's
"neither type is assignable to the other" check.

**Why this deserves a dedicated matcher** rather than "two
`typeAssertion()` hits": the pattern is intentional laundering, not a
sequence of unrelated casts. Flagging the nested structure once (with a
dedicated message) is clearer than flagging the two assertions
individually. Users running `typeAssertion()` already get the individual
hits — `doubleCast()` is for teams that tolerate single casts but want
to ban the laundering pattern specifically.

**Options:**

```typescript
export interface DoubleCastOptions {
  /**
   * Require the middle type to be `unknown` or `any` for a match.
   * Default `false` (any `as` chained into another `as` matches).
   * Set `true` to match only the laundering form: `x as unknown as T`.
   */
  readonly throughUnknownOrAny?: boolean
}

export function doubleCast(options?: DoubleCastOptions): ExpressionMatcher {
  const throughUnknownOrAny = options?.throughUnknownOrAny ?? false
  return {
    description: 'double type assertion (as X as Y)',
    syntaxKinds: [SyntaxKind.AsExpression],
    matches(node: Node): boolean {
      if (!Node.isAsExpression(node)) return false
      // Outer `as`: check if the inner expression is also an AsExpression.
      const inner = node.getExpression()
      if (!Node.isAsExpression(inner)) return false
      if (!throughUnknownOrAny) return true
      // Inner type must be `unknown` or `any`.
      const innerType = inner.getTypeNode()?.getText()
      return innerType === 'unknown' || innerType === 'any'
    },
  }
}
```

**Node visited:** the outer `AsExpression` (the full
`x as unknown as T` expression). TS-morph walks every `AsExpression` in
the file, so the matcher runs on each level — but it only matches when
the outer's child is another `AsExpression`. This prevents
double-reporting.

### Rule variants in `src/rules/typescript.ts`

Follow plan 0046's convention (one-line delegations), scoped per the
"Rule-variant scope" decision above. **Six** new rule functions:

```typescript
// any annotation — module-only (body traversal can't reach param/return/property positions)
export function moduleNoAnyAnnotations(): Condition<SourceFile> {
  return moduleNotContain(anyAnnotation())
}

// broad type — module-only (same reason)
export function moduleNoBroadTypes(options?: BroadTypeOptions): Condition<SourceFile> {
  return moduleNotContain(broadType(options))
}

// ts-directive — module-only (file-level suppression comments)
export function moduleNoTsDirectives(options?: TsDirectiveOptions): Condition<SourceFile> {
  return moduleNotContain(tsDirective(options))
}

// double cast — in-body expression, so all three scopes ship
export function noDoubleCasts(options?: DoubleCastOptions): Condition<ClassDeclaration> {
  return classNotContain(doubleCast(options))
}
export function functionNoDoubleCasts(options?: DoubleCastOptions): Condition<ArchFunction> {
  return functionNotContain(doubleCast(options))
}
export function moduleNoDoubleCasts(options?: DoubleCastOptions): Condition<SourceFile> {
  return moduleNotContain(doubleCast(options))
}
```

**Rule count:** 6 new rule functions — `doubleCast` ×3 scopes + one
module variant each for `anyAnnotation` / `broadType` / `tsDirective`.
Class/function variants for the three module-only matchers are deferred
(see "Rule-variant scope").

### Naming

Following `noTypeAssertions()` / `noNonNullAssertions()` — the
class-scoped versions get the plain name, function/module variants are
prefixed. This matches plan 0046 and the `security` / `errors` rule
files.

### Index exports

Add to `src/index.ts` matchers block (around lines 186–195):

```typescript
export {
  // ... existing
  anyAnnotation,
  tsDirective,
  broadType,
  doubleCast,
} from './helpers/matchers.js'
export type {
  TsDirective,
  TsDirectiveOptions,
  BroadTypeOptions,
  DoubleCastOptions,
} from './helpers/matchers.js'
```

Rule variants re-export via the existing `./rules/typescript` sub-path;
no index.ts change needed there.

## Implementation phases

### Phase 1 — Matchers (~1 hour)

1. Extract a shared `matchCommentRanges(node, predicate)` helper from
   `comment()` (used by both `comment()` and `tsDirective()`).
2. Add `anyAnnotation()`, `tsDirective()`, `broadType()`, `doubleCast()`
   and associated types to `src/helpers/matchers.ts`.
3. Export from `src/index.ts`.

**Files changed:**

- `src/helpers/matchers.ts` — extract `matchCommentRanges()`; +4 matchers (~90 LOC)
- `src/index.ts` — +4 exports

### Phase 2 — Rule variants (~30 min)

4. Add the 6 new rule functions to `src/rules/typescript.ts` as
   one-liners (per "Rule-variant scope").

**Files changed:**

- `src/rules/typescript.ts` — +6 rule functions (~45 LOC of mostly
  JSDoc + one-line bodies)

### Phase 3 — Tests (~2–3 hours)

5. Matcher unit tests in a new
   `tests/helpers/matchers-escape-hatch.test.ts` (mirror
   `matchers-typescript.test.ts` from plan 0046).
6. Rule smoke tests in
   `tests/rules/typescript-escape-hatch.test.ts`.

**Files changed:**

- `tests/helpers/matchers-escape-hatch.test.ts` — new
- `tests/rules/typescript-escape-hatch.test.ts` — new

### Phase 4 — Docs (~1 hour)

7. `docs/body-analysis.md` — document 4 new matchers alongside
   `typeAssertion`, `nonNullAssertion`. Update count 9 → 13.
8. `docs/standard-rules.md` — add the new rules to the TypeScript
   section with examples.
9. `docs/api-reference.md` — extend the matcher and rules tables.
10. `CHANGELOG.md` — `### Added` entries under Unreleased.

## Test strategy (~21 tests)

### Matcher tests (15)

`anyAnnotation()` — 4 tests:

- Matches `let x: any`
- Matches `function f(x: any)`, including return type
- Matches `any[]`, `Promise<any>`, nested generics
- Does NOT match `any` used as an identifier (shouldn't happen in
  type position but sanity test)

`tsDirective()` — 4 tests:

- Matches `// @ts-ignore` line comment
- Matches `/* @ts-expect-error */` block comment
- Matches `// @ts-nocheck` at file top
- Respects the allow-list: `tsDirective({ allow: ['ts-expect-error'] })`
  does NOT match `@ts-expect-error` but DOES match the other two

`broadType()` — 4 tests:

- Matches `: Function`, `: Object`, `: {}`
- Does NOT match `: () => void` (function type, not `Function`)
- Does NOT match `: { name: string }` (non-empty type literal)
- Option flags work independently
  (`broadType({ function: false })` skips `Function`)

`doubleCast()` — 3 tests:

- Matches `x as unknown as T`
- Matches `x as A as B` when `throughUnknownOrAny: false` (default)
- Does NOT match `x as A as B` when `throughUnknownOrAny: true`
  (inner type isn't `unknown`/`any`)

### Rule smoke tests (6)

One happy path + one violation per rule variant for each of the 6 new
rule functions. Each test instantiates the fixture project, runs the
rule, asserts violation count. (The module-only matchers are exercised
against param/return/property positions to lock the full-file coverage
that class/function scope could not provide.)

### Existing test impact

None. No existing matcher or rule changes behavior. `tsDirective` is
strictly additive over `comment()`. `typeAssertion()` still catches
`as any` independently of `anyAnnotation()`; that's intentional double
coverage.

## Files changed

| File                                          | Change                                                             |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `src/helpers/matchers.ts`                     | Extract `matchCommentRanges()`; +4 matchers + 4 option/union types |
| `src/rules/typescript.ts`                     | +6 rule functions (one-liners)                                     |
| `src/index.ts`                                | +4 matcher exports, +4 type exports                                |
| `tests/helpers/matchers-escape-hatch.test.ts` | new — 15 matcher tests                                             |
| `tests/rules/typescript-escape-hatch.test.ts` | new — 6 rule smoke tests                                           |
| `docs/body-analysis.md`                       | Document 4 new matchers, update count 9→13                         |
| `docs/standard-rules.md`                      | Add rules with examples                                            |
| `docs/api-reference.md`                       | Update matcher + rules tables                                      |
| `CHANGELOG.md`                                | `### Added` under next version                                     |

No `package.json` changes, no new runtime dependencies.

### CHANGELOG entry

```markdown
### Added

- **Four new escape-hatch matchers** — close the "fake type safety" gaps
  the `typeAssertion` / `nonNullAssertion` pair left open:
  - `anyAnnotation()` — every explicit `any` in a type position
    (annotations, parameters, returns, generics).
  - `tsDirective(options?)` — `@ts-ignore`, `@ts-expect-error`,
    `@ts-nocheck` suppression comments. Pass `{ allow: [...] }` to
    permit specific directives.
  - `broadType(options?)` — `Function`, `Object`, `{}` type annotations.
  - `doubleCast(options?)` — `x as A as B` type laundering. Pass
    `{ throughUnknownOrAny: true }` to match only the common
    `as unknown as T` form.
- **Six new rule variants in `rules/typescript`** — `noDoubleCasts`
  with class/function/module flavors, plus module-only
  `moduleNoAnyAnnotations`, `moduleNoBroadTypes`, `moduleNoTsDirectives`
  (see "Rule-variant scope" — the body-traversal engine can't reach
  type-position nodes at class/function scope).
```

## Rollout

This is additive. No existing rules change behavior. Users adopt by
composing the new matchers or enabling the new rule variants. No
migration guide needed.

## Out of scope (recap)

- **Implicit `any`** — type-resolution-based detection; separate plan.
- **Untyped imports** — same, requires type resolution.
- **Boundary validation preset** — plan 0048 (Tier 2).
- **Dataflow-lite** — Tier 3, design phase only.
- **`as any`** — already caught by `typeAssertion()` + `anyAnnotation()`
  when both are enabled. No dedicated matcher.
- **`satisfies` operator** — the preferred alternative, not a problem.

## Review findings — 2026-07-13

Reviewed via the `review-proposal` skill (architect + product lenses), grounded against the actual body-traversal engine. Existing-code survey: **no duplication** — all four matchers are new and follow the shipped 0046 `ExpressionMatcher` pattern.

**Verdict: Ship with changes.** Two of the four matchers are mis-scoped as written; one is largely redundant; the two that carry the weight (`doubleCast`, `anyAnnotation`) are sound.

### Blocking (fix before implementation)

- **`anyAnnotation()` and `broadType()` class/function rule variants silently miss their primary positions.** `classNotContain`/`functionNotContain` delegate to `searchClassBody`/`searchFunctionBody` (`src/helpers/body-traversal.ts:84,130`), which walk only method/constructor/accessor bodies. Parameter type annotations, return-type annotations, and property declarations are **siblings** of the body, not descendants — so `noAnyAnnotations()` (class) misses `data: any`, `m(x: any)`, `m(): any`, and `functionNoAnyAnnotations()` misses `function f(a: any): any` entirely. This is false confidence, worse than not shipping. The **module** variants work (full-file descendant walk); `doubleCast` works at all scopes (in-body expression). **RESOLVED 2026-07-13 — Option A (module-only):** `anyAnnotation`/`broadType`/`tsDirective` ship module-scoped rules only; `doubleCast` keeps all three scopes. Rule count drops from 10 → 6. Class/function scope deferred to a future signature-aware-traversal plan. See the "Rule-variant scope" section in the plan body.

### Should-fix

- **RESOLVED 2026-07-13 — added.** "Position relative to typescript-eslint" section is now in the plan body, with the `domain/**` vs `adapters/**` composability example. (0047 overlapped `no-explicit-any`, `ban-ts-comment`, `no-unsafe-function-type`, `no-empty-object-type` and had no positioning; now it does.)
- **RESOLVED 2026-07-13 — kept + fixed.** `tsDirective` stays for its typed allow-list, but the plan now specifies extracting a shared `matchCommentRanges(node, predicate)` helper (used by both `comment()` and `tsDirective()` — no copy-pasted trivia-dedup), and the option shape is now the explicit `{ allow: [...] }` instead of the inverted "pass the ones you keep."
- **`broadType` false-positives on user-defined `Function`/`Object` types** (name-based `getTypeName().getText()`, no symbol resolution), and `{}`-default-on bans the legit `<T extends {}>` generic-constraint idiom. Reconsider defaulting `empty` on; document the shadowing limitation.
- **Soften "`any` is never correct in production code"** — the blunt matcher is right, but state the escape hatch (scope the _rule_ with `resideInFolder`/exclusions) explicitly rather than the absolutist claim.

### Minor

- RESOLVED 2026-07-13 — the rule-variant section was rewritten to the module-only scope; the count is now a consistent **6** throughout (the stale "twelve"/"10" figures are gone).

### Praise

- `doubleCast()`'s anti-double-report logic is correct and it's the highest-value matcher (uniquely not expressible otherwise). Non-goals section is exemplary scope discipline. ADR-005 clean in all sketches.

**Value ranking (both reviewers):** `doubleCast` > `anyAnnotation` > `broadType` > `tsDirective`. Lead with `doubleCast`'s uniqueness, not catalog symmetry.
