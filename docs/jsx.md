# JSX Element Rules

The `jsxElements()` entry point operates on JSX elements across all `.tsx` and `.jsx` source files. Use it to enforce design system compliance, accessibility requirements, and structural conventions at the architecture level.

## When to Use

- Ban raw HTML elements in favor of design system components
- Require accessibility attributes (`alt` on `<img>`, `aria-label` on interactive elements)
- Forbid unsafe attributes (`dangerouslySetInnerHTML`, inline `style`)
- Enforce test IDs on interactive elements
- Scope JSX rules to specific folders (e.g., `**/pages/**` vs `**/components/**`)

## ArchJsxElement

ts-archunit scans every `JsxElement` and `JsxSelfClosingElement` in `.tsx`/`.jsx` files and wraps them in an `ArchJsxElement` model.

| Method                | Returns                               | Description                                       |
| --------------------- | ------------------------------------- | ------------------------------------------------- |
| `getName()`           | `string`                              | Tag name: `'div'`, `'Button'`, `'Icons.Check'`    |
| `isHtmlElement()`     | `boolean`                             | Lowercase first char, no dot                      |
| `isComponent()`       | `boolean`                             | Uppercase first char or dot-notation              |
| `hasAttribute(name)`  | `boolean`                             | Named attribute exists (skips spread)             |
| `getAttribute(name)`  | `string \| undefined`                 | Attribute value or undefined                      |
| `getAttributeNames()` | `string[]`                            | All named attributes (skips spread)               |
| `hasChildren()`       | `boolean`                             | `true` for `JsxElement`, `false` for self-closing |
| `getSourceFile()`     | `SourceFile`                          | Containing file                                   |
| `getNode()`           | `JsxElement \| JsxSelfClosingElement` | Underlying ts-morph node                          |

### Tag Classification

- **Simple lowercase** (`div`, `button`, `span`) → HTML intrinsic element
- **Uppercase** (`Button`, `Modal`) → component
- **Dot-notation** (`Icons.Check`, `motion.div`) → always component (the dot implies a namespace object)
- **Namespaced** (`svg:rect`) → HTML intrinsic (lowercase, no dot)

### Attribute Access

- `getAttribute('alt')` on `<img alt="Logo" />` returns `'Logo'` (literal value)
- `getAttribute('onClick')` on `<button onClick={() => {}} />` returns `{() => {}}` (raw text)
- `getAttribute('disabled')` on `<input disabled />` returns `undefined` (valueless — use `hasAttribute` for presence)
- Spread attributes (`{...props}`) are invisible to static analysis and are not inspected

## Basic Usage

```typescript
import { project, jsxElements, STANDARD_HTML_TAGS } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')

// No raw <button> — use design system components
jsxElements(p)
  .that()
  .areHtmlElements('button', 'input', 'select', 'textarea')
  .should()
  .notExist()
  .because('use design system components instead of raw HTML form elements')
  .check()

// Every <img> must have alt
jsxElements(p)
  .that()
  .areHtmlElements('img')
  .should()
  .haveAttribute('alt')
  .because('images must have alt text for accessibility')
  .check()
```

## JSX Predicates

Predicates narrow down which JSX elements your rule targets. Chain multiple with `.and()`.

### `areHtmlElements(...tags)`

Matches HTML intrinsic elements with the given tag names. At least one tag required.

```typescript
jsxElements(p).that().areHtmlElements('button', 'input')
jsxElements(p)
  .that()
  .areHtmlElements(...STANDARD_HTML_TAGS)
```

Use the exported `STANDARD_HTML_TAGS` constant for unambiguous "all standard HTML" matching — it excludes custom elements like `<my-widget>`.

### `areComponents(...names?)`

Matches component elements. No args = all components. With args = only those.

```typescript
jsxElements(p).that().areComponents() // all components
jsxElements(p).that().areComponents('Button', 'Input') // specific ones
jsxElements(p).that().areComponents('Icons.Check') // dotted name
```

### `withAttribute(name)`

Filter to elements that have the named attribute (any value). This is a **predicate** (filtering), not a condition (asserting).

```typescript
// Find elements with onClick, then assert they also have aria-label
jsxElements(p).that().withAttribute('onClick').should().haveAttribute('aria-label').check()
```

### `withAttributeMatching(name, value)`

Filter to elements where the attribute matches a string or regex.

```typescript
jsxElements(p).that().withAttributeMatching('type', 'submit')
jsxElements(p).that().withAttributeMatching('className', /error/)
```

### Identity Predicates

All standard identity predicates are available:

```typescript
jsxElements(p)
  .that()
  .haveNameMatching(/^H[1-6]$/) // heading elements
jsxElements(p).that().resideInFile('**/pages/**') // scope to pages
jsxElements(p).that().resideInFolder('**/components') // scope to folder
```

## JSX Conditions

Conditions assert what must be true about the matched elements.

### `notExist()`

The filtered set must be empty. Use with element-type predicates to ban specific elements.

```typescript
jsxElements(p)
  .that()
  .areHtmlElements('div')
  .and()
  .resideInFolder('**/pages/**')
  .should()
  .notExist()
  .because('pages must compose design system components, not raw HTML')
  .check()
```

### `haveAttribute(name)` / `notHaveAttribute(name)`

Assert attribute presence or absence on every matched element.

```typescript
// Every <img> must have alt
jsxElements(p).that().areHtmlElements('img').should().haveAttribute('alt').check()

// No inline styles
jsxElements(p).should().notHaveAttribute('style').check()

// No dangerouslySetInnerHTML
jsxElements(p).should().notHaveAttribute('dangerouslySetInnerHTML').check()
```

### `haveAttributeMatching(name, value)` / `notHaveAttributeMatching(name, value)`

Assert attribute value matching.

```typescript
// All inputs must have type="text" or type="email" (not untyped)
jsxElements(p)
  .that()
  .areHtmlElements('input')
  .should()
  .haveAttributeMatching('type', /^(text|email|password|number|tel)$/)
  .check()
```

## Predicate vs Condition Naming

JSX rules use **distinct names** for predicates and conditions on attributes to avoid confusion:

| Phase       | Method                 | Meaning                                    |
| ----------- | ---------------------- | ------------------------------------------ |
| `.that()`   | `withAttribute('alt')` | **Filter** to elements that have `alt`     |
| `.should()` | `haveAttribute('alt')` | **Assert** all matched elements have `alt` |

This prevents a subtle foot-gun: writing `.that().haveAttribute('alt')` would filter to elements WITH `alt`, not assert they have it.

## JSX Matcher for Body Analysis

The `jsxElement()` matcher integrates with existing entry points (`functions()`, `modules()`, `classes()`) for body-analysis checks:

```typescript
import { project, functions, modules, jsxElement } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')

// Functions in pages/ must not render raw <div>
functions(p).that().resideInFile('**/pages/**/*.tsx').should().notContain(jsxElement('div')).check()

// Modules must not contain <script> tags
modules(p).that().resideInFile('**/*.tsx').should().notContain(jsxElement('script')).check()

// Match by regex
modules(p)
  .that()
  .resideInFile('**/*.tsx')
  .should()
  .notContain(jsxElement(/^motion\./))
  .check()
```

The `jsxElement()` matcher is **tag-only** — it cannot check attributes. Use the `jsxElements()` entry point for attribute-level rules.

## STANDARD_HTML_TAGS

A shipped constant containing all standard HTML tag names (`'div'`, `'span'`, `'button'`, `'input'`, `'a'`, `'img'`, etc.). Use with `areHtmlElements()`:

```typescript
import { STANDARD_HTML_TAGS } from '@nielspeter/ts-archunit'

// Ban all standard HTML elements in pages
jsxElements(p)
  .that()
  .areHtmlElements(...STANDARD_HTML_TAGS)
  .and()
  .resideInFolder('**/pages/**')
  .should()
  .notExist()
  .check()
```

This excludes custom web components (`<my-widget>`) and dot-notation components (`<motion.div>`).

## Incremental Adoption with `.excluding()`

When migrating an existing codebase to design system components, use `.excluding()` to suppress known violations while you fix them:

```typescript
jsxElements(p)
  .that()
  .areHtmlElements('button', 'input')
  .should()
  .notExist()
  .excluding('<button>', '<input>') // suppress while migrating
  .because('use design system components')
  .check()
```

ts-archunit warns when exclusions become stale (the violation was fixed but the exclusion remains).

## Known Limitations

- **Spread attributes are opaque** — `{...props}` cannot be analyzed statically
- **Nested JSX produces multiple violations** — `<div><div>...</div></div>` banning `<div>` produces two violations
- **Custom web components** (`<my-widget>`) are lowercase and classified as HTML intrinsic — use explicit tag lists to exclude them
