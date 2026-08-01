# Bug 0036: the project-relative glob audit covers five surfaces, and there are more

**Reported:** 2026-08-01
**Found in:** v0.36.1, by the architect review of [bug 0033](./fixed/0033-assignedFrom-does-not-accept-a-project-relative-glob.md)
**Status:** **FIXED** 2026-08-01, unreleased.
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

## Fix as shipped

**The census is derived from source.** `tests/core/every-path-glob-surface-is-classified.test.ts` walks `src/`, finds every file that both calls `globAnyOf`/`globNode` and names a path kind, and requires each to appear in a `CLASSIFIED` map as `normalized`, `rewritten` or `fixed`. Adding a path-glob entry point without deciding what a relative spelling means there now **fails, naming the file** — the one thing the hand-written table could never do. Verified by sabotage: a brand-new surface file fails the suite.

It also asserts the reverse — that nothing stays classified after it stops declaring a glob — because a stale entry makes the map look more complete than it is.

Two things the census found about **itself** while being written, both fixed: a line-based scan missed `cross-layer-builder.ts` the moment prettier split its call across lines (now scans per file), and it counted `path-universe.ts`, which names the kinds in a signature but declares nothing (now requires both conditions). `glob-site.ts` is excluded by name, because it _defines_ the mechanism.

**Four surfaces were unclassified, and three of them were broken.** The audit found more than the review listed:

| Surface                                   | Before                                       | Now        |
| ----------------------------------------- | -------------------------------------------- | ---------- |
| `importFrom` / `notImportFrom` predicates | **0** modules selected vs 5 anchored         | normalized |
| `onlyBeImportedVia`                       | **5 violations** vs 0 anchored — a false red | normalized |
| `crossLayer().layer()`                    | layer resolved nothing                       | normalized |
| `smells.*.inFolder()` / `ignorePaths()`   | not normalized                               | normalized |

`onlyBeImportedVia` is the notable one: it is a **false red** of the same shape as bug 0037, one layer over — the glob is matched against the _importer's_ absolute path, so a relative one rejected every importer.

## What is guarded, and what is not

`importFrom` and `onlyBeImportedVia` have behavioural guards; both were verified by sabotage. `crossLayer` has only a **diagnosis** guard, and the reason is worth recording:

**A `crossLayer` pair rule produces zero violations whether its layer resolves three files or none.** Measured. So the runtime half of its fix is unobservable through the public API, on any fixture, and sabotaging it survives — a guard I could write would be theatre. That is a finding in its own right and the same shape as 0067-D: **an empty `crossLayer` layer is silent at check time**, visible only to `doctor`. R3b flipped selector and discovery globs; this entry point was not covered. Filed as the follow-up below rather than fixed here, because it is a behaviour change to a shipped surface, not an audit gap.

`smells.*.inFolder()` is normalized but unguarded: the duplicate-bodies fixture produces no findings at any `minLines`, so relative and anchored are indistinguishable there. It needs a fixture that actually yields a smell.

## Follow-up

- **An empty `crossLayer` layer should fail at check time**, as an empty slice discovery does (0067-D). Currently silent.
- A smells fixture that yields findings, so `inFolder()`'s normalization is guarded rather than asserted.

## Related

- [Bug 0033](./fixed/0033-assignedFrom-does-not-accept-a-project-relative-glob.md), [bug 0035](./fixed/0035-a-workspace-has-no-single-root.md) — the two surfaces already done.
- `plans/completed/0067-empty-selector-safety.md` part C — where root-relative resolution started.
