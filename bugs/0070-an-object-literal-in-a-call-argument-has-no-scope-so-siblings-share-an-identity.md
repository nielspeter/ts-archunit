# Bug 0070: an object literal passed as a call argument has no scope, so two siblings share one identity

**Reported:** 2026-08-07 · **Fixed:** not yet
**Found in:** the code review of [bug 0068](./fixed/0068-a-function-metric-identifies-an-object-literal-function-by-its-enclosing-function.md)'s
fix, as a case that fix does **not** reach. Not a regression from it — measured broken in 0.57.0 as
well.
**Severity:** **Low as filed, and the number is doing real work here.** The fail-open is the same class
as 0068 (a ratchet ceiling keyed to a positional slot rather than to a function), which is High — but it
requires **two object literals in one file, both passed as call arguments, both with the same key
name, both breaching the same metric**. No occurrence has been measured in any real corpus. Filed
because it was found in a docblock rather than in a report, and a known limit that lives only in a code
comment is a hand-maintained claim nobody derives.

## What happens

Measured on the 0.58.0 branch and, identically, on 0.57.0:

```ts
register({
  handler: (n: number): string => {
    /* 5 lines */
  },
})
register({
  handler: (n: number): string => {
    /* 5 lines */
  },
})
```

| version | identity of both findings                  |
| ------- | ------------------------------------------ |
| 0.57.0  | `…/h.ts::ArrowFunction::lines` — identical |
| 0.58.0  | `…/h.ts::handler::lines` — identical       |

Byte-identical in both, so `disambiguateIdentities` suffixes the second with `#1` and
`BaselineEntry.measured` becomes a ceiling keyed to a **slot**. Delete one registration and the survivor
inherits the other's ceiling — bug 0068's severity argument, on a shape 0068 did not cover.

The name got better between the two versions (`handler` rather than `ArrowFunction`); the collision did
not move.

## Why 0068's fix does not reach it

0068's fix qualifies a metric identity by the name of the **enclosing declaration**
(`enclosingScopeName`, `src/core/violation.ts`). Every shape it closes has one:

| shape                              | enclosing scope |
| ---------------------------------- | --------------- |
| arrow nested in a named function   | `makeAlpha`     |
| object literal returned by factory | `makeBeta`      |
| method shorthand in a factory      | `makeDelta`     |
| class method                       | the class       |
| **call argument at module level**  | **none**        |

`owningBindingName` (`src/models/arch-function.ts`) already declines to name this shape, deliberately:
_"a literal passed as a call argument or returned from a factory genuinely has no binding, and inventing
one from a distant ancestor would be a guess."_ The factory half of that sentence is now handled by
scope-qualifying the identity — an identity is a key, not a claim about what a thing is called. The
call-argument half is not, because at module level there is no ancestor to walk to.

## What a fix has to decide, and why it may be "document, not fix"

There is nothing stable to distinguish the two. The candidates:

- **The callee name** (`register`) — identical for both, so it separates nothing in the case that
  matters. It would help only where two _different_ functions are called, which is the case that already
  works via the key name.
- **Argument index / source position** — distinguishes them perfectly and is exactly what breaks
  ratcheting. Position moves when anything above it is edited, which is the defect
  `ArchViolation.identity` exists to prevent. Not available.
- **The key path plus an occurrence ordinal** — the `#N` we already fall back to, which is the fail-open
  being reported.

So this may be the same answer as [0067](./fixed/0067-a-duplicate-pair-identity-collides-on-two-same-named-functions-in-one-file.md):
_there is no right name yet_, and the honest outcome is a documented limit plus a **warning when it
happens**, rather than a silent `#N`. That would be a real improvement over today: the adopter learns
their ratchet is positional for those two entries, instead of discovering it when a ceiling rotates.

Note the asymmetry worth deciding deliberately: `disambiguateIdentities` currently makes collisions
**invisible** by resolving them. Its job was to stop two findings sharing one entry, and it does — but a
resolved collision and a genuinely distinct pair are indistinguishable downstream. A finding that says
"this identity was disambiguated positionally" is the information the baseline consumer is missing.

## Not measured

- **Whether any real corpus contains the shape.** The reproduction is synthetic. Before spending
  anything on a fix, grep a real codebase for two same-key literals in call arguments in one file —
  cmless and this repo are both available, and 0066/0068 were both found by running against a corpus
  rather than by reading source.
- Whether the same shape reaches the **smell** detectors and the duplicate-pair identity, or only
  `rules/metrics`. 0067 was the duplicate-pair half of this class and is fixed; the interaction was not
  probed.
- Whether `includeObjectLiteralFunctions` being **opt-in and off by default** bounds this to near-zero
  in practice. It does bound it — no preset enables it for metrics — but "near-zero" was not measured.
