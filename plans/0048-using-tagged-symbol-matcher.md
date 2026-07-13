# Plan 0048: `usingTagged()` Symbol-Tagged Matcher (Tier 1.5)

## Status

- **State:** PROPOSED
- **Review (2026-07-13):** Ship with changes. **Decisions applied 2026-07-13:** (1) scope trimmed to the `@deprecated` family — ship `usingTagged` + `usingDeprecated` + 3 deprecated rules; `usingInternal`/`usingExperimental` deferred (`usingTagged('internal')` still works); (2) add a reference-node cache + extract `src/helpers/symbol-resolution.ts`; (3) delete the stale dedup note, fix `syntaxKinds` (7→9) + the `as` cast, rename the option to `tagText`; (4) fold docs into `standard-rules.md`. Plan text ready; build scheduled later. See "Review findings" below.
- **Priority:** P2 — opens the symbol-resolution layer that several future plans depend on
- **Effort:** ~1–1.5 days (trimmed to `@deprecated`; incl. reusable `symbol-resolution` extraction)
- **Created:** 2026-05-05
- **Updated:** 2026-05-05 — two revisions: (1) post-review fixes: alias unwrapping for cross-package/re-export resolution, stateless dedup via deferral instead of in-matcher Set, position vs typescript-eslint section, `localOnly` switched to `isInNodeModules()`. (2) Phase 0 spike against ts-morph 27 resolved every prior open question — corrected `unwrapAliases` to use only `getAliasedSymbol()` (the originally referenced `getExportSymbolIfAlias` is not a ts-morph API), added `Decorator` + `TaggedTemplateExpression` to syntaxKinds, locked inheritance/override behavior, pinned `getCommentText()` semantics, confirmed `skipLibCheck` independence.
- **Depends on:** 0011 (body-analysis matchers), 0013 (defineCondition — current escape hatch for this capability), 0046 (matcher pattern precedent). Independent of 0047 (different matcher class — pure AST vs symbol resolution).

## Problem

ts-archunit currently has no way to ask **"is this reference pointing at a
declaration tagged with `@deprecated`?"** — or any other JSDoc tag.

Today the only paths are:

1. **`comment('@deprecated')`** — flags every declaration site that
   _carries_ the tag. Useful for "we never keep deprecated stubs around"
   rules. Useless for "no one in `src/services/**` may **call** a
   deprecated function." It catches the wrong end of the relationship.

2. **`defineCondition()` with hand-rolled symbol resolution** — works
   today (~25 lines walking `getSymbol().getDeclarations().getJsDocs()`),
   but every team writes the same code, the per-symbol cache is missing,
   the cross-file behavior is ad-hoc, and there's no composition surface
   (can't drop it into `notContain()`/`within()` like other matchers).

The capability is a pure ergonomics + performance gap. A primitive is
overdue.

The same gap applies to other JSDoc tags teams use as architectural
signals:

| Tag                            | Use case                                       |
| ------------------------------ | ---------------------------------------------- |
| `@deprecated`                  | "stop using this — replacement coming"         |
| `@internal`                    | TSDoc — not part of the published API surface  |
| `@experimental`                | Microsoft API extractor; opt-in stability tier |
| `@alpha` / `@beta` / `@public` | Stability-tier gates                           |
| `@since`                       | Per-version cutoffs                            |

A single primitive that answers "does this reference point at a
declaration tagged `X`?" closes all of these in one shot.

## Position relative to typescript-eslint and other rule catalogs

`usingTagged()` overlaps with rules that exist in established lint
catalogs — most directly `@typescript-eslint/no-deprecated` (stable
since v8). The overlap is real and shipping `usingTagged()` does not
replace those tools. They live at different layers:

- **Lint catalogs** ship a fixed set of preconfigured rules. Users
  enable, disable, and configure rules. Composition is limited to
  `overrides` blocks in the lint config.
- **ts-archunit** is a primitive layer — matchers, predicates,
  conditions, combinators. Users compose primitives into rules that
  match their project's shape.

Concrete capabilities `usingTagged()` enables that an off-the-shelf
lint rule does not:

- **Project-shape predicates.** `functions.that().resideInFolder('app/**')
.should().notContain(usingDeprecated()).check()` — the architectural
  cut by folder, name pattern, type membership, etc. is composable
  with the matcher. A lint rule plus `overrides` matrix grows brittle
  past two or three folder splits.
- **Generic JSDoc tag support.** `usingTagged('experimental')`,
  `usingTagged('alpha')`, `usingTagged('since', { tagText: /^[12]\./ })`
  all work uniformly. Lint catalogs ship one rule per tag.
- **Composition with body analysis.**
  `within(call(/Repository/)).functions().should().notContain(usingDeprecated()).check()`
  — "inside callbacks of any `Repository`-named call specifically."
  Not expressible in a lint rule.
- **Baseline integration.** Adopt incrementally on existing codebases
  via the same `withBaseline()` flow used by every other ts-archunit
  rule. Each project decides its own adoption pace.
- **One test artifact per architecture.** Architecture rules sit in
  one place, run by the test runner, fail PRs the same way unit tests
  do. No second tool, second config, second CI step.

This is the same generic-primitive-vs-rule-catalog distinction as
vitest vs. preconfigured test runners. The catalog is convenient when
your needs match its rules; the primitive layer is what you reach for
when they don't. The two compose — many teams will run both. The
plan's job is to ship the primitive correctly so that **any project
shape**, not just one we anticipated, can be expressed with it.

## Goals

- New matcher `usingTagged(tagName, options?)` in `src/helpers/matchers.ts`
  that resolves the symbol of an AST reference and inspects its
  declarations' JSDoc tags. **This generic primitive works for any tag** —
  `usingTagged('internal')`, `usingTagged('since', …)` all work the moment
  it ships.
- **One** convenience wrapper as a one-liner over `usingTagged`:
  - `usingDeprecated(options?)`
  - (`usingInternal` / `usingExperimental` deferred — demand is weak and the
    generic `usingTagged('internal')` already covers them; add the one-line
    wrappers when a user asks. See "Scope: `@deprecated` first".)
- Three `@deprecated` rule variants (class / function / module) following
  the 0046 convention.
- Reference-node + symbol-level caches so repeated `usingTagged()` runs on
  the same project pay symbol resolution once per reference, then near-zero
  on re-runs. Extracted to a reusable `src/helpers/symbol-resolution.ts`.
- Tests covering same-file, cross-file (within project), and
  cross-package (from `node_modules`) declarations.
- Docs folded into `docs/body-analysis.md` and `docs/standard-rules.md`
  (no separate page), plus `docs/api-reference.md`, `CHANGELOG.md`.

## Non-goals

- **A separate `SymbolMatcher` interface.** This plan extends the
  existing `ExpressionMatcher` (see "Design — primitive shape" below).
  A second matcher kind would force every body-analysis condition to
  accept a union, doubling the surface for no real benefit. The cost
  difference between AST-shape and symbol-resolving matchers is hidden
  inside `matches()`, not exposed through the type.
- **General "type-resolved matcher" framework.** This plan ships _one_
  symbol-resolving matcher. Future plans can add `untypedImports()`,
  `referencesAnyType()`, etc. by following the same pattern. We don't
  need a meta-framework yet.
- **Cross-function dataflow.** "Does a deprecated value flow into this
  call's argument?" is the Tier 3 dataflow-lite work. Out of scope.
- **JSDoc parsing of tag arguments beyond `tagText`.** The `tagText` option
  matches the tag's body string (e.g. `since 2.0`). Anything more
  structured (parsing `@deprecated since {version}` with named
  captures) is out of scope.
- **Auto-fix or migration suggestions.** `because`/`suggestion` strings
  the user supplies in `.rule({...})` are the only suggestion path.
- **Banning the tag declarations themselves.** That's the
  `comment('@deprecated')` case — already supported today. This plan
  is about _uses_, not declarations.

## Scope: `@deprecated` first (2026-07-13 decision)

Ship the generic `usingTagged` primitive + the `usingDeprecated` wrapper + the
three `@deprecated` rule variants. Defer the `usingInternal` / `usingExperimental`
wrappers and their rule variants.

Rationale: the primitive covers every tag on day one — `usingTagged('internal')`
and `usingTagged('experimental')` work mechanically without the wrappers, so
deferring them costs only a one-line convenience, not capability. Demand clearly
supports `@deprecated` (typescript-eslint shipped `no-deprecated`); `@internal` is
moderate (`stripInternal` + API-extractor already cover much of it) and
`@experimental` is speculative. The wrappers + their rules are trivially additive
later (three one-liners each), non-breaking. `usingInternal` is the first to add
if an `@internal` package-boundary need materializes.

This halves the shipped rule surface (9 → 3) and the docs, keeping the plan
matched to demand while still landing the full symbol-resolution infrastructure.

## Design

### Primitive shape — keep `ExpressionMatcher`, don't introduce `SymbolMatcher`

The existing interface:

```typescript
export interface ExpressionMatcher {
  readonly description: string
  readonly syntaxKinds?: SyntaxKind[]
  matches(node: Node): boolean
}
```

This plan adds matchers whose `matches()` body calls `node.getSymbol()`
and walks declarations. From the _condition layer's_ perspective, they
behave identically to existing matchers — the condition still iterates
nodes by `syntaxKinds` and calls `matches()`. The cost difference
(symbol resolution forces type-checker work) is internal.

Rejected alternative: introducing `SymbolMatcher` as a sibling type. It
would force `notContain()`, `useInsteadOf()`, `within()`, etc. to accept
`ExpressionMatcher | SymbolMatcher`, doubling the public surface. The
existing matchers already span a cost continuum (`call()` is `getText()`-
cheap, `comment()` walks trivia for every node) — symbol-resolving is
just the next step.

### What `usingTagged()` matches

The matcher fires on **any reference whose resolved symbol's
declaration carries the tag**. Concretely:

| Syntax                          | Resolution path                                          |
| ------------------------------- | -------------------------------------------------------- |
| `oldFn()`                       | `CallExpression.getExpression().getSymbol()`             |
| `obj.oldMethod()`               | The `PropertyAccessExpression` inside the call           |
| `new OldClass()`                | `NewExpression.getExpression().getSymbol()`              |
| `let x: DeprecatedType`         | `TypeReference.getTypeName().getSymbol()`                |
| `import { oldFn }`              | The named import binding's symbol                        |
| `OldEnum.Member`                | The property access chain — both enum and member checked |
| `<DeprecatedComponent />` (JSX) | `JsxOpeningElement.getTagNameNode().getSymbol()`         |

Targeted `syntaxKinds`:

```typescript
;[
  SyntaxKind.CallExpression,
  SyntaxKind.NewExpression,
  SyntaxKind.PropertyAccessExpression,
  SyntaxKind.TypeReference,
  SyntaxKind.ImportSpecifier,
  SyntaxKind.JsxOpeningElement,
  SyntaxKind.JsxSelfClosingElement,
  SyntaxKind.Decorator,
  SyntaxKind.TaggedTemplateExpression,
]
```

We deliberately do **not** target raw `Identifier` — that fires on every
variable reference and produces too much noise. Calls, constructors,
type references, imports, JSX tags, decorators, and tagged template
literals cover the architectural reference surfaces.

### Avoiding double-fires across overlapping syntax kinds

`obj.oldMethod()` parses as a `CallExpression` whose expression is a
`PropertyAccessExpression`. ts-morph's descendant walk visits both.
Naïvely matching on each would produce two violations for one logical
reference.

**Resolution policy:** the `CallExpression` and `NewExpression` arms of
`matches()` short-circuit to `false` when the callee/constructor is
itself a `PropertyAccessExpression`. The `PropertyAccessExpression` arm
handles those cases on its own. The `CallExpression` and `NewExpression`
arms only fire when the callee is a bare `Identifier`
(`oldFn()`, `new OldClass()`).

This makes the matcher **stateless** — no in-matcher dedup `Set`, no
position-keyed cache, no order-of-evaluation effects. Each AST node
either matches or doesn't based purely on its own shape. Same approach
applies to `JsxOpeningElement` / `JsxSelfClosingElement`: when the JSX
tag name is a `PropertyAccessExpression` (`<motion.div>`), the matcher
defers to the inner `PropertyAccessExpression` arm.

| Reference                 | Node that fires            | Why                                               |
| ------------------------- | -------------------------- | ------------------------------------------------- |
| `oldFn()`                 | `CallExpression`           | Callee is `Identifier` — no inner arm to defer to |
| `new OldClass()`          | `NewExpression`            | Constructor is `Identifier`                       |
| `obj.oldMethod()`         | `PropertyAccessExpression` | `CallExpression` defers — inner arm covers it     |
| `obj.oldProp`             | `PropertyAccessExpression` | Standalone access; no enclosing call              |
| `let x: OldType`          | `TypeReference`            | Direct                                            |
| `import { oldFn }`        | `ImportSpecifier`          | Direct                                            |
| `<OldComponent />`        | `JsxSelfClosingElement`    | Tag name is `Identifier`                          |
| `<motion.div>`            | `PropertyAccessExpression` | JSX arm defers when tag name is qualified         |
| `@OldDecorator class Foo` | `Decorator`                | Expression is `Identifier`                        |
| `@Ns.Decorator class Foo` | `PropertyAccessExpression` | Decorator arm defers when expression is qualified |
| `` oldTag`...` ``         | `TaggedTemplateExpression` | Tag is `Identifier`                               |
| `` ns.oldTag`...` ``      | `PropertyAccessExpression` | TaggedTemplate arm defers when tag is qualified   |

### Cross-package and re-export resolution via alias unwrapping

`import { oldFn } from 'some-lib'; oldFn()` resolves to a _local alias
symbol_ whose declarations are the `ImportSpecifier`, not the original
`@deprecated` declaration in `some-lib`. Same for re-exports through
barrel files: `export { oldFn } from './lib'` adds another alias hop.

The matcher must unwrap aliases before inspecting declarations:

```typescript
function unwrapAliases(sym: Symbol): Symbol {
  let current = sym
  const seen = new Set<Symbol>()
  while (!seen.has(current)) {
    seen.add(current)
    // ts-morph exposes alias resolution via getAliasedSymbol() —
    // confirmed by spike against ts-morph 27 to traverse two-hop
    // re-export chains correctly. Earlier sketches referenced
    // getExportSymbolIfAlias(); that is a TypeScript internal API
    // not surfaced on ts-morph's Symbol wrapper. Don't add it.
    const aliased = current.getAliasedSymbol()
    if (!aliased || aliased === current) break
    current = aliased
  }
  return current
}
```

Without this, the matcher silently misses the headline use case
(catching uses of `@deprecated` symbols imported from another package).
The cycle guard via `Set<Symbol>` is precautionary — circular aliases
shouldn't occur in well-formed TS but we don't loop forever if they do.

**Verified by Phase 0 spike** (`tests/investigation/plan-0048-spike.test.ts`):

- `lib.ts` exports `@deprecated oldFn`, `index.ts` re-exports via barrel,
  `app.ts` imports from `index.ts` — naïve symbol resolution returns
  `false` (declarations point at `ImportSpecifier`s, not the original
  function); `unwrapAliases()` returns `true`. Lock-in test in Phase 3.

### API

```typescript
// src/helpers/matchers.ts — additions

export interface TagMatcherOptions {
  /**
   * Restrict matches to tags whose body text matches a string/regex.
   *
   * @example
   * usingTagged('deprecated', { tagText: /since 2\./ })
   * // matches only `@deprecated since 2.x` declarations
   */
  readonly tagText?: string | RegExp

  /**
   * Skip declarations whose source file is inside `node_modules`.
   * Default `false` — match tagged symbols from anywhere, including
   * upstream libraries.
   *
   * Set `true` for "I only care about *our own* tagged declarations"
   * rules. Path-based check via `SourceFile.isInNodeModules()`. A
   * symbol with declarations in both user code and `node_modules`
   * (declaration merging — common for global augmentation) still
   * matches if any user-code declaration carries the tag.
   */
  readonly localOnly?: boolean
}

export function usingTagged(
  tagName: string | RegExp,
  options?: TagMatcherOptions,
): ExpressionMatcher
```

### Convenience wrapper (one-liner)

```typescript
export function usingDeprecated(options?: TagMatcherOptions): ExpressionMatcher {
  return usingTagged('deprecated', options)
}

// Deferred (2026-07-13) — the generic primitive already covers these;
// add the wrappers when demand appears:
//   usingInternal(options?)     → usingTagged('internal', options)
//   usingExperimental(options?) → usingTagged('experimental', options)
```

Pure ergonomics — a team that knows the tag name doesn't have to import
`usingTagged` and pass a string. Same pattern as `call()` (primitive) →
`noEval()` / `noConsole()` (curried).

### Implementation sketch

```typescript
// Project-scoped caches (one per matcher instance, sharable across calls)
function makeCaches() {
  // Keyed on the *reference* node — skips getSymbol() (the type-checker cost) on re-runs.
  const referenceDecisions = new WeakMap<Node, boolean>()
  const symbolDecisions = new WeakMap<Symbol, boolean>()
  const declarationDecisions = new WeakMap<Node, boolean>()
  return { referenceDecisions, symbolDecisions, declarationDecisions }
}

export function usingTagged(
  tagName: string | RegExp,
  options?: TagMatcherOptions,
): ExpressionMatcher {
  const tagText = options?.tagText
  const localOnly = options?.localOnly ?? false
  const matchTagName =
    typeof tagName === 'string' ? (n: string) => n === tagName : (n: string) => tagName.test(n)
  const matchText =
    tagText === undefined
      ? () => true
      : typeof tagText === 'string'
        ? (s: string) => s.includes(tagText)
        : (s: string) => tagText.test(s)

  const { referenceDecisions, symbolDecisions, declarationDecisions } = makeCaches()

  function declarationCarriesTag(decl: Node): boolean {
    const cached = declarationDecisions.get(decl)
    if (cached !== undefined) return cached

    let result = false
    if (Node.isJSDocable(decl)) {
      for (const jsDoc of decl.getJsDocs()) {
        for (const tag of jsDoc.getTags()) {
          if (!matchTagName(tag.getTagName())) continue
          if (!matchText(tag.getCommentText() ?? '')) continue
          result = true
          break
        }
        if (result) break
      }
    }
    declarationDecisions.set(decl, result)
    return result
  }

  function symbolCarriesTag(sym: Symbol): boolean {
    // Unwrap import / re-export aliases so we inspect the original
    // declaration, not the alias's ImportSpecifier.
    const resolved = unwrapAliases(sym)
    const cached = symbolDecisions.get(resolved)
    if (cached !== undefined) return cached

    let result = false
    for (const decl of resolved.getDeclarations()) {
      if (localOnly && decl.getSourceFile().isInNodeModules()) continue
      if (declarationCarriesTag(decl)) {
        result = true
        break
      }
    }
    symbolDecisions.set(resolved, result)
    return result
  }

  function resolveSymbolFor(node: Node): Symbol | undefined {
    // CallExpression / NewExpression: only fire when the callee/constructor
    // is a bare Identifier. When it's a PropertyAccessExpression, the
    // PropertyAccessExpression arm below handles the same reference —
    // matching here too would produce duplicate violations.
    if (Node.isCallExpression(node) || Node.isNewExpression(node)) {
      const expr = node.getExpression()
      if (!Node.isIdentifier(expr)) return undefined
      return expr.getSymbol()
    }
    if (Node.isPropertyAccessExpression(node)) {
      return node.getNameNode().getSymbol()
    }
    if (Node.isTypeReference(node)) {
      return node.getTypeName().getSymbol()
    }
    if (Node.isImportSpecifier(node)) {
      return node.getNameNode().getSymbol()
    }
    if (Node.isJsxOpeningElement(node) || Node.isJsxSelfClosingElement(node)) {
      const tagName = node.getTagNameNode()
      // For `<motion.div>` the tag name is a PropertyAccessExpression,
      // which the descendant walk already visits. Defer to that arm.
      if (Node.isPropertyAccessExpression(tagName)) return undefined
      return tagName.getSymbol()
    }
    if (Node.isDecorator(node)) {
      const expr = node.getExpression()
      // `@Ns.Decorator` — defer to the inner PropertyAccessExpression.
      if (!Node.isIdentifier(expr)) return undefined
      return expr.getSymbol()
    }
    if (Node.isTaggedTemplateExpression(node)) {
      const tag = node.getTag()
      // `ns.oldTag\`...\`` — defer to the inner PropertyAccessExpression.
      if (!Node.isIdentifier(tag)) return undefined
      return tag.getSymbol()
    }
    return undefined
  }

  return {
    description:
      typeof tagName === 'string'
        ? `reference to @${tagName} symbol`
        : `reference to symbol matching @${String(tagName)}`,
    syntaxKinds: [
      SyntaxKind.CallExpression,
      SyntaxKind.NewExpression,
      SyntaxKind.PropertyAccessExpression,
      SyntaxKind.TypeReference,
      SyntaxKind.ImportSpecifier,
      SyntaxKind.JsxOpeningElement,
      SyntaxKind.JsxSelfClosingElement,
      SyntaxKind.Decorator,
      SyntaxKind.TaggedTemplateExpression,
    ],
    matches(node: Node): boolean {
      const cached = referenceDecisions.get(node)
      if (cached !== undefined) return cached
      const sym = resolveSymbolFor(node)
      const result = sym ? symbolCarriesTag(sym) : false
      referenceDecisions.set(node, result)
      return result
    },
  }
}
```

**Cache lifecycle.** Caches are closed over inside the matcher instance.
A user who reuses the same matcher across multiple `.check()` calls
within one ts-morph project benefits from the cache. A different
matcher (e.g. one with different options) gets fresh caches —
correctness is preserved. The `WeakMap` keys are `Symbol` and `Node`
instances, both stable across one project lifetime.

**Edge — duplicate hits on `obj.oldMethod()`**: handled by the stateless
deferral above (see "Avoiding double-fires across overlapping syntax
kinds"). `resolveSymbolFor` returns `undefined` for the `CallExpression`
when its callee is a `PropertyAccessExpression`, so only the
`PropertyAccessExpression` arm fires — exactly one violation, no
condition-layer dedup needed.

### Rule variants in `src/rules/deprecation.ts`

Decision: put deprecation rules in their own file
`src/rules/deprecation.ts`. They are not "TypeScript safety" concerns —
they're API-lifecycle concerns and share the same pattern as
`security.ts` / `errors.ts`. Splitting keeps the typescript.ts file
focused on the post-0047 escape-hatch family.

```typescript
// src/rules/deprecation.ts

import type { ClassDeclaration, SourceFile } from 'ts-morph'
import type { Condition } from '../core/condition.js'
import type { ArchFunction } from '../models/arch-function.js'
import { usingDeprecated, type TagMatcherOptions } from '../helpers/matchers.js'
import { classNotContain } from '../conditions/body-analysis.js'
import { functionNotContain } from '../conditions/body-analysis-function.js'
import { moduleNotContain } from '../conditions/body-analysis-module.js'

// @deprecated
export function noUseOfDeprecated(opts?: TagMatcherOptions): Condition<ClassDeclaration> {
  return classNotContain(usingDeprecated(opts))
}
export function functionNoUseOfDeprecated(opts?: TagMatcherOptions): Condition<ArchFunction> {
  return functionNotContain(usingDeprecated(opts))
}
export function moduleNoUseOfDeprecated(opts?: TagMatcherOptions): Condition<SourceFile> {
  return moduleNotContain(usingDeprecated(opts))
}

// @internal / @experimental rule wrappers deferred (2026-07-13) — add
// alongside their convenience wrappers when demand appears.
```

Three `@deprecated` rule wrappers. All one-liners. (The `usingInternal` /
`usingExperimental` families follow the identical pattern when added.)

### Composition examples (for docs)

```typescript
// Ban every call to a deprecated symbol in production code.
// Tests can still use them.
functions(p)
  .that()
  .resideInFolder('src/**')
  .should()
  .satisfy(functionNoUseOfDeprecated())
  .rule({
    id: 'lifecycle/no-deprecated',
    because: 'deprecated APIs will be removed in the next major version',
    suggestion: 'follow the @deprecated message for the replacement',
  })
  .check()

// Local deprecations only — ignore upstream library deprecations
// until we're ready to update them.
functions(p)
  .should()
  .satisfy(functionNoUseOfDeprecated({ localOnly: true }))
  .check()

// Pre-2.0 deprecations are blockers; 2.0+ deprecations are warnings.
functions(p)
  .should()
  .satisfy(functionNoUseOfDeprecated({ tagText: /(since 1\.|since 0\.)/ }))
  .check()

// Don't reach into another package's @internal symbols.
modules(p).should().notContain(usingTagged('internal')).check()

// SDK package may use experimental features; downstream consumers may not.
functions(p)
  .that()
  .resideInFolder('!src/sdk/**')
  .should()
  .notContain(usingTagged('experimental'))
  .check()
```

### Index exports

`src/index.ts` matchers block — append:

```typescript
export {
  // existing matchers...
  usingTagged,
  usingDeprecated,
  // usingInternal, usingExperimental — deferred (see "Scope: @deprecated first")
} from './helpers/matchers.js'

export type { TagMatcherOptions } from './helpers/matchers.js'
```

Rule wrappers re-exported via the new `./rules/deprecation` sub-path
(parallels `./rules/typescript`, `./rules/security`, etc.). Add to
`package.json` `"exports"` block:

```json
"./rules/deprecation": {
  "types": "./dist/rules/deprecation.d.ts",
  "default": "./dist/rules/deprecation.js"
}
```

## Implementation phases

### Phase 1 — `usingTagged()` matcher with cache (~3 hours)

1. Create `src/helpers/symbol-resolution.ts` with the reusable pieces:
   `resolveSymbolFor()`, `unwrapAliases()`, and the reference/symbol/
   declaration caches. (This is what makes the follow-on symbol-resolving
   matchers cheap — see "Strategic note.")
2. Add `TagMatcherOptions` and `usingTagged()` to `src/helpers/matchers.ts`,
   built on the extracted resolver.
3. Add the `usingDeprecated` convenience wrapper.
4. Export from `src/index.ts`.

**Files changed:** `src/helpers/symbol-resolution.ts` (new),
`src/helpers/matchers.ts`, `src/index.ts`.

### Phase 2 — Rule wrappers (~1 hour)

5. Create `src/rules/deprecation.ts` with three one-line `@deprecated` rule variants.
6. Add `./rules/deprecation` sub-path export to `package.json`.

**Files changed:** `src/rules/deprecation.ts` (new), `package.json`.

### Phase 3 — Tests (~4–5 hours)

6. Matcher unit tests in
   `tests/helpers/matchers-tagged.test.ts`.
7. Cross-file fixture: a deprecated function in one file, a caller in
   another.
8. Cross-package fixture: simulated `node_modules/some-lib/index.d.ts`
   with `@deprecated`, a caller importing it. Verify `localOnly`
   filters this out.
9. Rule smoke tests in
   `tests/rules/deprecation.test.ts`.
10. Cache-hit regression test: invoke the same matcher 10× on a fixture,
    assert symbol resolution count via spy/instrumentation does not
    grow linearly.

**Files changed:** `tests/helpers/matchers-tagged.test.ts` (new),
`tests/rules/deprecation.test.ts` (new), several fixture files under
`tests/fixtures/deprecation/` (new).

### Phase 4 — Docs (~1.5 hours)

11. `docs/body-analysis.md` — new section on symbol-resolving matchers,
    document `usingTagged` + `usingDeprecated`.
12. `docs/standard-rules.md` — add the `@deprecated` rule family, with a
    short "deprecation lifecycle" narrative (declare with `@deprecated`,
    ban use with `usingDeprecated()`, optionally enforce removal with
    `comment()`). No separate page — matches every other rule family.
13. `docs/api-reference.md` — extend the matcher and rules tables.
14. `CHANGELOG.md` — `### Added` entries under Unreleased.
15. README mention — short paragraph in the "Standard Rules Library"
    section pointing to `rules/deprecation`.

## Test strategy (~30 tests)

### `usingTagged()` matcher (15 tests)

- **Basic same-file deprecation** — function declared `@deprecated`,
  caller in same file, matcher fires on call expression.
- **Method `@deprecated`** — class method tagged, caller does
  `obj.method()` — fires on the property access inside the call.
- **Class `@deprecated`** — `new OldClass()` fires on `NewExpression`.
- **Type alias `@deprecated`** — `let x: DeprecatedType` fires on
  `TypeReference`.
- **Import binding `@deprecated`** — `import { oldFn }` fires on
  `ImportSpecifier`.
- **JSX tag `@deprecated`** — `<OldComponent />` fires on
  `JsxOpeningElement` / `JsxSelfClosingElement`.
- **Decorator `@deprecated`** — `@OldDecorator class Foo {}` fires on
  `Decorator`. Negative case: `@Ns.OldDecorator` fires on the inner
  `PropertyAccessExpression`, not the Decorator.
- **Tagged template `@deprecated`** — `` oldTag`...` `` fires on
  `TaggedTemplateExpression`. Negative case: `` ns.oldTag`...` ``
  fires on the inner `PropertyAccessExpression`.
- **Inheritance — override masks tag** — `class Sub extends Base`
  where `Base.foo()` is `@deprecated` and `Sub.foo()` overrides
  without the tag; `subInstance.foo()` does NOT fire.
- **Inheritance — base-typed receiver fires** — same fixture, but
  variable typed as `Base`; `baseTypedReceiver.foo()` DOES fire.
- **Empty `@deprecated` body** — `getCommentText()` returns `undefined`;
  matcher with no `tagText` option still fires; matcher with any
  `tagText` does not.
- **Cross-file** — declaration in `lib.ts`, caller in `app.ts`, matcher
  resolves the symbol via the project's type checker.
- **Cross-package (node_modules)** — declaration in
  `node_modules/some-lib/index.d.ts`, caller in user code, matcher
  fires.
- **`localOnly: true` skips node_modules** — same fixture as above,
  matcher does _not_ fire.
- **`tagText` option (string)** — only `@deprecated since 1.0` matches,
  not `@deprecated since 2.0`.
- **`tagText` option (regex)** — same, with a regex pattern.
- **`tagName` as regex** — `usingTagged(/^(deprecated|removed)$/)`
  fires on either tag name.
- **Untagged symbol** — caller uses a non-deprecated function,
  matcher does not fire.
- **No symbol resolvable** — e.g. dynamic import expression,
  unresolved name. Matcher returns `false` cleanly, no exception.
- **Cache correctness** — second call to `matches()` with the same
  symbol returns the cached result; instrumented test verifies the
  declaration walk runs once.

### Convenience wrapper (1 test)

- `usingDeprecated()` is equivalent to `usingTagged('deprecated')`.

### Rule wrappers (6 tests — 1 violation + 1 happy-path per wrapper)

- `noUseOfDeprecated()` / `functionNoUseOfDeprecated()` /
  `moduleNoUseOfDeprecated()` — each gets one positive (caller) and one
  negative (no caller) fixture. (`*Internal` / `*Experimental` families
  follow the identical shape when added.)

### Property/JSDoc descriptor assertions (2 tests)

- Each of the two shipped matchers (`usingTagged`, `usingDeprecated`) exposes the correct `description` and
  `syntaxKinds` array (mirroring 0046's matcher metadata tests).

### Edge / regression (3 tests)

- **`obj.oldMethod()` produces exactly one violation.** Encodes the
  stateless dedup policy from Design — `CallExpression` arm defers,
  `PropertyAccessExpression` arm fires. Counts violations, not just
  presence.
- **`<motion.div>` produces exactly one violation when `motion` is
  tagged.** Same policy applied to JSX qualified tag names.
- **Re-export alias chain.** `lib.ts` exports `@deprecated oldFn`,
  `index.ts` does `export { oldFn } from './lib'`, `app.ts` imports
  from `index.ts` and calls `oldFn()`. The matcher must follow both
  alias hops via `unwrapAliases()` and fire on the call.

## Files changed

| File                                    | Change                                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/helpers/symbol-resolution.ts`      | New — reusable resolver + `unwrapAliases` + reference/symbol/declaration caches     |
| `src/helpers/matchers.ts`               | +1 primitive (`usingTagged`) + `usingDeprecated` wrapper + `TagMatcherOptions`      |
| `src/index.ts`                          | Export `usingTagged`, `usingDeprecated`, `TagMatcherOptions`                        |
| `src/rules/deprecation.ts`              | New — 3 one-line `@deprecated` rule variants                                        |
| `package.json`                          | Add `./rules/deprecation` sub-path export                                           |
| `tests/helpers/matchers-tagged.test.ts` | New — matcher tests + 1 wrapper test + 2 descriptor tests + 3 edge/regression tests |
| `tests/rules/deprecation.test.ts`       | New — 6 rule smoke tests                                                            |
| `tests/fixtures/deprecation/**`         | New fixtures: same-file, cross-file, cross-package, JSX, types                      |
| `docs/body-analysis.md`                 | Document symbol-resolving matchers section                                          |
| `docs/standard-rules.md`                | Add the `@deprecated` rule family + lifecycle narrative (no separate page)          |
| `docs/api-reference.md`                 | Update matcher and rules tables                                                     |
| `README.md`                             | One-paragraph mention in Standard Rules section                                     |
| `CHANGELOG.md`                          | `### Added` under next version                                                      |

No new runtime dependencies. Symbol resolution uses ts-morph APIs
already in use by `noAnyProperties()`.

### CHANGELOG entry

```markdown
### Added

- **`usingTagged(tagName, options?)` matcher** — flags references whose
  resolved symbol's declaration carries a JSDoc tag. The first
  symbol-resolving matcher in ts-archunit; opens the path to other
  type-aware primitives (`untypedImports`, `referencesAnyType`) via the
  reusable `symbol-resolution` helper. Caches per-reference decisions so
  repeated rule runs skip re-resolution.
- **Convenience wrapper**: `usingDeprecated()` for the most common
  JSDoc-tagged-API workflow. (`usingInternal()` / `usingExperimental()`
  follow when demand appears — `usingTagged('internal')` works today.)
- **New rules namespace `@nielspeter/ts-archunit/rules/deprecation`** —
  three class/function/module variants for banning uses of `@deprecated`
  symbols. All compose with `resideInFolder()` for "production code can't
  use deprecated APIs; tests can" style rules.
```

## Performance considerations

- `getSymbol()` forces type-checker work on first call. Empirically
  ts-morph caches symbols at the program level, so the second call on
  the same node is cheap.
- The matcher's caches amortize both layers: a `WeakMap<Symbol, boolean>`
  spares the declaration JSDoc walk (`oldFn` inspected once no matter how
  many call sites), and a `WeakMap<referenceNode, boolean>` skips
  `getSymbol()` itself on repeated `.check()` runs over the same project.
- `syntaxKinds` filtering happens in the condition layer before
  `matches()` runs — most nodes never reach the symbol resolution code.
- Worst case (large project, no cache hits): ~1ms per unique symbol
  resolved. A project with 5,000 unique tagged-symbol references
  resolves in ~5s of one-time cost, then near-zero on re-runs.
- The matcher should not hold the `Symbol`/`Node` cache alive past the
  ts-morph project lifetime — `WeakMap` ensures GC compatibility.

Add a benchmark fixture (10k-line synthetic project, 500 unique
deprecated symbols, 5,000 call sites) and assert the rule completes
under 10s. Don't gate CI on absolute time, but track the trend.

## Phase 0 spike — answers locked in

A throwaway investigation script
(`tests/investigation/plan-0048-spike.test.ts`) ran every prior open
question against ts-morph 27. Results below; the spike file is removed
once the answers land in the real test suite.

### Resolved into Design

- **Dedup policy** — `CallExpression` / `NewExpression` /
  qualified-JSX arms defer to the inner `PropertyAccessExpression` arm.
  Stateless. No in-matcher Set. (See "Avoiding double-fires across
  overlapping syntax kinds.")
- **Re-exports and import aliases** — `unwrapAliases()` via
  `getAliasedSymbol()` only. `getExportSymbolIfAlias()` does **not**
  exist on ts-morph's `Symbol` wrapper — was a misremembered TS
  internal. Two-hop barrel re-export traversal verified against the
  spike fixture. (See "Cross-package and re-export resolution via
  alias unwrapping.")

### Resolved by spike — concrete answers

1. **Inheritance / overrides.** Override masks the tag, as expected.
   - `class Sub extends Base` where `Base.foo()` is `@deprecated` and
     `Sub.foo()` overrides without the tag — `subInstance.foo()` does
     **not** fire (`carriesTag = false`).
   - The same call against a variable typed as `Base` (holding a `Sub`)
     **does** fire — `getSymbol()` resolves through the declared
     receiver type.
   - This is the right behavior: rules see what TypeScript sees. Lock
     with two fixtures in Phase 3 (one for each case).

2. **`{@link}` and tag body shapes.** `getCommentText()` semantics
   pinned by spike:

   | Source                                   | `getCommentText()`             |
   | ---------------------------------------- | ------------------------------ |
   | `@deprecated since 2.0`                  | `"since 2.0"`                  |
   | `@deprecated use {@link newApi} instead` | `"use {@link newApi} instead"` |
   | `@deprecated\n * multi-line\n * body`    | `"  multi-line\n  body"`       |
   | `@deprecated` (no body)                  | `undefined`                    |
   | `@deprecated   leading spaces  `         | `"leading spaces"` (trimmed)   |

   So: `{@link}` syntax is preserved literally (not rendered). Empty
   body returns `undefined`. Single-line bodies are trimmed; multi-line
   preserves internal whitespace. The matcher coerces with `?? ''` and
   `tagText` matches by substring/regex against this raw string.

3. **Decorator and tagged-template coverage.** Both work cleanly —
   add to `syntaxKinds`.
   - `@MyDecorator class Foo` — `Decorator.getExpression().getSymbol()`
     resolves correctly, tag detection fires.
   - `` oldTag`...` `` — `TaggedTemplateExpression.getTag().getSymbol()`
     same.
   - Updated `syntaxKinds`:
     ```typescript
     ;[
       SyntaxKind.CallExpression,
       SyntaxKind.NewExpression,
       SyntaxKind.PropertyAccessExpression,
       SyntaxKind.TypeReference,
       SyntaxKind.ImportSpecifier,
       SyntaxKind.JsxOpeningElement,
       SyntaxKind.JsxSelfClosingElement,
       SyntaxKind.Decorator,
       SyntaxKind.TaggedTemplateExpression,
     ]
     ```
   - `Decorator` arm: only fire when expression is an `Identifier`
     (defer to inner `PropertyAccessExpression` for
     `@Namespace.Decorator`).
   - `TaggedTemplateExpression` arm: same — only when tag is an
     `Identifier`.

4. **`skipLibCheck: true` interaction.** Independent of JSDoc parsing.
   Spike tested both `true` and `false` against the same cross-package
   `@deprecated` fixture; both detect the tag. The test plan does
   **not** need a tsconfig matrix — single tsconfig covers both cases.

## Open questions (genuinely open)

None blocking. Implementation can start.

## Out of scope

- **Auto-applying `@deprecated` to consumers transitively.** "Mark
  every function that calls a deprecated function as itself deprecated"
  is taint propagation — Tier 3 territory.
- **Suggesting the replacement automatically.** The `@deprecated` tag
  often says "use `newFn` instead." Parsing that and feeding it into
  the violation `suggestion` is doable but not in this plan; the user
  supplies suggestion text per `.rule({...})` for now.
- **`@public` / `@alpha` / `@beta` API-extractor stability tiers.**
  These are TSDoc/Microsoft API extractor conventions that combine
  multiple tags into a stability hierarchy. `usingTagged('alpha')`
  works mechanically but the _policy_ (alpha can use beta but not
  public, etc.) is a layered preset — propose separately if demand
  shows up.
- **`@since` version cutoffs.** `tagText` option already supports
  matching by tag body, so `usingTagged('since', { tagText: /^[12]\./ })`
  works. A dedicated `usedSince(version)` predicate could be cleaner;
  defer until usage emerges.
- **Banning the _declaration_ of `@deprecated`.** Already handled
  today by `comment('@deprecated')`. We don't duplicate that.
- **Cross-file dataflow / taint propagation.** Tier 3.

## Strategic note

`usingTagged()` is the gateway to the **symbol-resolution matcher
family**. Because the resolver, alias unwrapping, and caches are extracted
into `src/helpers/symbol-resolution.ts` (not closure-local to `usingTagged`),
several follow-on plans become small:

| Future plan           | Reuses                                                               |
| --------------------- | -------------------------------------------------------------------- |
| `untypedImports()`    | `symbol-resolution.ts` (resolver + caches) + `isFromExternalLibrary` |
| `referencesAnyType()` | Symbol → type → `'any'` text comparison                              |
| `usesUnsafeReturn()`  | Symbol → return type → flow into call site                           |

Each becomes a 0.5-day plan instead of a 2-day plan, because the
infrastructure exists. That's the strategic justification for accepting
the larger up-front cost in 0048: it pays for itself across follow-ons.

## Review findings — 2026-07-13

Reviewed via the `review-proposal` skill (architect + product lenses), grounded against the consumer (`body-traversal.ts`) and ts-morph's `.d.ts`. Existing-code survey: **no duplication** — `usingTagged`, wrappers, and `rules/deprecation` are all new; symbol resolution (`getSymbol`/`getJsDocs`) is already used by `noAnyProperties`.

**Verdict: Ship with changes** — the hard architectural calls are right; the plan text has contract bugs and is over-scoped.

### Blocking (fix before implementation)

- **RESOLVED 2026-07-13 — deleted.** The "Edge — duplicate hits" note now states the stateless deferral resolves it (no condition-layer dedup, which never existed). `findMatchesByKind` doesn't dedupe, but the `resolveSymbolFor` deferral makes `obj.oldMethod()` fire exactly once.
- **RESOLVED 2026-07-13 — reconciled.** The implementation-sketch `syntaxKinds` array is now the 9-kind version (adds `Decorator` + `TaggedTemplateExpression`), matching `resolveSymbolFor`, the spike, and the tests.
- **RESOLVED 2026-07-13 — removed.** The `(text as RegExp)` cast is gone (the branch already narrows to `RegExp`); ADR-005 clean. The option is also renamed `text` → `tagText` throughout.

### Should-fix

- **RESOLVED 2026-07-13 — added + extracted.** A `WeakMap<referenceNode, boolean>` now skips `getSymbol()` on re-runs, and the resolver + alias-unwrap + caches are extracted to `src/helpers/symbol-resolution.ts` so the follow-on matchers (`untypedImports`, `referencesAnyType`) can actually reuse them. CHANGELOG + Performance section corrected.
- **RESOLVED 2026-07-13 — trimmed.** Shipping `usingTagged` + `usingDeprecated` + the 3 deprecated rules; `usingInternal`/`usingExperimental` wrappers deferred (the generic primitive covers them). `docs/deprecation.md` folded into `standard-rules.md`. See "Scope: `@deprecated` first."
- **Honest positioning** (open — apply at doc-writing time). The eslint comparison oversells ("brittle past two-three folder splits" — the headline prod-vs-tests case is one `overrides` block). In `standard-rules.md`, add: "for the 90% case (warn on any deprecated usage), typescript-eslint's `no-deprecated` is zero-config and gives editor squiggles; reach for `usingTagged` when you need the architectural cut, generic tags, or baseline adoption."
- **RESOLVED 2026-07-13 — `text` → `tagText`** aligned throughout. Still to correct at implementation: the design table's "both enum and member checked" (only the member is checked per the sketch — either fix the table or resolve `getExpression().getSymbol()` too).

### Praise

- Reusing `ExpressionMatcher` over a `SymbolMatcher` sibling is the right call. Alias unwrapping is load-bearing and handled seriously (`getAliasedSymbol()` verified to return `undefined`, not throw). Watch-mode staleness is a non-issue (`WeakMap` object identity). `./rules/deprecation` split is correct. Phase 0 spike is exemplary.

**Next step:** apply the three blocking edits + trim to `@deprecated`; the largest open plan then becomes a focused ~1-day change that still lays the full symbol-resolution infra.
