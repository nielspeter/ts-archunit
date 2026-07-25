# Bug 0013: three of four function collectors are blind to object-literal functions

**Reported:** 2026-07-25
**Found in:** all versions through v0.18.1
**Severity:** High — the GraphQL entry point selects the helper functions sitting beside the resolvers and none of the resolvers themselves, and both smell detectors are blind to the same shape. Every rule written with `resolvers()` passes on the wrong subjects, and the discovery surface under-reports.

## Description

`ResolverRuleBuilder.getElements()` called `collectFunctions(sf)` with no
options (`src/graphql/resolver-rule-builder.ts:166`), so
`includeObjectLiteralFunctions` took its default of `false`.

A GraphQL resolver map **is** an object literal:

```typescript
export const resolvers = {
  Query: { assetCollection: async (_p, args, ctx) => { … } },
  Asset: { url: (parent) => parent.url },
}
```

Every resolver is therefore a property value, and none of them is a named
declaration, a variable-assigned arrow, or a class method — the three shapes
`collectFunctions` collects by default. `functions()` keeps object-literal
collection opt-in for a good reason: switching it on there would sweep every
inline callback into every rule. The GraphQL entry point has the opposite need
and must always opt in.

## Reproduction

Measured against a real GraphQL server (38 files in the resolver layer):

```
resolvers('src/graphql/resolvers/**')  ->  60 subjects
  resolver-map entries among them      ->   0 of 20

the 60 it did select: mapGraphQLFit, mapGraphQLFocus, stripRgbPrefix,
                      mapEntryToResult, mapDbEntryToGqlResult, …
```

Sixty subjects, none of them a resolver — they are the mapping helpers that
happen to live in the same files. A rule like the one in `docs/graphql.md`:

```typescript
r.that()
  .resolveFieldReturning(/^[A-Z]/)
  .should()
  .contain(call('loader.load'))
  .check()
```

evaluates those helpers, finds nothing to say about them, and reports green over
an unchecked resolver layer.

After the fix: **119 subjects, 20 of 20 resolver-map entries visible.**

## Why no test caught it

Every fixture in `tests/fixtures/graphql/src/` used named declarations and
exported consts — `export const resolvePostAuthor = async () => {}`. Not one
contained a resolver map. Apply ADR-008's question — _what would these tests do
if `resolvers()` could not see a single resolver in a map?_ — and the answer is
**pass**, all of them.

The fixture, not the assertions, was the hole.

## The same defect in two more places

Fixing `resolvers()` alone would have been an instance fix. Enumerating every
caller of `collectFunctions()` mechanically:

| Caller                                     | Options passed                     | Verdict   |
| ------------------------------------------ | ---------------------------------- | --------- |
| `src/builders/function-rule-builder.ts:96` | `this._collectionOptions` (user's) | correct   |
| `src/graphql/resolver-rule-builder.ts`     | none                               | **blind** |
| `src/smells/duplicate-bodies.ts:80`        | none                               | **blind** |
| `src/smells/inconsistent-siblings.ts:32`   | none                               | **blind** |

Three of four. `duplicateBodies` returns **0** findings on two byte-identical
object-literal handlers — the handler-map idiom that `docs/functions.md` itself
advertises support for (Bun.serve, Hono/Elysia route maps, reducer maps) and
that every GraphQL resolver uses.

Measured on a real codebase, same inputs either side:

```
                 before   after
Cell (808 files)   1019    1049    (+30)
IG   (571 files)    719     730    (+11)
```

41 duplicate pairs that were structurally invisible. The delta is modest there
because that codebase is class-heavy; for a project written in the handler-map
style the blindness was total.

## Fix

Pass `{ includeObjectLiteralFunctions: true }` at all three sites.

The principle, worth stating because it is the reason `functions()` differs: a
**selector** has a documented subject set, so widening it silently changes every
existing rule — hence opt-in. A **detector** scans for a property of the code
and has no such contract, so it should always look everywhere. `resolvers()` is
a selector, but one whose entire domain is object literals.

Guarded by `tests/fixtures/graphql/src/schema-map.resolver.ts` — an idiomatic map
with arrow properties and a method shorthand, two of which violate — plus two
tests asserting the resolvers are selected by qualified key path
(`Query.user`, `Post.comments`) and that a rule fires per resolver rather than
per file. Reverting the one-line fix turns both red.

## Migration

This **widens** the subject set for anyone already using `resolvers()`, so rules
that were green may now fail. That is the point: they were green because they
were evaluating the wrong functions. Worth a CHANGELOG note under a heading that
says so rather than burying it as a fix.

## Notes

Found while checking an external coverage audit's Track B against what actually
ships. That audit reported "no GraphQL resolver is a selectable subject" and
asked for new selection shapes (computed-key assignment, factory-returned
arrows). Measured against the current build, that request is **not** justified
and the diagnosis was one layer off:

| audit claim (written against 0.17.0)                            | measured on 0.18.1                                                                     |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| no resolver is a selectable subject                             | `functions({ includeObjectLiteralFunctions: true })` reaches 62 of them                |
| 5 collection resolvers skipping a complexity guard, uncatchable | rule writable today; **4 flagged**, including the named unbounded-descendants resolver |
| 15 plain-`Error` sites, uncatchable                             | 16 sites, **all in ordinary declarations/methods** — reachable with no options at all  |
| needs computed-key / factory-return selection                   | 23 such functions exist, with **no measured defect behind any of them**                |

0066 had already closed the reachability gap for `functions()`. What nobody
noticed is that the GraphQL builder never picked it up. The audit's own evidence
is catchable today — through `functions()`, and now through `resolvers()` as
well.
