# Proposal 011 — Argument-Aware Identity for `calls()` Rules

**Status:** Implemented (v0.11.0, 2026-06-13 — see plan 0057)
**Date:** 2026-06-11
**Priority:** High
**Affects:** `calls()` builder, `ArchCall.getName()`, `ConditionContext`, `createCallViolation`, violation messages

## Summary

`calls()` rules identify a violating call by its **callee**
(`archCall.getName()` returns `${object}.${method}` — e.g. `app.post`,
`bus.on`, `flags.define`). When a codebase registers many things through
the _same_ call — any string-keyed registration pattern — every
violation collapses to the same element name, making the call's real
identity (the registration key) invisible to `.excluding()`.

This proposal adds an **opt-in** way to fold a chosen string-literal
argument into a call's element identity, so rules over
`<callee>(<key>, ...)` can name and exclude individual registrations by
their key:

```ts
calls(p)
  .that()
  .onObject('app')
  .withMethod(/^(get|post|put|patch|delete)$/)
  .identifiedByArg(0) // element becomes e.g. app.post("/auth/token")
  .resideInFolder('**/src/routes/**')
  .should()
  .haveArgumentWithProperty('preHandler')
  .excluding(/"\/auth\/(login|token|register)"/, /"\/\.well-known\/openid-configuration"/)
  .rule({ id: 'route/prehandler-required', because: 'Every route must have auth' })
  .check()
```

## The Generic Pattern: String-Keyed Registrations

This is _not_ an HTTP-routes feature. Any "register a thing by passing a
string identifier" pattern has the same problem when written as a rule:

| Pattern                | Call                                      | Identity needed  |
| ---------------------- | ----------------------------------------- | ---------------- |
| HTTP routes            | `app.post("/auth/token", handler)`        | the path         |
| Test discovery         | `describe("auth", () => ...)`             | the suite name   |
| Event/PubSub           | `bus.on("user.created", handler)`         | the event name   |
| Command/message router | `router.handle("createOrder", handler)`   | the command name |
| Validator registry     | `registry.register("email", validator)`   | the type key     |
| Feature flags          | `flags.define("new-checkout", true)`      | the flag key     |
| DI container           | `container.register("UserRepo", impl)`    | the token        |
| DB migrations          | `migrator.register("0042_add_users", fn)` | the migration id |

In every row the _first argument_ — a string literal — is the
distinguishing identity. Without folding it into the element name,
`.excluding()` can only operate at file granularity (too broad) or
per-line comments (too verbose when the whole file is exempt by design).

## The Problem

`createCallViolation` at `src/conditions/call.ts:18` writes:

```ts
element: archCall.getName() ?? '<call>'
```

`ArchCall.getName()` at `src/models/arch-call.ts:67` precomputes
`fullName = ${objectName}.${methodName}` (e.g. `app.post`) at
construction time. The distinguishing argument is discarded before it
ever reaches `.excluding()` (which matches against
`[element, file, message]` via `src/core/execute-rule.ts:44–48`).

So a rule like "every route registration must include a `preHandler`
auth middleware" cannot say "…except `GET
/.well-known/openid-configuration`, which is public." It can only say
"…except everything in `well-known.ts`," because the file path is the
only per-violation identity left.

The same shape blocks `describe("auth", …)`-keyed test policies,
`bus.on("payment.captured", …)`-keyed event policies, etc.

## Evidence (case study: Cmless PKG-02)

This came out of a real remediation — the Cmless project's June 2026
full-system architecture review, finding PKG-02. The
`route/prehandler-required` rule (R11) and two schema-quality rules
(`schema/no-bare-object`, `schema/no-additional-properties-true`) each
exclude **nine whole route files** — `auth.ts`, `sso.ts`, `oidc.ts`,
`invitations.ts`, `internal.ts`, `plans.ts`, `social.ts`,
`well-known.ts`, `platform/index.ts` — because the genuinely-public
routes inside them cannot be named individually.

The review flagged the consequence precisely:

> A _new authenticated_ route added to `auth.ts`, or a new internal
> endpoint with a bare `{ type: 'object' }` schema, ships **exempt from
> CI** — exactly the highest-risk files.

Confirming the gap empirically — running R11 with the file exclusions
removed and printing `violation.element` for all ~35 flagged routes
yields:

```
ELEM: app.post  @ auth.ts:233
ELEM: app.post  @ auth.ts:254
ELEM: app.get   @ well-known.ts:27
ELEM: app.post  @ sso.ts:125
ELEM: app.post  @ oidc.ts:273
…
```

Every route is `app.get` / `app.post`. There is no element-level
identity to exclude on, so the rule author is forced back to whole-file
regexes — which is the security hole PKG-02 is about.

PKG-02 is one driver. Any framework or app using `describe`,
`bus.on`, `flags.define`, `container.register`, `t(…)`, etc. as
architecture-rule targets hits the same wall.

## Proposed API

A new opt-in builder method on `calls()`:

```ts
.identifiedByArg(index: number)
```

Name chosen for consistency with the sibling predicates
`withArgMatching(index, pattern)` and `withStringArg(index, glob)` on
`CallRuleBuilder` (`src/builders/call-rule-builder.ts:102–108`) — same
`Arg` abbreviation across the family.

When set, the element name for a matched call becomes
`` `${callee}(${rawText})` `` where `rawText` is the source text of
argument `index` **iff** it is a `StringLiteral` or
`NoSubstitutionTemplateLiteral`. Otherwise the element name is unchanged
(bare `callee`), so dynamic registrations degrade gracefully.

Resulting element names:

| Call                                         | Default    | `.identifiedByArg(0)`                          |
| -------------------------------------------- | ---------- | ---------------------------------------------- |
| `app.post("/auth/token", h)`                 | `app.post` | `app.post("/auth/token")`                      |
| ``app.post(`/auth/token`, h)``               | `app.post` | ``app.post(`/auth/token`)``                    |
| `app.get(buildPath(), h)`                    | `app.get`  | `app.get` (non-literal → unchanged)            |
| ``app.post(`/auth/${env}`, h)``              | `app.post` | `app.post` (template substitution → unchanged) |
| `app.post(...routeArgs)`                     | `app.post` | `app.post` (spread → unchanged)                |
| `app.post("/long", h, opts)` with `index: 5` | `app.post` | `app.post` (out of bounds → unchanged)         |
| `describe("auth", () => {})` with `index: 0` | `describe` | `describe("auth")`                             |
| `bus.on("user.created", h)` with `index: 0`  | `bus.on`   | `bus.on("user.created")`                       |

`.excluding()` then targets the enriched name via the existing
matching machinery (`src/core/execute-rule.ts:44–48`):

```ts
.excluding(
  /"\/\.well-known\/openid-configuration"/,   // single route
  /app\.(get|post)\("\/oidc\//,                // all /oidc/* routes
  'app.post("/auth/token")',                   // exact-string match — works
)
```

> **Existing `.excluding()` semantics, unchanged by this proposal:**
> string patterns match by **exact equality** against
> `[element, file, message]`; regex patterns match by `.test()` (so
> substring matching is available via regex but not via plain strings).
> A separate proposal could relax string matching to substring; this
> proposal does not.

## How It Works

The enrichment lives at the model layer so every condition that reads
`archCall.getName()` benefits from it without per-condition plumbing.

**1. `ArchCall.getName()` gains an optional parameter:**

```ts
// src/models/arch-call.ts
getName(options?: { withArgument?: number }): string | undefined
```

When `withArgument` is set, `getName()` inspects argument `index` on the
underlying `CallExpression` via the existing `getArguments()`. If the
argument is a `StringLiteral` or `NoSubstitutionTemplateLiteral`, the
raw source text (`getText()`) is appended in parentheses. Otherwise the
bare `fullName` is returned unchanged.

**2. `ConditionContext` gains an optional field:**

```ts
// src/core/condition.ts
export interface ConditionContext {
  // ... existing fields
  identifyByArgument?: number
}
```

Placed on the shared `ConditionContext` rather than a `CallConditionContext`
subtype because it's a single optional primitive — abstraction cost would
exceed the leak. Conditions for other builder types simply ignore it.
Revisit if more builder-specific context fields accumulate.

**3. Every `archCall.getName()` call site in call conditions threads the option through.**

`src/conditions/call.ts` reads `archCall.getName() ?? '<call>'` at eight
sites: the `element` field at line 18, and seven violation-message
strings at lines 36, 61, 92, 169, 215, 256, 291. All eight switch to
`archCall.getName({ withArgument: context.identifyByArgument })`, so
the element field and the rendered message agree on identity.

**Hoist note:** at lines 92 and 291 the call sits inside an inner
`for (const match of matches)` loop. Hoist the enriched name into a
local before the loop (same shape as line 169 already uses) — otherwise
the option's literal-shape walk re-runs per match. The other six sites
fire once per element and need no hoist.
Without this, a violation could read:

```
element: app.post("/auth/token")
message: app.post does not have a callback containing ...
```

— element and message disagree on the same line. Threading the option
through every site keeps the two cohesive.

**4. `CallRuleBuilder` stores the index. `fork()` propagation is automatic.**

```ts
// src/builders/call-rule-builder.ts
private _identifyByArgument?: number

identifiedByArg(index: number): this {
  this._identifyByArgument = index
  return this
}
```

No change to `fork()`. `Object.assign(fork, this)` at
`src/core/rule-builder.ts:276` already shallow-copies the primitive
`_identifyByArgument` field. The explicit copies on lines 277–282 exist
only for mutable shared state (arrays, sets, objects) where shallow
copy would alias mutations across forks; a primitive needs none. A
test still asserts the field survives `.and()`/`.or()` branching.

(Future variants that store an options object rather than a number
would require the explicit copy.)

Everything else (`.excluding()` matching, the stale-exclusion warning,
code frames) is unchanged.

### Identity scope — what gets enriched, what doesn't

`.identifiedByArg()` is an **identity/exclusion** concern, not a
**filtering** concern. The enriched name appears in:

- the violation `element` field,
- the rendered violation `message`,
- anything that runs `.test(element)` / `=== element` on the way out
  (`.excluding()` matching at `src/core/execute-rule.ts:44–48`, the
  stale-exclusion warning at line 61).

The enriched name does **not** appear in:

- **predicates** that read `archCall.getName()` to decide whether an
  element passes the filter chain. `Named.getName()` at
  `src/predicates/identity.ts:7` takes no arguments, and identity
  predicates (`haveNameMatching`, `haveNameStartingWith`,
  `haveNameEndingWith`) call it with no args at
  `src/predicates/identity.ts:32, 45, 58`. They continue to see the
  bare `app.post`.

This means:

```ts
// Does NOT match — predicate sees bare "app.post", not the enriched form
calls(p).that()
  .haveNameMatching(/app\.post\("\/auth/)
  .identifiedByArg(0)
  .should()...
```

To filter by argument value, use the predicates designed for it:

```ts
calls(p).that()
  .onObject('app')
  .withMethod(/^(get|post)$/)
  .withStringArg(0, '/auth/**')    // <-- filters by arg
  .identifiedByArg(0)               // <-- enriches identity for output/exclusion
  .should()...
```

This is intentional: filtering on the enriched name would silently
break `haveNameMatching(/^app\.post$/)` for users who haven't opted in,
and would create two paths to filter by argument value with subtly
different semantics.

## Edge Cases (explicit behavior)

| Input                                                       | Element name         | Why                                               |
| ----------------------------------------------------------- | -------------------- | ------------------------------------------------- |
| `app.post("/foo", h)` + `identifiedByArg(0)`                | `app.post("/foo")`   | string literal — match                            |
| ``app.post(`/foo`, h)`` + `identifiedByArg(0)`              | ``app.post(`/foo`)`` | no-substitution template — match                  |
| ``app.post(`/foo/${x}`, h)`` + `identifiedByArg(0)`         | `app.post`           | `TemplateExpression` (has substitution) — degrade |
| `app.post(sql\`...\`, h)`+`identifiedByArg(0)`              | `app.post`           | tagged template — degrade                         |
| `app.post(routes.AUTH, h)` + `identifiedByArg(0)`           | `app.post`           | identifier — degrade (no static evaluation)       |
| `app.post(...args)` + `identifiedByArg(0)`                  | `app.post`           | spread — degrade                                  |
| `app.post("/foo" as const, h)` + `identifiedByArg(0)`       | `app.post`           | `AsExpression` wrapping literal — degrade         |
| `app.post(("/foo"), h)` + `identifiedByArg(0)`              | `app.post`           | `ParenthesizedExpression` — degrade               |
| `app.post("/foo")` + `identifiedByArg(2)`                   | `app.post`           | out of bounds — degrade                           |
| `flags.define("new-checkout", true)` + `identifiedByArg(1)` | `flags.define`       | `true` is not a string literal — degrade          |

**Quote style:** the appended identity preserves the source quote style
exactly (`"foo"` vs `'foo'` vs `` `foo` ``). Cross-file exclusion
patterns that need to be portable should use regex with a character
class covering all three delimiters (e.g. `/["'\x60]\/foo["'\x60]/`
where `\x60` is the backtick), not exact strings.

**Long literals:** the element string preserves the argument source
text verbatim — exclusion patterns need stable identities, and
truncating would break them. The rendered violation `message` elides
the middle of long literals so CI output stays scannable. **Exact
algorithm:** if `arg.getText().length > 80`, the message uses
`${arg.getText().slice(0, 38)}…${arg.getText().slice(-38)}` (total 77
chars including the ellipsis). The threshold and slices are measured
on `arg.getText()` (the literal alone, including its surrounding
quotes/backticks), not on the full element string. The element field
is never truncated.

**Restriction to string literals:** intentional. Numeric and boolean
keys (`version.set(2, …)`) are out of scope — they rarely serve as
exclusion targets in practice, and including them would change the
matcher semantics from "string-keyed registrations" to "any literal
argument." If a real use case surfaces, expand later behind the same
opt-in.

## Migration / Backward Compatibility

**Fully backward compatible.** Default behavior is unchanged; element
names only gain the argument suffix when `.identifiedByArg()` is
explicitly called.

**One-time migration cost when opting in:**

- Existing `.excluding()` patterns on the rule may stop matching (and
  trigger the unused-exclusion warning at `execute-rule.ts:61`). Update
  patterns to target the enriched element name.
- Both the `element` field AND the violation `message` string shift on
  opt-in (the option is threaded through all eight `archCall.getName()`
  sites in `conditions/call.ts` — see step 3 of "How It Works"). So
  baselines keyed on `element + file + line + message` change in two
  parts, not one.
- Existing baseline files (`createBaseline` output) will need
  regenerating for the rule that opts in. Same cost as renaming any
  rule's element format.
- Downstream consumers grouping violations by `element` (CI dashboards,
  PR diff tools, custom reporters) get a one-time recategorization for
  the opting-in rule.

Inline `// ts-archunit-exclude` comments are unaffected — they match on
file+line+ruleId, not element.

**Custom conditions:** built-in conditions in `src/conditions/call.ts`
thread the option automatically. Custom user-defined conditions that
read `archCall.getName()` directly must read `context.identifyByArgument`
and pass it through to participate in identity enrichment.

**Per-rule independence:** opt-in is stored on the `CallRuleBuilder`
instance. Two `calls()` rules over the same files maintain
independent identity and exclusion semantics — one rule opting in
does not affect the other.

## Alternatives Considered

- **Inline `// ts-archunit-exclude` comments (shipped).** Correct and
  precise, but for entirely-public files it's one comment per
  registration (dozens), and the exclusion list is scattered across
  source rather than visible at the rule. Best when exemptions are rare
  and local; awkward when a whole file is exempt by design. The two
  mechanisms are complementary, not competing.

- **Whole-file `.excluding(/auth\.ts/)` (status quo).** The bug
  itself — a new authenticated route added to the file ships unchecked.
  Status quo is unsafe for security-shaped rules.

- **Always enrich call element names with the first string arg.**
  Rejected: changes element names / violation messages for _all_
  `calls()` rules, which would silently break existing `.excluding()`
  patterns and baselines. Opt-in avoids that.

- **A separate `callArgument()` predicate / matcher.** More surface
  area for the same outcome; `.identifiedByArg()` reuses the existing
  element-name + `.excluding()` machinery — Lego bricks, not parallel
  universes.

- **Function-form identity: `.identifiedBy((archCall) => string | undefined)`.**
  Fully general (could extract identity from arg shape, type info,
  parent context, anything). Rejected for now: the index form covers
  the 80% case in one line, and the function form would expose the
  internal `ArchCall` shape to user code. Revisit if non-literal
  identity cases compound.

- **Filtering by argument (`.withArgMatching` / `.withStringArg`)
  already ships** at `src/predicates/call.ts:71,102`. This proposal
  addresses the _identity / exclusion_ gap, not the filtering gap.

## Resolved Decisions

- **Raw literal in the suffix.** Reasons:
  1. `.excluding()` exact-match must include quotes when a user pastes
     the appended identity from failure output; raw form is what
     appears there.
  2. Raw is unambiguous when an argument is itself a quoted
     string-looking value (`define("\"weird\"", …)`).
  3. Raw matches the user's mental model — "what the source says."
  4. Regex authors can match either form trivially (`/"?\/foo"?/`).
- **Long literals.** Element string verbatim (exclusion stability
  requires it); rendered violation message elides middle if literal
  > 80 chars with `…`. See Edge Cases.
- **Element + message both enrich.** All eight `archCall.getName()`
  call sites in `conditions/call.ts` thread the option through, so
  the element field and the rendered message agree on identity.
- **Predicates stay on the bare callee.** Filtering by argument value
  uses `withStringArg` / `withArgMatching`; `.identifiedByArg()` is an
  identity/exclusion concern only. See "Identity scope."

## Files Touched (planning sketch)

- `src/models/arch-call.ts` — optional `withArgument` param on `getName()`
- `src/core/condition.ts` — optional `identifyByArgument` on `ConditionContext`
- `src/builders/call-rule-builder.ts` — new `.identifiedByArg(index)` method
  and threading of `_identifyByArgument` into the `ConditionContext` built
  for each condition execution.
- `src/conditions/call.ts` — read `context.identifyByArgument` at every
  `archCall.getName()` call site (eight total: element at line 18, messages
  at 36, 61, 92, 169, 215, 256, 291).
- **No change to `src/core/rule-builder.ts`** — `Object.assign(fork, this)`
  at line 276 already propagates the primitive field.
- Tests: opt-out default, string-literal hit, no-substitution template hit,
  template-with-substitution degrade, identifier degrade, OOB index, spread,
  `as const` degrade, parenthesized-expression degrade, `fork()` propagation
  through `.and()`/`.or()`, element+message cohesion, long-literal message
  elision, baseline invalidation note.
