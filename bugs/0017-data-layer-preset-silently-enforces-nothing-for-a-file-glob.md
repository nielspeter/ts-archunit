# Bug 0017: `dataLayerIsolation({ repositories: '<a file glob>' })` enforces nothing

**Reported:** 2026-07-26
**Found in:** all versions through v0.19.0
**Severity:** High — a preset that silently certifies nothing, for a spelling of its own option that looks correct and that its own tests use.

## Description

`dataLayerIsolation` passes `options.repositories` to `resideInFolder` at
`src/presets/data-layer.ts:39` and `:60`. `resideInFolder` matches the file's
**immediate parent directory** (`src/predicates/identity.ts:96`), so a glob that
names a _file_ can never match — the preset generates its rules, selects zero
classes, and reports nothing.

## Reproduction

Against `tests/fixtures/presets/data-layer`, which contains a class deliberately
named `bad-repo` that violates both rules:

```
repositories: '**/repositories/bad-repo.ts'    rules=2  violations=0
repositories: '**/repositories/**'             rules=2  violations=2
```

Zero, on a fixture whose whole purpose is to be reported.

## Why no test caught it

`tests/presets/data-layer.test.ts:42` — `passes when only good repo and
baseClass not specified` — passes `'**/repositories/good-repo.ts'`, a file glob,
and asserts `[]` violations. An empty selection gives `[]`, so the test is
satisfied by the bug. It would pass with `requireTypedErrors` entirely broken.

Apply ADR-008's question: _what would this test do if `dataLayerIsolation`
enforced nothing at all?_ Pass.

Worse, plan 0069's [appendix](../plans/0069-appendix-vacuous-tests.md) classified
that test as **legitimate** on the stated grounds that it was "a generated preset
rule that does not apply to the given options". Measured, the rule _does_ apply
and does generate — it just selects nothing. So the classification concealed a
live defect and, had R3b been designed to leave category A untouched, would have
made the guard preserve it.

## This is the plan's own named fault, inside a preset

Plan 0069 specifies `file-not-folder` for exactly this shape, with the measured
instance `resideInFolder('**/src/predicates/module**')` — 1 file, 0 directories.
The same fault is shipped in a preset, where the user did not write the
`resideInFolder` call and cannot see it.

## Suggested fix

The option is documented as naming repositories, and both a file glob and a
directory glob are natural spellings, so the fix is to make the natural spelling
work rather than to fail on it — the principle bug 0014 settled on and 0067-C
reached independently.

Match against the file path **and** the parent directory:

```ts
classes(p)
  .that()
  .satisfy(
    or(
      resideInFile<ClassDeclaration>(options.repositories),
      resideInFolder<ClassDeclaration>(options.repositories),
    ),
  )
```

`or()` is the correct combinator: the set is dead only when both are, which is
also what plan 0069's glob tree will report on it.

Check the other presets for the same shape before fixing this one —
`strictBoundaries({ folders })` reads the parent directory too
(`src/presets/boundaries.ts:117`), and `layeredArchitecture({ layers })` passes
its globs to `resideInFolder` as well.

## Guard this needs

- A **file** glob for `repositories` reports the violation the fixture exists to
  produce. This is the case that currently reports nothing.
- A **directory** glob still reports it (no regression).
- Both asserted with a non-empty subject set, or they are satisfiable by the bug.
- The equivalent for whichever other presets share the shape.

## Relationship to plan 0069

`doctor` would catch this today if the preset's globs were declared — R2a
declares `strictBoundaries({ folders })` but `dataLayerIsolation` has no
`globs()` at all, because it returns plain builders. That is the gap: a preset
generates rules the user never wrote, so it is exactly where a silent vacuous
rule is least visible and most costly.
