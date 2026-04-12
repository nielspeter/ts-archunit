# Proposal 010 — JSX Element Architecture Rules

**Status:** Implemented
**Created:** 2026-04-12
**Implemented:** 2026-04-12
**Priority:** High
**Affects:** New entry point, new model, new builder, matchers, conditions

**Summary:** All 5 phases shipped. `jsxElements(p)` entry point with
`ArchJsxElement` model, `JsxRuleBuilder`, 4 JSX predicates, 5 JSX conditions,
`jsxElement()` body-analysis matcher, and `STANDARD_HTML_TAGS` constant.
90 tests across 5 test files. Docs: `docs/jsx.md` + updates to getting-started,
what-to-check, api-reference, recipes. Two rounds of 5-reviewer expert review
with all findings addressed. SonarLint clean (0 issues).

## Problem

ts-archunit can enforce module boundaries, class structure, function naming,
and body analysis on `.tsx` files — but it cannot see _inside JSX_. There is
no way to express rules about which JSX elements a component renders, which
attributes those elements carry, or whether a design system is being used
consistently.

This matters for two concrete use cases:

### 1. Design system compliance

Teams with component libraries (Material UI, Chakra, Radix, Ant Design, or
custom internal systems) want to ensure raw HTML elements are not used where
design system components exist. Import rules can prevent importing the wrong
package, but they cannot detect raw HTML elements rendered inline:

```tsx
// This passes all existing rules — no forbidden import
export function BadComponent() {
  return <button onClick={handleClick}>Save</button>
  //     ^^^^^^^^ should be <Button> from the design system
}
```

### 2. Structural JSX conventions

Common patterns that teams want to enforce at the architecture level:

- "No raw `<div>` wrappers — use `<Stack>` or `<Box>` from the design system"
- "Every `<img>` must have an `alt` attribute" (a11y baseline)
- "No inline `style={}` — use utility classes"
- "No `<a>` tags — use `<Link>` from the router"
- "No `dangerouslySetInnerHTML`"
- "Test IDs: every interactive element must have `data-testid`"

These are all AST-level concerns — the information is in the ts-morph JSX
nodes — but ts-archunit has no entry point to reach it.

### Why not eslint?

eslint-plugin-jsx-a11y covers some attribute rules. But:

- It cannot enforce design system substitutions (`<div>` → `<Box>`)
- It cannot scope rules to specific folders (`**/components/**` vs `**/pages/**`)
- It cannot combine with import rules or body analysis in a single test
- ts-archunit rules compose with `.that()` predicates, `.excluding()`,
  baselines, and severity — eslint rules don't

The goal is not to replace eslint-plugin-jsx-a11y but to cover the
_structural_ JSX patterns that eslint cannot express.

## Pre-implementation Check

**Verify ts-morph JSX support for user projects.** ts-morph parses `.tsx`
files based on file extension alone — the `jsx` compiler option is not
required for parsing (confirmed in spike). ts-archunit's own tsconfig does
not need a `jsx` setting. Confirm:

1. `project('tsconfig.json')` where tsconfig has `"jsx": "react-jsx"` correctly
   parses `.tsx` files and exposes `JsxElement` / `JsxSelfClosingElement` nodes.
2. A project with NO `jsx` compiler option still parses `.tsx` files and
   returns JSX AST nodes (ts-morph infers from extension).
3. Test fixtures use `useInMemoryFileSystem` with `compilerOptions: { jsx: 2 }`
   for unit tests (confirmed in spike — works). All tests use in-memory
   file systems — no `.tsx` fixture files on disk — to avoid breaking
   `tsc --noEmit` (the main tsconfig has no `jsx` setting and includes
   `tests/`).

## Proposed API

### New entry point: `jsxElements(p)`

```ts
import { project, jsxElements } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')

// No raw <button> — use design system components
jsxElements(p)
  .that()
  .areHtmlElements('button', 'input', 'select', 'textarea')
  .should()
  .notExist()
  .because('use design system components instead of raw HTML form elements')
  .check()

// No raw <div> wrappers in components — use layout primitives
jsxElements(p)
  .that()
  .areHtmlElements('div')
  .and()
  .resideInFile('**/components/**')
  .should()
  .notExist()
  .because('use <Stack>, <Box>, or <Flex> from the design system')
  .check()

// Every <img> must have alt
jsxElements(p)
  .that()
  .areHtmlElements('img')
  .should()
  .haveAttribute('alt')
  .because('images must have alt text for accessibility')
  .check()

// No inline styles anywhere
jsxElements(p)
  .that()
  .resideInFile('**/*.tsx')
  .should()
  .notHaveAttribute('style')
  .because('use utility classes, not inline styles')
  .check()

// No dangerouslySetInnerHTML
jsxElements(p)
  .that()
  .resideInFile('**/*.tsx')
  .should()
  .notHaveAttribute('dangerouslySetInnerHTML')
  .check()

// Interactive elements must have data-testid
jsxElements(p)
  .that()
  .areHtmlElements('button', 'input', 'select', 'a')
  .should()
  .haveAttribute('data-testid')
  .because('interactive elements need test IDs for E2E tests')
  .check()

// Only design system components in pages (no raw HTML)
jsxElements(p)
  .that()
  .areHtmlElements(...STANDARD_HTML_TAGS) // shipped constant
  .and()
  .resideInFolder('**/pages/**')
  .should()
  .notExist()
  .because('pages must compose design system components, not raw HTML')
  .check()

// Elements with onClick must also have an aria-label
jsxElements(p)
  .that()
  .withAttribute('onClick')
  .should()
  .haveAttribute('aria-label')
  .because('interactive elements need accessible labels')
  .check()
```

### New model: `ArchJsxElement`

Follows the same interface pattern as `ArchCall` and `ArchFunction`:

```ts
export interface ArchJsxElement {
  /** Tag name: 'div', 'Button', 'Icons.Check', etc. */
  getName(): string

  /** Source file containing this element. */
  getSourceFile(): SourceFile

  /** Whether this is a lowercase HTML intrinsic element. */
  isHtmlElement(): boolean

  /** Whether this is an uppercase component element. */
  isComponent(): boolean

  /**
   * Get attribute value by name. Returns undefined if absent or valueless.
   * For valueless attributes (`<input disabled />`), returns undefined —
   * use `hasAttribute('disabled')` for presence checks.
   * For expression attributes (`onClick={() => {}}`), returns the raw
   * initializer text including braces (e.g. `{() => {}}`).
   */
  getAttribute(name: string): string | undefined

  /**
   * Check whether an attribute exists (including valueless like `disabled`).
   * Only checks named attributes — spread attributes (`{...props}`) are
   * not inspected (the spread's contents are not statically known).
   */
  hasAttribute(name: string): boolean

  /**
   * Get all named attribute names. Spread attributes (`{...props}`) are
   * excluded — only `JsxAttribute` nodes are returned, not
   * `JsxSpreadAttribute` nodes.
   */
  getAttributeNames(): string[]

  /** Whether this element has children (JsxElement vs JsxSelfClosingElement). */
  hasChildren(): boolean

  /** Underlying ts-morph node. */
  getNode(): JsxElement | JsxSelfClosingElement

  /** Start line number in the source file. */
  getStartLineNumber(): number
}
```

**Spread attribute handling:** JSX attributes can be either `JsxAttribute`
(named, e.g. `className="x"`) or `JsxSpreadAttribute` (e.g. `{...props}`).
All attribute methods (`getAttribute`, `hasAttribute`, `getAttributeNames`)
filter to `Node.isJsxAttribute()` before accessing names, safely skipping
spread attributes. This prevents runtime crashes on `{...props}`.

**Fragment handling:** `JsxFragment` (`<>...</>`) nodes are intentionally
excluded from collection — they have no tag name and no attributes, so no
rule can meaningfully target them. `<React.Fragment>` _is_ a `JsxElement`
with tag name `"React.Fragment"`, classified as a component (uppercase
first character). This is correct — it behaves like any other component.

### New builder: `JsxRuleBuilder extends RuleBuilder<ArchJsxElement>`

**Predicates (`.that()` phase):**

| Method                               | Description                                                                                                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `areHtmlElements(...tags)`           | Lowercase intrinsic elements matching the given tag names. At least one tag required — use `STANDARD_HTML_TAGS` constant for the common "all standard HTML" case. |
| `areComponents(...names?)`           | Uppercase/dotted component elements. No args = all components. With args = only those (use full dotted name, e.g. `'Icons.Check'`).                               |
| `withAttribute(name)`                | Filter to elements that have the named attribute (any value).                                                                                                     |
| `withAttributeMatching(name, value)` | Filter to elements where attribute matches string/regex.                                                                                                          |
| `haveNameMatching(pattern)`          | Inherited identity predicate — tag name matches string or regex.                                                                                                  |
| `haveNameStartingWith(prefix)`       | Inherited identity predicate — tag name starts with prefix.                                                                                                       |
| `haveNameEndingWith(suffix)`         | Inherited identity predicate — tag name ends with suffix.                                                                                                         |
| `resideInFile(glob)`                 | Inherited identity predicate (predicate-only, not available in `.should()`).                                                                                      |
| `resideInFolder(glob)`               | Inherited identity predicate (predicate-only, not available in `.should()`).                                                                                      |

**Shipped constant:** `STANDARD_HTML_TAGS` — array of all standard HTML tag
names (`'div'`, `'span'`, `'button'`, `'input'`, `'a'`, `'img'`, `'form'`,
`'table'`, `'p'`, `'h1'`–`'h6'`, `'ul'`, `'ol'`, `'li'`, `'section'`,
`'header'`, `'footer'`, `'nav'`, `'main'`, `'aside'`, `'article'`, etc.).
Exported from `src/index.ts`. Lets users write
`areHtmlElements(...STANDARD_HTML_TAGS)` without manually listing tags, while
keeping the semantics unambiguous (no surprise matching of `<my-widget>` or
`<motion.div>`).

**Conditions (`.should()` phase):**

| Method                                  | Description                                                      |
| --------------------------------------- | ---------------------------------------------------------------- |
| `notExist()`                            | Filtered set must be empty (like `calls().should().notExist()`). |
| `haveAttribute(name)`                   | Every matched element must have this attribute.                  |
| `notHaveAttribute(name)`                | No matched element may have this attribute.                      |
| `haveAttributeMatching(name, value)`    | Attribute must exist and match value (string/regex).             |
| `notHaveAttributeMatching(name, value)` | Attribute must not match (or be absent).                         |

**No dual-use methods.** Unlike the module builder's `resideInFile` /
`notImportFrom` which dispatch on `_phase`, attribute methods use
**distinct names** for predicates vs conditions:

- **Predicate:** `withAttribute(name)` — filter to elements that have it
- **Condition:** `haveAttribute(name)` — assert all matched elements have it

This avoids a subtle foot-gun: `.that().haveAttribute('alt')` (filter to
elements WITH alt) vs `.should().haveAttribute('alt')` (assert all HAVE alt)
would silently enforce the _opposite_ intent if confused. Distinct names
(`withAttribute` vs `haveAttribute`) make the chain unambiguous:

```ts
// Correct: assert all <img> have alt
jsxElements(p).that().areHtmlElements('img').should().haveAttribute('alt').check()

// Correct: find elements with data-testid, assert they also have aria-label
jsxElements(p).that().withAttribute('data-testid').should().haveAttribute('aria-label').check()
```

### New matcher: `jsxElement()` for body analysis

Extends the existing matcher family (`call()`, `access()`, `newExpr()`,
`expression()`) so existing entry points can detect JSX usage:

```ts
import { jsxElement } from '@nielspeter/ts-archunit'

// Functions must not render raw <div>
functions(p).that().resideInFile('**/pages/**/*.tsx').should().notContain(jsxElement('div')).check()

// Modules must not contain <script> tags
modules(p).that().resideInFile('**/*.tsx').should().notContain(jsxElement('script')).check()
```

Implementation: an `ExpressionMatcher` targeting `SyntaxKind.JsxElement`
and `SyntaxKind.JsxSelfClosingElement`, matching the tag name.

### Collection function: `collectJsxElements(sourceFile)`

Follows the `collectCalls()` pattern, with two optimizations:

1. **Skip non-`.tsx` files early** — pure `.ts` files cannot contain JSX.
   Unlike `collectCalls()` (calls exist in every file), JSX is extension-gated.
2. **Single-pass traversal** — uses `forEachDescendant` instead of two
   separate `getDescendantsOfKind` calls, avoiding a double AST walk.

```ts
export function collectJsxElements(sourceFile: SourceFile): ArchJsxElement[] {
  // Short-circuit: only .tsx/.jsx files can contain JSX
  const filePath = sourceFile.getFilePath()
  if (!filePath.endsWith('.tsx') && !filePath.endsWith('.jsx')) return []

  const elements: ArchJsxElement[] = []
  sourceFile.forEachDescendant((node) => {
    if (Node.isJsxElement(node)) {
      elements.push(fromJsxElement(node))
    } else if (Node.isJsxSelfClosingElement(node)) {
      elements.push(fromJsxSelfClosingElement(node))
    }
    // JsxFragment intentionally excluded — no tag name, no attributes
    // Nested JSX elements ARE collected (consistent with collectCalls)
  })
  return elements
}
```

## Design Decisions

### Why a new entry point, not just a matcher?

A `jsxElement()` matcher (Phase 1) is useful for body-analysis conditions
(`notContain(jsxElement('div'))`), but it cannot express attribute rules.
The matcher interface returns `boolean` — it has no way to say "this `<img>`
is missing `alt`." Attribute conditions need element-level granularity,
which requires a dedicated builder operating on `ArchJsxElement` instances.

Both are shipped: the matcher for quick body checks, the entry point for
full JSX architecture rules.

### Tag name classification

Two rules:

1. **Dot-notation tags are always components.** If the tag name contains `.`
   (e.g. `motion.div`, `Icons.Check`, `React.Fragment`), it is a component —
   dot-notation implies a namespace object, not an HTML element. Checked via
   `tagName.includes('.')`.
2. **For simple names, lowercase = HTML intrinsic, uppercase = component.**
   This follows the JSX specification and React's convention. Checked via
   `tagName[0] === tagName[0].toLowerCase()`.

ts-morph's AST reflects this: `JsxOpeningElement.getTagNameNode()` returns
a `PropertyAccessExpression` for `<Foo.Bar />` and an `Identifier` for
`<div>` or `<Button>`. Namespaced tags (`<svg:rect>`) are lowercase and
classified as HTML — correct for our purposes.

### Attribute value access

`JsxAttribute.getInitializer()` returns:

- `StringLiteral` for `alt='Logo'` — `getAttribute()` returns `'Logo'`
  (the literal value, not the quoted text)
- `JsxExpression` for `onClick={() => {}}` — `getAttribute()` returns
  `{() => {}}` (raw text including braces)
- `undefined` for valueless attributes (`disabled`, `checked`) —
  `getAttribute()` returns `undefined`

**Valueless attributes return `undefined`, not `'true'`.** This avoids
conflating "present but valueless" (`<input disabled />`) with "value is
true" (`<input disabled={true} />`). The distinction matters:

- `hasAttribute('disabled')` → `true` for both
- `getAttribute('disabled')` → `undefined` for `<input disabled />`,
  `{true}` for `<input disabled={true} />`

This is consistent with how HTML's `getAttribute()` works (returns `""` or
`null`, never the string `"true"` for boolean attributes) and prevents
subtle matching bugs in `haveAttributeMatching`.

### Spread attribute safety

`JsxSpreadAttribute` nodes (`{...props}`) have no name — calling name
methods on them would crash. All attribute access methods filter to
`Node.isJsxAttribute()` first (ADR-005: use ts-morph type guards for
narrowing). Spread attributes are inherently opaque at static analysis
time — the spread's contents are not known without type evaluation.

### No children analysis in Phase 1

Checking "does this `<button>` have text children?" is useful for a11y
(`<button>` needs either `aria-label` or visible text). But children can
be expressions, fragments, or nested elements. This adds significant
complexity for a niche use case. Defer to Phase 2.

### No dual-use methods for attributes

The module builder uses dual-use methods (`resideInFile`, `notImportFrom`)
that dispatch on `_phase`. This works because filter-vs-assert on file
location rarely produces the _opposite_ intent. For attributes, it's
dangerous: `.that().haveAttribute('alt')` (filter to elements WITH alt)
vs `.should().haveAttribute('alt')` (assert all HAVE alt) are semantically
opposite. Getting the chain order wrong silently enforces the wrong thing.

**Solution:** distinct names — `withAttribute` (predicate) vs
`haveAttribute` (condition). "With" implies filtering, "have" implies
assertion. This follows the pattern of `withMethod` (predicate on
`CallRuleBuilder`) vs method-specific conditions.

### Violation helpers

`ArchJsxElement` is a wrapper model (like `ArchCall`), not a raw `Node`.
JSX conditions need a `createJsxViolation()` helper. Unlike
`createCallViolation()` which constructs violations manually (missing code
frames), `createJsxViolation()` should **delegate to the core
`createViolation()`** in `src/core/violation.ts` — passing
`element.getNode()` to get code frames, suggestions, and docs links for
free. Override the `element` field with the JSX tag name (since the core
helper walks ancestors, which produces meaningless output for a JSX node
inside a component).

### Scoping: `.tsx` files only?

No — the entry point collects from all source files. Users scope with
`.that().resideInFile('**/*.tsx')`. This is consistent with all other entry
points (modules, classes, functions don't pre-filter by extension). Files
without JSX simply produce zero elements.

## Implementation

### Phase 1: Model + matcher + collection (~0.5 day)

1. **`src/models/arch-jsx-element.ts`** — `ArchJsxElement` interface,
   `fromJsxElement()`, `fromJsxSelfClosingElement()`, `collectJsxElements()`
   with `.tsx` short-circuit and single-pass traversal. Spread attribute
   safety via `Node.isJsxAttribute()` filtering.
2. **`src/helpers/matchers.ts`** — add `jsxElement(tagOrRegex)` matcher
   targeting `SyntaxKind.JsxElement` + `SyntaxKind.JsxSelfClosingElement`.
   JSDoc notes it is tag-only (no attribute matching — use the entry point
   for attribute rules).
3. **`src/index.ts`** — export `jsxElement` matcher, `STANDARD_HTML_TAGS` constant

### Phase 2: Predicates + conditions (~0.5 day)

4. **`src/predicates/jsx.ts`** — `areHtmlElements()`, `areComponents()`,
   `withAttribute()`, `withAttributeMatching()`
5. **`src/conditions/jsx.ts`** — `notExist()`, `haveAttribute()`,
   `notHaveAttribute()`, `haveAttributeMatching()`, `notHaveAttributeMatching()`,
   `createJsxViolation()` helper (delegates to core `createViolation`)

### Phase 3: Builder + entry point (~0.5 day)

6. **`src/builders/jsx-rule-builder.ts`** — `JsxRuleBuilder extends RuleBuilder<ArchJsxElement>`,
   `jsxElements(p)` entry function. Exposes inherited identity predicates
   (`haveNameMatching`, `haveNameStartingWith`, `haveNameEndingWith`,
   `resideInFile`, `resideInFolder` — all predicate-only, following
   `CallRuleBuilder` pattern). No dual-use methods — distinct names
   for predicates (`withAttribute`) vs conditions (`haveAttribute`).
7. **`src/index.ts`** — export `jsxElements`, `JsxRuleBuilder`

### Phase 4: Tests (~0.5 day)

All tests use in-memory file systems with `compilerOptions: { jsx: 2 }` —
no `.tsx` fixture files on disk (avoids breaking `tsc --noEmit` which uses
the main tsconfig without a `jsx` setting).

8. **`tests/models/arch-jsx-element.test.ts`** — model unit tests
9. **`tests/predicates/jsx.test.ts`** — predicate tests
10. **`tests/conditions/jsx.test.ts`** — condition tests
11. **`tests/builders/jsx-rule-builder.test.ts`** — integration tests
12. **`tests/helpers/matchers-jsx.test.ts`** — `jsxElement()` matcher tests

### Phase 5: Documentation (~0.25 day)

13. **`docs/jsx.md`** — new page: JSX Element Rules. Prominently feature
    cross-entry-point composition (`functions().should().notContain(jsxElement('div'))`)
14. **`docs/getting-started.md`** — add JSX example in "What can you check?"
15. **`docs/what-to-check.md`** — add JSX one-liners
16. **`docs/api-reference.md`** — add `jsxElements()`, `jsxElement()`, `STANDARD_HTML_TAGS`, predicates, conditions
17. **`docs/recipes.md`** — add "Design System Compliance" recipe

### Files Changed

| File                                      | Change                                          |
| ----------------------------------------- | ----------------------------------------------- |
| `src/models/arch-jsx-element.ts`          | **New** — model + collection                    |
| `src/predicates/jsx.ts`                   | **New** — JSX predicates                        |
| `src/conditions/jsx.ts`                   | **New** — JSX conditions + `createJsxViolation` |
| `src/builders/jsx-rule-builder.ts`        | **New** — builder + entry point                 |
| `src/helpers/matchers.ts`                 | Add `jsxElement()` matcher                      |
| `src/index.ts`                            | Export new symbols                              |
| `package.json`                            | No change (no new dependencies)                 |
| `tests/models/arch-jsx-element.test.ts`   | **New**                                         |
| `tests/predicates/jsx.test.ts`            | **New**                                         |
| `tests/conditions/jsx.test.ts`            | **New**                                         |
| `tests/builders/jsx-rule-builder.test.ts` | **New**                                         |
| `tests/helpers/matchers-jsx.test.ts`      | **New**                                         |
| `docs/jsx.md`                             | **New** — JSX rules page                        |
| `docs/getting-started.md`                 | Add JSX example                                 |
| `docs/what-to-check.md`                   | Add JSX one-liners                              |
| `docs/api-reference.md`                   | Add JSX API entries                             |
| `docs/recipes.md`                         | Add design system recipe                        |

### Test Inventory

| Area          | Tests   | Description                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model         | 14      | getName (simple, dotted `Icons.Check`, `motion.div`), isHtmlElement (simple, namespaced `svg:rect`), isComponent (simple, dotted — dot-notation always component), getAttribute (string value, expression value, valueless returns undefined), hasAttribute (named, valueless, absent), getAttributeNames (named only, skips spread), hasChildren, getStartLineNumber, expression-based tag name graceful handling                                       |
| Collection    | 6       | collects JsxElement, JsxSelfClosingElement, mixed, skips JsxFragment (`<>...</>`), returns empty for `.ts` files, returns empty for `.js` files, collects from `.jsx` files                                                                                                                                                                                                                                                                              |
| Predicates    | 12      | areHtmlElements (with args, STANDARD_HTML_TAGS), areComponents (no args, with args, dotted `Icons.Check`), withAttribute, withAttributeMatching (string, regex), haveNameMatching (string, regex), haveNameStartingWith, haveNameEndingWith, resideInFile, resideInFolder                                                                                                                                                                                |
| Conditions    | 10      | notExist (pass, fail), haveAttribute (pass, fail), notHaveAttribute, haveAttributeMatching, notHaveAttributeMatching, element with spread attrs + named attrs, createJsxViolation source location + code frame                                                                                                                                                                                                                                           |
| Builder chain | 14      | `.that().areHtmlElements().should().notExist().check()` (pass + fail), `.that().areComponents().should().haveAttribute().check()` (pass + fail), `.excluding()`, `.because()` in error, `.warn()` does not throw, `.and()` combinator, `withAttribute` predicate + `haveAttribute` condition in same chain, `resideInFile` scoping, `resideInFolder` scoping, `not()` combinator, empty project (zero `.tsx` files), nested JSX in ternary/arrow returns |
| Matcher       | 5       | jsxElement string match, regex match, used in `notContain` (full body-analysis integration with functions/modules), used in `contain`, no match on non-JSX nodes                                                                                                                                                                                                                                                                                         |
| **Total**     | **~61** |                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Scope

~2 days. ~61 tests. No new dependencies. No changes to core engine
(rule-builder, execute-rule, format). Pure additive — new model, predicates,
conditions, builder, violation helper, `STANDARD_HTML_TAGS` constant, and a
single new matcher function.

## tsconfig Consideration

ts-archunit's own `tsconfig.json` does not have `"jsx"` set. This is fine
because:

1. ts-morph parses `.tsx` files based on file extension alone — the `jsx`
   compiler option is not required for AST parsing (confirmed in spike).
2. The library analyzes the _user's_ project, which typically has `jsx` set,
   but even without it ts-morph produces correct JSX AST nodes.
3. ts-archunit's source files are `.ts`, not `.tsx` — no JSX in library code.
4. The ts-morph type definitions for JSX nodes (`JsxElement`, `JsxAttribute`,
   etc.) are available regardless — they're part of the TypeScript type
   declarations.

**Critical:** all tests use in-memory file systems. No `.tsx` fixture files
on disk. The main `tsconfig.json` includes `tests/` in its `include` array
and has no `jsx` setting — on-disk `.tsx` files would break `tsc --noEmit`
in CI. This is the safest approach and matches the existing test pattern
(see `tests/models/arch-call.test.ts`).

## Alternatives Considered

### Alternative 1: JSX-specific conditions on existing entry points

Add `notContainJsx('div')` to the module builder. Simpler, but cannot
express attribute rules and breaks the "one entry point per element type"
pattern. The module builder would accumulate JSX-specific methods that
don't apply to non-JSX files.

**Rejected:** violates separation of concerns and the lego-bricks principle.

### Alternative 2: Extend the `calls()` entry point

JSX elements are syntactic sugar for `React.createElement()` calls. Could
model them as calls. But the AST represents them as `JsxElement`, not
`CallExpression` — this would require mapping between representations and
confuse the mental model.

**Rejected:** leaky abstraction.

### Alternative 3: Framework-specific package (`ts-archunit-react`)

ADR-006 says framework-specific rules go in separate packages. But JSX is
a TypeScript language feature (not React-specific) — Preact, Solid, and
custom JSX runtimes all use the same syntax. The entry point is
`jsxElements`, not `reactComponents`. Tag classification and attribute
analysis are framework-agnostic.

**Decision:** ship in core. If React-specific rules emerge later (hooks,
context, suspense boundaries), those go in a separate package per ADR-006.

## Known Limitations

- **Spread attributes are opaque:** `{...props}` cannot be analyzed
  statically. A `<Button {...props} />` where `props` includes `alt` will
  not be detected by `hasAttribute('alt')`. This is inherent to static
  analysis — the spread's contents depend on runtime values.

- **Nested JSX produces multiple violations:** `<div><div><button/></div></div>`
  with a rule banning `<div>` will produce two violations (one per `<div>`).
  This is consistent with `collectCalls` (every nested call is a separate
  element). Use `.excluding()` and file-level scoping to manage noise.

- **Expression-based tag names:** Rare patterns like computed JSX tags
  (`<{Component} />`) produce non-identifier tag name nodes. `getName()`
  returns the raw text; `isHtmlElement()`/`isComponent()` may misclassify.

## Out of Scope

- **Children analysis** — checking text content, child count, child types (Phase 2)
- **`useInsteadOf` for JSX** — structured "use `<Button>` instead of `<button>`"
  condition producing actionable violation messages with both the bad element
  and its replacement. Valuable for design system enforcement. Planned for
  Phase 2; for now, use `.because('use <Button> from @cmless/ui')`.
- **Component prop type validation** — needs type checker integration, not just AST
- **Hook rules** — separate concern, separate proposal
- **CSS class validation** — checking that Tailwind classes are valid (tooling exists)
- **Event handler analysis** — what's inside `onClick={...}` (use existing `within()` for that)
- **Attribute matching on the `jsxElement()` matcher** — the body-analysis
  matcher is tag-only by design. Use the `jsxElements()` entry point for
  attribute rules.
