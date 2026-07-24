# Proposal 016 — Selectable Object-Literal Functions

**Status:** Draft 2 — revised after architect + product review (2026-07-24)
**Priority:** Low–Medium — closes [proposal 015](./015-bun-support-tier-three.md)'s "layer 1", resolves a documented-contract/behaviour mismatch, and unblocks the framework-plural handler-map idiom. No urgency; scoping now so 015 knows what it carries. **One part is P0 and ships now: the docs correction (below), decoupled from the flag.**
**Affects:** `functions()` collection (`src/models/arch-function.ts` `collectFunctions`); the shared traversal primitive **F3**; one opt-in collection flag threaded through the first public `functions()` option object. Default behaviour unchanged.
**Origin:** Proposal 015's decomposition, then **probed 2026-07-23** against the bun-petclinic fixture. This proposal is 015's layer 1, scoped as its own question because it is **not** Bun-specific.
**Depends on:** **F3 — shared call-agnostic object-literal traversal** (`plans/ai-era-product-direction.md`). F3 is a *precondition*, not an optimization; the flag's sizing assumes F3 lands first.

> **`functions()` deliberately collects three *named* patterns; object-literal functions are not selectable subjects.** The probe below shows the gap is **selection, not content** — and that the traversal to reach these functions already exists in the *other* collection path. The question is whether to surface it, and how, without blast radius.

## Changes in draft 2

Revised after architect + product review. What moved:

1. **Docs fix elevated to P0 and decoupled.** Both `docs/functions.md:7` ("wraps all of these") and `:19` ("every function shape") overclaim, and this is a **live false-green for current users, independent of the flag** — corrected to "every *named* function shape" and **shipped as part of this task** (the two edits are already applied). See §The current contract.
2. **Widened scope + renamed** `includeObjectLiteralArrows` → **`includeObjectLiteralFunctions`**: covers arrows, function expressions, **and** method shorthand `{ GET(){} }` — the handler-map idiom uses all three interchangeably, and the reused machinery already handles all three. An arrows-only flag would silently collect a slice. Shorthand-*property* `{ GET }` (no initializer) is **not** a function and is dropped from the name-derivation list.
3. **Reuse claim corrected → F3 made a precondition.** `extractFromObjectLiteral` is *private*, *call-bound*, and returns a call-tied `ExtractedCallback` — only its **traversal shape** is reusable. Extract a call-agnostic `forEachObjectLiteralFunctionProperty` consumed by *both* paths first. See §The traversal exists.
4. **"Symmetric with `includeMethods`" retracted at the public layer.** `includeMethods` is internal to `collectFunctions`; the public `functions(p)` takes only `p`. `functions(p, opts)` introduces the **first-ever public option object** — a deliberate API decision, framed as such. See §Recommendation.
5. **Qualified default names.** The rendered violation `element`/`message` defaults to the **qualified** path (`routes["/x"].GET`); the short key is available to naming *predicates* only. Frame/file:line targets the `PropertyAssignment`. Computed keys get a defined `<computed>` fallback.
6. **Acceptance test compares name+file:line *tuples*, both directions** — not a name `Set` (which de-dupes collisions and masks under/over-collection, the exact ADR-008 Rule-5 independence failure the test guards).
7. **Boundaries documented** (new §): dual-wrapper identity; smells + GraphQL builder use `collectFunctions` defaults and won't see handler functions even with the flag on; `MAX_OBJECT_DEPTH=3` inherited from the shared traversal.
8. **Fixed an inaccuracy:** the "Why NOT widen the default" section cited `mustMatchName`/`mustNotEndWith`, which are `Condition<ClassDeclaration>` (classes only). The function naming surface is `haveNameMatching`/`haveNameStartingWith`/`haveNameEndingWith` (+ `mustCall`, which *is* `ArchFunction`). Corrected.

Preserved from draft 1: the probe-driven "the gap is selection, not content" reframing, the ADR-008 acceptance test, and the rejections of widen-default and a separate entry point.

## The current contract — and where it disagrees with itself (docs fix is P0)

`collectFunctions` (`arch-function.ts:163`) collects exactly three shapes, and the docs commit to them:

1. `function foo() {}` — declarations
2. `const foo = () => {}` — arrow **variables**
3. `class Foo { bar() {} }` — methods (gated on the existing `includeMethods` option, default `true`)

`docs/functions.md` sold this as *"operates on functions, arrow functions… wraps all of these"* (`:7`) and *"every function shape in your codebase"* (`:19`). **Both overclaim.** Object-literal function values (`{ GET: () => {} }`), callback arguments (`arr.map(x => …)`), and function expressions (`const f = function(){}`) are all function shapes and none are collected. The contract said "every function shape"; the code delivers "every *named* function shape."

**This is a live false-green for current users, independent of the flag.** Point `functions().resideInFile('**/routes.ts').should().beAsync()` at a file whose only functions are a `{ GET: () => {} }` handler map, and it **passes green on zero subjects** — the user believes their handlers are guarded; nothing is checked. That is precisely the trust bug ADR-008 exists to prevent, and it is true *today*, whether or not the flag ever ships.

**So the docs correction is P0 and decoupled.** The two edits — `:7` and `:19` → "every *named* function shape" — are **applied as part of this task**, do not wait on the flag decision, and remain correct in every outcome below (including "decline the flag"). (The deeper fix for the zero-subject false-green — an empty-selector guard — is [proposal 014](./014-empty-selector-safety.md)'s job, not this one; the docs correction is the honest floor.)

Note the precedent that shapes the flag: **collection scope is already parameterised — internally.** `includeMethods` is an opt-in flag on `collectFunctions` (default on) that gates pattern 3. A fourth pattern gated on a symmetric flag is the same *internal* mechanism. But it is **not** symmetric at the public layer — see §Recommendation.

## The gap is selection, not content — settled by probe

Three probes on the bun-petclinic fixture, whose `Bun.serve({ routes })` handlers are arrows nested as object-literal property values:

- **P1** — `functions().resideInFile('**/main.ts').should().notExist()` **passed**: functions() collects **zero** functions in `main.ts` (the handlers sit in the `Bun.serve({ routes })` literal).
- **P2** — same over `owners/routes.ts` collected **three** — `ownerRoutes`, `must`, `fullName` — and **none of the `GET`/`POST` handler arrows** (property values of the returned object).
- **PROBE2** — `modules().resideInFile('**/main.ts').should().notContain(newExpr('Error'))` **red at the `/oups` arrow body**. Module-level **content** scanning (`body-traversal.ts:searchModuleBody`) already descends into nested arrow/function-expression bodies.

So:

| Rule shape | Expressible today? | Via |
| --- | --- | --- |
| **Negative content** — "no `new Error` / no direct DB import in a handler" | **Yes** (module-scoped) | `modules().notContain(...)` reaches nested arrow bodies |
| **Positive per-handler** — "every handler validates input", "every handler is async", "no handler exceeds N params", "handler return type is `Response`" | **No** | needs the handler as a selectable `ArchFunction` — which `functions()` does not provide |

The unmet need is precise and narrow: **per-subject assertions on object-literal functions.** Everything content-shaped is already covered by `modules()`. This narrows the proposal and lowers its priority — but the positive-assertion class is the higher-value one (it is where `mustCall`, `beAsync`, param/return rules live).

## The traversal exists — but only its *shape* is reusable (this is F3)

Draft 1 claimed "the capability already exists in the other path." That was overstated. `callback-extractor.ts` **does** walk object literals — `extractFromObjectLiteral` (`callback-extractor.ts:65`, reached from the call at `:41`) descends into a call argument's object literal and wraps its arrow/function-expression/method-shorthand values. But that function is **not reusable as-is**:

- It is **private** (not exported).
- It is **call-bound**: its signature is `(arg, callSite: CallExpression, argIndex, depth)` and every result is an `ExtractedCallback` carrying a `callSite` and `argIndex`.
- Its arrow wrapper returns **`getName: () => undefined`** — names come from call-site context, not the property key.

An object literal collected by `functions()` is frequently **not a call argument at all** — `export const handlers = { GET: () => {} }` has no `CallExpression` to hand it. You cannot invoke `extractFromObjectLiteral` without fabricating a fake call site. **Only the *traversal shape* — "for each property of this object literal, if its value is a function, yield (key, functionNode), depth-limited" — is shared.**

So the precondition is **F3** in `plans/ai-era-product-direction.md`: extract a **call-agnostic shared primitive**

```ts
forEachObjectLiteralFunctionProperty(obj: ObjectLiteralExpression, visit: (key, fnNode, propAssignment) => void)
```

consumed by **both** `functions()` collection (this proposal) **and** the existing `callback-extractor` (which keeps wrapping the yielded nodes as call-tied `ExtractedCallback`s). One traversal, one depth policy, two consumers. This is a genuine deduplication, not a claim of free reuse — and it must land **before** the flag, which is why the sizing below is gated on it.

`MAX_OBJECT_DEPTH = 3` (`callback-extractor.ts:52`) moves into F3 as the single shared depth policy, so both paths agree by construction.

## Why this is a core question, not a Bun one (proposal-010's own test)

Object-of-handlers is **framework-plural**: `Bun.serve({ routes })`, Hono/Elysia route maps, Express handler objects, Redux reducer maps, XState `on: { EVENT: () => … }`, DOM event-handler maps. Proposal 010 admitted JSX to **core** on exactly this ground — *"JSX is a language feature, not React-specific… Preact, Solid, and custom runtimes all use the same syntax."* An object literal of functions is a plain-TypeScript idiom, not a runtime's. By 010's test it is a **core collection** question. (The Bun-specific part — isolating *route* handlers from all object-literal functions — stays tier-3 in 015; see §Relationship.)

## Why NOT widen the default

Making object-literal functions part of the default `functions()` set is the wrong move, for the reason ADR-008 warns about — a check that suddenly fires on correct code trains suppression:

- **Naming rules break.** The function naming surface — `haveNameMatching` / `haveNameStartingWith` / `haveNameEndingWith` (the `functions()` builder methods) plus `mustCall` (`src/rules/architecture.ts:12`, a `Condition<ArchFunction>`) — would suddenly evaluate against derived keys that never existed as function names before. (`mustMatchName` / `mustNotEndWith` in `src/rules/naming.ts` are `Condition<ClassDeclaration>` — classes only — so they are *not* on this surface; draft 1 cited them in error.)
- **The set floods.** Every inline `arr.map(x => …)`, `setTimeout(() => …)`, promise `.then(…)` would qualify if we widened past object-literal *property* values — and even scoped to properties, config objects and schema literals carry many non-handler functions. Existing rules (`beAsync`, parameter-count, `resideInFolder` handler rules) get noisy against functions users never considered "named units."
- **It breaks the documented three-pattern contract** that users wrote rules against.

The three-pattern default is a deliberate **"named unit"** scope and is correct as the default.

## Recommendation — opt-in via the *first public* `functions()` option, covering all object-literal function shapes

```ts
functions(p, { includeObjectLiteralFunctions: true })   // default: false
```

- **This introduces the first-ever public option object on `functions()`.** Today `functions(p)` takes only `p` (`function-rule-builder.ts:343`); `includeMethods` lives on the *internal* `collectFunctions` (`arch-function.ts:165`) and is never threaded out. So this is **not** "the same mechanism, no new API" — it is a deliberate public-API decision. Thread a single options type:

  ```ts
  interface FunctionCollectionOptions {
    includeObjectLiteralFunctions?: boolean  // default false
    includeMethods?: boolean                 // default true — see below
  }
  ```

  and **consciously decide** whether to also surface `includeMethods` here for symmetry (recommended: yes — it costs one field and closes the "why can I turn on object-literal functions but not turn off methods?" asymmetry). Whatever is chosen, `getElements()` (`function-rule-builder.ts:85`) threads the options straight into `collectFunctions`.

- **Default off.** Backward-compatible; ADR-006's configurable-factory pattern (sensible defaults, override via options).

- **Scope narrowly to object-literal function-valued *properties*** — `{ GET: () => {} }`, `{ GET: function(){} }`, `{ GET(){} }` — reusing F3's traversal. **Not** arbitrary callback arguments (`.map(cb)`), which are the `within()`/call path's job. The line is "a function that is the value of a `PropertyAssignment`, or a method-shorthand member, in an object literal." Object-literal **shorthand-property** `{ GET }` is *not* a function (no initializer) and is out of scope.

- **Cover all three function shapes, not arrows only.** The handler-map idiom uses arrows, function expressions, and method shorthand interchangeably (`{ GET(){} }` is common in Hono/Elysia examples), and F3 already yields all three. An arrows-only flag would silently collect a slice of a file's handlers — a fresh false-green. Hence the rename `includeObjectLiteralArrows` → **`includeObjectLiteralFunctions`**.

### Name derivation — qualified by default

A collected object-literal function needs a name for violation frames and naming rules. Two names, deliberately distinct:

- **Rendered `element` / `message` — qualified path, the default.** `routes["/x"].GET`, or at minimum `parentKey.GET`. A bare `GET` repeats N times across a route map and is useless in a violation list — the agent (and the human) cannot tell *which* `GET`. This mirrors the method wrapper, which already renders `ClassName.method` (`arch-function.ts:118`).
- **Naming *predicates* may match the short key.** `haveNameMatching(/^GET$/)` should test against `GET`, not `routes["/x"].GET`. This means the wrapper needs a **short match-name distinct from the qualified display name** — a small addition over today's method wrapper (which qualifies both, and consequently makes `haveNameMatching(/^method$/)` awkward). Decide this consciously; the recommendation is short-for-predicates, qualified-for-display.
- **Frame file:line targets the `PropertyAssignment`**, not the arrow body — a stable, keyed location (`getNode()`/`getStartLineNumber()` on the wrapper resolve to the property).
- **Computed keys** `{ [verb]: () => {} }` have no static key. Emit a **defined synthetic fallback `<computed>`** (qualified as `parent.<computed>`), never an invented remedy — ADR-008: a nameless subject must not silently vanish from a naming rule, and must not be given a fabricated name.

## Boundaries (what the flag does NOT reach)

Documented so they are not later read as bugs:

- **Dual-wrapper identity.** With the flag on, the *same* arrow in `Bun.serve({ routes: { GET: () => {} } })` is reachable **twice**: via `functions()` (wrapped with the derived name `routes.GET`, frame at the `PropertyAssignment`) *and* via the call/`within()` path (wrapped as an anonymous `ExtractedCallback`, `getName() === undefined`, frame at the arrow). Two wrappers, two names, one node. This is another argument for F3: a single traversal makes the divergence explicit and intentional rather than accidental.
- **Smells and GraphQL do not inherit the flag.** `duplicate-bodies.ts:80`, `inconsistent-siblings.ts:32`, and the GraphQL resolver builder (`graphql/resolver-rule-builder.ts:167`) all call `collectFunctions(sf)` with **defaults** — so they will **not** see object-literal handler functions even when a `functions()` rule turns the flag on. That is the correct default (a route map is not a "duplicate body" or "inconsistent sibling" candidate by default), but it is a boundary, not a bug. Widening any of those is a separate, deliberate follow-up.
- **One depth policy.** Both paths inherit `MAX_OBJECT_DEPTH = 3` from F3 — nested handler groups deeper than three levels are not collected, by the same rule the callback path already applies.

## Relationship to 015

This is 015's layer 1. If 016 lands, `@ts-archunit/bun`'s `isRouteHandler()` shrinks to a **filter over already-selectable object-literal functions** — "an object-literal function that is a value under `routes` passed to `Bun.serve`" — composing the core primitive rather than re-implementing traversal inside a runtime package. If 016 is rejected, 015 must carry both layers, burying a framework-plural capability behind a runtime name — the ADR-006 anti-pattern. **Decide 016 first.**

## Acceptance test (ADR-008)

A "does not throw" test is a check that cannot fail. Assert by identity, both directions, guarded against vacuity:

- **Opt-in ON selects the handler AND a per-subject rule reds on it:** on a fixture with a known object-literal handler carrying a violation (e.g. a non-async handler under a `beAsync()` rule, or a handler missing a `mustCall(/parse/)`), the finding set contains that handler by **derived name + file:line** — not merely "a violation occurred."
- **Default (OFF) is unchanged — the independent derivation (ADR-008 Rule 5):** compare the collected set with the flag OFF vs ON as a **set of `(name, file, line)` tuples**, both directions. OFF must equal today's tuple set exactly; ON must differ from OFF by **exactly** the object-literal-function tuples. **Do not compare a name `Set`** — a `Set` of names silently de-dupes a legitimate collision (a top-level `function GET(){}` *and* a `{ GET: () => {} }` in the same file collapse to one `"GET"`), which masks both under-collection (ON dropped a real subject) and over-collection (ON added a duplicate). De-duping is the exact ADR-008 Rule-5 independence failure this test exists to catch, so the two derivations must stay tuple-distinct.
- **Vacuity guard:** assert the fixture actually contains object-literal functions of all three shapes first, so "OFF collects fewer" is not trivially true on a function-free file. `0 === 0` must be unreachable.

## Honest sizing — gated on F3 first

- **F3 first (precondition):** extract `forEachObjectLiteralFunctionProperty` as a shared, call-agnostic traversal; re-point `callback-extractor` at it (behaviour-preserving) and fold `MAX_OBJECT_DEPTH` in. This is the real shared brick; do it before the flag or ship duplication. Small-to-medium, mostly a careful refactor with the existing callback tests as the guard.
- **Then the flag:** thread `FunctionCollectionOptions` through `functions(p, opts)` → `getElements()` → `collectFunctions`, and add a fourth collection pass over top-level object literals via F3. Small, once F3 exists.
- **The real work is name derivation:** property key → qualified display name + short match-name, with computed-key `<computed>` fallback and `PropertyAssignment`-anchored frames, plus confirming **zero default blast radius** (the tuple-set-unchanged test above).
- **Docs:** the `functions.md:7,19` correction is **already shipped** with this task (P0, decoupled). If the flag lands, document it and the boundaries; if it is declined, the corrected sentence still stands.

## Alternatives considered

- **Just fix the docs; collect nothing new.** Legitimate and cheapest — and the docs correction ships **regardless** (it is P0, already applied). Rejected as the *whole* answer because it leaves the positive-per-handler class (mustCall/beAsync/param-count on handlers) permanently unexpressible and forces 015 to carry layer 1. But the docs correction is required in every outcome and is the fallback if the flag is declined.
- **Widen the default.** Rejected — blast radius + contract break (above).
- **A separate entry point `handlers()` / `objectFns()`** (proposal 010's JSX precedent). Weighed and not preferred: JSX earned its own entry point because a `JsxElement` is a *different AST node* from a function, needing a distinct `ArchJsxElement` model. An object-literal function **is** a function — same `ArchFunction` model, same conditions (`beAsync`, param count, `mustCall`). A parallel entry point would duplicate the entire function condition surface. An opt-in flag reuses it. (If review disagrees, the entry-point form is viable — it just costs a model and builder for no new condition.)
- **A predicate that widens collection on use** — `functions(p).that().areObjectLiteralFunctions()` implicitly including them only when that predicate appears. Rejected: collection that changes based on a downstream predicate is surprising and hard to reason about; the flag makes the scope decision explicit at the entry, where the collection options already conceptually live.
