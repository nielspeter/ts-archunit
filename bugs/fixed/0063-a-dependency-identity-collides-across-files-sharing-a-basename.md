# Bug 0063: a dependency finding's identity collides across files sharing a basename

**Reported:** 2026-08-04 · **Fixed:** 2026-08-04 (v0.53.0)
**Found in:** every version since [bug 0028](./0028-two-findings-in-one-file-can-share-a-baseline-identity.md)
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

## Corrected scope — this report was wrong in BOTH directions

Written in a hurry and reviewed before implementing, which changed it twice. Measured:

**Too broad.** It claimed "every dependency finding's hash moves". Only **three** conditions route through
the identity-setting constructor `edgeViolation` — `notImportFrom`, `onlyImportFrom` and the type-only
import check. `notHaveAliasedImports` goes through `importViolation`, which sets **no** identity, and its
message contains the specifier, so it does not collide.

**Too narrow, and this is the worse half.** `dependOn` sets **no identity at all** and collides _harder_:

```
/src/services/alpha/index.ts  element=index.ts  identity=undefined  hash=22ddc5d11c54210a
/src/services/beta/index.ts   element=index.ts  identity=undefined  hash=22ddc5d11c54210a
findings=2  distinct=1
```

Its `element` is the basename and its message — `"<basename> does not import from any path matching […]"` —
never names the file. So two sibling folders each with an `index.ts` are one finding, with **nothing to
correct in an identity** because there is none. That needs an identity _added_, not fixed.

**One claim came out stronger.** The report worried whether an absolute path is safe. It is, and not as a
new bet: the existing identity's third component is `edgeCandidates(edge, sourceFile)[0]`, which is already
the resolved **absolute path of the target** — measured as `/src/legacy/index.ts`. And `root` is populated
by default (`discoverIdentityRoot(baselineDir)`), so `normalizeIdentityText` really does run. Using the
source path adds nothing the identity did not already depend on.

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

**Two changes, not one** — the corrected scope above is why:

1. `edgeViolation`: `sourceFile.getBaseName()` → `sourceFile.getFilePath()`, as the slice conditions now do.
   Affects `notImportFrom`, `onlyImportFrom`, the type-only check.
2. `dependOn`: **add** an identity — the file path plus the globs it failed to match. There is nothing to
   correct there today; the finding has been basename-identified since it shipped.

**Baseline impact: the hashes of findings from those four conditions move, once** — not every dependency
finding, per the corrected scope. That is the whole cost and the reason
this is filed rather than folded into v0.52.0 — the slice migration in that release is already one
regeneration, and quietly adding a second family to it would have made the upgrade note wrong about its own
scope. Consider whether `HASH_VERSION` should increment, as it did for 0028; read that mechanism rather
than assuming, since the _format_ is unchanged and only an input moves.

Check while there whether `edgeCandidates(edge, sourceFile)[0]` is doing the work its comment claims. Its
docstring argues against adding the root because `[0]` is the primary candidate either way — fine — but the
component it yields is a property of the target, and with the source now identified by path it may be
redundant. Do not remove it in the same change: that would move the hash twice.

## Test inventory

1. **Two files sharing a basename, same edge, are distinct findings** — for `notImportFrom` (identity
   present) **and** for `dependOn` (identity absent). Both measurements above, as rows. Both red today,
   and they fail for different reasons, which is why one row cannot stand for both.
   1b. **`notHaveAliasedImports` is UNAFFECTED**, asserted — the control that keeps the fix from being
   "add a path everywhere" and pins the corrected scope.
2. **One baseline entry accepts exactly one of them**, asserted through `isKnown` rather than inferred from
   the hash.
3. **The same-file case from bug 0028 still holds** — the anti-regression row, since that fix is what this
   builds on.
4. **Migration measured** before and after through the real `hashViolation`, per the standard plan 0084 set
   by omitting it.
5. **VACUITY: both files really produced a finding** — a 1-of-1 comparison proves nothing.

## Related

- [Bug 0028](./0028-two-findings-in-one-file-can-share-a-baseline-identity.md) — the same field, the
  adjacent shape, already fixed once.
- [Plan 0088](../../plans/0088-a-slice-finding-identifies-itself.md) — copied this scheme, hit the collision,
  and fixed it on its own side.
- `src/conditions/dependency.ts`, `src/helpers/baseline.ts`, `src/core/identity-root.ts`.

## Fix as shipped — THREE mechanisms, after the report was wrong about its own scope twice

Reviewing this report before implementing it changed the scope twice, and writing the test rows changed it
a third time. The sequence is the useful part:

**Round 1 — the report as filed** claimed "every dependency finding's hash moves". Wrong: only three
conditions route through the identity-setting constructor.

**Round 2 — reviewing it** found the opposite error as well. `dependOn` sets **no identity at all** and
collides _harder_, with nothing in an identity to blame:

```
/src/services/alpha/index.ts  element=index.ts  identity=undefined  hash=22ddc5d11c54210a
/src/services/beta/index.ts   element=index.ts  identity=undefined  hash=22ddc5d11c54210a
findings=2  distinct=1
```

**Round 3 — a CONTROL row disproved the corrected scope.** I asserted `notHaveAliasedImports` was
unaffected because its message "names the specifier". It names the **alias**, which two sibling files share
equally, so it collides too. The row written to _rule out_ a third mechanism found one — after the first
two were already fixed.

So, three changes:

1. `edgeViolation`: `getBaseName()` → `getFilePath()`. Affects `notImportFrom`, `onlyImportFrom` and the
   type-only import check.
2. `dependOn`: an identity **added** — `path::depends-on::sorted-globs`. The globs belong in it because this
   finding is about a _requirement_ not met rather than an edge, so one file can fail several.
3. `importViolation`: takes a `subject` from its caller and prefixes the path. `notHaveAliasedImports`
   passes `aliased::<name>::<alias>`, which separates two aliases in one file as well as two files.

An absolute path is safe and not a new bet: the existing identity's third component is already the resolved
absolute path of the _target_, and `root` defaults to `discoverIdentityRoot(baselineDir)`, so
`normalizeIdentityText` really runs.

## What this says about the process

**All 3095 tests passed while all three collisions were live.** They were untested, which is why they
survived from bug 0028 — and the fix for one family (the slices, v0.52.1) is what exposed them, because
copying a scheme copies its defects.

Two guards caught me during the work, both worth naming: plan 0079's cardinality scanner flagged the new
test file for count-only assertions — **the second time in one day** — and the failed control above.

## Residual, found by an adversarial pass before tagging — and NOT introduced here

Two identical aliased imports in one file still collide:

```
line=1  id=/src/f/index.ts::aliased::x::y   hash=d3c800c1f7543267
line=2  id=/src/f/index.ts::aliased::x::y2  hash=26d11d51f12ff4b4
line=3  id=/src/f/index.ts::aliased::x::y   hash=d3c800c1f7543267
findings=3  distinct=2
```

`import { x as y }` written twice is legal TypeScript, and lines 1 and 3 are two statements with one
identity.

**Unchanged by this fix, not caused by it.** Before, the same pair fell back to `element::message` —
`"index.ts aliases \"x\" as \"y\""` for both — and collided identically. Left as-is deliberately: the only
thing separating them is the line, and a coordinate is precisely what `identity` exists to survive. The
dependency family already carries a stated residual of the same kind for `import { X }` versus
`import { X as Y }`, for the same reason.

Recorded rather than chased, and recorded rather than left for someone to rediscover as a new bug.

**Also checked and sound:** the added absolute path stays portable. Measured, the same logical identity
under `/Users/me/proj` and `/home/runner/proj` hashes identically once a root is supplied, and `root`
defaults to `discoverIdentityRoot(baselineDir)`. Without a root they differ — which is why that default
exists, and is bug 0010's original subject.

## Sabotage

| Revert                                                     | Result                                   |
| ---------------------------------------------------------- | ---------------------------------------- |
| `getFilePath()` back to `getBaseName()` in `edgeViolation` | CAUGHT — the `notImportFrom` row         |
| `dependOn`'s identity removed                              | CAUGHT — the `dependOn` row              |
| `dependOn`'s identity drops the globs                      | CAUGHT — the two-glob-sets row           |
| `importViolation`'s identity removed                       | CAUGHT — both aliased rows               |
| `importViolation`'s subject drops the alias                | CAUGHT — the two-aliases-in-one-file row |
