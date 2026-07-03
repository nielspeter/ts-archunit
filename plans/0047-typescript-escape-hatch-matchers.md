# Plan 0047: TypeScript Escape-Hatch Matchers (Tier 1)

## Status

- **State:** PROPOSED
- **Priority:** P2 — extends the existing `rules/typescript` family; no blockers
- **Effort:** 1 day
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
  - `tsDirective(kinds?)` — `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`
  - `broadType(options?)` — `Function` / `Object` / `{}`
  - `doubleCast(options?)` — nested `as X as Y`
- Rule variants in `src/rules/typescript.ts` for class / function /
  module, matching the 0046 convention (one-line delegations to
  `classNotContain` / `functionNotContain` / `moduleNotContain`).
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

### Matcher 2: `tsDirective(kinds?)`

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
3. Selective allowance — `tsDirective(['ts-expect-error'])` bans
   `@ts-ignore` and `@ts-nocheck` while keeping `@ts-expect-error`
   (which is safer because it fails when the suppression becomes
   unnecessary).

**Implementation sketch:** delegate to the existing `comment()`
traversal (visit every node's leading/trailing comment ranges with
dedup), but test against a known set of directives rather than a
user-supplied pattern.

```typescript
export type TsDirective = 'ts-ignore' | 'ts-expect-error' | 'ts-nocheck'

export function tsDirective(kinds?: readonly TsDirective[]): ExpressionMatcher {
  const allowed = new Set<TsDirective>(kinds ?? ['ts-ignore', 'ts-expect-error', 'ts-nocheck'])
  // match comments whose text contains any of the allowed directives
  // (reuse the dedup + leading/trailing traversal logic from comment())
  ...
}
```

**Default:** all three directives banned. Passing a subset allow-lists
the rest.

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

Follow plan 0046's convention exactly. Each of the four matchers gets
three rule variants (class / function / module) as one-line
delegations. Twelve new rule functions, all trivial wrappers:

```typescript
// any annotation
export function noAnyAnnotations(): Condition<ClassDeclaration> {
  return classNotContain(anyAnnotation())
}
export function functionNoAnyAnnotations(): Condition<ArchFunction> {
  return functionNotContain(anyAnnotation())
}
export function moduleNoAnyAnnotations(): Condition<SourceFile> {
  return moduleNotContain(anyAnnotation())
}

// ts-directive (module-scope only — directives are file-level comments;
// class/function variants would be confusing since `@ts-nocheck` must be
// at file top. Ship module variant first; add class/function if demand shows up.)
export function moduleNoTsDirectives(kinds?: readonly TsDirective[]): Condition<SourceFile> {
  return moduleNotContain(tsDirective(kinds))
}

// broad type
export function noBroadTypes(options?: BroadTypeOptions): Condition<ClassDeclaration> { ... }
export function functionNoBroadTypes(options?: BroadTypeOptions): Condition<ArchFunction> { ... }
export function moduleNoBroadTypes(options?: BroadTypeOptions): Condition<SourceFile> { ... }

// double cast
export function noDoubleCasts(options?: DoubleCastOptions): Condition<ClassDeclaration> { ... }
export function functionNoDoubleCasts(options?: DoubleCastOptions): Condition<ArchFunction> { ... }
export function moduleNoDoubleCasts(options?: DoubleCastOptions): Condition<SourceFile> { ... }
```

**Rule count:** 10 new rule functions (4 matchers × 3 variants, minus 2
class/function variants for `tsDirective` which don't make semantic
sense). `tsDirective` is module-only.

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
export type { TsDirective, BroadTypeOptions, DoubleCastOptions } from './helpers/matchers.js'
```

Rule variants re-export via the existing `./rules/typescript` sub-path;
no index.ts change needed there.

## Implementation phases

### Phase 1 — Matchers (~1 hour)

1. Add `anyAnnotation()`, `tsDirective()`, `broadType()`, `doubleCast()`
   and associated types to `src/helpers/matchers.ts`.
2. Export from `src/index.ts`.

**Files changed:**

- `src/helpers/matchers.ts` — +4 matchers (~80 LOC)
- `src/index.ts` — +4 exports

### Phase 2 — Rule variants (~30 min)

3. Add the 10 new rule functions to `src/rules/typescript.ts` as
   one-liners.

**Files changed:**

- `src/rules/typescript.ts` — +10 rule functions (~70 LOC of mostly
  JSDoc + one-line bodies)

### Phase 3 — Tests (~2–3 hours)

4. Matcher unit tests in a new
   `tests/helpers/matchers-escape-hatch.test.ts` (mirror
   `matchers-typescript.test.ts` from plan 0046).
5. Rule smoke tests in
   `tests/rules/typescript-escape-hatch.test.ts`.

**Files changed:**

- `tests/helpers/matchers-escape-hatch.test.ts` — new
- `tests/rules/typescript-escape-hatch.test.ts` — new

### Phase 4 — Docs (~1 hour)

6. `docs/body-analysis.md` — document 4 new matchers alongside
   `typeAssertion`, `nonNullAssertion`. Update count 9 → 13.
7. `docs/standard-rules.md` — add the new rules to the TypeScript
   section with examples.
8. `docs/api-reference.md` — extend the matcher and rules tables.
9. `CHANGELOG.md` — `### Added` entries under Unreleased.

## Test strategy (~25 tests)

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
- Respects `kinds` allow-list: `tsDirective(['ts-expect-error'])`
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

### Rule smoke tests (10)

One happy path + one violation per rule variant for each of the 10 new
rule functions. Each test instantiates the fixture project, runs the
rule, asserts violation count.

### Existing test impact

None. No existing matcher or rule changes behavior. `tsDirective` is
strictly additive over `comment()`. `typeAssertion()` still catches
`as any` independently of `anyAnnotation()`; that's intentional double
coverage.

## Files changed

| File                                          | Change                                     |
| --------------------------------------------- | ------------------------------------------ |
| `src/helpers/matchers.ts`                     | +4 matchers + 3 option/union types         |
| `src/rules/typescript.ts`                     | +10 rule functions (one-liners)            |
| `src/index.ts`                                | +4 matcher exports, +3 type exports        |
| `tests/helpers/matchers-escape-hatch.test.ts` | new — 15 matcher tests                     |
| `tests/rules/typescript-escape-hatch.test.ts` | new — 10 rule smoke tests                  |
| `docs/body-analysis.md`                       | Document 4 new matchers, update count 9→13 |
| `docs/standard-rules.md`                      | Add rules with examples                    |
| `docs/api-reference.md`                       | Update matcher + rules tables              |
| `CHANGELOG.md`                                | `### Added` under next version             |

No `package.json` changes, no new runtime dependencies.

### CHANGELOG entry

```markdown
### Added

- **Four new escape-hatch matchers** — close the "fake type safety" gaps
  the `typeAssertion` / `nonNullAssertion` pair left open:
  - `anyAnnotation()` — every explicit `any` in a type position
    (annotations, parameters, returns, generics).
  - `tsDirective(kinds?)` — `@ts-ignore`, `@ts-expect-error`,
    `@ts-nocheck` suppression comments. Pass a subset to allow-list.
  - `broadType(options?)` — `Function`, `Object`, `{}` type annotations.
  - `doubleCast(options?)` — `x as A as B` type laundering. Pass
    `{ throughUnknownOrAny: true }` to match only the common
    `as unknown as T` form.
- **Ten new rule variants in `rules/typescript`** — `noAnyAnnotations`,
  `noBroadTypes`, `noDoubleCasts` with class/function/module flavors,
  plus `moduleNoTsDirectives` (directives are file-level; no class or
  function variant).
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
