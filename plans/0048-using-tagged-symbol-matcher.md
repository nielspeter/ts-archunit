# Plan 0048: `usingTagged()` Symbol-Tagged Matcher (Tier 1.5)

## Status

- **State:** PROPOSED
- **Priority:** P2 — opens the symbol-resolution layer that several future plans depend on
- **Effort:** 1.5–2 days
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
  declarations' JSDoc tags.
- Three convenience wrappers as one-liners over `usingTagged`:
  - `usingDeprecated(options?)`
  - `usingInternal(options?)`
  - `usingExperimental(options?)`
- Three rule variants per convenience wrapper (class / function /
  module) following the 0046 convention.
- Symbol-level cache so repeated `usingTagged()` calls on the same
  project pay symbol resolution exactly once per symbol.
- Tests covering same-file, cross-file (within project), and
  cross-package (from `node_modules`) declarations.
- Docs in `docs/body-analysis.md`, a new `docs/deprecation.md` page,
  `docs/standard-rules.md`, `docs/api-reference.md`, `CHANGELOG.md`.

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
- **JSDoc parsing of tag arguments beyond `text`.** The `text` option
  matches the tag's body string (e.g. `since 2.0`). Anything more
  structured (parsing `@deprecated since {version}` with named
  captures) is out of scope.
- **Auto-fix or migration suggestions.** `because`/`suggestion` strings
  the user supplies in `.rule({...})` are the only suggestion path.
- **Banning the tag declarations themselves.** That's the
  `comment('@deprecated')` case — already supported today. This plan
  is about _uses_, not declarations.

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
   * usingTagged('deprecated', { text: /since 2\./ })
   * // matches only `@deprecated since 2.x` declarations
   */
  readonly text?: string | RegExp

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

### Convenience wrappers (one-liners)

```typescript
export function usingDeprecated(options?: TagMatcherOptions): ExpressionMatcher {
  return usingTagged('deprecated', options)
}

export function usingInternal(options?: TagMatcherOptions): ExpressionMatcher {
  return usingTagged('internal', options)
}

export function usingExperimental(options?: TagMatcherOptions): ExpressionMatcher {
  return usingTagged('experimental', options)
}
```

These are pure ergonomics — every team that knows the tag name doesn't
have to import `usingTagged` and pass a string. Same pattern as
`call()` (primitive) → `noEval()` / `noConsole()` (curried).

### Implementation sketch

```typescript
// Project-scoped caches (one per matcher instance, sharable across calls)
function makeCaches() {
  const symbolDecisions = new WeakMap<Symbol, boolean>()
  const declarationDecisions = new WeakMap<Node, boolean>()
  return { symbolDecisions, declarationDecisions }
}

export function usingTagged(
  tagName: string | RegExp,
  options?: TagMatcherOptions,
): ExpressionMatcher {
  const text = options?.text
  const localOnly = options?.localOnly ?? false
  const matchTagName =
    typeof tagName === 'string' ? (n: string) => n === tagName : (n: string) => tagName.test(n)
  const matchText =
    text === undefined
      ? () => true
      : typeof text === 'string'
        ? (s: string) => s.includes(text)
        : (s: string) => (text as RegExp).test(s)

  const { symbolDecisions, declarationDecisions } = makeCaches()

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
    ],
    matches(node: Node): boolean {
      const sym = resolveSymbolFor(node)
      if (!sym) return false
      return symbolCarriesTag(sym)
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

**Edge — duplicate hits on `obj.oldMethod()`**: this is both a
`PropertyAccessExpression` and lives inside a `CallExpression`. ts-morph
emits both in the descendant walk. The `PropertyAccessExpression`
matcher fires on `oldMethod`, but the `CallExpression` matcher resolves
the _call's_ expression, which is the same property access — symbol is
the same, so both nodes match. Two violations for one call.

**Fix:** prefer the `PropertyAccessExpression`'s match when a
`CallExpression` wraps it; the condition layer can dedupe by
`(symbol, source-file, line)`. Document explicitly. (See "Open
questions" below.)

### Rule variants in `src/rules/typescript.ts` (or new `src/rules/deprecation.ts`?)

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
import {
  usingDeprecated,
  usingInternal,
  usingExperimental,
  type TagMatcherOptions,
} from '../helpers/matchers.js'
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

// @internal — analogous trio
// @experimental — analogous trio
```

Nine rule wrappers total (3 tags × 3 scopes). All one-liners.

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
  .satisfy(functionNoUseOfDeprecated({ text: /(since 1\.|since 0\.)/ }))
  .check()

// Don't reach into another package's @internal symbols.
modules(p).should().notContain(usingInternal()).check()

// SDK package may use experimental features; downstream consumers may not.
functions(p).that().resideInFolder('!src/sdk/**').should().notContain(usingExperimental()).check()
```

### Index exports

`src/index.ts` matchers block — append:

```typescript
export {
  // existing matchers...
  usingTagged,
  usingDeprecated,
  usingInternal,
  usingExperimental,
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

1. Add `TagMatcherOptions`, `usingTagged()`, and the symbol/declaration
   caches to `src/helpers/matchers.ts`.
2. Add the three convenience wrappers (`usingDeprecated`,
   `usingInternal`, `usingExperimental`).
3. Export from `src/index.ts`.

**Files changed:** `src/helpers/matchers.ts`, `src/index.ts`.

### Phase 2 — Rule wrappers (~1 hour)

4. Create `src/rules/deprecation.ts` with nine one-line rule variants.
5. Add `./rules/deprecation` sub-path export to `package.json`.

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

### Phase 4 — Docs (~2 hours)

11. `docs/body-analysis.md` — new section on symbol-resolving matchers,
    document the four new functions.
12. `docs/deprecation.md` — new dedicated page covering the recommended
    deprecation lifecycle (declare with `@deprecated`, ban use with
    `usingDeprecated()`, optionally enforce removal with `comment()`).
13. `docs/standard-rules.md` — add the deprecation/internal/experimental
    rule families.
14. `docs/api-reference.md` — extend the matcher and rules tables.
15. `CHANGELOG.md` — `### Added` entries under Unreleased.
16. README mention — short paragraph in the "Standard Rules Library"
    section pointing to `rules/deprecation`.

## Test strategy (~42 tests)

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
- **`text` option (string)** — only `@deprecated since 1.0` matches,
  not `@deprecated since 2.0`.
- **`text` option (regex)** — same, with a regex pattern.
- **`tagName` as regex** — `usingTagged(/^(deprecated|removed)$/)`
  fires on either tag name.
- **Untagged symbol** — caller uses a non-deprecated function,
  matcher does not fire.
- **No symbol resolvable** — e.g. dynamic import expression,
  unresolved name. Matcher returns `false` cleanly, no exception.
- **Cache correctness** — second call to `matches()` with the same
  symbol returns the cached result; instrumented test verifies the
  declaration walk runs once.

### Convenience wrappers (3 tests)

- `usingDeprecated()` is equivalent to `usingTagged('deprecated')`.
- `usingInternal()` and `usingExperimental()` likewise.

### Rule wrappers (12 tests — 1 violation + 1 happy-path per wrapper)

- `noUseOfDeprecated()` / `functionNo*` / `moduleNo*` — each
  variant gets one positive (caller) and one negative (no caller)
  fixture.
- Same for `*Internal` and `*Experimental` rule families.

### Property/JSDoc descriptor assertions (4 tests)

- Each of the four matchers exposes the correct `description` and
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

| File                                    | Change                                                          |
| --------------------------------------- | --------------------------------------------------------------- |
| `src/helpers/matchers.ts`               | +1 primitive (`usingTagged`) + 3 wrappers + `TagMatcherOptions` |
| `src/index.ts`                          | Export the 4 new functions and the type                         |
| `src/rules/deprecation.ts`              | New — 9 one-line rule variants                                  |
| `package.json`                          | Add `./rules/deprecation` sub-path export                       |
| `tests/helpers/matchers-tagged.test.ts` | New — 15 matcher tests + 3 wrapper tests + 4 descriptor tests   |
| `tests/rules/deprecation.test.ts`       | New — 12 rule smoke tests + 1 dedup regression test             |
| `tests/fixtures/deprecation/**`         | New fixtures: same-file, cross-file, cross-package, JSX, types  |
| `docs/body-analysis.md`                 | Document symbol-resolving matchers section                      |
| `docs/deprecation.md`                   | New dedicated page                                              |
| `docs/standard-rules.md`                | Add the 9 rule variants                                         |
| `docs/api-reference.md`                 | Update matcher and rules tables                                 |
| `README.md`                             | One-paragraph mention in Standard Rules section                 |
| `CHANGELOG.md`                          | `### Added` under next version                                  |

No new runtime dependencies. Symbol resolution uses ts-morph APIs
already in use by `noAnyProperties()`.

### CHANGELOG entry

```markdown
### Added

- **`usingTagged(tagName, options?)` matcher** — flags references whose
  resolved symbol's declaration carries a JSDoc tag. The first
  symbol-resolving matcher in ts-archunit; opens the path to other
  type-aware primitives (`untypedImports`, `referencesAnyType`).
  Caches per-symbol decisions so repeated rule runs amortize the
  type-checker cost.
- **Convenience wrappers**: `usingDeprecated()`, `usingInternal()`,
  `usingExperimental()` for the most common JSDoc-tagged-API workflows.
- **New rules namespace `@nielspeter/ts-archunit/rules/deprecation`** —
  nine class/function/module variants for banning uses of `@deprecated`,
  `@internal`, and `@experimental` symbols. All compose with
  `resideInFolder()` for "production code can't use deprecated APIs;
  tests can" style rules.
```

## Performance considerations

- `getSymbol()` forces type-checker work on first call. Empirically
  ts-morph caches symbols at the program level, so the second call on
  the same node is cheap.
- The matcher's own `WeakMap<Symbol, boolean>` cache amortizes the
  declaration walk: `oldFn` called 200 times in a project does
  declaration JSDoc inspection once.
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
- **`@since` version cutoffs.** `text` option already supports
  matching by tag body, so `usingTagged('since', { text: /^[12]\./ })`
  works. A dedicated `usedSince(version)` predicate could be cleaner;
  defer until usage emerges.
- **Banning the _declaration_ of `@deprecated`.** Already handled
  today by `comment('@deprecated')`. We don't duplicate that.
- **Cross-file dataflow / taint propagation.** Tier 3.

## Strategic note

`usingTagged()` is the gateway to the **symbol-resolution matcher
family**. Once this lands and the cache pattern is established, several
follow-on plans become small:

| Future plan           | Reuses                                                      |
| --------------------- | ----------------------------------------------------------- |
| `untypedImports()`    | The same symbol cache + `Declaration.isFromExternalLibrary` |
| `referencesAnyType()` | Symbol → type → `'any'` text comparison                     |
| `usesUnsafeReturn()`  | Symbol → return type → flow into call site                  |

Each becomes a 0.5-day plan instead of a 2-day plan, because the
infrastructure exists. That's the strategic justification for accepting
the larger up-front cost in 0048: it pays for itself across follow-ons.
