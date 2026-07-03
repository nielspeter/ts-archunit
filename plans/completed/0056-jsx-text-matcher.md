# Plan 0056: `jsxText()` Matcher

## Status

- **State:** Done — shipped in v0.12.0 (2026-07-03)
- **Priority:** P3 — small additive matcher, unblocks i18n-style rules
- **Effort:** ~3 hours
- **Created:** 2026-06-10
- **Depends on:** none (additive)

## Problem

A consuming project (Danish UI, `t()`-based i18n) wanted to enforce "no
hardcoded user-facing text in JSX." For **attribute values** the existing
`jsxElements()` entry point already solves it cleanly — `getAttribute()`
returns the literal string for `title="..."` and the raw expression text
(starting with `{`) for `title={t(...)}`, so a single regex
(`/^[^{].*\p{L}/u`) catches literals containing actual prose while
ignoring numeric placeholders like `"000000"`. Verified: ~70ms test,
five user-facing attributes covered, zero false positives.

**One gap remains: JSX text children.** `<button>Save</button>` is a
`JsxText` node, not a `JsxAttribute`. The attribute machinery doesn't see
it. The same is true for `<button>{"Save"}</button>` and
``<button>{`Save`}</button>`` — the literal/template is wrapped in a
`JsxExpression`, syntactically distinct from attribute values.

Today users have two bad options:

1. **`expression(/regex/).notContain(...)`** — too broad. The
   `expression()` matcher walks all descendants and tests `getText()`,
   which flags string literals everywhere (variable initializers,
   default arg values, etc.), not just JSX content. Needs heavy
   exclusions or a baseline to be usable.
2. **No rule.** Live with the gap.

Neither is satisfying. A targeted matcher that knows about JSX text
content closes the gap with the same lego-brick shape as the existing
`jsxElement()` matcher — composable with the standard `.notContain()`
condition, no new builder type, no opinion baked in.

## Goals

- One new matcher in `src/helpers/matchers.ts`:
  - `jsxText()` — matches `JsxText` nodes with non-whitespace content,
    and `JsxExpression` nodes wrapping a bare `StringLiteral` or
    no-substitution template literal.
- Export from `src/index.ts` alongside `jsxElement`.
- Tests in `tests/helpers/matchers-jsx.test.ts` (extends the existing
  JSX matcher test file).
- Documentation in `docs/body-analysis.md`, `docs/api-reference.md`,
  `CHANGELOG.md`.

No new rule variants in `src/rules/`. JSX text content is not
class-property-shaped or function-shaped in the way the TypeScript
escape-hatch rules are — the only natural composition is with
body-analysis `notContain()` on `modules`/`functions`, which users wire
up directly.

## Non-goals

- **JSX-aware allowlists for technical attributes** (`className`,
  `data-*`, etc.). Already solved by users composing
  `jsxElements(p).that().withAttribute(...)`. ts-archunit doesn't
  hardcode "user-facing" knowledge.
- **i18n function detection** (`t(...)`, `<Trans>`, `i18n.t(...)`). The
  matcher only finds hardcoded text. Whether the alternative is `t()`
  vs `<Trans>` vs `useTranslation()` is the user's call. The matcher
  doesn't require any of them; it just flags literal text.
- **Letter-presence filter** (the `\p{L}` regex from the consuming
  project). Belongs in the user's rule, not the matcher. A team
  enforcing "no JSX text content at all" should not be forced to opt
  out of a built-in letter filter. See "Three design calls" below.
- **JSX entity ban** (`&amp;`, `&nbsp;`). JsxText `getLiteralText()`
  returns the raw text with entities intact; users can layer their own
  pattern check on top if needed.
- **A new entry point like `jsxText(p)`.** The matcher form (lowercase,
  inside `matchers.ts`, composed via `.notContain()`) is consistent
  with `jsxElement()`. Adding a builder entry point would duplicate
  surface area for no gain.

## Design

### Three design calls (resolved)

These came up in the consuming project's feedback. Resolving them here
so the implementation is unambiguous.

**1. Whitespace skip — built-in.** `JsxText` nodes are emitted for
inter-element whitespace (every multi-line `<div>\n  <span/>\n</div>`
produces them). If `jsxText()` matched these, every JSX file would
explode. Skip is built in:
`node.getLiteralText().trim().length === 0` → no match. There is no
real-world use case for "match whitespace JsxText nodes."

**2. `{"hardcoded"}` and ``{`hardcoded`}`` — match.** A `JsxExpression`
wrapping a bare `StringLiteral` or `NoSubstitutionTemplateLiteral` is
semantically identical to JSX text — same rendered output, same
hardcoded-prose problem. Not matching them leaves a trivial bypass:
write `<button>{"Save"}</button>` to dodge the rule. Match by default.
No option. The matcher's job is "JSX text content"; the wrapping
expression is incidental.

**3. Letter-present filter — user concern.** The `\p{L}` regex
(`/^[^{].*\p{L}/u`) is the right semantic for _i18n_ rules, but
`jsxText()` shouldn't bake in that semantic. A different rule might
want to flag all JSX text including `<span>$$$</span>` or
`<button>→</button>` (e.g. enforcing a token system). If teams need
the letter gate, they layer it via their own regex on the violation
output, or — more cleanly — they live with the false positives and use
`.excluding(silent(...))` per the suite's convention. No option for
now. If a real second user surfaces with a documented need we can add
`jsxText({ requirePattern })` later.

### Matcher implementation

```typescript
export function jsxText(): ExpressionMatcher {
  return {
    description: 'JSX text content',
    syntaxKinds: [SyntaxKind.JsxText, SyntaxKind.JsxExpression],
    matches(node: Node): boolean {
      if (Node.isJsxText(node)) {
        return node.getLiteralText().trim().length > 0
      }
      if (Node.isJsxExpression(node)) {
        const expr = node.getExpression()
        if (!expr) return false
        if (Node.isStringLiteral(expr)) return true
        if (Node.isNoSubstitutionTemplateLiteral(expr)) return true
        return false
      }
      return false
    },
  }
}
```

**Why both `JsxText` and `JsxExpression` in `syntaxKinds`:** ts-archunit
traversal uses `syntaxKinds` to narrow `getDescendantsOfKind` calls.
Listing both kinds is what enables the same matcher to cover both shapes
in a single body walk. The dispatch inside `matches()` then picks the
correct branch — same pattern as `broadType()` in plan 0047 (which
covers both `TypeReference` and `TypeLiteral`).

**Why `Node.isStringLiteral(expr)` not a text comparison:** robust
against quote-style variation (`'Save'` vs `"Save"`), Unicode escapes,
and template-literal-with-no-interpolation. ts-morph type guards do
the work.

**Why `getLiteralText()` not `getText()`:** `getText()` on `JsxText`
includes the surrounding whitespace from the source. `getLiteralText()`
returns the content as it would render — correct for the
non-whitespace check.

### Usage

```typescript
import { modules, jsxText } from 'ts-archunit'

modules(p)
  .that()
  .resideInFolder('src/components/**')
  .should()
  .notContain(jsxText())
  .because('User-facing text must go through t() — found hardcoded JSX content')
  .excluding('src/components/Icon.tsx') // single-char icons, allowed
  .check()
```

For function-scoped rules (per-component):

```typescript
import { functions, jsxText } from 'ts-archunit'

functions(p).that().resideInFolder('src/components/**').should().notContain(jsxText()).check()
```

Both work because `notContain` is defined for both `ArchModule` and
`ArchFunction` body analysis (plan 0011 pattern). No new condition
variant needed.

### Edge cases — what does and doesn't match

| Code                             | Matches? | Why                                                            |
| -------------------------------- | -------- | -------------------------------------------------------------- |
| `<button>Save</button>`          | yes      | `JsxText` with prose                                           |
| `<div>{"Save"}</div>`            | yes      | `JsxExpression` wrapping `StringLiteral`                       |
| ``<div>{`Save`}</div>``          | yes      | `JsxExpression` wrapping `NoSubstitutionTemplateLiteral`       |
| `<div>{count}</div>`             | no       | `JsxExpression` wrapping `Identifier`                          |
| `<div>{t("save")}</div>`         | no       | `JsxExpression` wrapping `CallExpression`                      |
| ``<div>{`Hello ${name}`}</div>`` | no       | `TemplateExpression` (has substitution), not no-substitution   |
| `<div>\n  <span/>\n</div>`       | no       | Whitespace-only `JsxText`                                      |
| `<div>{ /* comment */ }</div>`   | no       | `JsxExpression` with no expression                             |
| `<div>123</div>`                 | yes      | `JsxText` with prose — users layer letter-gate if they want it |
| `const x = "Save"`               | no       | Not inside JSX. Plain `StringLiteral`.                         |
| `<MyComponent label="Save" />`   | no       | Attribute, not text — use `jsxElements()` for attribute rules  |

The last row is the critical separation: **attributes are covered by
the existing `jsxElements()` entry point**, JSX text children are
covered by this matcher. Two clean lego bricks, no overlap.

### Index exports

Add to `src/index.ts` matchers block at line 192:

```typescript
export {
  // ... existing
  jsxElement,
  jsxText, // <-- new
  typeAssertion,
  // ...
} from './helpers/matchers.js'
```

No new type exports — the matcher is parameterless.

## Implementation phases

### Phase 1 — Matcher (~30 min)

1. Add `jsxText()` to `src/helpers/matchers.ts` immediately after
   `jsxElement()` (lines 364–384). Same JSDoc shape, link to
   `jsxElement()` so readers find both.
2. Export from `src/index.ts` line 192 block.

**Files changed:**

- `src/helpers/matchers.ts` — +1 matcher (~25 LOC)
- `src/index.ts` — +1 export

### Phase 2 — Tests (~1.5 hours)

Extend `tests/helpers/matchers-jsx.test.ts` with a new
`describe('jsxText() matcher', ...)` block. Test inventory below.

**Files changed:**

- `tests/helpers/matchers-jsx.test.ts` — +1 describe block (~12 tests)

### Phase 3 — Docs (~1 hour)

1. `docs/body-analysis.md` — add `jsxText()` to the matcher catalog
   alongside `jsxElement()`. Include the i18n use case as the
   motivating example, and a worked example with `.notContain()` on
   `modules`. Update the matcher count.
2. `docs/api-reference.md` — extend the matcher table.
3. `CHANGELOG.md` — `### Added` entry under Unreleased:
   `- jsxText() matcher for detecting hardcoded JSX text content (children of JSX elements, including {"..."} and {`...`} expression-wrapped literals). Composable with notContain() for i18n enforcement.`

## Test strategy (~12 tests)

In `describe('jsxText() matcher', ...)` extending the existing JSX
matcher test file. Same `createTsxProject` helper that's already there.

**Matches (positive cases — 5 tests):**

1. Matches `<button>Save</button>` — basic `JsxText` with prose
2. Matches `<div>{"Save"}</div>` — `JsxExpression` wrapping
   `StringLiteral`, single quotes
3. Matches ``<div>{`Save`}</div>`` — `JsxExpression` wrapping
   `NoSubstitutionTemplateLiteral`
4. Matches multiple JsxText nodes in one element — e.g.
   `<div>Hello <span/> world</div>` matches both text nodes
5. Matches single-character text — `<div>×</div>` (letter-gate is a
   user concern, not built-in)

**Does NOT match (negative cases — 6 tests):**

6. Does NOT match whitespace-only `JsxText` — `<div>\n  <span/>\n</div>`
7. Does NOT match `JsxExpression` wrapping an `Identifier` —
   `<div>{count}</div>`
8. Does NOT match `JsxExpression` wrapping a `CallExpression` —
   `<div>{t("save")}</div>`
9. Does NOT match `TemplateExpression` (has substitution) —
   ``<div>{`Hello ${name}`}</div>``
10. Does NOT match empty `JsxExpression` — `<div>{ /* comment */ }</div>`
11. Does NOT match plain string literals outside JSX —
    `const x = "Save"` (`StringLiteral` node not inside
    `JsxText`/`JsxExpression`)

**Structural (1 test):**

12. Has correct `syntaxKinds` for efficient traversal — contains both
    `JsxText` and `JsxExpression`, length 2

End-to-end integration with `notContain()` is covered by the existing
body-analysis test suite for `notContain()`; no additional integration
test needed — the matcher conforms to `ExpressionMatcher` and the
condition layer dispatches by `syntaxKinds`.

## Stability impact

**Additive — minor version bump.** New export, no behavior change to
existing matchers or rules, no `recommended()` changes (per plan 0049
stability policy this matcher does not flag previously-passing code in
any existing rule because no existing rule uses it).

## ADR alignment

- **ADR-002 (ts-morph):** uses `Node.isJsxText`, `Node.isJsxExpression`,
  `Node.isStringLiteral`, `Node.isNoSubstitutionTemplateLiteral` for
  type narrowing. No raw `typescript` API access.
- **ADR-003 (fluent builder):** sits in `helpers/matchers.ts`,
  composes with existing `notContain()` condition. No new builder
  type, no DSL fracture.
- **ADR-005 (no `any`, no `as`):** parameterless matcher returning
  `ExpressionMatcher` interface. No casts. All type narrowing via
  ts-morph guards.

## Strategic note

This is the smallest-possible plan that closes the JSX-children gap
flagged by a real consuming project. Three reasons it earns the
slot:

1. **Real demand.** A team already shipped the attribute-side rule
   and hit the exact wall this matcher unblocks. Not speculative.
2. **Joins existing architecture.** Same file, same shape, same
   composition path as `jsxElement()`. Zero new concepts.
3. **Framework-mindset clean.** No baked-in i18n function knowledge,
   no letter-gate, no "user-facing" hardcoding. The matcher answers
   one structural question: is this hardcoded JSX text content? Teams
   bring their own policy on top.

## Files Changed

**Phase 1:**

- `src/helpers/matchers.ts` — +1 matcher (~25 LOC)
- `src/index.ts` — +1 export

**Phase 2:**

- `tests/helpers/matchers-jsx.test.ts` — +1 describe block (~12 tests)

**Phase 3:**

- `docs/body-analysis.md` — matcher catalog entry
- `docs/api-reference.md` — matcher table entry
- `CHANGELOG.md` — Added entry under Unreleased
