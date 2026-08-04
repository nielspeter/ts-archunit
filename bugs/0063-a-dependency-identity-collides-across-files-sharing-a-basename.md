# Bug 0063: a dependency finding's identity collides across files sharing a basename

**Reported:** 2026-08-04 · **Fixed:** not yet
**Found in:** every version since [bug 0028](./fixed/0028-two-findings-in-one-file-can-share-a-baseline-identity.md)
introduced `identity` for this family — found on 2026-08-04 while reviewing v0.52.0, because the slice
conditions copied this scheme and inherited the defect.
**Severity:** **High.** Two distinct violations share one baseline entry, so **accepting either accepts
both**, silently. `ArchViolation.identity`'s own docstring states the requirement this breaks: _"it must be
unique per finding within a rule: two distinct violations sharing one identity are one violation to the
baseline, and accepting either accepts both."_

## What

`src/conditions/dependency.ts` builds a finding's identity from the source file's **basename**:

```ts
identity: [
  sourceFile.getBaseName(),
  edge.kind,
  edgeCandidates(edge, sourceFile)[0],
  [...edge.names].sort(…).join(','),
].join('::')
```

Every component except the first is a property of the _edge_, and the first does not identify the _file_.
So two different files with the same basename, at the same depth, crossing the same edge, are one finding
to the baseline.

Measured, with `notImportFrom('**/src/legacy/**')`:

```
src/features/alpha/index.ts   id=index.ts::reexport::/src/legacy/index.ts::x   hash=e84be8d904c79cbd
src/features/beta/index.ts    id=index.ts::reexport::/src/legacy/index.ts::x   hash=e84be8d904c79cbd
findings=2  distinctHashes=1
```

Two findings, one hash.

**The layout is not exotic — it is the commonest there is.** Sibling feature folders each with an
`index.ts`, all re-exporting from a shared module. `index.ts` is precisely the basename that repeats.

## Why bug 0028 did not catch it

0028 was _"two findings in **one file** can share a baseline identity"_, and its fix — adding `identity`
with the edge's kind, target and names — solved that. This is **two findings in two files**, which the
basename cannot separate. Same family, same field, adjacent shape, and `HASH_VERSION` went to 3 for the
first one.

## How it surfaced

Plan 0088 gave the slice conditions an identity and deliberately copied this scheme, on the stated ground
that _"these two families report the same underlying edges"_ — which is true, and meant copying the flaw.
The slice version was fixed in the same release by using the source file's **full path** instead of the
basename; `hashViolation` normalises the repository root out of identity text
(`src/core/identity-root.ts`), so an absolute path stays portable between a laptop and CI.

So the two families now diverge on this one component, deliberately, and the divergence is recorded at the
slice call site. That is the wrong end state: this one should follow.

## Fix

Replace `sourceFile.getBaseName()` with `sourceFile.getFilePath()`, as the slice conditions now do.

**Baseline impact: every dependency finding's hash moves, once.** That is the whole cost and the reason
this is filed rather than folded into v0.52.0 — the slice migration in that release is already one
regeneration, and quietly adding a second family to it would have made the upgrade note wrong about its own
scope. Consider whether `HASH_VERSION` should increment, as it did for 0028; read that mechanism rather
than assuming, since the _format_ is unchanged and only an input moves.

Check while there whether `edgeCandidates(edge, sourceFile)[0]` is doing the work its comment claims. Its
docstring argues against adding the root because `[0]` is the primary candidate either way — fine — but the
component it yields is a property of the target, and with the source now identified by path it may be
redundant. Do not remove it in the same change: that would move the hash twice.

## Test inventory

1. **Two files sharing a basename, same edge, are distinct findings** — the measurement above, as a row.
   Reds today.
2. **One baseline entry accepts exactly one of them**, asserted through `isKnown` rather than inferred from
   the hash.
3. **The same-file case from bug 0028 still holds** — the anti-regression row, since that fix is what this
   builds on.
4. **Migration measured** before and after through the real `hashViolation`, per the standard plan 0084 set
   by omitting it.
5. **VACUITY: both files really produced a finding** — a 1-of-1 comparison proves nothing.

## Related

- [Bug 0028](./fixed/0028-two-findings-in-one-file-can-share-a-baseline-identity.md) — the same field, the
  adjacent shape, already fixed once.
- [Plan 0088](../plans/0088-a-slice-finding-identifies-itself.md) — copied this scheme, hit the collision,
  and fixed it on its own side.
- `src/conditions/dependency.ts`, `src/helpers/baseline.ts`, `src/core/identity-root.ts`.
