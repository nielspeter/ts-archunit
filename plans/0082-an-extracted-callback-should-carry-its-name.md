# Plan 0082 — an extracted callback should carry its name

**Status:** Open, not started. Filed 2026-08-03 out of [plan 0079](./completed/0079-triage-the-cardinality-only-assertions.md)'s
Phase 2, which needed this identity and had to derive it outside the library to get it.
**Priority:** Low. No false green — a rule that cannot be written produces no misleading pass. It
is a capability gap on a shipped entry point, found by needing it.
**Effort:** Small. One optional field, populated at the two sites that already know the name.
**Blast radius:** **Published API.** `ExtractedCallback` is reachable from the `calls()` entry point
and `haveCallbackContaining` is documented. Additive, so per
[ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 6 the depth is "prove the field is
populated wherever a name exists, and absent where none does" — the absent case matters, because a
rule keying on the name must be able to tell "anonymous" from "not extracted".

## Problem

`ExtractedCallback` (`src/helpers/callback-extractor.ts:9`) carries:

```ts
export interface ExtractedCallback {
  fn: ArchFunction
  callSite: CallExpression
  argIndex: number
}
```

For two callbacks on one object literal — the Fastify/Express shape the extractor exists for —
**none of the three distinguishes them.** `argIndex` is the index of the _object_, so it is the same
for both; `fn.getName()` is `undefined`, because an arrow assigned to a property has no name of its
own. Measured on

```ts
app.post('/multi', {
  preHandler: (req) => authenticate(req),
  handler: (req) => validateInput(req),
})
```

both extracted callbacks report `argIndex: 1` and `getName(): undefined`.

So a rule an adopter would plausibly want —

```ts
calls(p).that().withMethod('post').should().notHaveCallbackContaining(call('db.query'))
```

— cannot be narrowed to the `handler` callback while leaving `preHandler` alone. The information
exists in the AST one node up and nothing exposes it.

**Found by needing it.** Plan 0079 converted four count assertions in
`callback-extractor.test.ts` to identity assertions and could not express the identity through the
public shape; the test file now walks `fn.getNode().getParent()` to the enclosing
`PropertyAssignment` itself. A test reaching around an API to get what the API should provide is
the signal.

## Phase 1 — the field

```ts
export interface ExtractedCallback {
  fn: ArchFunction
  callSite: CallExpression
  argIndex: number
  /**
   * The property or method name this callback was written as, when it has one.
   *
   * `undefined` for a positional callback — `app.get('/x', (req) => …)` — which
   * is not a defect but the honest answer: `argIndex` identifies those. Both
   * cases are asserted, because a rule keying on the name must be able to tell
   * "anonymous" from "the extractor did not look".
   */
  name?: string
}
```

Populated in the object-literal walk (`callback-extractor.ts:81` onwards), which already has the
`PropertyAssignment`/`MethodDeclaration` in hand — the name is read from the node the walk is
standing on, not re-derived.

## Phase 2 — make it reachable from a rule

A predicate or condition option so the name is usable, not merely present. Shape to decide during
implementation, but it must compose with the existing combinators per ADR-003 — a
`withCallbackNamed(...)` predicate on the calls builder is the obvious candidate, and it must work
under `not()`/`or()` without a parallel mechanism (the lesson from the `.excluding()`/`not()`
duplication in the proposal-review skill).

**Do not** add a second extraction path. One walk, one shape.

## Test inventory

1. Two callbacks on one object literal are distinguishable by `name` — `['handler', 'preHandler']`.
   This is the case that motivated the plan.
2. A positional callback has `name: undefined` **and** a distinguishing `argIndex`. The absent case
   asserted, not assumed.
3. A method shorthand (`{ handler(req) {} }`) carries the name too — the extractor already handles
   the shape, so the field must not be arrow-only.
4. Nested (`hooks.onRequest`) carries the innermost property name, and the choice is stated: the
   test records that it is `onRequest`, not `hooks.onRequest`, so a later change to dotted paths is
   a visible decision rather than a silent one.
5. Vacuity: the fixture really produces two callbacks, or rows 1 and 4 assert over nothing.
6. `callback-extractor.test.ts`'s local `identify()` helper is **deleted** and the tests read
   `name` instead. If it survives, the API did not close the gap it was written around.

## Out of scope

- **Resolving named references** (`app.get('/x', myHandler)`). Still deferred, still needs
  type-checker lookups, and documented as such at `callback-extractor.ts:25`.
- **Renaming `argIndex`.** It stays and stays meaningful; it is the identity for positional
  callbacks.

## Related

- [Plan 0079](./completed/0079-triage-the-cardinality-only-assertions.md) — found it, and holds the
  measurement.
- `src/helpers/callback-extractor.ts` — the shape to extend.
- `tests/helpers/callback-extractor.test.ts` — the `identify()` helper this plan should delete.
