# Bug 0057: an empty options object reverts `beFreeOfCycles`' documented default

**Reported:** 2026-08-04 · **Fixed:** 2026-08-04 (v0.50.0)
**Found in:** v0.47.0, where the default was introduced
([plan 0084](../../plans/completed/0084-cycle-detection-that-ignores-type-only-imports.md)).
**Severity:** Medium now, High later. Only `{}` reaches it today; the moment `ImportOptions` gains a
second field, any caller passing that field silently reverts a documented default.

## What

The default lives on the **whole object**:

```ts
export function beFreeOfCycles(
  options: ImportOptions = { ignoreTypeImports: true },
): Condition<Slice>
```

and the read is per-field:

```ts
const ignoreErased = options?.ignoreTypeImports === true
```

So any object argument at all defeats it. Measured, on a project whose only cross-slice edge is an
`import type`:

```
beFreeOfCycles()                             -> []          documented behaviour
beFreeOfCycles({})                           -> ['[a, b]']  pre-0.47 behaviour
beFreeOfCycles({ ignoreTypeImports: true })  -> []
beFreeOfCycles({ ignoreTypeImports: false }) -> ['[a, b]']
```

`{}` typechecks, because the field is optional. It reports a cycle that cannot exist at runtime — the
exact false positive plan 0084 was written to remove.

## Why it will get worse

`ImportOptions` is **shared** with `dependOn`, `importFrom`, `notImportFrom`, `onlyImportFrom`,
`notDependOn` and `respectLayerOrder`. Add one field to it — which is the point of a shared options bag —
and `beFreeOfCycles({ someNewOption: true })` silently re-enables type-edge cycles. Nothing warns, and the
caller's intent was unrelated.

The same shape reaches users through a variable: `beFreeOfCycles(opts)` where `opts` came from config and
happens not to set the field.

## Fix as shipped

Resolved per field, **once, in the condition**, and passed down as a complete object — so the graph and
the details lookup cannot disagree about what the default was:

```ts
export function beFreeOfCycles(options?: ImportOptions): Condition<Slice> {
  const ignoreTypeImports = options?.ignoreTypeImports ?? true
  …
}
```

Then pass the resolved value down rather than the caller's object, so the graph and the details lookup
cannot disagree about what the default was.

Check the sibling conditions while there: `notDependOn`/`respectLayerOrder` default to _counting_ type
edges, which is `?? false` — the same shape, and correct today only because `undefined` is falsy. Make it
explicit so a future default change is a one-line edit rather than an audit.

## Test inventory

1. **`beFreeOfCycles({})` behaves as `beFreeOfCycles()`**, by identity. Reds today.
2. **`beFreeOfCycles({ ignoreTypeImports: false })` still reports**, so the fix is not "ignore the
   argument".
3. **A second field on `ImportOptions` does not change the default** — simulate it with an object carrying
   an unrelated key, since this is the failure mode that arrives later.
4. **The same three rows for `notDependOn` and `respectLayerOrder`**, whose default is the opposite.

## Related

- [Plan 0084](../../plans/completed/0084-cycle-detection-that-ignores-type-only-imports.md) — introduced the
  default, and its own test rows all pass an explicit field, which is why none of them caught this.
- `src/conditions/slice.ts`, `src/helpers/slice-graph.ts`.

## Sabotage

| Revert                                                            | Result                                   |
| ----------------------------------------------------------------- | ---------------------------------------- |
| Back to a whole-object default on `beFreeOfCycles`                | CAUGHT — the `{}` row and the spread row |
| `?? true` becomes `?? false` on cycles                            | CAUGHT — the no-argument row             |
| `?? false` becomes `?? true` on `notDependOn`/`respectLayerOrder` | CAUGHT — the coupling-default rows       |

**One case is recorded rather than tested, and the reason is worth keeping.** An options object carrying an
unrelated _future_ field of `ImportOptions` is rejected by TypeScript's excess-property check (TS2559), and
expressing it would need an `as` cast, which ADR-005 bars. So the type system is a second line of defence
for the literal form — and stops being one the moment a second field genuinely exists. The guard for that
day is the per-field resolution itself. The test says so in place of pretending to cover it.
