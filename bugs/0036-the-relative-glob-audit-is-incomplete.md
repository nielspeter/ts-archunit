# Bug 0036: the project-relative glob audit covers five surfaces, and there are more

**Reported:** 2026-08-01
**Found in:** v0.36.1, by the architect review of [bug 0033](./fixed/0033-assignedFrom-does-not-accept-a-project-relative-glob.md)
**Status:** OPEN
**Severity:** Low-to-medium, and mostly a **documentation** defect today. Nothing is silently wrong at runtime — an unsupported relative glob matches nothing, which since v0.34.0 is a loud failure, not a false green. The cost is that `docs/slices.md` said "every surface" when the audit covered five.

## What is established

Plan 0067 part C normalized the path predicates; bug 0033 added `assignedFrom()`. `tests/core/relative-globs-are-uniform.test.ts` covers five surfaces and asserts each resolves a relative glob against the project root, agrees with the absolute spelling by count, is **narrower** than the anchored spelling, and still finds nothing for an absent folder.

## What is not

Review named three further entry points that take a `file-path` glob and do not route through `project-relative.ts`:

- `crossLayer().layer(name, pattern)` — `src/builders/cross-layer-builder.ts`
- `smells.*.inFolder(glob)` — `src/smells/smell-builder.ts`
- `onlyBeImportedVia(...globs)` — `src/conditions/reverse-dependency.ts`

**Reproduce before fixing.** The review reported `onlyBeImportedVia` giving 7 violations relative against 5 anchored; measured again on `tests/fixtures/modules` it was **5 and 5**, so that specific number did not reproduce and the claim is recorded here as unverified rather than as fact. What is not in question is that none of the three calls `isProjectRelative`/`relativeToRoot`, so any support they have is incidental.

`onlyBeImportedVia` deserves its own thought regardless: it is a **condition**, and `diagnose()` exempts condition-position globs by design (0069's decision table), so a wrong glob there is invisible to `doctor` in a way a selector's is not.

## The guard's real weakness

`tests/core/relative-globs-are-uniform.test.ts` is an `it.each` over a **hand-written array**. Its stated purpose is that "a new surface added without normalization fails" — it cannot do that: a new surface adds no row. That is the same defect as one test per surface, which is the defect the table was written to remove.

`tests/docs/doc-globs-are-anchored.test.ts` already solves this shape by deriving its population from source rather than from a list, and says why: _"knows which APIs it is classifying, so a new one is not silently unchecked."_ The fix here is the same — enumerate every `globAnyOf(…, 'file-path')` / `globNode({ kind: 'file-path' })` call site in `src/` and require each to appear in the table, so adding a surface fails until it is classified.

## Fix

1. Derive the surface census from source, and fail on an unclassified one.
2. For each surface the census surfaces: normalize, or record why not (as `matching()` is recorded — it uses a looser rewrite deliberately, and aligning it narrows existing matches).
3. Then, and only then, restore the "every surface" wording in `docs/slices.md`.

## Related

- [Bug 0033](./fixed/0033-assignedFrom-does-not-accept-a-project-relative-glob.md), [bug 0035](./fixed/0035-a-workspace-has-no-single-root.md) — the two surfaces already done.
- `plans/completed/0067-empty-selector-safety.md` part C — where root-relative resolution started.
